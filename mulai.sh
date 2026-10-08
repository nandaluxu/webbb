#!/usr/bin/env bash
# Nyalain Neyhra Playground: web (Next.js) + realtime obrolan (mini-service).
# Cukup jalanin satu perintah: bash mulai.sh
# Port bisa diganti: PORT=8080 bash mulai.sh   (default 3000)
# Abis nyala, buka http://localhost:3000 terus tunnel ny:
#   cloudflared tunnel --url http://localhost:3000

set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-3000}"

if command -v bun >/dev/null 2>&1; then
  RUN=bun
elif command -v npm >/dev/null 2>&1; then
  RUN=npm
else
  echo "Butuh Node.js (npm) atau bun terpasang. Install salah satu dulu."
  exit 1
fi
echo ">> runtime : $RUN"

echo ">> 1/5 pasang dependensi..."
if [ "$RUN" = bun ]; then bun install; else npm install; fi

echo ">> 2/5 pasang dependensi mini-service obrolan..."
(
  cd mini-services/obrolan
  if [ "$RUN" = bun ]; then bun install; else npm install --no-audit --no-fund; fi
)

echo ">> 3/5 siapin database SQLite (file db/custom.db, dibikin otomatis)..."
# .env ditulis ulang pakai path absolut folder ini biar resolusi db
# gak ambigu (prisma kadang nge-resolve path relatif ke lokasi laen).
echo "DATABASE_URL=file:$(pwd)/db/custom.db" > .env
export DATABASE_URL="file:$(pwd)/db/custom.db" # eksplisit — env luar gak bisa nyasar db laen
# bunx kadang gak kepasang sebagai command sendiri walau bun ada,
# jadi: bunx -> "bun x" -> npx.
if [ "$RUN" = bun ]; then
  if command -v bunx >/dev/null 2>&1; then
    bunx prisma db push
  else
    bun x prisma db push
  fi
else
  npx prisma db push
fi

echo ">> 4/5 pastiin akun owner (Neyhra) ada..."
# Idempoten: cuma bikin kalo belum ada, sandi yang udah diganti gak
# disentuh. Db kehapus/keganti pun owner ny balik sendiri tiap nyala.
# Kelupaan sandi owner: node scripts/bikin-admin.mjs --reset
if [ "$RUN" = bun ]; then
  bun scripts/bikin-admin.mjs || echo "   (dilewatin — web tetep jalan, daftar manual aja)"
else
  node scripts/bikin-admin.mjs || echo "   (dilewatin — web tetep jalan, daftar manual aja)"
fi

echo ">> 5/5 nyalain mini-service realtime (socket.io)..."
(
  cd mini-services/obrolan
  if pgrep -f "node index.js" >/dev/null 2>&1; then
    echo "   udah ada yang jalan, lewati"
  else
    nohup node index.js > obrolan.log 2>&1 &
    echo "   jalan (log: mini-services/obrolan/obrolan.log)"
  fi
)
sleep 1

echo ""
echo ">> situs jalan di http://localhost:$PORT"
echo ">> matiin: Ctrl+C (web), pkill -f 'node index.js' (obrolan)"
echo ">> expose ke internet: cloudflared tunnel --url http://localhost:$PORT"
echo ""

export PORT
if [ "$RUN" = bun ]; then
  exec bun run dev
else
  exec npm run dev
fi
