import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { normalizeInboundBody, processWebhookPayloads } from './mix-webhook-process.js'
import {
  getRecentInbox,
  getWebhookDashboardData,
  insertInboxRecords,
} from './mix-webhook-store.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = path.join(__dirname, 'fixtures')

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'))
}

function stampDemoPayload(payload, kind) {
  const now = new Date().toISOString()
  const id = `MOCK-DEMO-${kind.toUpperCase()}-${Date.now()}`
  const next = JSON.parse(JSON.stringify(payload))

  if (next.EventId) {
    next.EventId = id
    next.EventDateTime = now
    next.ReceivedDateTime = now
    if (next.Position) next.Position.FormattedAddress = 'DEMO - not real MiX data'
  }
  if (next.TripId) {
    next.TripId = id
    next.TripStart = new Date(Date.now() - 45 * 60 * 1000).toISOString()
    next.TripEnd = now
  }
  if (next.Timestamp) {
    next.Timestamp = now
    next.FormattedAddress = 'DEMO - not real MiX data'
  }

  return next
}

export function getWebhookDemoSamples() {
  const panic = stampDemoPayload(readFixture('mix-webhook-panic.json'), 'panic')
  const trip = stampDemoPayload(readFixture('mix-webhook-trip.json'), 'trip')
  const position = stampDemoPayload(readFixture('mix-webhook-position.json'), 'position')

  return {
    panic,
    trip,
    position,
    vehicle: {
      AssetId: '1234567890123456789',
      RegistrationNumber: 'DEMO-JMG-001',
      Description: 'DEMO - JMG sample vehicle',
      Make: 'Demo',
      Model: 'Webhook',
    },
    driver: {
      DriverId: '1234567890123456790',
      Name: 'DEMO Driver',
      MobileNumber: '+2340000000000',
    },
  }
}

export function getPlaygroundSetup(webhookUrl, webhookSecret) {
  return {
    webhookUrl,
    dashboardDataUrl: '/api/mix-webhook/dashboard-data?limit=20',
    eventsUrl: '/api/mix-webhook/events?limit=10',
    docsUrl: '/docs/mix-webhook',
    secretConfigured: Boolean(webhookSecret),
    expectedHeaders: {
      'Content-Type': 'application/json',
      'x-webhook-secret': webhookSecret ? 'Configured' : 'Missing',
    },
    samples: getWebhookDemoSamples(),
  }
}

export async function sendPlaygroundPayload(payload) {
  const items = normalizeInboundBody(payload)
  if (items.length === 0) {
    return {
      ok: false,
      status: 400,
      postResponse: { ok: false, error: 'Unrecognised payload — expected event, trip, vehicle, driver, site, or position' },
    }
  }

  const ids = await insertInboxRecords(items)
  const processed = await processWebhookPayloads(items)

  return {
    ok: true,
    status: 200,
    postResponse: { ok: true, count: ids.length, ids, processed },
    dashboard: getWebhookDashboardData(20),
    fetched: getRecentInbox(10),
  }
}

export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk.toString() })
    req.on('end', () => {
      if (!body.trim()) {
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(body))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}
