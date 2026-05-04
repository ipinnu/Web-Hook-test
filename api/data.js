import { fetchVehicleData } from './_lib/mix.js';

export default async function handler(req, res) {
  if (req.headers['x-api-secret'] !== process.env.API_SECRET) {
    return res.status(401).end('Unauthorized');
  }
  try {
    const data = await fetchVehicleData();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
