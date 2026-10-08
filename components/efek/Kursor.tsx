"use client";

/* Kinetik Ink: kursor tinta yang ngikutin pointer dengan fisika pegas.
   Dipasang sekali di kerangka aplikasi, mouse maupun layar sentuh:
   - Perangkat mouse/trackpad: kursor nyala terus, ngikutin gerakan.
   - Layar sentuh: tinta ny muncul pas jari nempel ke layar (ikut gerakan
     jari, termasuk pas scroll), riak pas tap, larut pelan pas diangkat.
   - Kanvas digambar putih pekat + mix-blend-mode:difference, jadi
     warnany otomatis kebalik di tema terang maupun gelap.
   - Blok teks buat nyorotin kata yang lagi di-hover (cuma mode mouse). */

import { useEffect } from "react";

export default function Kursor() {
  useEffect(() => {
    const HALUS = window.matchMedia("(pointer: fine)").matches;
    const KASAR = window.matchMedia("(pointer: coarse)").matches;
    if (!HALUS && !KASAR) return;

    const gaya = document.createElement("style");
    if (HALUS) {
      gaya.textContent = "html,body,*{cursor:none !important}";
      document.head.appendChild(gaya);
    }

    const canvas = document.createElement("canvas");
    canvas.id = "ink-canvas";
    const blok = document.createElement("div");
    blok.id = "blok-teks";
    document.body.append(canvas, blok);
    const ctx = canvas.getContext("2d")!;

    let w = 0;
    let h = 0;
    function resize() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    const POINTS_MAX = 40;
    const WIDTH_MAX = 14;
    const WIDTH_MIN = 0.8;
    const SPEED_SOFT = 45;
    const SPRING = 0.22;
    const DAMPING = 0.72;
    const GRAB_SPRING = 0.06;
    const GRAB_DAMPING = 0.86;
    const GRAB_WIDTH = 0.6;
    const GRAB_HEAD = 3;
    const IDLE_DELAY_MS = 1000;
    const HIGHLIGHT_DELAY = 80;
    const CURSOR_SIZE = 8;
    const BREATH_AMOUNT = 0.15;
    const BREATH_PERIOD = 3600;

    let hasPosition = false;
    let tipeSentuh = !HALUS;
    let lepasPada = 0;

    const mouse = { x: 0, y: 0 };
    const head = { x: 0, y: 0, vx: 0, vy: 0 };
    const trail: { x: number; y: number; born: number; width: number }[] = [];
    let speed = 0;
    let isDown = false;
    let isGrabbing = false;
    let grabAmount = 0;
    let releaseKick = 0;
    let headSizeScale = 1;
    let lastMoveTime = performance.now();
    let idleAmount = 0;
    let textTarget: { x: number; y: number; w: number; h: number } | null = null;
    let textBlend = 0;
    let lastTextCheck = 0;
    const blockPos = { x: 0, y: 0, w: 0, h: 0 };
    let blockInit = false;
    const ripples: { x: number; y: number; born: number; delay: number; maxRadius: number; isWhite: boolean; duration: number }[] = [];

    function spawnRipple(x: number, y: number) {
      for (let i = 0; i < 3; i++) {
        ripples.push({
          x,
          y,
          born: performance.now(),
          delay: i * 90,
          maxRadius: 90 + i * 40,
          isWhite: i === 1,
          duration: 900 + i * 150,
        });
      }
    }

    function setPosition(x: number, y: number) {
      mouse.x = head.x = x;
      mouse.y = head.y = y;
      head.vx = head.vy = 0;
      hasPosition = true;
      try {
        sessionStorage.setItem("ink:lastPos", JSON.stringify({ x, y }));
      } catch {}
    }

    try {
      const saved = sessionStorage.getItem("ink:lastPos");
      if (saved) {
        const p = JSON.parse(saved);
        if (typeof p.x === "number" && typeof p.y === "number") {
          if (p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h) setPosition(p.x, p.y);
        }
      }
    } catch {}

    function onMove(e: PointerEvent) {
      if (e.pointerType === "touch") tipeSentuh = true;
      else tipeSentuh = false;
      if (!hasPosition) {
        setPosition(e.clientX, e.clientY);
        return;
      }
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      lastMoveTime = performance.now();
    }

    function onDown(e: PointerEvent) {
      if (e.pointerType === "touch") {
        tipeSentuh = true;
        lepasPada = 0;
        setPosition(e.clientX, e.clientY);
        spawnRipple(e.clientX, e.clientY);
        return;
      }
      tipeSentuh = false;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      isDown = true;
      if (!hasPosition) setPosition(e.clientX, e.clientY);
      spawnRipple(e.clientX, e.clientY);
    }

    function angkatJari(e: PointerEvent) {
      if (e && e.pointerType === "touch") {
        lepasPada = performance.now();
        return;
      }
      if (isDown) releaseKick = 1;
      isDown = false;
    }

    function getGlyphRect(x: number, y: number) {
      let range: Range | null = null;
      if (document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(x, y);
      } else if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(x, y);
        if (pos) {
          range = document.createRange();
          range.setStart(pos.offsetNode, pos.offset);
        }
      }
      if (!range) return null;
      const node = range.startContainer;
      if (node.nodeType !== Node.TEXT_NODE) return null;
      const text = node.textContent ?? "";
      let start = range.startOffset;
      let end = range.startOffset;
      while (start > 0 && /\S/.test(text[start - 1])) start--;
      while (end < text.length && /\S/.test(text[end])) end++;
      if (start === end) return null;
      range.setStart(node, start);
      range.setEnd(node, end);
      const rects = range.getClientRects();
      if (!rects.length) return null;
      const rect = rects[0];
      return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
    }

    function isInsideGlyph(rect: { x: number; y: number; w: number; h: number } | null, x: number, y: number) {
      if (!rect) return false;
      return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
    }

    const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);
    const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

    let lastTime = performance.now();
    let hidup = true;

    function animate(now: number) {
      if (!hidup) return;
      const dt = Math.min((now - lastTime) / 16.67, 2);
      lastTime = now;

      ctx.clearRect(0, 0, w, h);

      if (!hasPosition) {
        requestAnimationFrame(animate);
        return;
      }

      const idleFor = now - lastMoveTime;
      const wantIdle = idleFor > IDLE_DELAY_MS && !isDown && !textTarget && !isGrabbing;
      idleAmount += ((wantIdle ? 1 : 0) - idleAmount) * 0.06;

      /* Mode sentuh: setelah jari diangkat, seluruh tinta larut pelan. */
      const alphaSentuh = tipeSentuh ? Math.max(0, 1 - (now - lepasPada) / 520) : 1;
      if (tipeSentuh && alphaSentuh <= 0.02 && ripples.length === 0) {
        ctx.clearRect(0, 0, w, h);
        requestAnimationFrame(animate);
        return;
      }

      if (!tipeSentuh && now - lastTextCheck > HIGHLIGHT_DELAY && !isDown) {
        lastTextCheck = now;
        const rect = getGlyphRect(mouse.x, mouse.y);
        if (rect && isInsideGlyph(rect, mouse.x, mouse.y)) textTarget = rect;
        else textTarget = null;
      }
      if (tipeSentuh) textTarget = null;
      if (idleAmount > 0.5 || isDown) textTarget = null;
      textBlend += ((textTarget ? 1 : 0) - textBlend) * 0.12;

      if (textBlend > 0.01 && textTarget) {
        const padX = 3;
        const padY = 1;
        const tx = textTarget.x - padX;
        const ty = textTarget.y - padY;
        const tw = textTarget.w + padX * 2;
        const th = textTarget.h + padY * 2;
        if (!blockInit) {
          blockPos.x = tx;
          blockPos.y = ty;
          blockPos.w = tw;
          blockPos.h = th;
          blockInit = true;
        } else {
          const k = 0.18;
          blockPos.x += (tx - blockPos.x) * k;
          blockPos.y += (ty - blockPos.y) * k;
          blockPos.w += (tw - blockPos.w) * k;
          blockPos.h += (th - blockPos.h) * k;
        }
        blok.style.width = blockPos.w + "px";
        blok.style.height = blockPos.h + "px";
        blok.style.transform = "translate(" + blockPos.x + "px," + blockPos.y + "px)";
        blok.style.opacity = String(textBlend);
      } else {
        blok.style.opacity = "0";
        blockInit = false;
      }

      const grabTarget = isDown || isGrabbing ? 1 : 0;
      grabAmount += (grabTarget - grabAmount) * 0.18;

      const springK = SPRING * (1 - grabAmount) + GRAB_SPRING * grabAmount;
      const dampingK = DAMPING * (1 - grabAmount) + GRAB_DAMPING * grabAmount;
      const ax = (mouse.x - head.x) * springK;
      const ay = (mouse.y - head.y) * springK;
      head.vx = (head.vx + ax) * dampingK;
      head.vy = (head.vy + ay) * dampingK;

      if (releaseKick > 0.01) {
        head.vx += (mouse.x - head.x) * 0.35 * releaseKick;
        head.vy += (mouse.y - head.y) * 0.35 * releaseKick;
        releaseKick *= 0.82;
      } else {
        releaseKick = 0;
      }

      head.x += head.vx * dt;
      head.y += head.vy * dt;

      const v = Math.hypot(head.vx, head.vy);
      speed += (v - speed) * 0.25;
      const speedT = Math.min(speed / SPEED_SOFT, 1);
      const pressureT = 1 - easeOutQuint(speedT);

      let baseWidth = WIDTH_MIN + (WIDTH_MAX - WIDTH_MIN) * pressureT;
      baseWidth = baseWidth * (1 - grabAmount) + GRAB_WIDTH * grabAmount;
      let headBase = baseWidth;
      if (grabAmount > 0.02) headBase = headBase * (1 - grabAmount) + GRAB_HEAD * grabAmount;
      if (releaseKick > 0.01) headBase *= 1 + easeOutExpo(1 - releaseKick) * 0.8;
      headSizeScale += (headBase - headSizeScale) * 0.35;

      trail.push({ x: head.x, y: head.y, born: now, width: headSizeScale });
      if (trail.length > POINTS_MAX) trail.shift();

      const trailVisible = 1 - idleAmount;
      if (trailVisible > 0.02) {
        ctx.lineCap = "butt";
        ctx.lineJoin = "miter";
        for (let i = 0; i < trail.length - 1; i++) {
          const a = trail[i];
          const b = trail[i + 1];
          const t = (i + 1) / trail.length;
          const fadeAlpha = Math.pow(t, 1.8) * trailVisible * alphaSentuh;
          const taper = Math.pow(t, 0.7);
          const segWidth = Math.max(0.4, ((a.width + b.width) / 2) * taper);
          ctx.beginPath();
          ctx.lineWidth = segWidth;
          ctx.strokeStyle = "rgba(255,255,255," + fadeAlpha + ")";
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      const breathPhase = (now % BREATH_PERIOD) / BREATH_PERIOD;
      const breathScale = 1 + (1 - Math.cos(breathPhase * Math.PI * 2)) * 0.5 * BREATH_AMOUNT;
      const finalSize = Math.max(headSizeScale, 3) * (1 - idleAmount) + CURSOR_SIZE * breathScale * idleAmount;
      const size = Math.round(finalSize);
      const half = size / 2;

      ctx.globalAlpha = alphaSentuh;
      ctx.fillStyle = "rgba(255,255,255,1)";
      ctx.fillRect(head.x - half, head.y - half, size, size);
      if (idleAmount > 0.3) {
        ctx.strokeStyle = "rgba(255,255,255," + idleAmount + ")";
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(head.x - half) + 0.5, Math.round(head.y - half) + 0.5, size - 1, size - 1);
      }
      ctx.globalAlpha = 1;

      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        const age = now - r.born;
        if (age < r.delay) continue;
        const t = Math.min(1, (age - r.delay) / r.duration);
        const radius = r.maxRadius * easeOutExpo(t);
        const strokeW = 2 * (1 - easeOutQuint(t));
        if (strokeW < 0.05 || radius < 0.5) {
          ripples.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = alphaSentuh;
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = r.isWhite ? Math.max(strokeW, 1.5) : strokeW;
        ctx.beginPath();
        ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);

    const onGrabStart = () => (isGrabbing = true);
    const onGrabEnd = () => {
      if (isGrabbing) releaseKick = 1;
      isGrabbing = false;
    };
    const onUnload = () => {
      if (hasPosition) {
        try {
          sessionStorage.setItem("ink:lastPos", JSON.stringify({ x: mouse.x, y: mouse.y }));
        } catch {}
      }
    };

    window.addEventListener("mousemove", onMove as unknown as (e: MouseEvent) => void);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", angkatJari);
    window.addEventListener("pointercancel", angkatJari);
    window.addEventListener("inkgrab:start", onGrabStart);
    window.addEventListener("inkgrab:end", onGrabEnd);
    window.addEventListener("beforeunload", onUnload);

    return () => {
      hidup = false;
      window.removeEventListener("mousemove", onMove as unknown as (e: MouseEvent) => void);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", angkatJari);
      window.removeEventListener("pointercancel", angkatJari);
      window.removeEventListener("inkgrab:start", onGrabStart);
      window.removeEventListener("inkgrab:end", onGrabEnd);
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("resize", resize);
      canvas.remove();
      blok.remove();
      gaya.remove();
    };
  }, []);

  return null;
}
