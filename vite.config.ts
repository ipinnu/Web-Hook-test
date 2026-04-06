import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { pollOnce, startPolling, clearTriggeredEvent, resetState, getWarningEvents } from './scripts/mix-test.js'
import fs from 'fs'
import path from 'path'

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

let pollingStarted = false

export default defineConfig({
  server: {
    host: true,
    watch: {
      ignored: ['**/scripts/mix-test.js', '**/public/data.json', '**/public/metadata.json', '**/public/acknowledged.json'],
    },
  },
  plugins: [
    react(),
    {
      name: 'mix-data-poller',
      configureServer(server) {
        if (!pollingStarted) {
          startPolling({ maxRuns: null })
          pollingStarted = true
        }

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
            const dataPath = path.join(process.cwd(), 'data.json')
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

        // Events log endpoint — reads from events.log and panic.log, enriches with vehicle data
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