/**
 * Send a mock MiX webhook event to your server.
 *
 * Usage:
 *   node scripts/send-webhook-test.js
 *   node scripts/send-webhook-test.js https://jmg.bestpracticesltd.com.ng
 *   WEBHOOK_URL=https://... WEBHOOK_SECRET=... node scripts/send-webhook-test.js
 */
import * as dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import fetch from 'node-fetch'

dotenv.config({ path: ['.env.local', '.env'] })

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturePath = path.join(__dirname, 'fixtures', 'mix-webhook-panic.json')

const baseUrl = (process.argv[2] || process.env.WEBHOOK_URL || 'http://localhost:3000').replace(/\/$/, '')
const secret = process.env.MIX_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || 'change-me-in-production'
const payload = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))

payload.EventDateTime = new Date().toISOString()
payload.ReceivedDateTime = new Date().toISOString()
payload.EventId = `mock-${Date.now()}`

const url = `${baseUrl}/api/mix-webhook`

console.log('POST', url)
console.log('Payload:', JSON.stringify(payload, null, 2))

const response = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-webhook-secret': secret,
  },
  body: JSON.stringify(payload),
})

const text = await response.text()
console.log('Status:', response.status)
console.log('Response:', text)

if (!response.ok) {
  process.exit(1)
}
