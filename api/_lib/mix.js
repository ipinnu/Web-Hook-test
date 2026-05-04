const IDENTITY_URL = 'https://identity.za.mixtelematics.com/core/connect/token';
const API_BASE = 'https://integrate.za.mixtelematics.com/api';

let cachedToken = null;
let tokenExpiresAt = 0;

function safeJson(text) {
  return JSON.parse(text.replace(/:\s*(-?\d{16,})/g, ': "$1"'));
}

async function authenticate() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60_000) return cachedToken;

  const params = new URLSearchParams({
    grant_type: 'password',
    username: process.env.MIX_USERNAME,
    password: process.env.MIX_PASSWORD,
    client_id: process.env.MIX_CLIENT_ID,
    client_secret: process.env.MIX_CLIENT_SECRET,
    scope: 'offline_access MiX.Integrate',
  });

  const res = await fetch(IDENTITY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  const data = await res.json();
  if (!data.access_token) throw new Error(`Auth failed: ${JSON.stringify(data)}`);

  cachedToken = data.access_token;
  tokenExpiresAt = now + data.expires_in * 1000;
  return cachedToken;
}

function flattenSites(node, zoneName = null) {
  const map = new Map();
  const type = node.Type;
  const isRoot = type === 'OrganisationGroup';
  const isZone = type === 'OrganisationSubGroup';
  const isSite = type === 'SiteGroup' || type === 'DefaultSite';
  const currentZone = isRoot ? null : isZone ? node.Name : (zoneName || node.Name);
  if (isSite || isZone) {
    map.set(node.GroupId?.toString(), { name: node.Name, zoneName: currentZone || node.Name });
  }
  (node.SubGroups || []).forEach(child => {
    flattenSites(child, currentZone).forEach((v, k) => map.set(k, v));
  });
  return map;
}

const PANIC_ID = '-4444421556390778105';
const IDLE_ID = '-3393530750645328945';
const EXCESSIVE_IDLE_ID = '4650840888823746894';
const WARNING_TYPES = {
  '4750800303282680186': 'Harsh Braking',
  '6454149451280645233': 'Harsh Acceleration',
  '-3890646499157906515': 'Overspeeding',
  '-4596269900191457380': 'Overspeed Tiered',
  '4291175374538259638': 'Harsh Cornering',
};

export async function fetchVehicleData() {
  const token = await authenticate();
  const orgId = process.env.JMG_ORG_ID;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

  const [vehiclesRes, positionsRes, sitesRes, eventsRes] = await Promise.all([
    fetch(`${API_BASE}/assets/group/${orgId}`, { headers }),
    fetch(`${API_BASE}/positions/groups/latest/1`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: `[${orgId}]`,
    }),
    fetch(`${API_BASE}/organisationgroups/subgroups/${orgId}`, { headers }),
    fetch(`${API_BASE}/activeevents/groups/createdsince/entitytype/Asset/sincetoken/NEW/quantity/1000`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: `[${orgId}]`,
    }),
  ]);

  const vehicles = vehiclesRes.ok ? safeJson(await vehiclesRes.text()) : [];
  const positions = positionsRes.ok ? safeJson(await positionsRes.text()) : [];
  const siteMap = sitesRes.ok ? flattenSites(safeJson(await sitesRes.text())) : new Map();

  let activeEvents = [];
  if (eventsRes.ok && eventsRes.status !== 204) {
    try { activeEvents = safeJson(await eventsRes.text()); } catch { }
  }

  const posMap = new Map(positions.map(p => [p.AssetId?.toString(), p]));
  const panicSet = new Set(activeEvents.filter(e => e.EventTypeId === PANIC_ID).map(e => e.AssetId?.toString()));
  const idleSet = new Set(activeEvents.filter(e => e.EventTypeId === IDLE_ID).map(e => e.AssetId?.toString()));
  const excessiveIdleSet = new Set(activeEvents.filter(e => e.EventTypeId === EXCESSIVE_IDLE_ID).map(e => e.AssetId?.toString()));

  const warningsByAsset = new Map();
  activeEvents.filter(e => WARNING_TYPES[e.EventTypeId]).forEach(e => {
    const id = e.AssetId?.toString();
    if (!warningsByAsset.has(id)) warningsByAsset.set(id, []);
    warningsByAsset.get(id).push({
      eventId: e.EventId,
      label: WARNING_TYPES[e.EventTypeId],
      timestamp: new Date().toISOString(),
      eventTime: e.EventDateTime,
    });
  });

  return vehicles.map(vehicle => {
    const assetId = vehicle.AssetId?.toString();
    const pos = posMap.get(assetId);
    const siteInfo = siteMap.get(vehicle.SiteId?.toString());

    let status = 'Offline';
    if (pos) {
      const tsMs = new Date(pos.Timestamp).getTime();
      const posAge = isNaN(tsMs) ? 0 : Date.now() - tsMs;
      const age = isNaN(tsMs) ? Infinity : Date.now() - tsMs;

      if (pos.SpeedKilometresPerHour > 5 && posAge < 5 * 60 * 1000) status = 'Moving';
      else if (excessiveIdleSet.has(assetId)) status = 'Excessive Idle';
      else if (idleSet.has(assetId)) status = 'Idle';
      else if (age < 60 * 60 * 1000) status = 'Stationary';
      else if (age < 24 * 60 * 60 * 1000) status = 'Parked';
      else if (age < 30 * 24 * 60 * 60 * 1000) status = 'Offline';
      else status = 'Inactive';
    }

    return {
      id: assetId || 'unknown',
      regNo: vehicle.RegistrationNumber || 'N/A',
      transporter: 'JMG',
      site: siteInfo?.name || 'Unknown Site',
      zone: siteInfo?.zoneName || 'Unknown Zone',
      siteId: vehicle.SiteId?.toString() || null,
      assetName: vehicle.Description || 'Unknown Vehicle',
      make: vehicle.Make || 'N/A',
      model: vehicle.Model || 'N/A',
      status,
      date: pos?.Timestamp || new Date().toISOString(),
      panic: panicSet.has(assetId),
      warnings: warningsByAsset.get(assetId) || [],
      position: pos ? {
        latitude: pos.Latitude,
        longitude: pos.Longitude,
        speed: pos.SpeedKilometresPerHour,
        heading: pos.Heading,
        address: pos.FormattedAddress || 'Unknown',
      } : null,
      activeEvents: 0,
    };
  });
}
