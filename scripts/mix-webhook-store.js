import fs from 'fs'
import path from 'path'
import pg from 'pg'

const WEBHOOK_DIR = path.join(process.cwd(), 'webhook-data')

const PANIC_EVENT_TYPE_ID = '-4444421556390778105'

const WARNING_EVENT_TYPES = {
  '4750800303282680186': 'Harsh Braking',
  '6454149451280645233': 'Harsh Acceleration',
  '-3890646499157906515': 'Overspeeding',
  '-4596269900191457380': 'Overspeed Tiered',
  '4291175374538259638': 'Harsh Cornering',
}

const PATHS = {
  inbox: () => path.join(WEBHOOK_DIR, 'inbox.log'),
  panic: () => path.join(WEBHOOK_DIR, 'panic.log'),
  events: () => path.join(WEBHOOK_DIR, 'events.log'),
  trips: () => path.join(WEBHOOK_DIR, 'trips.log'),
  vehicles: () => path.join(WEBHOOK_DIR, 'vehicles.json'),
  drivers: () => path.join(WEBHOOK_DIR, 'drivers.json'),
  sites: () => path.join(WEBHOOK_DIR, 'sites.json'),
  positions: () => path.join(WEBHOOK_DIR, 'positions.json'),
  metadata: () => path.join(WEBHOOK_DIR, 'metadata.json'),
}

let pool = null
let postgresReady = false

/** @typedef {'file' | 'postgres' | 'dual'} WebhookStoreMode */

export function getStoreMode() {
  const explicit = process.env.WEBHOOK_STORE?.toLowerCase()
  if (explicit === 'file' || explicit === 'postgres' || explicit === 'dual') return explicit
  if (process.env.DATABASE_URL) return 'dual'
  return 'file'
}

function useFileStore() {
  const mode = getStoreMode()
  return mode === 'file' || mode === 'dual'
}

function usePostgresStore() {
  const mode = getStoreMode()
  return mode === 'postgres' || mode === 'dual'
}

export function getStoreInfo() {
  return {
    mode: getStoreMode(),
    fileDir: WEBHOOK_DIR,
    fileEnabled: useFileStore(),
    postgresEnabled: usePostgresStore(),
    postgresConnected: postgresReady,
  }
}

function ensureDir() {
  fs.mkdirSync(WEBHOOK_DIR, { recursive: true })
}

function appendLine(filePath, record) {
  ensureDir()
  fs.appendFileSync(filePath, JSON.stringify(record) + '\n')
}

function readJsonArray(filePath, bigIntSafe = false) {
  if (!fs.existsSync(filePath)) return []
  try {
    const text = fs.readFileSync(filePath, 'utf8')
    const safe = bigIntSafe ? text.replace(/:\s*(-?\d{16,})/g, ': "$1"') : text
    const data = JSON.parse(safe)
    return Array.isArray(data) ? data : []
  } catch {
    return readJsonLines(filePath)
  }
}

function writeJsonArray(filePath, data) {
  ensureDir()
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function readJsonObject(filePath) {
  if (!fs.existsSync(filePath)) return {}
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return {}
  }
}

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return []
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function countJsonLines(filePath) {
  return readJsonLines(filePath).length
}

function touchMetadata(extra = {}) {
  const meta = {
    ...readJsonObject(PATHS.metadata()),
    lastUpdate: new Date().toISOString(),
    source: 'webhook',
    store: 'webhook-data',
    ...extra,
  }
  ensureDir()
  fs.writeFileSync(PATHS.metadata(), JSON.stringify(meta, null, 2))
}

function extractFields(payload) {
  return {
    eventId: (payload.EventId ?? payload.eventId ?? payload.id)?.toString() || null,
    eventTypeId: (payload.EventTypeId ?? payload.eventTypeId)?.toString() || null,
    assetId: (payload.AssetId ?? payload.assetId ?? payload.AssetID)?.toString() || null,
  }
}

export function getWebhookDir() {
  return WEBHOOK_DIR
}

