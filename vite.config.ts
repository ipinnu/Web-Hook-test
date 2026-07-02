import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import * as dotenv from 'dotenv'
import { pollOnce, clearTriggeredEvent, resetState, getWarningEvents, getSessionTrips, getDriverDistanceSummary } from './scripts/mix-test.js'
import { initWebhookStore, getWebhookDashboardData } from './scripts/mix-webhook-store.js'
import { getPlaygroundSetup, sendPlaygroundPayload, readJsonBody } from './scripts/mix-webhook-playground.js'
import fs from 'fs'
import path from 'path'

dotenv.config({ path: ['.env.local', '.env'] })

const WEBHOOK_SECRET = process.env.MIX_WEBHOOK_SECRET
const WEBHOOK_URL = process.env.WEBHOOK_PUBLIC_URL || 'https://jmg.bestpracticesltd.com.ng/api/mix-webhook'

const ACKNOWLEDGED_FILE = path.join(process.cwd(), 'public', 'acknowledged.json')
const API_SECRET = process.env.API_SECRET

function loadAcknowledged(): string[] {
  try {
    if (fs.existsSync(ACKNOWLEDGED_FILE)) {
      return JSON.parse(fs.readFileSync(ACKNOWLEDGED_FILE, 'utf8'))
    }
  } catch {
    // ignore
  }
  return []
}

function saveAcknowledged(ids: string[]) {
  fs.writeFileSync(ACKNOWLEDGED_FILE, JSON.stringify(ids, null, 2))
}

function isAuthorized(req: any): boolean {
  const secret = req.headers['x-api-secret']
  return secret === API_SECRET
}

