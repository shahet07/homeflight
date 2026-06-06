const defaults = {
  lat: 37.6213,
  lon: -122.379,
  radius: 1,
  provider: "demo",
  apiKey: "",
  interval: 5,
  running: true,
};

const state = {
  settings: loadSettings(),
  timer: null,
  selectedHex: null,
  trails: new Map(),
  activeHexes: new Set(),
  history: [],
  lastData: null,
};

const hostedStatic = !["localhost", "127.0.0.1", ""].includes(window.location.hostname);

const elements = {
  form: document.querySelector("#settingsForm"),
  lat: document.querySelector("#latInput"),
  lon: document.querySelector("#lonInput"),
  radius: document.querySelector("#radiusInput"),
  provider: document.querySelector("#providerInput"),
  apiKey: document.querySelector("#apiKeyInput"),
  interval: document.querySelector("#intervalInput"),
  geo: document.querySelector("#geoButton"),
  geoText: document.querySelector("#geoButtonText"),
  save: document.querySelector("#saveButton"),
  toggle: document.querySelector("#toggleButton"),
  toggleIcon: document.querySelector("#toggleIcon"),
  livePill: document.querySelector("#livePill"),
  formStatus: document.querySelector("#formStatus"),
  insideCount: document.querySelector("#insideCount"),
  closest: document.querySelector("#closestMetric"),
  updated: document.querySelector("#updatedMetric"),
  source: document.querySelector("#sourceLabel"),
  error: document.querySelector("#errorBox"),
  aircraftLayer: document.querySelector("#aircraftLayer"),
  trailLayer: document.querySelector("#trailLayer"),
  flightList: document.querySelector("#flightList"),
  historyList: document.querySelector("#historyList"),
  historyCount: document.querySelector("#historyCount"),
};

hydrateForm();
bindEvents();
setRunning(state.settings.running);
void refreshAircraft();

function loadSettings() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem("flight-home-radar") || "{}") };
  } catch {
    return { ...defaults };
  }
}

function saveSettings() {
  localStorage.setItem("flight-home-radar", JSON.stringify(state.settings));
}

function hydrateForm() {
  elements.lat.value = state.settings.lat;
  elements.lon.value = state.settings.lon;
  elements.radius.value = state.settings.radius;
  elements.provider.value = state.settings.provider;
  elements.apiKey.value = state.settings.apiKey;
  elements.interval.value = state.settings.interval;
}

function bindEvents() {
  elements.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nextSettings = readSettingsFromForm();
    if (!validateSettings(nextSettings)) return;

    state.settings = {
      ...state.settings,
      ...nextSettings,
    };
    saveSettings();
    restartTimer();
    setControlStatus("Saved. Refreshing aircraft now...", "good");
    elements.save.textContent = "Saved";
    window.setTimeout(() => {
      elements.save.textContent = "Save";
    }, 1200);
    await refreshAircraft();
  });

  elements.geo.addEventListener("click", async () => {
    if (!navigator.geolocation) {
      showControlError("Location is not available in this browser. Enter latitude and longitude manually, then Save.");
      return;
    }

    elements.geo.disabled = true;
    elements.geoText.textContent = "Locating";
    setControlStatus("Requesting your browser location...", "");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        elements.lat.value = position.coords.latitude.toFixed(6);
        elements.lon.value = position.coords.longitude.toFixed(6);
        setControlStatus("Location found. Saving new center...", "good");
        elements.geo.disabled = false;
        elements.geoText.textContent = "Locate";
        elements.form.requestSubmit();
      },
      (error) => {
        elements.geo.disabled = false;
        elements.geoText.textContent = "Locate";
        const message =
          error.code === error.PERMISSION_DENIED
            ? "Location was blocked. Allow location for localhost in the address bar, or enter latitude and longitude manually, then Save."
            : "Could not get your location. Enter latitude and longitude manually, then Save.";
        showControlError(message);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });

  elements.toggle.addEventListener("click", () => {
    setRunning(!state.settings.running);
    saveSettings();
  });
}

function readSettingsFromForm() {
  return {
    lat: Number(elements.lat.value),
    lon: Number(elements.lon.value),
    radius: Number(elements.radius.value),
    provider: elements.provider.value,
    apiKey: elements.apiKey.value.trim(),
    interval: Number(elements.interval.value),
  };
}

