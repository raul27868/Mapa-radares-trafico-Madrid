// Router público OSRM (sigue carreteras). Ojo: es un servicio público, evita pedir cientos de rutas de golpe.
const OSRM_ROUTE_URL = "https://router.project-osrm.org/route/v1/driving/";

async function osrmRouteLatLngs(from, to) {
  // from/to: {lat, lon}
  const url =
    `${OSRM_ROUTE_URL}${from.lon},${from.lat};${to.lon},${to.lat}` +
    `?overview=full&geometries=geojson&alternatives=false&steps=false`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);

  const data = await res.json();
  const coords = data?.routes?.[0]?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) throw new Error("OSRM sin geometría");

  // OSRM devuelve [lon, lat]
  return coords.map(([lon, lat]) => [lat, lon]);
}

function addArrows(map, latLngs) {
  // Flechas a lo largo de la línea
  const decorator = L.polylineDecorator(latLngs, {
    patterns: [
      {
        offset: 25,
        repeat: 120,
        symbol: L.Symbol.arrowHead({
          pixelSize: 12,
          polygon: false,
          pathOptions: { color: "red", weight: 3, opacity: 0.9 }
        })
      }
    ]
  }).addTo(map);

  return decorator;
}

async function addSectionRadarSegments(map, rows, boundsCollector) {
  let added = 0;

  // Cola de “tramos” a rutear (para no saturar OSRM)
  const tasks = [];

  for (const r of rows) {
    const keyLonIni = findKey(r, ["Longitud inicio tramo"]);
    const keyLatIni = findKey(r, ["Latitud inicio tramo"]);

    // “Fin”: primero intento columnas fin tramo si existieran,
    // y si no, uso X/Y (WGS84) como ubicación del radar (fin del control)
    const keyLonFin = findKey(r, ["Longitud fin tramo", "X (WGS84)", "Longitud"]);
    const keyLatFin = findKey(r, ["Latitud fin tramo", "Y (WGS84)", "Latitud"]);

    if (!keyLonIni || !keyLatIni || !keyLonFin || !keyLatFin) continue;

    const lon1 = toNumber(r[keyLonIni]);
    const lat1 = toNumber(r[keyLatIni]);
    const lon2 = toNumber(r[keyLonFin]);
    const lat2 = toNumber(r[keyLatFin]);

    if (![lon1, lat1, lon2, lat2].every(Number.isFinite)) continue;

    const keyVel = findKey(r, ["Velocidad límite", "Velocidad limite"]);
    const vel = keyVel ? r[keyVel] : null;

    const keyUbic = findKey(r, ["Ubicacion", "Ubicación", "Carretara o vial", "Carretera o vial", "Sentido", "Tipo", "PK"]);
    const ubic = keyUbic ? r[keyUbic] : null;

    // Encolamos para rutear con OSRM (seguirá carretera)
    tasks.push(async () => {
      let latLngs = null;

      try {
        latLngs = await osrmRouteLatLngs({ lat: lat1, lon: lon1 }, { lat: lat2, lon: lon2 });
      } catch (e) {
        // Fallback: línea recta si OSRM falla
        latLngs = [[lat1, lon1], [lat2, lon2]];
      }

      const poly = L.polyline(latLngs, { color: "red", weight: 5, opacity: 0.9 }).addTo(map);
      addArrows(map, latLngs);

      poly.bindPopup(`
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
          <div style="font-weight:700;margin-bottom:4px">Radar de tramo</div>
          ${ubic ? `<div><strong>Ubicación:</strong> ${String(ubic)}</div>` : ""}
          <div><strong>Velocidad límite:</strong> ${vel ?? "—"}</div>
          <div style="margin-top:6px;color:#666;font-size:12px">
            <strong>Inicio:</strong> ${lat1.toFixed(6)}, ${lon1.toFixed(6)}<br/>
            <strong>Fin:</strong> ${lat2.toFixed(6)}, ${lon2.toFixed(6)}
          </div>
        </div>
      `);

      // bounds
      for (const [lat, lon] of latLngs) boundsCollector.push([lat, lon]);
      added++;
    });
  }

  // Ejecuta rutas en serie (más amable con OSRM)
  for (const job of tasks) {
    await job();
    // micro-pausa para no “pegar tiros” al router público
    await new Promise(r => setTimeout(r, 120));
  }

  return added;
}
