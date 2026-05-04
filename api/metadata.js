import { fetchVehicleData } from './_lib/mix.js';

export default async function handler(req, res) {
  if (req.headers['x-api-secret'] !== process.env.API_SECRET) {
    return res.status(401).end('Unauthorized');
  }
  try {
    const vehicles = await fetchVehicleData();
    const count = (status) => vehicles.filter(v => v.status === status).length;
    res.status(200).json({
      totalVehicles: vehicles.length,
      moving: count('Moving'),
      idle: count('Idle'),
      excessiveIdle: count('Excessive Idle'),
      stationary: count('Stationary'),
      parked: count('Parked'),
      inactive: count('Inactive'),
      offline: count('Offline'),
      lastUpdate: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
