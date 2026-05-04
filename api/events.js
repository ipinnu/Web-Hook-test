export default function handler(req, res) {
  if (req.headers['x-api-secret'] !== process.env.API_SECRET) {
    return res.status(401).end('Unauthorized');
  }
  res.json({});
}