function jsonResponse(res: any, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

export default defineConfig({
  server: {
    host: true,
    watch: {
      ignored: ['**/scripts/mix-test.js', '**/public/data.json', '**/public/metadata.json', '**/public/acknowledged.json', '**/public/drivers.json', '**/public/vehicles.json', '**/events.log', '**/panic.log'],
    },
  },
  plugins: [
    react(),
    {
      name: 'mix-data-poller',
      configureServer(server) {
        // Webhook demo branch — MiX polling disabled (no startPolling here)
        initWebhookStore().catch(err => console.error('Webhook store init failed:', err.message))

        server.middlewares.use('/api/mix-webhook/dashboard-data', (req, res) => {
          if (req.method !== 'GET') {
            res.statusCode = 405
            res.end('Method Not Allowed')
            return
          }
          if (!isAuthorized(req)) {
            res.statusCode = 401
            res.end('Unauthorized')
            return
          }
          const requestUrl = new URL(req.url || '', 'http://localhost')
          const limit = Math.min(Number(requestUrl.searchParams.get('limit')) || 20, 100)
          jsonResponse(res, 200, getWebhookDashboardData(limit))
        })

        server.middlewares.use('/api/mix-webhook/playground/setup', (req, res) => {
          if (req.method !== 'GET') {
            res.statusCode = 405
            res.end('Method Not Allowed')
            return
          }
          if (!isAuthorized(req)) {
            res.statusCode = 401
            res.end('Unauthorized')
            return
          }
          jsonResponse(res, 200, getPlaygroundSetup(WEBHOOK_URL, WEBHOOK_SECRET))
        })

        server.middlewares.use('/api/mix-webhook/playground/send', async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end('Method Not Allowed')
            return
          }
          if (!isAuthorized(req)) {
            res.statusCode = 401
            res.end('Unauthorized')
            return
          }
          if (!WEBHOOK_SECRET) {
            jsonResponse(res, 500, { ok: false, error: 'Webhook secret is not configured' })
            return
          }
          try {
            const body = await readJsonBody(req)
            const payload = body?.payload
            if (!payload || typeof payload !== 'object') {
              jsonResponse(res, 400, { ok: false, error: 'Expected JSON object or array payload' })
              return
            }
            const result = await sendPlaygroundPayload(payload)
            jsonResponse(res, result.status, {
              ok: result.ok,
              webhookUrl: WEBHOOK_URL,
              sent: payload,
              postStatus: result.status,
              postResponse: result.postResponse,
              fetchUrl: '/api/mix-webhook/dashboard-data?limit=20',
              dashboard: result.dashboard,
              fetched: result.fetched,
              error: result.ok ? undefined : result.postResponse?.error,
            })
          } catch (err) {
            console.error('Webhook demo send failed:', (err as Error).message)
            jsonResponse(res, 500, { ok: false, error: 'Failed to send demo payload' })
          }
        })

        // Refresh endpoint
        server.middlewares.use('/api/refresh', async (req, res) => {
          if (!isAuthorized(req)) {
            res.statusCode = 401
            res.end('Unauthorized')
            return
          }
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end('Method Not Allowed')
            return
          }
          const result = await pollOnce()
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(result))
        })

        // Get acknowledged IDs
        server.middlewares.use('/api/acknowledged', async (req, res) => {
          if (!isAuthorized(req)) {
            res.statusCode = 401
            res.end('Unauthorized')
            return
          }

          if (req.method === 'GET') {
            const ids = loadAcknowledged()
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(ids))
            return
          }

          if (req.method === 'POST') {
            let body = ''
            req.on('data', (chunk: Buffer) => { body += chunk.toString() })
            req.on('end', () => {
              try {
                const { id } = JSON.parse(body)
                const ids = loadAcknowledged()
                if (!ids.includes(id)) {
                  ids.push(id)
                  saveAcknowledged(ids)
                }
                clearTriggeredEvent(id)
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ ok: true }))
              } catch {
                res.statusCode = 400
                res.end('Bad Request')
              }
            })
            return
          }

          res.statusCode = 405
          res.end('Method Not Allowed')
        })

        // Reset endpoint
        server.middlewares.use('/api/reset', async (req, res) => {
          if (!isAuthorized(req)) {
            res.statusCode = 401
            res.end('Unauthorized')
            return
          }
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end('Method Not Allowed')
            return
          }
          resetState()
          saveAcknowledged([])
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true }))
        })

        // Data endpoint
        server.middlewares.use('/api/data', async (req, res) => {
          if (!isAuthorized(req)) {
            res.statusCode = 401
            res.end('Unauthorized')
            return
          }
          if (req.method !== 'GET') {
            res.statusCode = 405
            res.end('Method Not Allowed')
            return
          }
          try {
            const dataPath = path.join(process.cwd(), 'public', 'data.json')
            const data = fs.readFileSync(dataPath, 'utf8')
            res.setHeader('Content-Type', 'application/json')
            res.end(data)
          } catch {
            res.statusCode = 404
            res.end('Not Found')
          }
        })

        // Metadata endpoint
        server.middlewares.use('/api/metadata', async (req, res) => {
          if (!isAuthorized(req)) {
            res.statusCode = 401
            res.end('Unauthorized')
            return
          }
          if (req.method !== 'GET') {
            res.statusCode = 405
            res.end('Method Not Allowed')
            return
          }
          try {
            const metadataPath = path.join(process.cwd(), 'public', 'metadata.json')
            const data = fs.readFileSync(metadataPath, 'utf8')
            res.setHeader('Content-Type', 'application/json')
            res.end(data)
          } catch {
            res.statusCode = 404
            res.end('Not Found')
          }
        })

        // Events log endpoint — reads from events.log and panic.log, enriches with vehicle data
        server.middlewares.use('/api/trips/session', async (req, res) => {
          if (!isAuthorized(req)) {
            res.statusCode = 401
            res.end('Unauthorized')
            return
          }
          if (req.method !== 'GET') {
            res.statusCode = 405
            res.end('Method Not Allowed')
            return
          }
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(getSessionTrips()))
        })

        server.middlewares.use('/api/driver-distance', async (req, res) => {
          if (!isAuthorized(req)) {
            res.statusCode = 401
            res.end('Unauthorized')
            return
          }
          if (req.method !== 'GET') {
            res.statusCode = 405
            res.end('Method Not Allowed')
            return
          }
          const requestUrl = new URL(req.url || '', 'http://localhost')
          const range = requestUrl.searchParams.get('range') || '24h'
          const month = requestUrl.searchParams.get('month')
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(getDriverDistanceSummary({ range, month })))
        })

        server.middlewares.use('/api/events/log', async (req, res) => {
          if (!isAuthorized(req)) {
            res.statusCode = 401
            res.end('Unauthorized')
            return
          }
          if (req.method !== 'GET') {
            res.statusCode = 405
            res.end('Method Not Allowed')
            return
          }
          try {
            const entries: any[] = []

            // Warning events endpoint
        server.middlewares.use('/api/events', async (req, res) => {
          if (!isAuthorized(req)) {
            res.statusCode = 401
            res.end('Unauthorized')
            return
          }
          if (req.method !== 'GET') {
            res.statusCode = 405
            res.end('Method Not Allowed')
            return
          }
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(getWarningEvents()))
        })

        // Drivers endpoint
          server.middlewares.use('/api/drivers', async (req, res) => {
            if (!isAuthorized(req)) {
              res.statusCode = 401
              res.end('Unauthorized')
              return
            }
            if (req.method !== 'GET') {
              res.statusCode = 405
              res.end('Method Not Allowed')
              return
            }
            try {
              const driversPath = path.join(process.cwd(), 'public', 'drivers.json')
              if (!fs.existsSync(driversPath)) {
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify([]))
                return
              }
              const data = fs.readFileSync(driversPath, 'utf8')
              res.setHeader('Content-Type', 'application/json')
              res.end(data)
            } catch {
              res.statusCode = 404
              res.end('Not Found')
            }
          })

            // Load vehicle lookup from data.json for enrichment
            const vehicleLookup = new Map<string, any>()
            try {
              const dataPath = path.join(process.cwd(), 'public', 'data.json')
              if (fs.existsSync(dataPath)) {
                const vehicles = JSON.parse(fs.readFileSync(dataPath, 'utf8'))
                vehicles.forEach((v: any) => {
                  vehicleLookup.set(v.id?.toString(), {
                    regNo: v.regNo || 'N/A',
                    assetName: v.assetName || 'Unknown Vehicle',
                    transporter: v.transporter || 'N/A',
                  })
                })
              }
            } catch { }

            const enrich = (entry: any) => {
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
                  const entry = JSON.parse(line)
                  entries.push(enrich({ ...entry, type: 'panic', label: 'Panic' }))
                } catch { }
              })
            }

            const eventsLogPath = path.join(process.cwd(), 'events.log')
            if (fs.existsSync(eventsLogPath)) {
              const lines = fs.readFileSync(eventsLogPath, 'utf8').trim().split('\n').filter(Boolean)
              lines.forEach(line => {
                try {
                  const entry = JSON.parse(line)
                  entries.push(enrich({ ...entry, type: 'warning' }))
                } catch { }
              })
            }

            entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(entries))
          } catch {
            res.statusCode = 500
            res.end('Internal Server Error')
          }
        })
      },
    },
  ],
})