export function isPostgresReady() {
  return postgresReady
}

export async function initWebhookStore() {
  ensureDir()
  if (!usePostgresStore() || !process.env.DATABASE_URL) return

  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  })

  await pool.query(`
    CREATE TABLE IF NOT EXISTS webhook_inbox (
      id BIGSERIAL PRIMARY KEY,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      payload JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_inbox_received_at ON webhook_inbox (received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_webhook_inbox_entity_type ON webhook_inbox (entity_type);
  `)

  postgresReady = true
  console.log(`🐘 Webhook PostgreSQL ready (WEBHOOK_STORE=${getStoreMode()})`)
}

async function persistPostgres(entityType, entityId, payload) {
  if (!usePostgresStore() || !postgresReady || !pool) return null
  const result = await pool.query(
    'INSERT INTO webhook_inbox (entity_type, entity_id, payload) VALUES ($1, $2, $3) RETURNING id',
    [entityType, entityId, payload]
  )
  return Number(result.rows[0].id)
}

export async function insertInboxRecords(items, source = 'webhook') {
  const ids = []

  if (useFileStore()) {
    ensureDir()
    const existing = readJsonArray(PATHS.inbox())
    let nextId = existing.length > 0 ? Math.max(...existing.map(e => e.id || 0)) + 1 : 1

    for (const payload of items) {
      const fields = extractFields(payload)
      const record = {
        id: nextId,
        receivedAt: new Date().toISOString(),
        ...fields,
        source,
        payload,
      }
      appendLine(PATHS.inbox(), record)
      ids.push(nextId)
      nextId++
    }
    touchMetadata({ lastInboxId: ids[ids.length - 1], inboxCount: ids.length, storeMode: getStoreMode() })
  }

  if (usePostgresStore() && postgresReady) {
    for (const payload of items) {
      const fields = extractFields(payload)
      const pgId = await persistPostgres('inbox', fields.eventId || fields.assetId, payload)
      if (!useFileStore() && pgId) ids.push(pgId)
    }
  }

  return ids
}

export function getRecentInbox(limit = 50) {
  return readJsonArray(PATHS.inbox())
    .sort((a, b) => (b.id || 0) - (a.id || 0))
    .slice(0, limit)
}

export function getWebhookDashboardData(limit = 20) {
  const metadata = readJsonObject(PATHS.metadata())
  const panicEvents = readJsonLines(PATHS.panic()).map(event => ({ ...event, kind: 'panic' }))
  const warningEvents = readJsonLines(PATHS.events()).map(event => ({ ...event, kind: 'warning' }))
  const trips = readJsonLines(PATHS.trips())
  const vehicles = readJsonArray(PATHS.vehicles(), true)
  const drivers = readJsonArray(PATHS.drivers(), true)
  const sites = readJsonArray(PATHS.sites())
  const positions = readJsonObject(PATHS.positions())
  const inbox = getRecentInbox(limit)

  const recentEvents = [...panicEvents, ...warningEvents]
    .map(event => ({
      id: event.eventId || event.id || null,
      eventId: event.eventId || null,
      eventType: event.eventType || null,
      label: event.label || (event.kind === 'panic' ? 'Panic' : 'Event'),
      kind: event.kind,
      assetId: event.assetId || null,
      driverId: event.driverId || null,
      address: event.address || null,
      timestamp: event.eventTime || event.timestamp || event.receivedAt || null,
      receivedAt: event.receivedAt || null,
      payload: event.payload || event,
    }))
    .sort((a, b) => new Date(b.timestamp || b.receivedAt || 0).getTime() - new Date(a.timestamp || a.receivedAt || 0).getTime())
    .slice(0, limit)

  return {
    generatedAt: new Date().toISOString(),
    lastUpdate: metadata.lastUpdate || null,
    store: getStoreInfo(),
    stats: {
      inboxTotal: countJsonLines(PATHS.inbox()),
      panicEvents: panicEvents.length,
      warningEvents: warningEvents.length,
      trips: trips.length,
      vehicles: vehicles.length,
      drivers: drivers.length,
      sites: sites.length,
      positions: Object.keys(positions).length,
    },
    recentEvents,
    recentInbox: inbox,
    metadata,
  }
}

