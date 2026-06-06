import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 4173);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function haversineMiles(a, b) {
  const earthMiles = 3958.7613;
  const degToRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * degToRad;
  const dLon = (b.lon - a.lon) * degToRad;
  const lat1 = a.lat * degToRad;
  const lat2 = b.lat * degToRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthMiles * Math.asin(Math.sqrt(h));
}

function headingToCompass(degrees) {
  if (!Number.isFinite(degrees)) return "";
  const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return points[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}

function normalizeAltitude(value) {
  if (value === "ground") return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeAircraft(raw, center) {
  const lat = Number(raw.lat ?? raw.latitude);
  const lon = Number(raw.lon ?? raw.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const heading = Number(raw.track ?? raw.true_heading ?? raw.mag_heading ?? raw.heading);
  const speed = Number(raw.gs ?? raw.groundspeed ?? raw.speed);
  const altitude = normalizeAltitude(raw.alt_baro ?? raw.alt_geom ?? raw.altitude_baro ?? raw.altitude);
  const verticalRate = Number(raw.baro_rate ?? raw.geom_rate ?? raw.vertical_rate);
  const flight = String(raw.flight ?? raw.callsign ?? raw.ident ?? "").trim();
  const operator = String(raw.ownOp ?? raw.operator ?? raw.airline ?? "").trim();
  const distanceMiles = haversineMiles(center, { lat, lon });

  return {
    hex: String(raw.hex ?? raw.icao24 ?? raw.icao ?? raw.id ?? `${lat},${lon}`),
    flight: flight || "Unknown",
    displayName: resolveFlightName(flight, operator),
    operator,
    registration: raw.r ?? raw.registration ?? "",
    type: raw.t ?? raw.type ?? raw.aircraft_type ?? "",
    category: raw.category ?? "",
    lat,
    lon,
    altitude,
    speed: Number.isFinite(speed) ? speed : null,
    heading: Number.isFinite(heading) ? heading : null,
    compass: headingToCompass(heading),
    verticalRate: Number.isFinite(verticalRate) ? verticalRate : null,
    squawk: raw.squawk ?? "",
    origin: raw.route_origin ?? raw.origin ?? "",
    destination: raw.route_dest ?? raw.destination ?? "",
    seenSeconds: raw.seen ?? raw.seen_pos ?? null,
    distanceMiles,
    isOverhead: distanceMiles <= 0.2,
    raw,
  };
}

function resolveFlightName(flight, operator) {
  const cleanFlight = String(flight || "").trim();
  if (!cleanFlight) return operator || "Unknown flight";

  const match = cleanFlight.match(/^([A-Z]{2,3})(\d+[A-Z]?)$/i);
  if (!match) return operator || cleanFlight;

  const prefix = match[1].toUpperCase();
  const number = match[2];
  const airlineNames = {
    AAL: "American Airlines",
    ACA: "Air Canada",
    AFR: "Air France",
    ASA: "Alaska Airlines",
    BAW: "British Airways",
    DAL: "Delta Air Lines",
    DLH: "Lufthansa",
    EJA: "NetJets",
    FFT: "Frontier Airlines",
    FDX: "FedEx",
    JBU: "JetBlue",
    KLM: "KLM",
    QFA: "Qantas",
    ROU: "Air Canada Rouge",
    SKW: "SkyWest",
    SWA: "Southwest Airlines",
    UAE: "Emirates",
    UAL: "United Airlines",
    UPS: "UPS",
    VOI: "Volaris",
    WJA: "WestJet",
  };

  const airline = airlineNames[prefix] || operator;
  return airline ? `${airline} ${number}` : cleanFlight;
}

function makeDemoAircraft(center, radiusMiles) {
  const now = Date.now() / 1000;
  const planes = [
    { id: "demo-aal441", flight: "AAL441", type: "A321", alt: 10875, speed: 276, heading: 73, offset: 0 },
    { id: "demo-swa908", flight: "SWA908", type: "B738", alt: 6425, speed: 238, heading: 204, offset: 2.1 },
    { id: "demo-ual178", flight: "UAL178", type: "B739", alt: 18250, speed: 412, heading: 315, offset: 4.2 },
  ];

  return planes.map((plane, index) => {
    const lap = (now / (72 + index * 16) + plane.offset) % (Math.PI * 2);
    const orbit = radiusMiles * (0.28 + index * 0.26);
    const northMiles = Math.sin(lap) * orbit;
    const eastMiles = Math.cos(lap) * orbit;
    const lat = center.lat + northMiles / 69;
    const lon = center.lon + eastMiles / (69 * Math.cos((center.lat * Math.PI) / 180));
    return normalizeAircraft(
      {
        hex: plane.id,
        flight: plane.flight,
        t: plane.type,
        lat,
        lon,
        alt_baro: plane.alt + Math.round(Math.sin(lap) * 350),
        gs: plane.speed,
        track: plane.heading,
        baro_rate: Math.round(Math.cos(lap) * 640),
      },
      center,
    );
  });
}

async function fetchProvider(provider, center, radiusMiles, apiKey) {
  if (provider === "demo") {
    return { source: "Demo traffic", aircraft: makeDemoAircraft(center, radiusMiles) };
  }

  const radiusNm = clamp(radiusMiles * 0.868976, 0.1, 250).toFixed(2);
  const providers = {
    airplanes: {
      label: "Airplanes.live",
      url: `https://api.airplanes.live/v2/point/${center.lat}/${center.lon}/${radiusNm}`,
      headers: {},
    },
    adsblol: {
      label: "adsb.lol",
      url: `https://api.adsb.lol/v2/point/${center.lat}/${center.lon}/${radiusNm}`,
      headers: {},
    },
    adsbx: {
      label: "ADSB Exchange",
      url: `https://gateway.adsbexchange.com/api/aircraft/v2/lat/${center.lat}/lon/${center.lon}/dist/${radiusNm}`,
      headers: {
        "X-Api-Key": apiKey,
        "Accept-Encoding": "gzip",
      },
    },
  };

  const selected = providers[provider] ?? providers.airplanes;
  if (provider === "adsbx" && !apiKey) {
    return { source: selected.label, aircraft: [], error: "ADSB Exchange API key required." };
  }

  const response = await fetch(selected.url, {
    headers: selected.headers,
    signal: AbortSignal.timeout(9000),
  });

  if (!response.ok) {
    return {
      source: selected.label,
      aircraft: [],
      error: `${selected.label} returned ${response.status}.`,
    };
  }

  const payload = await response.json();
  const list = Array.isArray(payload.ac) ? payload.ac : Array.isArray(payload.aircraft) ? payload.aircraft : [];
  return {
    source: selected.label,
    aircraft: list.map((item) => normalizeAircraft(item, center)).filter(Boolean),
  };
}

async function handleAircraft(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const center = {
    lat: clamp(toNumber(url.searchParams.get("lat"), 37.6213), -90, 90),
    lon: clamp(toNumber(url.searchParams.get("lon"), -122.379), -180, 180),
  };
  const radiusMiles = clamp(toNumber(url.searchParams.get("radiusMiles"), 1), 0.1, 50);
  const provider = url.searchParams.get("provider") || "demo";
  const apiKey = url.searchParams.get("apiKey") || process.env.ADSB_EXCHANGE_API_KEY || "";

  try {
    const result = await fetchProvider(provider, center, radiusMiles, apiKey);
    const aircraft = result.aircraft
      .filter((plane) => plane.distanceMiles <= radiusMiles)
      .sort((a, b) => a.distanceMiles - b.distanceMiles);

    sendJson(res, 200, {
      fetchedAt: new Date().toISOString(),
      provider,
      source: result.source,
      radiusMiles,
      center,
      count: aircraft.length,
      error: result.error || "",
      aircraft,
    });
  } catch (error) {
    sendJson(res, 502, {
      fetchedAt: new Date().toISOString(),
      provider,
      radiusMiles,
      center,
      count: 0,
      error: error instanceof Error ? error.message : "Unable to fetch aircraft.",
      aircraft: [],
    });
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer((req, res) => {
  if (req.url?.startsWith("/api/aircraft")) {
    void handleAircraft(req, res);
    return;
  }

  void serveStatic(req, res);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Flight Home Radar running at http://localhost:${port}`);
});
