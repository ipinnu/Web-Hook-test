import fs from 'fs'
import path from 'path'

const WEBHOOK_LOG = path.join(process.cwd(), 'webhook-events.log')

function extractFields(event) {
  const eventId = (event.EventId ?? event.eventId ?? event.id)?.toString() || null
  const eventTypeId = (event.EventTypeId ?? event.eventTypeId ?? event.type)?.toString() || null
  const assetId = (event.AssetId ?? event.assetId ?? event.AssetID)?.toString() || null
  return { eventId, eventTypeId, assetId }
}

function readLogEntries() {
  try {
    if (!fs.existsSync(WEBHOOK_LOG)) return []
    return fs.readFileSync(WEBHOOK_LOG, 'utf8').trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line) } catch { return null }
    }).filter(Boolean)
  } catch {
    return []
  }
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
  const existing = readLogEntries()
  let nextId = existing.length > 0 ? Math.max(...existing.map(e => e.id || 0)) + 1 : 1
  const ids = []

  const lines = events.map(event => {
    const fields = extractFields(event)
    const record = {
      id: nextId,
      receivedAt: new Date().toISOString(),
      ...fields,
      source,
      payload: event,
    }
    ids.push(nextId)
    nextId++
    return JSON.stringify(record)
  })

  fs.appendFileSync(WEBHOOK_LOG, lines.join('\n') + '\n')
  return ids
}

export function getRecentWebhookEvents(limit = 50) {
  return readLogEntries()
    .sort((a, b) => (b.id || 0) - (a.id || 0))
    .slice(0, limit)
}
