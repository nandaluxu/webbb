"use client";

/* EditorPost (r24): crop CLIENT-SIDE buat foto post, SEBELUM upload.
   Muncul setelah user milih foto (bisa banyak), sebelum ke-server.
   File asli gak tersentuh: yang kebaca cuma object URL; hasil akhir
   = File baru (webp) dari area crop. File yang gak keubah (rect =
   full + gak dirotasi) tetep FILE ASLI ny (gak di-reencode, kualitas
   + ukuran ny kejaga).

   Rasio: FREE (bebas apapun) atau preset terkunci (Original, 1:1,
   4:5, 16:9, 9:16, 3:4, 4:3). Original = rasio asli foto ny.
   Alat: geser rect (drag), ubah ukuran (pegangan 4 sudut, rasio
   terkunci nurut preset), putar 90 derajat, reset, keyboard (panah
   geser, +/- ubah ukuran, R putar). Multi-foto: pindah antar foto,
   crop masing-masing (hasil ny keinget per foto). */

import { useEffect, useRef, useState } from "react";
import { TutupIkon, PutarIkon, ResetIkon, KiriIkon, KananIkon, CentangIkon } from "@/components/ikon";
import { mainkanSfx } from "@/lib/suara";
import { kunciGulir, bukaKunciGulir } from "@/lib/gulir";

const MAKS_SISI = 2048;
const MIN_SISI = 48;

type Preset = { k: string; teks: string; rasio: number | null };

/* rasio null = Free; -1 = Original (ikut rasio foto ny, terkunci). */
const PRESET: Preset[] = [
  { k: "free", teks: "Free", rasio: null },
  { k: "asli", teks: "Original", rasio: -1 },
  { k: "1:1", teks: "1:1", rasio: 1 },
  { k: "4:5", teks: "4:5", rasio: 4 / 5 },
  { k: "16:9", teks: "16:9", rasio: 16 / 9 },
  { k: "9:16", teks: "9:16", rasio: 9 / 16 },
  { k: "3:4", teks: "3:4", rasio: 3 / 4 },
  { k: "4:3", teks: "4:3", rasio: 4 / 3 },
];

type Rect = { x: number; y: number; w: number; h: number };
type Draf = { rect: Rect; preset: string; rot: number; galat: boolean };

function rectPenuh(w: number, h: number): Rect {
  return { x: 0, y: 0, w, h };
}

/* Rect terbesar dengan rasio r yang muat di dalem gambar,
   dipusatin di titik tengah (cx, cy) — dipake pas ganti preset biar
   areany gak jomplang. */
function rectRasio(w: number, h: number, r: number, cx = w / 2, cy = h / 2): Rect {
  let rw = w;
  let rh = Math.round(w / r);
  if (rh > h) {
    rh = h;
    rw = Math.round(h * r);
  }
  return {
    x: Math.max(0, Math.min(w - rw, Math.round(cx - rw / 2))),
    y: Math.max(0, Math.min(h - rh, Math.round(cy - rh / 2))),
    w: rw,
    h: rh,
  };
}

function jepitRect(r: Rect, w: number, h: number): Rect {
  const rw = Math.max(MIN_SISI, Math.min(w, Math.round(r.w)));
  const rh = Math.max(MIN_SISI, Math.min(h, Math.round(r.h)));
  return {
    x: Math.max(0, Math.min(Math.round(w - rw), Math.round(r.x))),
    y: Math.max(0, Math.min(Math.round(h - rh), Math.round(r.y))),
    w: rw,
    h: rh,
  };
}

