#!/usr/bin/env python3
"""Worker Playwright buat fallback Akinator (r24).

Dijalankan LAZY oleh src/lib/akinator/playwright.mjs HANYA kalau
HTTP langsung + proxy udah gagal kena Cloudflare. Protokol ny
JSON per baris di stdin/stdout:

  {"id":1,"cmd":"buka","gameId":"..","baseUrl":"https://id.akinator.com","ua":".."}
      -> {"id":1,"ok":true}  (buka context+page, lewatin challenge CF)
  {"id":2,"cmd":"minta","gameId":"..","url":"..","method":"POST",
    "form":"step=1&...","xhr":true,"referer":".."}
      -> {"id":2,"ok":true,"status":200,"body":"..."}
  {"id":3,"cmd":"tutup","gameId":".."}  -> {"id":3,"ok":true}

Satu browser di-share semua game (lazy start, sekali); satu context
per game (cookie keisolasi). Browser di-launch pas request "buka"
PERTAMA, bukan pas worker nyala.

ENV:
  AKINATOR_PLAYWRIGHT_EXECUTABLE_PATH  path chromium/chrome (wajib
       bisa diatur, JANGAN hardcode path browser).
  AKINATOR_PLAYWRIGHT_HEADLESS          default true.
  AKINATOR_TIMEOUT                      detik, default 60.
"""

import asyncio
import json
import os
import sys

EXEC = os.environ.get("AKINATOR_PLAYWRIGHT_EXECUTABLE_PATH") or None
HEADLESS = (os.environ.get("AKINATOR_PLAYWRIGHT_HEADLESS", "true").strip().lower()
            not in ("0", "false", "no", "off"))
TIMEOUT_S = max(5, min(300, int(os.environ.get("AKINATOR_TIMEOUT", "60") or 60)))

TANDA_CF = ("just a moment", "__cf_chl", "cf_chl_", "cf-error-details", "attention required")

_pw = None
_browser = None
_konteks = {}  # gameId -> BrowserContext
_halaman = {}  # gameId -> Page


async def _pasti_browser():
    global _pw, _browser
    if _browser:
        return _browser
    from playwright.async_api import async_playwright

    _pw = await async_playwright().start()
    _browser = await _pw.chromium.launch(
        executable_path=EXEC,
        headless=HEADLESS,
        args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    )
    return _browser


async def _lewatin_cf(halaman, base_url):
    """goto halaman depan + tunggu challenge Cloudflare kelewatin
    (challenge JS biasanya auto-redirect dalam beberapa detik)."""
    await halaman.goto(base_url + "/", wait_until="domcontentloaded", timeout=TIMEOUT_S * 1000)
    for _ in range(15):
        isi = (await halaman.content()).lower()
        if not any(t in isi for t in TANDA_CF):
            return
        await halaman.wait_for_timeout(1000)
    isi = (await halaman.content()).lower()
    if any(t in isi for t in TANDA_CF):
        raise RuntimeError("challenge cloudflare gak kelewatin setelah 15 detik")


async def _buka(cmd):
    game_id = cmd["gameId"]
    if game_id in _halaman:
        return {}
    browser = await _pasti_browser()
    konteks = await browser.new_context(user_agent=cmd.get("ua") or None, viewport={"width": 1280, "height": 800})
    halaman = await konteks.new_page()
    await _lewatin_cf(halaman, cmd["baseUrl"].rstrip("/"))
    _konteks[game_id] = konteks
    _halaman[game_id] = halaman
    return {}


async def _minta(cmd):
    game_id = cmd["gameId"]
    halaman = _halaman.get(game_id)
    if halaman is None:
        raise RuntimeError("sesi browser belum dibuka (cmd buka dulu)")
    url = cmd["url"]
    method = (cmd.get("method") or "GET").upper()
    xhr = bool(cmd.get("xhr", True))
    headers = {"Accept-Language": "id-ID,id;q=0.9,en;q=0.8"}
    if method == "POST":
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8"
    if xhr:
        headers["X-Requested-With"] = "XMLHttpRequest"
        headers["Accept"] = "application/json, text/javascript, */*; q=0.01"
    else:
        headers["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"

    hasil = await asyncio.wait_for(
        halaman.evaluate(
            """async (p) => {
                const r = await fetch(p.url, {
                    method: p.method,
                    headers: p.headers,
                    body: p.form || undefined,
                    credentials: 'include',
                });
                return { status: r.status, body: await r.text() };
            }""",
            {"url": url, "method": method, "headers": headers, "form": cmd.get("form") or None},
        ),
        timeout=TIMEOUT_S,
    )
    return {"status": hasil["status"], "body": hasil["body"]}


async def _tutup(cmd):
    game_id = cmd["gameId"]
    konteks = _konteks.pop(game_id, None)
    if konteks:
        await konteks.close()
    _halaman.pop(game_id, None)
    return {}


async def kerjakan(cmd):
    c = cmd.get("cmd")
    if c == "buka":
        return await _buka(cmd)
    if c == "minta":
        return await _minta(cmd)
    if c == "tutup":
        return await _tutup(cmd)
    if c == "ping":
        return {}
    raise RuntimeError("cmd gak dikenal: " + str(c))


async def utama():
    loop = asyncio.get_running_loop()
    antrean = asyncio.Queue()

    def baca():
        for baris in sys.stdin:
            loop.call_soon_threadsafe(antrean.put_nowait, baris)
        loop.call_soon_threadsafe(antrean.put_nowait, None)

    await asyncio.to_thread(baca)
    nomor = 0
    while True:
        baris = await antrean.get()
        if baris is None:
            break
        baris = baris.strip()
        if not baris:
            continue
        try:
            cmd = json.loads(baris)
        except ValueError:
            continue
        nomor += 1
        try:
            hasil = await kerjakan(cmd)
            balas = {"id": cmd.get("id", nomor), "ok": True}
            balas.update(hasil)
        except Exception as e:  # balas error, worker tetep hidup
            balas = {"id": cmd.get("id", nomor), "ok": False, "error": str(e)[:300]}
        sys.stdout.write(json.dumps(balas, ensure_ascii=False) + "\n")
        sys.stdout.flush()

    # stdin ketutup (server mati / gak dipake lagi): bersihin.
    for k in list(_konteks):
        try:
            await _konteks[k].close()
        except Exception:
            pass
    if _browser:
        try:
            await _browser.close()
        except Exception:
            pass
    if _pw:
        try:
            await _pw.stop()
        except Exception:
            pass


if __name__ == "__main__":
    try:
        asyncio.run(utama())
    except KeyboardInterrupt:
        pass