function validateSettings(settings) {
  if (!Number.isFinite(settings.lat) || settings.lat < -90 || settings.lat > 90) {
    showControlError("Latitude must be a number between -90 and 90.");
    return false;
  }
  if (!Number.isFinite(settings.lon) || settings.lon < -180 || settings.lon > 180) {
    showControlError("Longitude must be a number between -180 and 180.");
    return false;
  }
  if (!Number.isFinite(settings.radius) || settings.radius < 0.1 || settings.radius > 50) {
    showControlError("Radius must be between 0.1 and 50 miles.");
    return false;
  }
  if (!Number.isFinite(settings.interval) || settings.interval < 2 || settings.interval > 60) {
    showControlError("Refresh must be between 2 and 60 seconds.");
    return false;
  }
  if (settings.provider === "adsbx" && !settings.apiKey) {
    showControlError("ADSB Exchange needs an API key. Choose Demo, Airplanes.live, or adsb.lol without a key.");
    return false;
  }
  return true;
}

function setRunning(running) {
  state.settings.running = running;
  elements.livePill.textContent = running ? "Live" : "Paused";
  elements.livePill.classList.toggle("is-paused", !running);
  elements.toggle.title = running ? "Pause updates" : "Resume updates";
  elements.toggle.setAttribute("aria-label", running ? "Pause updates" : "Resume updates");
  elements.toggleIcon.textContent = running ? "Ⅱ" : "▶";
  restartTimer();
}

function restartTimer() {
  if (state.timer) window.clearInterval(state.timer);
  state.timer = null;
  if (state.settings.running) {
    state.timer = window.setInterval(() => void refreshAircraft(), state.settings.interval * 1000);
  }
}

async function refreshAircraft() {
  try {
    const data = hostedStatic ? await fetchStaticAircraft() : await fetchLocalAircraft();
    state.lastData = data;
    updateHistory(data.aircraft || []);
    render(data);
    if (!data.error) {
      setControlStatus(`Updated ${data.count} aircraft from ${data.source || data.provider}.`, "good");
    }
  } catch (error) {
    showControlError(error instanceof Error ? error.message : "Unable to refresh aircraft.");
  }
}

async function fetchLocalAircraft() {
  const query = new URLSearchParams({
    lat: String(state.settings.lat),
    lon: String(state.settings.lon),
    radiusMiles: String(state.settings.radius),
    provider: state.settings.provider,
    apiKey: state.settings.apiKey,
  });
  const response = await fetch(`api/aircraft?${query.toString()}`, { cache: "no-store" });
  return response.json();
}

async function fetchStaticAircraft() {
  const center = { lat: state.settings.lat, lon: state.settings.lon };
  const radiusMiles = state.settings.radius;

  if (state.settings.provider === "demo") {
    const aircraft = makeDemoAircraft(center, radiusMiles);
    return makeAircraftResponse("Demo traffic", aircraft, "");
  }

  if (state.settings.provider === "adsbx") {
    return makeAircraftResponse("ADSB Exchange", [], "ADSB Exchange needs a backend proxy, so it only works in local Node mode.");
  }

  const radiusNm = clamp(radiusMiles * 0.868976, 0.1, 250).toFixed(2);
  const providers = {
    airplanes: {
      label: "Airplanes.live",
      url: `https://api.airplanes.live/v2/point/${center.lat}/${center.lon}/${radiusNm}`,
    },
    adsblol: {
      label: "adsb.lol",
      url: `https://api.adsb.lol/v2/point/${center.lat}/${center.lon}/${radiusNm}`,
    },
  };
  const selected = providers[state.settings.provider] || providers.airplanes;

  try {
    const response = await fetch(selected.url, { cache: "no-store" });
    if (!response.ok) {
      return makeAircraftResponse(selected.label, [], `${selected.label} returned ${response.status}.`);
    }

    const payload = await response.json();
    const list = Array.isArray(payload.ac) ? payload.ac : Array.isArray(payload.aircraft) ? payload.aircraft : [];
    const aircraft = list
      .map((item) => normalizeAircraft(item, center))
      .filter(Boolean)
      .filter((plane) => plane.distanceMiles <= radiusMiles)
      .sort((a, b) => a.distanceMiles - b.distanceMiles);
    return makeAircraftResponse(selected.label, aircraft, "");
  } catch {
    return makeAircraftResponse(
      selected.label,
      [],
      `${selected.label} could not be reached from GitHub Pages. Use local Node mode if the browser blocks this provider.`,
    );
  }
}

