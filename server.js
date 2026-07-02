import express from 'express'
import path from 'path'
import fs from 'fs'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import fetch from 'node-fetch'
import { pollOnce, clearTriggeredEvent, resetState, getWarningEvents, getSessionTrips, getDriverDistanceSummary } from './scripts/mix-test.js'
import { normalizeInboundBody, processWebhookPayloads } from './scripts/mix-webhook-process.js'
import {
  initWebhookStore,
  insertInboxRecords,
  getRecentInbox,
  getWebhookDashboardData,
  queryPostgresRecent,
  isPostgresReady,
  getWebhookDir,
  getStoreInfo,
} from './scripts/mix-webhook-store.js'

dotenv.config({ path: ['.env.local', '.env'] })

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000
const API_SECRET = process.env.API_SECRET
const WEBHOOK_SECRET = process.env.MIX_WEBHOOK_SECRET
const WEBHOOK_URL = process.env.WEBHOOK_PUBLIC_URL || 'https://jmg.bestpracticesltd.com.ng/api/mix-webhook'
const ACKNOWLEDGED_FILE = path.join(process.cwd(), 'public', 'acknowledged.json')

app.use(express.json())

function isAuthorized(req) {
  return req.headers['x-api-secret'] === API_SECRET
}

function unauthorized(res) {
  res.status(401).end('Unauthorized')
}

function isWebhookAuthorized(req) {
  if (!WEBHOOK_SECRET) return false
  return req.headers['x-webhook-secret'] === WEBHOOK_SECRET
}

function loadAcknowledged() {
  try {
    if (fs.existsSync(ACKNOWLEDGED_FILE)) {
      return JSON.parse(fs.readFileSync(ACKNOWLEDGED_FILE, 'utf8'))
    }
  } catch { }
  return []
}

function saveAcknowledged(ids) {
  fs.writeFileSync(ACKNOWLEDGED_FILE, JSON.stringify(ids, null, 2))
}

function readFixture(name) {
  const filePath = path.join(__dirname, 'scripts', 'fixtures', name)
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
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

function getWebhookDemoSamples() {
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

// Block direct access to sensitive JSON files
app.use((req, res, next) => {
  const blocked = ['/data.json', '/metadata.json', '/drivers.json', '/vehicles.json', '/acknowledged.json', '/trips-session.json', '/trips-cache.json', '/driver-distance-24h.json']
  if (blocked.includes(req.path)) {
    return res.status(403).end('Forbidden')
  }
  next()
})

// Refresh
app.post('/api/refresh', async (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  const result = await pollOnce()
  res.json(result)
})

// Acknowledged GET
app.get('/api/acknowledged', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  res.json(loadAcknowledged())
})

// Acknowledged POST
app.post('/api/acknowledged', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  try {
    const { id } = req.body
    const ids = loadAcknowledged()
    if (!ids.includes(id)) {
      ids.push(id)
      saveAcknowledged(ids)
    }
    clearTriggeredEvent(id)
    res.json({ ok: true })
  } catch {
    res.status(400).end('Bad Request')
  }
})

// Reset
app.post('/api/reset', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  resetState()
  saveAcknowledged([])
  res.json({ ok: true })
})

// Data
app.get('/api/data', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  try {
    const data = fs.readFileSync(path.join(process.cwd(), 'public', 'data.json'), 'utf8')
    res.setHeader('Content-Type', 'application/json')
    res.end(data)
  } catch {
    res.status(404).end('Not Found')
  }
})

// Metadata
app.get('/api/metadata', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  try {
    const data = fs.readFileSync(path.join(process.cwd(), 'public', 'metadata.json'), 'utf8')
    res.setHeader('Content-Type', 'application/json')
    res.end(data)
  } catch {
    res.status(404).end('Not Found')
  }
})

// Warning events
app.get('/api/events', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  res.json(getWarningEvents())
})

// Session trips
app.get('/api/trips/session', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  res.json(getSessionTrips())
})

// Driver distance summary
app.get('/api/driver-distance', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  const range = req.query.range?.toString() || '24h'
  const month = req.query.month?.toString() || null
  res.json(getDriverDistanceSummary({ range, month }))
})

// Drivers
app.get('/api/drivers', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  try {
    const driversPath = path.join(process.cwd(), 'public', 'drivers.json')
    if (!fs.existsSync(driversPath)) return res.json([])
    const data = fs.readFileSync(driversPath, 'utf8')
    res.setHeader('Content-Type', 'application/json')
    res.end(data)
  } catch {
    res.status(404).end('Not Found')
  }
})