function getTripKey(trip) {
  return (
    trip.TripId ||
    trip.TripID ||
    trip.Id ||
    trip.tripId ||
    `${trip.AssetId || trip.assetId || 'unknown'}-${trip.TripStart || trip.StartDateTime || Date.now()}`
  ).toString()
}

export async function storeWebhookEvent(event) {
  const eventId = (event.EventId ?? event.eventId)?.toString()
  const eventTypeId = (event.EventTypeId ?? event.eventTypeId)?.toString()
  const assetId = (event.AssetId ?? event.assetId)?.toString()
  const isPanic = eventTypeId === PANIC_EVENT_TYPE_ID
  const label = isPanic ? 'Panic' : WARNING_EVENT_TYPES[eventTypeId]

  const record = {
    receivedAt: new Date().toISOString(),
    source: 'webhook',
    timestamp: new Date().toISOString(),
    assetId,
    driverId: event.DriverId ?? event.driverId ?? null,
    eventId,
    eventType: eventTypeId,
    label: label || 'Event',
    eventTime: event.EventDateTime ?? event.eventTime ?? null,
    receivedFromMix: event.ReceivedDateTime ?? null,
    latitude: event.Position?.Latitude ?? event.latitude ?? null,
    longitude: event.Position?.Longitude ?? event.longitude ?? null,
    address: event.Position?.FormattedAddress ?? event.address ?? null,
    payload: event,
  }

  if (useFileStore()) {
    appendLine(isPanic ? PATHS.panic() : PATHS.events(), record)
    touchMetadata({ lastEventId: eventId, lastEventType: eventTypeId })
  }
  await persistPostgres(isPanic ? 'panic' : 'event', eventId, event)
  console.log(`📥 Webhook event → ${useFileStore() ? `webhook-data/${isPanic ? 'panic' : 'events'}.log` : 'postgres'}`)
  return { type: 'event', id: eventId, ok: true, channel: isPanic ? 'panic' : 'events' }
}

export async function storeWebhookTrip(trip) {
  const key = getTripKey(trip)
  if (useFileStore()) {
    appendLine(PATHS.trips(), { receivedAt: new Date().toISOString(), source: 'webhook', ...trip })
    touchMetadata({ lastTripId: key })
  }
  await persistPostgres('trip', key, trip)
  console.log(`📥 Webhook trip → ${useFileStore() ? 'webhook-data/trips.log' : 'postgres'}`)
  return { type: 'trip', id: key, ok: true }
}

export async function storeWebhookVehicle(vehicle) {
  const assetId = (vehicle.AssetId ?? vehicle.assetId)?.toString()
  if (!assetId) return { type: 'vehicle', ok: false, error: 'missing AssetId' }

  let created = true
  if (useFileStore()) {
    const vehicles = readJsonArray(PATHS.vehicles(), true)
    const idx = vehicles.findIndex(v => v.AssetId?.toString() === assetId)
    created = idx < 0
    if (idx >= 0) vehicles[idx] = { ...vehicles[idx], ...vehicle, webhookUpdatedAt: new Date().toISOString() }
    else vehicles.push({ ...vehicle, webhookUpdatedAt: new Date().toISOString() })
    writeJsonArray(PATHS.vehicles(), vehicles)
    touchMetadata({ lastAssetId: assetId })
  }
  await persistPostgres('vehicle', assetId, vehicle)
  console.log(`📥 Webhook vehicle → ${useFileStore() ? 'webhook-data/vehicles.json' : 'postgres'}`)
  return { type: 'vehicle', id: assetId, created, ok: true }
}

