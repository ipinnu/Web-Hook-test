import express from 'express'
import path from 'path'
import fs from 'fs'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { startPolling, pollOnce, clearTriggeredEvent, resetState, getWarningEvents, getSessionTrips, getDriverDistanceSummary } from './scripts/mix-test.js'
import { insertWebhookEvents, getRecentWebhookEvents, normalizeWebhookBody } from './scripts/mix-db.js'

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
  res.json({
    ok: true,
    service: 'jmg-mix-webhook',
    webhookUrl: WEBHOOK_URL,
    secretConfigured: Boolean(WEBHOOK_SECRET),
  })
})

// MiX webhook — MiX (or test scripts) POST events here; no dashboard x-api-secret
app.post('/api/mix-webhook', (req, res) => {
  if (!isWebhookAuthorized(req)) return unauthorized(res)

  const events = normalizeWebhookBody(req.body)
  if (events.length === 0) {
    return res.status(400).json({ ok: false, error: 'Expected a MiX event object or array of events' })
  }

  try {
    const ids = insertWebhookEvents(events)
    res.status(200).json({ ok: true, count: ids.length, ids })
  } catch (err) {
    console.error('Webhook insert failed:', err.message)
    res.status(500).json({ ok: false, error: 'Failed to store event' })
  }
})

// Inspect recent webhook events (dashboard auth)
app.get('/api/mix-webhook/events', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  const limit = Math.min(Number(req.query.limit) || 50, 200)
  res.json(getRecentWebhookEvents(limit))
})

// Serve built frontend
app.use(express.static(path.join(__dirname, 'dist')))

// All other routes serve index.html
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

// Start server and polling
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 JMG Dashboard server running on port ${PORT}`)
  console.log(`📡 Starting MiX polling...`)
  startPolling({ maxRuns: null })
})
