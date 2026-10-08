/* Telemetry internal Akinator (r24): catat mode transport yang kepake,
   latency, dan alasan kegagalan per percobaan start. Satu-satunya
   pembaca ny dashboard owner (/api/admin/akinator) — detail teknis
   ini gak diekspos ke user biasa. Semuany di memori (reset pas
   server restart), itu cukup buat kebutuhan diagnose. */

const g = globalThis;
if (!g.__akinatorTelemetry) {
  g.__akinatorTelemetry = {
    mulai: Date.now(),
    /* per mode: { ok, gagal, msRata, terakhir: {ok, ms, alasan, at} } */
    perMode: {},
    /* percobaan start terakhir (max 8, yang lama kegeser) */
    percobaan: [],
    /* mode dari game TERAKHIR yang sukses mulai */
    modeAktif: null,
  };
}
const tel = g.__akinatorTelemetry;

function pastiMode(mode) {
  if (!tel.perMode[mode]) tel.perMode[mode] = { ok: 0, gagal: 0, msRata: 0, terakhir: null };
  return tel.perMode[mode];
}

/** Catat satu percobaan start. alasan = error code kalau gagal. */
export function catatPercobaan(mode, { ok, ms, alasan }) {
  const m = pastiMode(mode);
  const entri = { ok, ms, alasan: alasan ?? null, at: Date.now() };
  m.terakhir = entri;
  if (ok) {
    m.ok += 1;
    m.msRata = Math.round((m.msRata * (m.ok - 1) + ms) / m.ok);
    tel.modeAktif = mode;
  } else {
    m.gagal += 1;
  }
  tel.percobaan.push({ mode, ...entri });
  if (tel.percobaan.length > 8) tel.percobaan.shift();
}

/** Snapshot buat dashboard owner. */
export function snapshotTelemetry() {
  return {
    sejak: new Date(tel.mulai).toISOString(),
    modeAktif: tel.modeAktif,
    perMode: tel.perMode,
    percobaan: tel.percobaan,
  };
}
