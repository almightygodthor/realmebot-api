const express = require('express')
const { devices, findDevice, getSeries, normalize, publicDevice, searchDevices } = require('./lib/devices')

const app = express()
const PORT = Number(process.env.PORT) || 8080
const startedAt = Date.now()

app.disable('x-powered-by')
app.set('trust proxy', true)
app.use(express.json({ limit: '32kb' }))

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'public, max-age=60')
  res.setHeader('X-API-Version', '2')
  next()
})

app.get('/', (_req, res) => {
  res.json({
    name: 'RealmeBot API',
    version: '2.0.0',
    status: 'ok',
    devices: devices.length,
    endpoints: {
      health: '/health',
      search: '/api/v1/search?q=lisaa',
      device: '/api/v1/device/lisaa',
      series: '/api/v1/series/Realme GT',
      devices: '/api/v1/devices',
      legacySearch: '/lisaa',
      legacyData: '/legacy',
    },
  })
})

app.get('/legacy', (_req, res) => res.json(require('./data.json')))

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    devices: devices.length,
    timestamp: new Date().toISOString(),
  })
})

app.get('/api/v1', (_req, res) => {
  res.json({
    version: '1.0',
    api: 'RealmeBot API',
    endpoints: [
      'GET /api/v1/search?q=<query>',
      'GET /api/v1/device/<query>',
      'GET /api/v1/series/<series>',
      'GET /api/v1/devices',
    ],
  })
})

app.get('/api/v1/search', (req, res) => {
  const query = String(req.query.q ?? '').trim()
  if (!query) {
    return res.status(400).json({ error: 'Missing query.', usage: '/api/v1/search?q=<codename|model|device name>' })
  }
  if (query.length > 100) return res.status(400).json({ error: 'Query is too long.' })

  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100)
  const results = searchDevices(query, limit)
  return res.json({ query, count: results.length, results })
})

app.get('/api/v1/device/:query', (req, res) => {
  const query = decodeURIComponent(req.params.query).trim()
  const device = findDevice(query)
  if (!device) return res.status(404).json({ error: 'Device not found.', query })
  return res.json(device)
})

app.get('/api/v1/series/:series', (req, res) => {
  const series = decodeURIComponent(req.params.series).trim()
  const results = getSeries(series)
  if (!results.length) return res.status(404).json({ error: 'Series not found.', series })
  return res.json({ series, count: results.length, results })
})

app.get('/api/v1/devices', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || devices.length, 1), 5000)
  const offset = Math.max(Number(req.query.offset) || 0, 0)
  const results = devices.slice(offset, offset + limit).map(publicDevice)
  return res.json({ count: devices.length, offset, limit, results })
})

// Legacy endpoint retained for existing consumers.
app.get('/:query', (req, res) => {
  const query = decodeURIComponent(req.params.query).trim()
  if (!query || normalize(query).length > 100) return res.status(400).json({ error: 'Invalid query.' })

  const results = searchDevices(query).map(({ score, ...device }) => ({
    ...device,
    codename: device.codenames[0] || null,
    model: device.name,
    score,
  }))

  if (!results.length) return res.status(404).json({ error: 'No matching results found.', query })
  return res.json(results)
})

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found.', path: req.originalUrl })
})

app.use((err, _req, res, _next) => {
  console.error(err)
  if (res.headersSent) return
  res.status(500).json({ error: 'Internal server error.' })
})

if (require.main === module) {
  app.listen(PORT, () => console.log('RealmeBot API listening on port ' + PORT))
}

module.exports = { app }
