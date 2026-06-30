import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = path.join(process.cwd(), 'mix-events.db')

let db

function getDb() {
  if (!db) {
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS mix_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        received_at TEXT NOT NULL DEFAULT (datetime('now')),
        event_id TEXT,
        event_type_id TEXT,
        asset_id TEXT,
        source TEXT NOT NULL DEFAULT 'webhook',
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mix_events_received_at ON mix_events(received_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mix_events_event_id ON mix_events(event_id);
    `)
  }
  return db
}

function extractFields(event) {
  const eventId = (event.EventId ?? event.eventId ?? event.id)?.toString() || null
  const eventTypeId = (event.EventTypeId ?? event.eventTypeId ?? event.type)?.toString() || null
  const assetId = (event.AssetId ?? event.assetId ?? event.AssetID)?.toString() || null
  return { eventId, eventTypeId, assetId }
}

export function normalizeWebhookBody(body) {
  if (!body || typeof body !== 'object') return []
  if (Array.isArray(body)) return body
  if (Array.isArray(body.events)) return body.events
  if (Array.isArray(body.Events)) return body.Events
  if (Array.isArray(body.data)) return body.data
  if (body.EventId || body.eventId || body.EventTypeId || body.eventTypeId) return [body]
  return []
}

export function insertWebhookEvents(events, source = 'webhook') {
  const database = getDb()
  const insert = database.prepare(`
    INSERT INTO mix_events (event_id, event_type_id, asset_id, source, payload)
    VALUES (@eventId, @eventTypeId, @assetId, @source, @payload)
  `)

  const insertMany = database.transaction((rows) => {
    const ids = []
    for (const event of rows) {
      const fields = extractFields(event)
      const result = insert.run({
        ...fields,
        source,
        payload: JSON.stringify(event),
      })
      ids.push(Number(result.lastInsertRowid))
    }
    return ids
  })

  return insertMany(events)
}

export function getRecentWebhookEvents(limit = 50) {
  const database = getDb()
  const rows = database.prepare(`
    SELECT id, received_at, event_id, event_type_id, asset_id, source, payload
    FROM mix_events
    ORDER BY id DESC
    LIMIT ?
  `).all(limit)

  return rows.map(row => ({
    id: row.id,
    receivedAt: row.received_at,
    eventId: row.event_id,
    eventTypeId: row.event_type_id,
    assetId: row.asset_id,
    source: row.source,
    payload: JSON.parse(row.payload),
  }))
}
