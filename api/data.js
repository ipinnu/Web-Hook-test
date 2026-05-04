const { fetchVehicleData } = require('./_lib/mix');

module.exports = async (req, res) => {
  if (req.headers['x-api-secret'] !== process.env.API_SECRET) {
    return res.status(401).end('Unauthorized');
  }
  try {
    const data = await fetchVehicleData();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