// Events log
app.get('/api/events/log', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  try {
    const entries = []

    const vehicleLookup = new Map()
    try {
      const dataPath = path.join(process.cwd(), 'public', 'data.json')
      if (fs.existsSync(dataPath)) {
        const vehicles = JSON.parse(fs.readFileSync(dataPath, 'utf8'))
        vehicles.forEach(v => {
          vehicleLookup.set(v.id?.toString(), {
            regNo: v.regNo || 'N/A',
            assetName: v.assetName || 'Unknown Vehicle',
            transporter: v.transporter || 'N/A',
          })
        })
      }
    } catch { }

    const enrich = (entry) => {
      const vehicle = vehicleLookup.get(entry.assetId?.toString()) || {}
      return {
        ...entry,
        regNo: vehicle.regNo || 'N/A',
        assetName: vehicle.assetName || 'Unknown Vehicle',
        transporter: vehicle.transporter || 'N/A',
      }
    }

    const panicLogPath = path.join(process.cwd(), 'panic.log')
    if (fs.existsSync(panicLogPath)) {
      const lines = fs.readFileSync(panicLogPath, 'utf8').trim().split('\n').filter(Boolean)
      lines.forEach(line => {
        try {
          entries.push(enrich({ ...JSON.parse(line), type: 'panic', label: 'Panic' }))
        } catch { }
      })
    }

    const eventsLogPath = path.join(process.cwd(), 'events.log')
    if (fs.existsSync(eventsLogPath)) {
      const lines = fs.readFileSync(eventsLogPath, 'utf8').trim().split('\n').filter(Boolean)
      lines.forEach(line => {
        try {
          entries.push(enrich({ ...JSON.parse(line), type: 'warning' }))
        } catch { }
      })
    }

    entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    res.json(entries)
  } catch {
    res.status(500).end('Internal Server Error')
  }
})

// Public ping — verify domain/nginx routes to this app (no auth)
app.get('/api/mix-webhook/health', (_req, res) => {
  const store = getStoreInfo()
  res.json({
    ok: true,
    service: 'jmg-mix-webhook',
    webhookUrl: WEBHOOK_URL,
    secretConfigured: Boolean(WEBHOOK_SECRET),
    store,
  })
})

// MiX webhook — MiX (or test scripts) POST events here; no dashboard x-api-secret
app.post('/api/mix-webhook', async (req, res) => {
  if (!isWebhookAuthorized(req)) return unauthorized(res)

  const items = normalizeInboundBody(req.body)
  if (items.length === 0) {
    return res.status(400).json({ ok: false, error: 'Unrecognised payload — expected event, trip, vehicle, driver, site, or position' })
  }

  try {
    const ids = await insertInboxRecords(items)
    const processed = await processWebhookPayloads(items)
    res.status(200).json({ ok: true, count: ids.length, ids, processed, store: getStoreInfo() })
  } catch (err) {
    console.error('Webhook insert failed:', err.message)
    res.status(500).json({ ok: false, error: 'Failed to store event' })
  }
})

// Inspect recent webhook events (dashboard auth)
app.get('/api/mix-webhook/events', async (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  const limit = Math.min(Number(req.query.limit) || 50, 200)
  const source = req.query.source?.toString() || 'file'
  if (source === 'postgres' && isPostgresReady()) {
    return res.json(await queryPostgresRecent(limit))
  }
  res.json(getRecentInbox(limit))
})

// Webhook demo dashboard data — reads only the isolated webhook-data store
app.get('/api/mix-webhook/dashboard-data', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  const limit = Math.min(Number(req.query.limit) || 20, 100)
  res.json(getWebhookDashboardData(limit))
})

// Webhook demo setup — safe metadata and sample payloads, never raw secrets
app.get('/api/mix-webhook/playground/setup', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  res.json({
    webhookUrl: WEBHOOK_URL,
    dashboardDataUrl: '/api/mix-webhook/dashboard-data?limit=20',
    eventsUrl: '/api/mix-webhook/events?limit=10',
    docsUrl: '/docs/mix-webhook',
    secretConfigured: Boolean(WEBHOOK_SECRET),
    expectedHeaders: {
      'Content-Type': 'application/json',
      'x-webhook-secret': WEBHOOK_SECRET ? 'Configured' : 'Missing',
    },
    samples: getWebhookDemoSamples(),
  })
})

// Webhook demo send — the browser calls this; the server posts to the real webhook route
app.post('/api/mix-webhook/playground/send', async (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  if (!WEBHOOK_SECRET) {
    return res.status(500).json({ ok: false, error: 'Webhook secret is not configured' })
  }

  const payload = req.body?.payload
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ ok: false, error: 'Expected JSON object or array payload' })
  }

  try {
    const loopbackUrl = `http://127.0.0.1:${PORT}/api/mix-webhook`
    const response = await fetch(loopbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': WEBHOOK_SECRET,
      },
      body: JSON.stringify(payload),
    })

    const text = await response.text()
    let postResponse
    try {
      postResponse = JSON.parse(text)
    } catch {
      postResponse = { raw: text }
    }

    res.status(response.ok ? 200 : response.status).json({
      ok: response.ok,
      webhookUrl: WEBHOOK_URL,
      sent: payload,
      postStatus: response.status,
      postResponse,
      fetchUrl: '/api/mix-webhook/dashboard-data?limit=20',
      dashboard: getWebhookDashboardData(20),
      fetched: getRecentInbox(10),
    })
  } catch (err) {
    console.error('Webhook demo send failed:', err.message)
    res.status(500).json({ ok: false, error: 'Failed to send demo payload' })
  }
})

// MiX webhook documentation (public HTML)
app.get('/docs/mix-webhook', (_req, res) => {
  res.sendFile(path.join(__dirname, 'docs', 'mix-webhook.html'))
})

// Serve built frontend
app.use(express.static(path.join(__dirname, 'dist')))

// All other routes serve index.html
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

// Start server and polling
initWebhookStore().catch(err => {
  console.error('Webhook store init failed:', err.message)
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 JMG Dashboard server running on port ${PORT}`)
  console.log(`📡 Webhook demo mode — MiX polling disabled`)
})
