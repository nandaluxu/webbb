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

/* ---------- Chat pribadi (r32) ----------
   Ruang per pasangan teman: "pv:" + dua userId ke-sort, jadi dua
   browser yang nge-join pasangan yang sama pasti nyampe di ruang
   yang sama (gak peduli siapa yang nge-join duluan). Key ny
   dihitung dari id yang dikirim klien + id pengirim di umpan
   port dari API Next.js — dua-duany pake fungsi ini, jadi gak
   bisa geser mesh. */
function ruanganPv(a, b) {
  return "pv:" + [String(a), String(b)].sort().join("+");
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

  /* Chat pribadi: klien minta masuk/keluar ruang obrolan sama satu
     teman (ganti lawan bicara = lepas ruang lama, gabung ruang baru).
     Id ny dipake cuma buat nyusun nama ruang, gak disimpen. */
  socket.on("pv-gabung", (data) => {
    const a = String(data?.diri ?? ""), b = String(data?.lawan ?? "");
    if (!a || !b || a === b) return;
    socket.join(ruanganPv(a, b));
  });
  socket.on("pv-lepas", (data) => {
    const a = String(data?.diri ?? ""), b = String(data?.lawan ?? "");
    if (!a || !b) return;
    socket.leave(ruanganPv(a, b));
  });
  /* Indikator nulis versi pribadi: cuma ke ruang pasangan ny, dan
     cuma ke socket LAIN (si pengirim udah jelas lagi nulis). */
  socket.on("pv-menulis", (data) => {
    const a = String(data?.diri ?? ""), b = String(data?.lawan ?? "");
    if (!a || !b || a === b) return;
    socket.to(ruanganPv(a, b)).emit("pv-menulis", { dari: a });
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
  const url = req.url ?? "";
  /* Chat pribadi: ke ruang pasangan doang (bukan siaran umum).
     Dua kabar: pesan baru (pesan) + tanda "udah kebaca"
     (baca: { dariId }) — si pengirim tau ✓ ny barusan jadi ✓✓. */
  if (url.startsWith("/terbit-pv")) {
    let isi = "";
    req.on("data", (c) => (isi += c));
    req.on("end", () => {
      try {
        const data = JSON.parse(isi);
        const ruangan = String(data?.ruangan ?? "");
        if (ruangan) {
          if (data.baca) io.to(ruangan).emit("pv-baca", { dari: String(data.baca.dariId ?? "") });
          else io.to(ruangan).emit("pv-pesan", data.pesan);
        }
        res.writeHead(204).end();
      } catch {
        res.writeHead(400).end();
      }
    });
    return;
  }
  const hapus = url.startsWith("/hapus");
  if (!hapus && !url.startsWith("/terbit")) {
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