function makeAircraftResponse(source, aircraft, error) {
  return {
    fetchedAt: new Date().toISOString(),
    provider: state.settings.provider,
    source,
    radiusMiles: state.settings.radius,
    center: { lat: state.settings.lat, lon: state.settings.lon },
    count: aircraft.length,
    error,
    aircraft,
  };
}

function render(data) {
  const aircraft = Array.isArray(data.aircraft) ? data.aircraft : [];
  elements.insideCount.textContent = String(aircraft.length);
  elements.closest.textContent = aircraft[0] ? `${formatDistance(aircraft[0].distanceMiles)}` : "--";
  elements.updated.textContent = formatTime(data.fetchedAt);
  elements.source.textContent = data.source || data.provider || "Unknown";

  if (data.error) showError(data.error);
  else clearError();

  renderRadar(aircraft);
  renderFlightList(aircraft);
  renderHistory();
}

function renderRadar(aircraft) {
  const aircraftByHex = new Map(aircraft.map((plane) => [plane.hex, plane]));
  for (const node of [...elements.aircraftLayer.children]) {
    if (!aircraftByHex.has(node.dataset.hex)) node.remove();
  }

  state.activeHexes = new Set(aircraft.map((plane) => plane.hex));

  for (const plane of aircraft) {
    const point = projectToRadar(plane.lat, plane.lon);
    let node = elements.aircraftLayer.querySelector(`[data-hex="${cssEscape(plane.hex)}"]`);
    if (!node) {
      node = document.createElement("button");
      node.type = "button";
      node.className = "aircraft";
      node.dataset.hex = plane.hex;
      node.addEventListener("click", () => {
        state.selectedHex = plane.hex;
        renderFlightList(state.lastData?.aircraft || []);
      });
      elements.aircraftLayer.appendChild(node);
    }

    node.classList.toggle("is-overhead", Boolean(plane.isOverhead));
    node.style.left = `${point.x}%`;
    node.style.top = `${point.y}%`;
    node.style.setProperty("--heading", `${Number(plane.heading || 0)}deg`);
    node.title = `${plane.flight} ${formatDistance(plane.distanceMiles)}`;
    updateTrail(plane, point);
  }

  renderTrails();
}

function updateTrail(plane, point) {
  const trail = state.trails.get(plane.hex) || [];
  trail.push({ x: point.x, y: point.y, at: Date.now() });
  state.trails.set(plane.hex, trail.slice(-12));
}

function renderTrails() {
  elements.trailLayer.innerHTML = "";
  for (const [hex, points] of state.trails) {
    if (!state.activeHexes.has(hex)) continue;
    points.forEach((point, index) => {
      const dot = document.createElement("span");
      dot.className = "trail-dot";
      dot.style.left = `${point.x}%`;
      dot.style.top = `${point.y}%`;
      dot.style.opacity = String((index + 1) / points.length / 1.4);
      elements.trailLayer.appendChild(dot);
    });
  }
}

function projectToRadar(lat, lon) {
  const center = { lat: state.settings.lat, lon: state.settings.lon };
  const radius = state.settings.radius;
  const northMiles = (lat - center.lat) * 69;
  const eastMiles = (lon - center.lon) * 69 * Math.cos((center.lat * Math.PI) / 180);
  const x = 50 + (eastMiles / radius) * 47;
  const y = 50 - (northMiles / radius) * 47;
  return { x: clamp(x, 2, 98), y: clamp(y, 2, 98) };
}

function renderFlightList(aircraft) {
  if (!aircraft.length) {
    elements.flightList.innerHTML = `<div class="empty-state">No aircraft in the selected radius.</div>`;
    return;
  }

  elements.flightList.innerHTML = aircraft.map(renderFlightCard).join("");
}