export default function EditorPost({
  files,
  onSelesai,
  onBatal,
}: {
  files: File[];
  onSelesai: (hasil: File[]) => void;
  onBatal: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [siap, setSiap] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState("");
  const [draf, setDraf] = useState<Draf[]>(() =>
    files.map(() => ({ rect: { x: 0, y: 0, w: 0, h: 0 }, preset: "free", rot: 0, galat: false }))
  );

  const imgRef = useRef<(HTMLImageElement | null)[]>([]);
  const urlRef = useRef<(string | null)[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
  const kanvasRef = useRef<HTMLCanvasElement>(null);
  const praRef = useRef<HTMLCanvasElement>(null);
  const sumberRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  /* Cermin state buat listener pointer (biar gak nyimpen stale
     closure: dimensi + rasio bisa ganti pas rotate/preset). */
  const dimRef = useRef({ w: 0, h: 0, rasio: null as number | null });
  const drafRef = useRef(draf);
  drafRef.current = draf;

  /* Muat semua file ke <img> (object URL, dibersihin pas nutup). */
  useEffect(() => {
    let hidup = true;
    files.forEach((f, i) => {
      const url = URL.createObjectURL(f);
      urlRef.current[i] = url;
      const img = new Image();
      img.decoding = "sync";
      img.onload = () => {
        if (!hidup) return;
        imgRef.current[i] = img;
        setDraf((p) => {
          if (p[i].rect.w) return p;
          const q = [...p];
          q[i] = { ...q[i], rect: rectPenuh(img.naturalWidth, img.naturalHeight) };
          return q;
        });
        if (i === 0) setSiap(true);
      };
      img.onerror = () => {
        if (!hidup) return;
        setDraf((p) => {
          const q = [...p];
          q[i] = { ...q[i], galat: true };
          return q;
        });
      };
      img.src = url;
    });
    return () => {
      hidup = false;
      urlRef.current.forEach((u) => u && URL.revokeObjectURL(u));
      urlRef.current = [];
      sumberRef.current.clear();
    };
  }, [files]);

  /* Kunci gulir + Esc = batal. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sibuk) {
        mainkanSfx("ui-dissolve");
        onBatal();
      }
    };
    document.addEventListener("keydown", onKey);
    kunciGulir();
    return () => {
      document.removeEventListener("keydown", onKey);
      bukaKunciGulir();
    };
  }, [onBatal, sibuk]);

  const img = imgRef.current[idx];
  const d = draf[idx];
  const miring = !!d && d.rot % 180 !== 0;
  const dimW = img ? (miring ? img.naturalHeight : img.naturalWidth) : 0;
  const dimH = img ? (miring ? img.naturalWidth : img.naturalHeight) : 0;
  const presetSekarang = PRESET.find((p) => p.k === d?.preset) ?? PRESET[0];
  const rasioTerkunci =
    presetSekarang.k === "free" ? null : presetSekarang.rasio === -1 ? (dimW && dimH ? dimW / dimH : null) : presetSekarang.rasio;

  /* Dimensi + rasio terkini di-share ke listener pointer. */
  dimRef.current = { w: dimW, h: dimH, rasio: rasioTerkunci };

  /* Sumber terputar (canvas) — dibikin sekali per (idx, rot). */
  function sumber(i: number, rot: number): HTMLImageElement | HTMLCanvasElement | null {
    const im = imgRef.current[i];
    if (!im) return null;
    if (rot % 360 === 0) return im;
    const k = i + ":" + rot;
    const ada = sumberRef.current.get(k);
    if (ada) return ada;
    const c = document.createElement("canvas");
    c.width = im.naturalHeight;
    c.height = im.naturalWidth;
    const ctx = c.getContext("2d");
    if (!ctx) return im;
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(im, -im.naturalWidth / 2, -im.naturalHeight / 2);
    sumberRef.current.set(k, c);
    return c;
  }

  /* Gambar sumber (terputar) ke kanvas panggung + pratinjau mini.
     Kanvas, bukan <img>, biar hasil rotasi ny gak lewat dataURL
     (gede + lambat). */
  useEffect(() => {
    const src = sumber(idx, d?.rot ?? 0);
    const kan = kanvasRef.current;
    if (!src || !kan) return;
    const w = src instanceof HTMLCanvasElement ? src.width : src.naturalWidth;
    const h = src instanceof HTMLCanvasElement ? src.height : src.naturalHeight;
    kan.width = w;
    kan.height = h;
    const ctx = kan.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, w, h);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(src, 0, 0);
    }
    /* Pratinjau mini hasil crop. */
    const pra = praRef.current;
    if (pra && d && !d.galat && d.rect.w > 0) {
      const maks = 116;
      const skala = Math.min(1, maks / Math.max(d.rect.w, d.rect.h));
      pra.width = Math.max(1, Math.round(d.rect.w * skala));
      pra.height = Math.max(1, Math.round(d.rect.h * skala));
      const pctx = pra.getContext("2d");
      if (pctx) {
        pctx.clearRect(0, 0, pra.width, pra.height);
        pctx.imageSmoothingQuality = "high";
        pctx.drawImage(src, d.rect.x, d.rect.y, d.rect.w, d.rect.h, 0, 0, pra.width, pra.height);
      }
    }
  }, [idx, d?.rect.x, d?.rect.y, d?.rect.w, d?.rect.h, d?.rot, siap]);

  function ubahDraf(i: number, ubah: Partial<Draf>) {
    setDraf((p) => {
      const q = [...p];
      q[i] = { ...q[i], ...ubah };
      return q;
    });
  }

  function pilihPreset(p: Preset) {
    if (!img || !d || d.galat) return;
    mainkanSfx("ui-menu");
    if (p.k === "free") {
      ubahDraf(idx, { preset: p.k });
      return;
    }
    const rasio = p.rasio === -1 ? dimW / dimH : p.rasio!;
    const cx = d.rect.x + d.rect.w / 2;
    const cy = d.rect.y + d.rect.h / 2;
    ubahDraf(idx, { preset: p.k, rect: jepitRect(rectRasio(dimW, dimH, rasio, cx, cy), dimW, dimH) });
  }

  function putar() {
    if (!img || !d || d.galat) return;
    mainkanSfx("ui-menu");
    const rotBaru = (d.rot + 90) % 360;
    /* Preset terkunci: rect di-re-fit ke rasio preset di ruang ny
       (dipusatin di tengah rect lama). Free: rect ny ke-remap ke
       ruang baru (area yang sama, rasio ny kebalik). */
    if (rasioTerkunci) {
      const cx = d.rect.x + d.rect.w / 2;
      const cy = d.rect.y + d.rect.h / 2;
      const wBaru = miring ? img.naturalWidth : img.naturalHeight;
      const hBaru = miring ? img.naturalHeight : img.naturalWidth;
      ubahDraf(idx, { rot: rotBaru, rect: jepitRect(rectRasio(wBaru, hBaru, rasioTerkunci, cx, cy), wBaru, hBaru) });
    } else {
      const wBaru = dimH;
      const hBaru = dimW;
      ubahDraf(idx, {
        rot: rotBaru,
        rect: jepitRect({ x: dimH - (d.rect.y + d.rect.h), y: d.rect.x, w: d.rect.h, h: d.rect.w }, wBaru, hBaru),
      });
    }
  }

  function reset() {
    if (!img || !d) return;
    mainkanSfx("ui-dissolve");
    ubahDraf(idx, { rot: 0, rect: rectPenuh(img.naturalWidth, img.naturalHeight), preset: "free" });
  }

  function pindah(arah: number) {
    const ke = Math.max(0, Math.min(files.length - 1, idx + arah));
    if (ke !== idx) {
      mainkanSfx("ui-menu");
      setIdx(ke);
    }
  }

  /* ---------- Interaksi pointer di panggung ----------
     Drag badan rect = geser; drag sudut = ubah ukuran (rasio
     terkunci nurut preset: dimensi pengikut ngikut yang gerak). */
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !siap) return;
    let mode: null | "geser" | "sudut" = null;
    let sudut = "";
    let awal: { px: number; py: number; rect: Rect } | null = null;

    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      const peg = target.dataset.sudut;
      const diRect = target.closest(".ep-rect");
      if (!peg && !diRect) return;
      const d0 = drafRef.current[idx];
      if (!d0 || d0.galat || !d0.rect.w) return;
      el.setPointerCapture(e.pointerId);
      mode = peg ? "sudut" : "geser";
      sudut = peg || "";
      awal = { px: e.clientX, py: e.clientY, rect: { ...d0.rect } };
      e.preventDefault();
    };

    const onMove = (e: PointerEvent) => {
      if (!mode || !awal) return;
      const { w: dimW0, h: dimH0, rasio } = dimRef.current;
      if (!dimW0 || !dimH0) return;
      const kotak = el.getBoundingClientRect();
      const skala = dimW0 / kotak.width;
      const dx = (e.clientX - awal.px) * skala;
      const dy = (e.clientY - awal.py) * skala;
      const r0 = awal.rect;

      if (mode === "geser") {
        setDraf((p) => {
          const q = [...p];
          q[idx] = { ...q[idx], rect: jepitRect({ ...r0, x: r0.x + dx, y: r0.y + dy }, dimW0, dimH0) };
          return q;
        });
        return;
      }

      let x1 = r0.x;
      let y1 = r0.y;
      let x2 = r0.x + r0.w;
      let y2 = r0.y + r0.h;
      if (sudut.includes("k")) x1 += dx;
      else x2 += dx;
      if (sudut.includes("a")) y1 += dy;
      else y2 += dy;

      let w = Math.max(MIN_SISI, Math.min(dimW0, x2 - x1));
      let h = Math.max(MIN_SISI, Math.min(dimH0, y2 - y1));
      if (rasio) {
        /* Dimensi pengikut nurut yang gerakny lebih jauh (relatif). */
        if (Math.abs(w - r0.w) / (r0.w || 1) >= Math.abs(h - r0.h) / (r0.h || 1)) {
          h = w / rasio;
          w = h * rasio;
        } else {
          w = h * rasio;
          h = w / rasio;
        }
        if (h > dimH0) {
          h = dimH0;
          w = h * rasio;
        }
        if (w > dimW0) {
          w = dimW0;
          h = w / rasio;
        }
      }
      /* Pantulan (sisi yang tetap) nempel: geser sisi lawan ny. */
      if (sudut.includes("k")) x1 = Math.max(0, Math.min(x2 - MIN_SISI, x2 - w));
      else x2 = Math.max(x1 + MIN_SISI, Math.min(dimW0, x1 + w));
      if (sudut.includes("a")) y1 = Math.max(0, Math.min(y2 - MIN_SISI, y2 - h));
      else y2 = Math.max(y1 + MIN_SISI, Math.min(dimH0, y1 + h));
      const rect = jepitRect({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, dimW0, dimH0);
      setDraf((p) => {
        const q = [...p];
        q[idx] = { ...q[idx], rect };
        return q;
      });
    };

    const onUp = () => {
      mode = null;
      awal = null;
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [siap, idx]);

  /* Keyboard di panggung: panah geser, +/- ubah ukuran, R putar. */
  function keyPanggung(e: React.KeyboardEvent) {
    if (!d || d.galat) return;
    const langkah = e.shiftKey ? 1 : 8;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const dx = e.key === "ArrowLeft" ? -langkah : e.key === "ArrowRight" ? langkah : 0;
      const dy = e.key === "ArrowUp" ? -langkah : e.key === "ArrowDown" ? langkah : 0;
      ubahDraf(idx, { rect: jepitRect({ ...d.rect, x: d.rect.x + dx, y: d.rect.y + dy }, dimW, dimH) });
    } else if (e.key === "+" || e.key === "=" || e.key === "-" || e.key === "_") {
      e.preventDefault();
      const f = e.key === "+" || e.key === "=" ? 1.1 : 1 / 1.1;
      const cx = d.rect.x + d.rect.w / 2;
      const cy = d.rect.y + d.rect.h / 2;
      let w = d.rect.w * f;
      let h = rasioTerkunci ? w / rasioTerkunci : d.rect.h * f;
      if (rasioTerkunci && h > dimH) {
        h = dimH;
        w = h * rasioTerkunci;
      }
      if (w > dimW) {
        w = dimW;
        h = rasioTerkunci ? w / rasioTerkunci : d.rect.h * f;
      }
      ubahDraf(idx, { rect: jepitRect({ x: cx - w / 2, y: cy - h / 2, w, h }, dimW, dimH) });
    } else if (e.key.toLowerCase() === "r") {
      e.preventDefault();
      putar();
    }
  }

  /* ---------- Hasil: potong (webp) atau file asli ---------- */
  async function potongSatu(i: number): Promise<File> {
    const d0 = draf[i];
    const im = imgRef.current[i];
    const asli = files[i];
    if (!im || !d0 || d0.galat) return asli;
    const utuh =
      d0.rect.x <= 0 && d0.rect.y <= 0 && d0.rect.w >= im.naturalWidth && d0.rect.h >= im.naturalHeight && d0.rot % 360 === 0;
    if (utuh) return asli;
    const src = sumber(i, d0.rot);
    if (!src) return asli;
    const sw = src instanceof HTMLCanvasElement ? src.width : src.naturalWidth;
    const sh = src instanceof HTMLCanvasElement ? src.height : src.naturalHeight;
    const rect = jepitRect(d0.rect, sw, sh);
    const skala = Math.min(1, MAKS_SISI / Math.max(rect.w, rect.h));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(rect.w * skala));
    c.height = Math.max(1, Math.round(rect.h * skala));
    const ctx = c.getContext("2d");
    if (!ctx) return asli;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((ya) => c.toBlob(ya, "image/webp", 0.92));
    if (!blob || blob.type !== "image/webp") throw new Error("potong gagal");
    const nama = asli.name.replace(/\.[^.]+$/, "") || "foto";
    return new File([blob], nama + ".webp", { type: "image/webp" });
  }

  async function selesai() {
    setSibuk(true);
    setGalat("");
    mainkanSfx("ui-menu");
    try {
      const hasil: File[] = [];
      for (let i = 0; i < files.length; i++) {
        hasil.push(await potongSatu(i));
      }
      setSibuk(false);
      onSelesai(hasil);
    } catch {
      setSibuk(false);
      setGalat("Gagal motong salah satu foto. Coba lagi.");
      mainkanSfx("failure");
    }
  }

  const terakhir = idx === files.length - 1;
  const pct = (n: number, total: number) => (total > 0 ? (n / total) * 100 : 0);

  return (
    <div
      className="pfp-lapis"
      role="dialog"
      aria-modal="true"
      aria-label="Atur potongan foto"
      onClick={(e) => e.target === e.currentTarget && !sibuk && onBatal()}
    >
      <section className="ep-kotak">
        <button type="button" className="post-tutup" data-sfx="ui-dissolve" aria-label="Batal" onClick={onBatal} disabled={sibuk}>
          <TutupIkon />
        </button>

        <h2>Atur potongan ny</h2>
        <p className="ep-ket">Geser atau tarik sudut kotakny buat milih bagian yang kepake. File asli lu gak berubah sebelum nyimpen.</p>

        <div className="ep-badan">
          <div
            className={"ep-panggung" + (siap && !d?.galat ? "" : " memuat")}
            ref={stageRef}
            tabIndex={0}
            role="application"
            aria-label={"Area potong foto " + (idx + 1) + " dari " + files.length}
            onKeyDown={keyPanggung}
            style={dimW && dimH ? { aspectRatio: String(dimW / dimH) } : undefined}
          >
            <canvas ref={kanvasRef} className="ep-kanvas" aria-hidden="true" />
            {d && !d.galat && dimW > 0 && (
              <div
                className="ep-rect"
                style={{
                  left: pct(d.rect.x, dimW) + "%",
                  top: pct(d.rect.y, dimH) + "%",
                  width: pct(d.rect.w, dimW) + "%",
                  height: pct(d.rect.h, dimH) + "%",
                }}
              >
                <span className="ep-sudut" data-sudut="ka" />
                <span className="ep-sudut" data-sudut="ki" />
                <span className="ep-sudut" data-sudut="aa" />
                <span className="ep-sudut" data-sudut="ai" />
              </div>
            )}
            {(!siap || d?.galat) && <span className="ep-memuat" aria-hidden="true" />}
          </div>

          <div className="ep-sisi">
            <div className="ep-pra">
              <canvas ref={praRef} className="ep-pra-kanvas" role="img" aria-label="Pratinjau hasil potongan" />
              <span className="ep-pra-ket">Hasil</span>
            </div>
            <div className="ep-alat" role="group" aria-label="Alat potong">
              <button type="button" className="btn kecil" onClick={putar} disabled={!siap || !!d?.galat} aria-label="Putar 90 derajat">
                <PutarIkon ukuran={15} />
              </button>
              <button type="button" className="btn kecil" onClick={reset} disabled={!siap || !!d?.galat} aria-label="Atur ulang potongan">
                <ResetIkon ukuran={15} />
              </button>
            </div>
            {files.length > 1 && (
              <div className="ep-nav" role="group" aria-label={"Pilih foto " + (idx + 1) + " dari " + files.length}>
                <button type="button" className="btn kecil" onClick={() => pindah(-1)} disabled={idx === 0} aria-label="Foto sebelumny">
                  <KiriIkon ukuran={15} />
                </button>
                <span className="ep-nav-ket">
                  Foto {idx + 1}/{files.length}
                </span>
                <button type="button" className="btn kecil" onClick={() => pindah(1)} disabled={terakhir} aria-label="Foto berikutny">
                  <KananIkon ukuran={15} />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="ep-preset" role="group" aria-label="Rasio potongan">
          {PRESET.map((p) => (
            <button
              key={p.k}
              type="button"
              className={"btn kecil ep-preset-btn" + (presetSekarang.k === p.k ? " primary" : "")}
              aria-pressed={presetSekarang.k === p.k}
              onClick={() => pilihPreset(p)}
              disabled={!siap || !!d?.galat}
            >
              {p.teks}
            </button>
          ))}
        </div>

        {galat && (
          <p className="hint" role="alert" style={{ color: "var(--tanda)" }}>
            {galat}
          </p>
        )}
        {d?.galat && (
          <p className="hint" role="alert" style={{ color: "var(--tanda)" }}>
            Foto {idx + 1} gak kebaca (file rusak?); file asli ny yang bakal kepake.
          </p>
        )}

        <div className="ep-aksi">
          <button type="button" className="btn" onClick={onBatal} disabled={sibuk}>
            Batal
          </button>
          <button type="button" className="btn primary" onClick={selesai} disabled={sibuk || !siap}>
            {sibuk ? "Nyunuh..." : terakhir ? "Selesai" : "Lanjut ke foto berikutny"}
          </button>
        </div>
        {files.length > 1 && !terakhir && (
          <button type="button" className="tautan-kecil ep-lompat" onClick={selesai} disabled={sibuk || !siap}>
            <CentangIkon ukuran={12} />
            Udah, pake semua yang udah diatur
          </button>
        )}
        <p className="ep-catatan">Panah = geser, +/- = ubah ukuran, R = putar. Preset ngunci rasio; Free bebas.</p>
      </section>
    </div>
  );
}
