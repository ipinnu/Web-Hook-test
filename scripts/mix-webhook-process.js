import {
  storeWebhookEvent,
  storeWebhookTrip,
  storeWebhookVehicle,
  storeWebhookDriver,
  storeWebhookSite,
  storeWebhookPosition,
} from './mix-webhook-store.js'

export function classifyPayload(item) {
  if (!item || typeof item !== 'object') return 'unknown'

  const eventTypeId = item.EventTypeId ?? item.eventTypeId
  if (eventTypeId) return 'event'

  const tripId = item.TripId ?? item.TripID ?? item.tripId
  const hasTripFields = tripId || (
    (item.DistanceKilometers != null || item.distanceKm != null) &&
    (item.TripStart || item.TripEnd || item.StartDateTime || item.EndDateTime)
  )
  if (hasTripFields) return 'trip'

  const driverId = item.DriverId ?? item.driverId
  const hasDriverFields = driverId && (item.Name || item.MobileNumber) && !item.RegistrationNumber && !eventTypeId
  if (hasDriverFields) return 'driver'

  const groupId = item.GroupId ?? item.groupId
  const siteType = item.Type ?? item.type
  if (groupId && siteType && (item.Name || item.name) && !item.RegistrationNumber && !driverId) return 'site'
  if (item.id && item.zoneName && !item.AssetId) return 'site'

  const assetId = item.AssetId ?? item.assetId ?? item.AssetID
  const hasLat = item.Latitude != null || item.latitude != null
  const hasSpeed = item.SpeedKilometresPerHour != null || item.speed != null
  const hasTs = item.Timestamp || item.timestamp
  if (assetId && hasLat && (hasSpeed || hasTs)) return 'position'

  if (assetId && (item.RegistrationNumber || item.Description || item.Make || item.Model)) return 'vehicle'

  return 'unknown'
}

function flattenInbound(body) {
  if (!body || typeof body !== 'object') return []
  if (Array.isArray(body)) return body
  if (Array.isArray(body.events)) return body.events
  if (Array.isArray(body.Events)) return body.Events
  if (Array.isArray(body.data)) return body.data
  if (Array.isArray(body.trips)) return body.trips
  if (Array.isArray(body.Trips)) return body.Trips
  if (Array.isArray(body.assets)) return body.assets
  if (Array.isArray(body.drivers)) return body.drivers
  if (body.event) return [body.event]
  if (body.trip) return [body.trip]
  if (body.asset || body.vehicle) return [body.asset || body.vehicle]
  if (body.driver) return [body.driver]
  if (body.position) return [body.position]
  if (body.site) return [body.site]
  if (typeof body.data === 'object' && body.data) return [body.data]
  return [body]
}

export function normalizeInboundBody(body) {
  return flattenInbound(body).filter(item => classifyPayload(item) !== 'unknown')
}

export async function processWebhookPayloads(items) {
  const results = []

  for (const item of items) {
    const kind = classifyPayload(item)
    try {
      switch (kind) {
        case 'event':
          results.push(await storeWebhookEvent(item))
          break
        case 'trip':
          results.push(await storeWebhookTrip(item))
          break
        case 'vehicle':
          results.push(await storeWebhookVehicle(item))
          break
        case 'driver':
          results.push(await storeWebhookDriver(item))
          break
        case 'site':
          results.push(await storeWebhookSite(item))
          break
        case 'position':
          results.push(await storeWebhookPosition(item))
          break
        default:
          results.push({ type: 'unknown', ok: false })
      }
    } catch (err) {
      console.error(`Webhook process failed (${kind}):`, err.message)
      results.push({ type: kind, ok: false, error: err.message })
    }
  }

  return results
}