function renderFlightCard(plane) {
  const selected = plane.hex === state.selectedHex ? "border-color: rgba(102, 217, 255, .7)" : "";
  const route = [plane.origin, plane.destination].filter(Boolean).join(" to ");
  const badge = plane.isOverhead ? `<span class="badge hot">Overhead</span>` : `<span class="badge">${formatDistance(plane.distanceMiles)}</span>`;
  const flightName = plane.displayName && plane.displayName !== plane.flight ? `<div class="flight-name">${escapeHtml(plane.displayName)}</div>` : "";

  return `
    <article class="flight-card" style="${selected}">
      <div class="flight-top">
        <div>
          <div class="callsign">${escapeHtml(plane.flight)}</div>
          ${flightName}
          <div class="flight-meta">
            <span>${escapeHtml(plane.registration || plane.hex)}</span>
            <span>${escapeHtml(plane.type || "type unknown")}</span>
            ${route ? `<span>${escapeHtml(route)}</span>` : ""}
          </div>
        </div>
        ${badge}
      </div>
      <div class="flight-stats">
        <div><span>Altitude</span><strong>${formatAltitude(plane.altitude)}</strong></div>
        <div><span>Speed</span><strong>${formatSpeed(plane.speed)}</strong></div>
        <div><span>Heading</span><strong>${formatHeading(plane)}</strong></div>
        <div><span>Vertical</span><strong>${formatVertical(plane.verticalRate)}</strong></div>
        <div><span>Squawk</span><strong>${escapeHtml(String(plane.squawk || "--"))}</strong></div>
        <div><span>Seen</span><strong>${formatSeen(plane.seenSeconds)}</strong></div>
      </div>
    </article>
  `;
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

function normalizeAltitude(value) {
  if (value === "ground") return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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

function updateHistory(aircraft) {
  const seen = new Map(state.history.map((item) => [item.hex, item]));
  aircraft.forEach((plane) => {
    const existing = seen.get(plane.hex);
    if (!existing || plane.distanceMiles < existing.closestDistance) {
      seen.set(plane.hex, {
        hex: plane.hex,
        flight: plane.flight,
        type: plane.type,
        closestDistance: plane.distanceMiles,
        lastSeenAt: new Date().toISOString(),
      });
    } else {
      existing.lastSeenAt = new Date().toISOString();
    }
  });

  state.history = [...seen.values()]
    .sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt))
    .slice(0, 10);
}

function renderHistory() {
  elements.historyCount.textContent = String(state.history.length);
  if (!state.history.length) {
    elements.historyList.innerHTML = `<div class="empty-state">No passes yet.</div>`;
    return;
  }

  elements.historyList.innerHTML = state.history
    .map(
      (item) => `
        <div class="history-item">
          <span><strong>${escapeHtml(item.flight)}</strong> ${escapeHtml(item.type || "")}</span>
          <span>${formatDistance(item.closestDistance)} · ${formatTime(item.lastSeenAt)}</span>
        </div>
      `,
    )
    .join("");
}

function showError(message) {
  elements.error.hidden = false;
  elements.error.textContent = message;
}

function showControlError(message) {
  setControlStatus(message, "error");
  showError(message);
}

function setControlStatus(message, tone) {
  elements.formStatus.textContent = message;
  elements.formStatus.classList.toggle("is-good", tone === "good");
  elements.formStatus.classList.toggle("is-error", tone === "error");
}

function clearError() {
  elements.error.hidden = true;
  elements.error.textContent = "";
}

function formatDistance(value) {
  return Number.isFinite(value) ? `${value.toFixed(value < 1 ? 2 : 1)} mi` : "--";
}

function formatAltitude(value) {
  return Number.isFinite(value) ? `${Math.round(value).toLocaleString()} ft` : "--";
}

function formatSpeed(value) {
  return Number.isFinite(value) ? `${Math.round(value)} kt` : "--";
}

function formatHeading(plane) {
  return Number.isFinite(plane.heading) ? `${Math.round(plane.heading)}° ${plane.compass || ""}` : "--";
}

function formatVertical(value) {
  if (!Number.isFinite(value)) return "--";
  if (value === 0) return "level";
  return `${value > 0 ? "+" : ""}${Math.round(value)} fpm`;
}

function formatSeen(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(0)}s` : "now";
}

function formatTime(value) {
  if (!value) return "--";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
