// Stub — no persistent storage on Vercel
// Returns empty list on GET, accepts POST silently
module.exports = (req, res) => {
  if (req.headers['x-api-secret'] !== process.env.API_SECRET) {
    return res.status(401).end('Unauthorized');
  }
  if (req.method === 'GET') return res.json([]);
  res.json({ ok: true });
};
