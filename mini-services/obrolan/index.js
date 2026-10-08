/* Mini-service obrolan: relai realtime buat chat global.
   - Port OBROLAN_PORT (default 3003): socket.io di path /socket.io.
     Browser nyambung same-origin lewat server Next.js, yang nyedot
     /socket.io/* terus diterusin ke sini (lihat rewrites di next.config.ts).
     Jadi cukup SATU port yang di-expose (tunnel/cloudflared/nginx).
   - Port OBROLAN_UMPUK_PORT (default 3004): endpoint HTTP /terbit, cuma
     buat server Next.js (localhost) ngumumin pesan baru biar ke-broadcast.
   Mini-service ini gak nyimpen apa-apa: penyimpanan pesan urusan
   Prisma di Next.js, ini cuma kirim-kirim.
   Bisa dijalanin node ATAU bun: node index.js */

const { createServer } = require("http");
const { Server } = require("socket.io");

const PORT = Number(process.env.OBROLAN_PORT || 3003);
const UMPUK = Number(process.env.OBROLAN_UMPUK_PORT || 3004);

const io = new Server(createServer(), {
  path: "/socket.io",
  /* Proxy (rewrite Next.js) nyampe-in URL kadang tanpa trailing slash
     (/socket.io?EIO=...). addTrailingSlash:false bikin path dicocokin
     secara prefix, jadi dua-duanya diterima. */
  addTrailingSlash: false,
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

const pemakai = new Map();

function daftarDaring() {
  const unik = [...new Set([...pemakai.values()])];
  return { jumlah: unik.length, nama: unik };
}

function siarkanDaring() {
  io.emit("daring", daftarDaring());
}

io.on("connection", (socket) => {
  socket.on("gabung", (data) => {
    const nama = String(data?.nama ?? "").slice(0, 24);
    if (!nama) return;
    pemakai.set(socket.id, nama);
    siarkanDaring();
  });

  /* Indikator "lagi nulis": diteruskan ke lain ny, pengirim gak perlu. */
  socket.on("menulis", (data) => {
    const nama = String(data?.nama ?? "").slice(0, 24);
    if (!nama) return;
    socket.broadcast.emit("menulis", { nama });
  });

  socket.on("disconnect", () => {
    if (pemakai.delete(socket.id)) siarkanDaring();
  });
});

/* ---------- Port umpan: pesan baru / pesan kehapus dari API Next.js ---------- */
const serverTerbit = createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(404).end();
    return;
  }
  const hapus = req.url?.startsWith("/hapus");
  if (!hapus && !req.url?.startsWith("/terbit")) {
    res.writeHead(404).end();
    return;
  }
  let badan = "";
  req.on("data", (c) => (badan += c));
  req.on("end", () => {
    try {
      const data = JSON.parse(badan);
      /* "hapus": pesan kehapus di server, semua client langsung
         ngapus dari daftar ny (id ny aja yang dibutuhin). */
      io.emit(hapus ? "hapus" : "pesan", hapus ? { id: String(data?.id ?? "") } : data);
      res.writeHead(204).end();
    } catch {
      res.writeHead(400).end();
    }
  });
});

io.listen(PORT);
serverTerbit.listen(UMPUK, "127.0.0.1", () => {
  console.log(`obrolan: socket.io /socket.io di ${PORT}, umpan /terbit di ${UMPUK}`);
});
