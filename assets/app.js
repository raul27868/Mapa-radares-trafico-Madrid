// URL XLSX oficial (catálogo). Si el portal cambia, actualiza esta constante.
const REMOTE_XLSX_URL = "https://datos.madrid.es/egob/catalogo/300049-1-radares-fijos-moviles.xlsx";

// Centro aproximado de Madrid
const MADRID_CENTER = [40.4168, -3.7038];

const statusEl = document.getElementById("status");

function setStatus(msg) {
  statusEl.textContent = msg;
}

function toNumber(x) {
  if (x === null || x === undefined) return NaN;
  if (typeof x === "number") return x;
  // Normaliza coma decimal si viniera como texto
  const s = String(x).trim().replace(",", ".");
  return Number(s);
}

// Intenta encontrar una clave aunque el XLSX traiga variaciones (tildes, espacios, etc.)
function findKey(obj, candidates) {
  const keys = Object.keys(obj);
  const norm = (k) =>
    k.toLowerCase()
      .normalize("NFD").replace(/\p{Diacritic}/gu, "")
      .replace(/\s+/g, " ")
      .trim();

  const map = new Map(keys.map(k => [norm(k), k]));

  for (const c of candidates) {
    const hit = map.get(norm(c));
    if (hit) return hit;
  }
  return null;
}

async function fetchAsArrayBuffer(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
  return await res.arrayBuffer();
}

function parseXlsxToRows(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const firstSheetName = wb.SheetNames[0];
  const ws = wb.Sheets[firstSheetName];

  // sheet_to_json devuelve array de objetos usando la primera fila como cabecera
  return XLSX.utils.sheet_to_json(ws, { defval: null });
}

function buildMap() {
  const map = L.map("map", { preferCanvas: true }).setView(MADRID_CENTER, 12);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  return map;
}

function addRadarMarkers(map, rows) {
  let added = 0;
  const bounds = [];

  for (const r of rows) {
    const keyLon = findKey(r, ["Longitud", "X (WGS84)", "X"]);
    const keyLat = findKey(r, ["Latitud", "Y (WGS84)", "Y"]);
    const keyVel = findKey(r, ["Velocidad límite", "Velocidad limite", "Velocidad", "Velocidad límite (km/h)"]);
    const keyUbic = findKey(r, ["Ubicacion", "Ubicación", "Carretera o vial", "Tramo", "PK", "Sentido", "Tipo"]);

    if (!keyLon || !keyLat) continue;

    const lon = toNumber(r[keyLon]);
    const lat = toNumber(r[keyLat]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

    const vel = keyVel ? r[keyVel] : null;
    const ubic = keyUbic ? r[keyUbic] : null;

    const popupHtml = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
        <div style="font-weight:700;margin-bottom:4px">Radar</div>
        ${ubic ? `<div><strong>Ubicación:</strong> ${String(ubic)}</div>` : ""}
        <div><strong>Velocidad límite:</strong> ${vel ?? "—"}</div>
        <div style="margin-top:6px;color:#666;font-size:12px">
          <strong>Lat/Lon:</strong> ${lat.toFixed(6)}, ${lon.toFixed(6)}
        </div>
      </div>
    `;

    L.marker([lat, lon]).addTo(map).bindPopup(popupHtml);
    bounds.push([lat, lon]);
    added++;
  }

  if (bounds.length) {
    map.fitBounds(bounds, { padding: [30, 30] });
  }

  return added;
}

async function main() {
  const map = buildMap();

  setStatus("Descargando XLSX…");

  try {
    const ab = await fetchAsArrayBuffer(REMOTE_XLSX_URL);
    const rows = parseXlsxToRows(ab);

    setStatus("Pintando radares…");
    const n = addRadarMarkers(map, rows);

    setStatus(`Listo: ${n} radares en el mapa.`);
  } catch (err) {
    console.error(err);
    setStatus(
      "No se pudo descargar/leer el XLSX (posible CORS o URL). " +
      "Solución rápida: descarga el XLSX y súbelo al repo como ./data/radares.xlsx, " +
      "y adapta REMOTE_XLSX_URL a 'data/radares.xlsx'."
    );
  }
}

main();