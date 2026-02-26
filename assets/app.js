// URL XLSX oficial. Si falla por CORS, cámbialo a "data/radares.xlsx" y sube el fichero al repo.
const REMOTE_XLSX_URL = "https://datos.madrid.es/egob/catalogo/300049-1-radares-fijos-moviles.xlsx";

const MADRID_CENTER = [40.4168, -3.7038];

const statusEl = document.getElementById("status");
function setStatus(msg) { statusEl.textContent = msg; }

function toNumber(x) {
  if (x === null || x === undefined) return NaN;
  if (typeof x === "number") return x;
  const s = String(x).trim().replace(",", ".");
  return Number(s);
}

// Busca clave tolerante a tildes/espacios
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

function addRadarPointMarkers(map, rows, boundsCollector) {
  let added = 0;

  for (const r of rows) {
    const keyLon = findKey(r, ["Longitud", "X (WGS84)", "X"]);
    const keyLat = findKey(r, ["Latitud", "Y (WGS84)", "Y"]);
    if (!keyLon || !keyLat) continue;

    const lon = toNumber(r[keyLon]);
    const lat = toNumber(r[keyLat]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

    const keyVel = findKey(r, ["Velocidad límite", "Velocidad limite", "Velocidad", "Velocidad límite (km/h)"]);
    const keyUbic = findKey(r, ["Ubicacion", "Ubicación", "Carretera o vial", "Tramo", "PK", "Sentido", "Tipo"]);

    const vel = keyVel ? r[keyVel] : null;
    const ubic = keyUbic ? r[keyUbic] : null;

    const popupHtml = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
        <div style="font-weight:700;margin-bottom:4px">Radar (punto)</div>
        ${ubic ? `<div><strong>Ubicación:</strong> ${String(ubic)}</div>` : ""}
        <div><strong>Velocidad límite:</strong> ${vel ?? "—"}</div>
        <div style="margin-top:6px;color:#666;font-size:12px">
          <strong>Lat/Lon:</strong> ${lat.toFixed(6)}, ${lon.toFixed(6)}
        </div>
      </div>
    `;

    L.marker([lat, lon]).addTo(map).bindPopup(popupHtml);

    boundsCollector.push([lat, lon]);
    added++;
  }

  return added;
}

function addSectionRadarSegments(map, rows, boundsCollector) {
  let added = 0;

  for (const r of rows) {

    const keyLonIni = findKey(r, ["Longitud inicio tramo"]);
    const keyLatIni = findKey(r, ["Latitud inicio tramo"]);
    const keyLonFin = findKey(r, ["Longitud fin tramo"]);
    const keyLatFin = findKey(r, ["Latitud fin tramo"]);

    if (!keyLonIni || !keyLatIni || !keyLonFin || !keyLatFin) {
      continue; // si no existen columnas, saltamos
    }

    const lon1 = toNumber(r[keyLonIni]);
    const lat1 = toNumber(r[keyLatIni]);
    const lon2 = toNumber(r[keyLonFin]);
    const lat2 = toNumber(r[keyLatFin]);

    if (
      !Number.isFinite(lon1) || !Number.isFinite(lat1) ||
      !Number.isFinite(lon2) || !Number.isFinite(lat2)
    ) {
      continue;
    }

    const keyVel = findKey(r, ["Velocidad límite"]);
    const vel = keyVel ? r[keyVel] : null;

    // 🔴 Dibujar tramo en rojo
    const polyline = L.polyline(
      [
        [lat1, lon1],
        [lat2, lon2]
      ],
      {
        color: "red",
        weight: 5,
        opacity: 0.9
      }
    ).addTo(map);

    polyline.bindPopup(`
      <div>
        <strong>Radar de tramo</strong><br>
        Velocidad límite: ${vel ?? "—"}<br>
        Inicio: ${lat1.toFixed(6)}, ${lon1.toFixed(6)}<br>
        Fin: ${lat2.toFixed(6)}, ${lon2.toFixed(6)}
      </div>
    `);

    boundsCollector.push([lat1, lon1]);
    boundsCollector.push([lat2, lon2]);

    added++;
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

    const bounds = [];

    const nPuntos = addRadarPointMarkers(map, rows, bounds);
    const nTramos = addSectionRadarSegments(map, rows, bounds);

    if (bounds.length) {
      map.fitBounds(bounds, { padding: [30, 30] });
    }

    setStatus(`Listo: ${nPuntos} radares punto, ${nTramos} radares de tramo.`);
  } catch (err) {
    console.error(err);
    setStatus(
      "No se pudo descargar/leer el XLSX (posible CORS o URL). " +
      "Solución: sube el XLSX al repo como ./data/radares.xlsx y cambia REMOTE_XLSX_URL a 'data/radares.xlsx'."
    );
  }
}

main();