export async function storeWebhookDriver(driver) {
  const driverId = (driver.DriverId ?? driver.driverId)?.toString()
  if (!driverId) return { type: 'driver', ok: false, error: 'missing DriverId' }

  let created = true
  if (useFileStore()) {
    const drivers = readJsonArray(PATHS.drivers(), true)
    const idx = drivers.findIndex(d => d.DriverId?.toString() === driverId)
    created = idx < 0
    if (idx >= 0) drivers[idx] = { ...drivers[idx], ...driver, webhookUpdatedAt: new Date().toISOString() }
    else drivers.push({ ...driver, webhookUpdatedAt: new Date().toISOString() })
    writeJsonArray(PATHS.drivers(), drivers)
    touchMetadata({ lastDriverId: driverId })
  }
  await persistPostgres('driver', driverId, driver)
  console.log(`📥 Webhook driver → ${useFileStore() ? 'webhook-data/drivers.json' : 'postgres'}`)
  return { type: 'driver', id: driverId, created, ok: true }
}

export async function storeWebhookSite(site) {
  const id = (site.id ?? site.GroupId ?? site.groupId)?.toString()
  if (!id) return { type: 'site', ok: false, error: 'missing site id' }

  const entry = {
    id,
    name: site.name ?? site.Name ?? 'Unknown',
    type: site.type ?? site.Type ?? 'SiteGroup',
    zoneName: site.zoneName ?? site.zone ?? site.ZoneName ?? site.Name ?? 'Unknown Zone',
    zoneId: (site.zoneId ?? site.ZoneId ?? site.GroupId)?.toString() ?? id,
    webhookUpdatedAt: new Date().toISOString(),
  }

  let created = true
  if (useFileStore()) {
    const sites = readJsonArray(PATHS.sites())
    const idx = sites.findIndex(s => s.id?.toString() === id)
    created = idx < 0
    if (idx >= 0) sites[idx] = { ...sites[idx], ...entry }
    else sites.push(entry)
    writeJsonArray(PATHS.sites(), sites)
    touchMetadata({ lastSiteId: id })
  }
  await persistPostgres('site', id, entry)
  console.log(`📥 Webhook site → ${useFileStore() ? 'webhook-data/sites.json' : 'postgres'}`)
  return { type: 'site', id, created, ok: true }
}

export async function storeWebhookPosition(position) {
  const assetId = (position.AssetId ?? position.assetId)?.toString()
  if (!assetId) return { type: 'position', ok: false, error: 'missing AssetId' }

  if (useFileStore()) {
    const positions = readJsonObject(PATHS.positions())
    positions[assetId] = {
      receivedAt: new Date().toISOString(),
      source: 'webhook',
      assetId,
      latitude: position.Latitude ?? position.latitude,
      longitude: position.Longitude ?? position.longitude,
      speed: position.SpeedKilometresPerHour ?? position.speed ?? null,
      heading: position.Heading ?? position.heading ?? null,
      timestamp: position.Timestamp ?? position.timestamp ?? new Date().toISOString(),
      address: position.FormattedAddress ?? position.address ?? null,
      driverId: position.DriverId ?? position.driverId ?? null,
      payload: position,
    }
    ensureDir()
    fs.writeFileSync(PATHS.positions(), JSON.stringify(positions, null, 2))
    touchMetadata({ lastPositionAssetId: assetId })
  }
  await persistPostgres('position', assetId, position)
  console.log(`📥 Webhook position → ${useFileStore() ? 'webhook-data/positions.json' : 'postgres'}`)
  return { type: 'position', id: assetId, ok: true }
}

export async function queryPostgresRecent(limit = 50) {
  if (!postgresReady || !pool) return []
  const result = await pool.query(
    `SELECT id, received_at, entity_type, entity_id, payload
     FROM webhook_inbox ORDER BY id DESC LIMIT $1`,
    [limit]
  )
  return result.rows.map(row => ({
    id: Number(row.id),
    receivedAt: row.received_at,
    entityType: row.entity_type,
    entityId: row.entity_id,
    payload: row.payload,
  }))
}
