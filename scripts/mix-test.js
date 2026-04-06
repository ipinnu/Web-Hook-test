//start
import * as dotenv from 'dotenv';
dotenv.config();

import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const IDENTITY_URL = "https://identity.za.mixtelematics.com/core/connect/token";
const API_BASE = "https://integrate.za.mixtelematics.com/api";

const CREDENTIALS = {
  username: process.env.MIX_USERNAME,
  password: process.env.MIX_PASSWORD,
  client_id: process.env.MIX_CLIENT_ID,
  client_secret: process.env.MIX_CLIENT_SECRET,
};

const CHEVRON_ORG_ID = process.env.CHEVRON_ORG_ID;

const POLL_INTERVAL_MS = 10 * 1000;
const MAX_RUNS = 1200;

let runCount = 0;
let inFlight = null;
let pollingInterval = null;
let pollingMaxRuns = MAX_RUNS;

function getCurrentSinceToken() {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}000`;
}

let activeSinceToken = getCurrentSinceToken();
let activeParseRetryDone = false;
let cachedToken = null;
let tokenExpiresAt = 0;

const PANIC_EVENT_TYPE_ID = '-4444421556390778105';

const WARNING_EVENT_TYPES = {
  '4750800303282680186': 'Harsh Brake',
  '6454149451280645233': 'Harsh Accel',
  '-3890646499157906515': 'Overspeed',
  '-4596269900191457380': 'Overspeed Tiered',
  '4291175374538259638': 'Harsh Corner',
};

const triggeredEvents = new Map();
const triggeredWarningEvents = new Map();

function cleanStaleWarnings() {
  const cutoff = Date.now() - 60_000;
  triggeredWarningEvents.forEach((events, assetId) => {
    const fresh = events.filter(e => new Date(e.timestamp).getTime() > cutoff);
    if (fresh.length === 0) {
      triggeredWarningEvents.delete(assetId);
    } else {
      triggeredWarningEvents.set(assetId, fresh);
    }
  });
}

export function clearTriggeredEvent(assetId) {
  triggeredEvents.delete(assetId);
}

export function getWarningEvents() {
  const result = {};
  triggeredWarningEvents.forEach((events, assetId) => {
    result[assetId] = events;
  });
  return result;
}

export function resetState() {
  triggeredEvents.clear();
  triggeredWarningEvents.clear();
  activeSinceToken = getCurrentSinceToken();
  activeParseRetryDone = false;
  cachedToken = null;
  tokenExpiresAt = 0;
  console.log('🔄 State reset — triggeredEvents cleared, activeSinceToken reset to now');
}

async function authenticate() {
  const now = Date.now();

  if (cachedToken && now < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  const params = new URLSearchParams({
    grant_type: "password",
    username: CREDENTIALS.username,
    password: CREDENTIALS.password,
    client_id: CREDENTIALS.client_id,
    client_secret: CREDENTIALS.client_secret,
    scope: "offline_access MiX.Integrate",
  });

  const response = await fetch(IDENTITY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  const contentType = response.headers.get("content-type");

  if (!contentType || !contentType.includes("application/json")) {
    cachedToken = null;
    tokenExpiresAt = 0;
    console.log("❌ Authentication failed - got HTML instead of JSON");
    console.log("   Server might be down or network issue");
    throw new Error("Authentication server returned HTML, not JSON");
  }

  const data = await response.json();
  if (!data.access_token) throw new Error("No access token in response");

  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in * 1000);
  console.log(`🔑 New token cached, expires in ${data.expires_in}s`);

  return cachedToken;
}

async function getVehicles(token) {
  const response = await fetch(`${API_BASE}/assets/group/${CHEVRON_ORG_ID}`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
    },
  });

  if (response.status === 401) {
    cachedToken = null;
    tokenExpiresAt = 0;
    console.log('⚠️ Token rejected by vehicles endpoint, will re-authenticate next poll');
    return [];
  }
  if (!response.ok) return [];
  const text = await response.text();
  const safe = text.replace(/:\s*(-?\d{16,})/g, ': "$1"');
  return JSON.parse(safe);
}

async function getLatestPositions(token) {
  const response = await fetch(`${API_BASE}/positions/groups/latest/1`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: `[${process.env.CHEVRON_ORG_ID}]`,
  });

  if (response.status === 401) {
    cachedToken = null;
    tokenExpiresAt = 0;
    console.log('⚠️ Token rejected by positions endpoint, will re-authenticate next poll');
    return [];
  }
  if (!response.ok) return [];
  const text = await response.text();
  const safe = text.replace(/:\s*(-?\d{16,})/g, ': "$1"');
  return JSON.parse(safe);
}

// ============================================================
// HISTORY EVENTS ENDPOINT — COMMENTED OUT
// Reason: Causes ghost panics. MiX can delay publishing events
// by hours, so a panic from before app startup can arrive after
// startup and bypass the sinceToken filter. Active events
// pipeline (getLatestActiveEvents) catches panics faster and
// more reliably. Re-enable if active events ever proves unreliable.
// ============================================================
// async function getActiveEvents(token) { ... }

async function getActivePanicEvents(token) {
  const endpoint = `${API_BASE}/activeevents/groups/createdsince/organisation/${CHEVRON_ORG_ID}/sincetoken/NEW/quantity/1000`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: `["-4444421556390778105"]`,
  });

  if (response.status === 401) {
    cachedToken = null;
    tokenExpiresAt = 0;
    console.log('⚠️ Token rejected by panic events endpoint, will re-authenticate next poll');
    return [];
  }
  if (response.status === 204 || !response.ok) {
    return [];
  }

  const text = await response.text();
  const safe = text.replace(/:\s*(-?\d{16,})/g, ': "$1"');
  return JSON.parse(safe);
}

async function getLatestActiveEvents(token) {
  const endpoint = `${API_BASE}/activeevents/groups/createdsince/entitytype/Asset/sincetoken/${activeSinceToken}/quantity/1000`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: `[${CHEVRON_ORG_ID}]`,
  });

  if (response.status === 401) {
    cachedToken = null;
    tokenExpiresAt = 0;
    console.log('⚠️ Token rejected by latest active events endpoint, will re-authenticate next poll');
    return [];
  }
  if (response.status === 204 || !response.ok) {
    return [];
  }

  const newToken = response.headers.get('GetSinceToken');
  const text = await response.text();

  let parsed;
  try {
    const safe = text.replace(/:\s*(-?\d{16,})/g, ': "$1"');
    parsed = JSON.parse(safe);
  } catch (e) {
    if (!activeParseRetryDone) {
      console.log('⚠️ Active events parse failed, retrying once on next poll...');
      activeParseRetryDone = true;
      return [];
    }
    console.log('⚠️ Active events parse failed again, advancing activeSinceToken and moving on. Events may have been lost.');
    activeParseRetryDone = false;
    if (newToken) {
      activeSinceToken = newToken;
      console.log(`📌 Updated activeSinceToken: ${activeSinceToken}`);
    }
    return [];
  }

  activeParseRetryDone = false;
  if (newToken) {
    activeSinceToken = newToken;
    console.log(`📌 Updated activeSinceToken: ${activeSinceToken}`);
  }

  // Handle panic events
  const panicEvents = parsed.filter(e => e.EventTypeId === PANIC_EVENT_TYPE_ID);
  if (panicEvents.length > 0) {
    console.log(`🔎 Active Panic found: ${panicEvents.length}`);
    panicEvents.forEach(e => {
      console.log(`🔎 Active Panic - AssetId: ${e.AssetId} | EventTime: ${e.EventDateTime} | ReceivedAt: ${e.ReceivedDateTime}`);
    });
    const logPath = path.join(process.cwd(), 'panic.log');
    const logEntries = panicEvents.map(e => JSON.stringify({
      timestamp: new Date().toISOString(),
      assetId: e.AssetId,
      eventId: e.EventId,
      eventTime: e.EventDateTime,
      receivedAt: e.ReceivedDateTime,
      rawEvent: e
    })).join('\n') + '\n';
    fs.appendFileSync(logPath, logEntries);
    console.log(`📝 Panic logged to panic.log`);
  }

  // Handle warning events
  const warningEvents = parsed.filter(e => WARNING_EVENT_TYPES[e.EventTypeId]);
  if (warningEvents.length > 0) {
    console.log(`⚠️ Warning events found: ${warningEvents.length}`);
    const eventsLogPath = path.join(process.cwd(), 'events.log');
    const logEntries = warningEvents.map(e => JSON.stringify({
      timestamp: new Date().toISOString(),
      assetId: e.AssetId,
      eventId: e.EventId,
      eventType: e.EventTypeId,
      label: WARNING_EVENT_TYPES[e.EventTypeId],
      eventTime: e.EventDateTime,
      receivedAt: e.ReceivedDateTime,
      rawEvent: e
    })).join('\n') + '\n';
    fs.appendFileSync(eventsLogPath, logEntries);

    warningEvents.forEach(e => {
      const assetId = e.AssetId?.toString();
      const label = WARNING_EVENT_TYPES[e.EventTypeId];
      console.log(`⚠️ ${label} - AssetId: ${assetId} | EventTime: ${e.EventDateTime}`);
      if (assetId) {
        if (!triggeredWarningEvents.has(assetId)) {
          triggeredWarningEvents.set(assetId, []);
        }
        const existing = triggeredWarningEvents.get(assetId);
        const alreadyStored = existing.some(ev => ev.eventId === e.EventId);
        if (!alreadyStored) {
          existing.push({
            eventId: e.EventId,
            label,
            timestamp: new Date().toISOString(),
            eventTime: e.EventDateTime,
          });
        }
      }
    });
  }

  return parsed;
}

function mergeData(vehicles, positions) {
  const positionsByAsset = new Map();
  positions.forEach(p => {
    positionsByAsset.set(p.AssetId?.toString(), p);
  });

  return vehicles.map(vehicle => {
    const assetId = vehicle.AssetId?.toString();
    const pos = positionsByAsset.get(assetId);

    const vehicleEvents = triggeredEvents.get(assetId) || [];
    const hasPanic = vehicleEvents.some(e => e.EventTypeId === PANIC_EVENT_TYPE_ID);
    const warningEvents = triggeredWarningEvents.get(assetId) || [];

    let status = 'Offline';
    if (pos) {
      if (pos.SpeedKilometresPerHour > 5) {
        status = 'Moving';
      } else if (pos.SpeedKilometresPerHour > 3 && pos.SpeedKilometresPerHour <= 5) {
        status = 'Idle';
      } else {
        const age = Date.now() - new Date(pos.Timestamp).getTime();
        if (age < 5 * 60 * 1000) {
          status = 'Idle';
        } else if (age < 60 * 60 * 1000) {
          status = 'Stationary';
        } else if (age < 24 * 60 * 60 * 1000) {
          status = 'Parked';
        } else {
          status = 'Inactive';
        }
      }
    }

    return {
      id: assetId || 'unknown',
      regNo: vehicle.RegistrationNumber || 'N/A',
      transporter: vehicle.SiteName || 'Chevron Nigeria',
      assetName: vehicle.Description || 'Unknown Vehicle',
      make: vehicle.Make || 'N/A',
      model: vehicle.Model || 'N/A',
      status,
      date: pos?.Timestamp
        ? new Date(pos.Timestamp).toLocaleString('en-GB')
        : new Date().toLocaleString('en-GB'),
      panic: hasPanic,
      warnings: warningEvents,
      position: pos ? {
        latitude: pos.Latitude,
        longitude: pos.Longitude,
        speed: pos.SpeedKilometresPerHour,
        heading: pos.Heading,
        address: pos.FormattedAddress || 'Unknown'
      } : null,
      activeEvents: vehicleEvents.length,
    };
  });
}

export async function pollOnce() {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    runCount++;
    cleanStaleWarnings();

    console.log("\n" + "=".repeat(70));
    console.log(`RUN #${runCount} of ${pollingMaxRuns ?? "∞"} - ${new Date().toLocaleString('en-GB')}`);
    console.log("=".repeat(70));

    try {
      const token = await authenticate();
      console.log("✅ Authenticated");

      const [vehicles, latestActiveEvents, positions] = await Promise.all([
        getVehicles(token),
        getLatestActiveEvents(token),
        getLatestPositions(token),
      ]);

      const allEvents = [...latestActiveEvents];

      console.log(`✅ Vehicles: ${vehicles.length} | Active Events: ${latestActiveEvents.length} | Positions: ${positions.length}`);

      allEvents.forEach(event => {
        if (event.EventTypeId === PANIC_EVENT_TYPE_ID) {
          const assetId = event.AssetId?.toString();
          if (assetId) {
            if (!triggeredEvents.has(assetId)) {
              triggeredEvents.set(assetId, []);
            }
            const existing = triggeredEvents.get(assetId);
            const alreadyStored = existing.some(e => e.EventId === event.EventId);
            if (!alreadyStored) {
              existing.push(event);
            }
          }
        }
      });

      if (vehicles.length === 0 || positions.length === 0) {
        console.log('⚠️ Empty response from MiX, skipping write to data.json');
        return { ok: true, stats: null, runCount };
      }

      const merged = mergeData(vehicles, positions);

      const stats = {
        panic: merged.filter(v => v.panic).length,
        moving: merged.filter(v => v.status === 'Moving').length,
        idle: merged.filter(v => v.status === 'Idle').length,
        stationary: merged.filter(v => v.status === 'Stationary').length,
        parked: merged.filter(v => v.status === 'Parked').length,
        inactive: merged.filter(v => v.status === 'Inactive').length,
        offline: merged.filter(v => v.status === 'Offline').length,
        warnings: merged.filter(v => v.warnings && v.warnings.length > 0).length,
      };

      const dataPath = path.join(process.cwd(), 'public', 'data.json');
      const metadataPath = path.join(process.cwd(), 'public', 'metadata.json');
      fs.writeFileSync(dataPath, JSON.stringify(merged, null, 2));

      const metadata = {
        lastUpdate: new Date().toISOString(),
        runNumber: runCount,
        totalVehicles: vehicles.length,
        ...stats
      };
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

      console.log(`📊 Panic: ${stats.panic} | Warnings: ${stats.warnings} | Moving: ${stats.moving} | Idle: ${stats.idle} | Stationary: ${stats.stationary} | Parked: ${stats.parked} | Inactive: ${stats.inactive} | Offline: ${stats.offline}`);
      console.log("💾 Saved to data.json");

      if (stats.panic > 0) {
        console.log("\n🚨 PANIC ALERT DETECTED! 🚨");
        const panicVehicles = merged.filter(v => v.panic);
        panicVehicles.forEach(v => {
          console.log(`   ${v.regNo} - ${v.assetName}`);
        });
      }

      if (stats.warnings > 0) {
        console.log(`\n⚠️ ${stats.warnings} vehicle(s) with active warnings`);
      }

      return { ok: true, stats, runCount };
    } catch (error) {
      console.error("❌ Error:", error.message);
      return { ok: false, error: error.message ?? String(error), runCount };
    }
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

export function startPolling(options = {}) {
  if (pollingInterval) {
    console.log('⚠️ Polling already running, ignoring duplicate start');
    return;
  }
  const { intervalMs = POLL_INTERVAL_MS, maxRuns = MAX_RUNS } = options;
  pollingMaxRuns = maxRuns ?? null;

  console.log("🚀 MiX Auto-Polling Started");
  console.log("=".repeat(70));
  console.log(`Polling interval: ${intervalMs / 1000} seconds`);
  console.log(`Total runs: ${pollingMaxRuns ?? "∞"}`);
  if (pollingMaxRuns) {
    console.log(`Estimated duration: ${(pollingMaxRuns * intervalMs) / 1000}s (~${((pollingMaxRuns * intervalMs) / 60000).toFixed(1)} min)`);
  }
  console.log("=".repeat(70));
  console.log("\nPress Ctrl+C to stop early\n");

  pollOnce();

  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(async () => {
    await pollOnce();
    if (pollingMaxRuns && runCount >= pollingMaxRuns) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  }, intervalMs);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  if (!global.__mixPollingStarted) {
    global.__mixPollingStarted = true;
    startPolling({ intervalMs: POLL_INTERVAL_MS, maxRuns: MAX_RUNS });
  }
}