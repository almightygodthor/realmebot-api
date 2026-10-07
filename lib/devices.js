const legacyData = require('../data.json')

const slugify = (value) =>
  String(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const normalize = (value) =>
  String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const compact = (value) => normalize(value).replace(/ /g, '')

const splitAliases = (value) =>
  String(value)
    .split('/')
    .map((item) => item.trim())
    .filter(Boolean)

function buildDevices(data) {
  const records = []

  for (const [series, entries] of Object.entries(data)) {
    for (const [rawKey, model] of Object.entries(entries)) {
      const aliases = splitAliases(rawKey)
      const name = String(model).trim()

      records.push({
        id: slugify(series + '-' + name + '-' + aliases.join('-')),
        brand: 'Realme',
        series,
        name,
        codenames: aliases.filter((alias) => !/^rmx[0-9a-z-]+$/i.test(alias)),
        models: aliases.filter((alias) => /^rmx[0-9a-z-]+$/i.test(alias)),
        aliases,
        search: [series, name, ...aliases],
      })
    }
  }

  return records
}

const devices = buildDevices(legacyData)

function scoreMatch(device, query) {
  const q = normalize(query)
  const cq = compact(query)
  if (!q) return 0

  const fields = [...device.codenames, ...device.models, ...device.aliases, device.name, device.series]
  let best = 0

  for (const field of fields) {
    const n = normalize(field)
    const c = compact(field)

    if (n === q || c === cq) best = Math.max(best, 100)
    else if (c.includes(cq)) best = Math.max(best, 85)
    else if (n.includes(q)) best = Math.max(best, 75)
  }

  const tokens = q.split(' ').filter(Boolean)
  if (tokens.length > 1) {
    const haystack = normalize(fields.join(' '))
    const matched = tokens.filter((token) => haystack.includes(token)).length
    if (matched === tokens.length) best = Math.max(best, 70)
    else if (matched > 0) best = Math.max(best, 30 + matched * 5)
  }

  return best
}

function publicDevice(device) {
  return {
    id: device.id,
    brand: device.brand,
    series: device.series,
    name: device.name,
    codenames: device.codenames,
    models: device.models,
    aliases: device.aliases,
  }
}

function searchDevices(query, limit = 25) {
  const q = String(query ?? '').trim()
  if (!q) return []

  return devices
    .map((device) => ({ device, score: scoreMatch(device, q) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.device.name.localeCompare(b.device.name))
    .slice(0, limit)
    .map(({ device, score }) => ({ ...publicDevice(device), score }))
}

function findDevice(query) {
  const results = searchDevices(query, 10)
  return results.find((result) => result.score >= 100) || results[0] || null
}

function getSeries(series) {
  const q = normalize(series)
  return devices.filter((device) => normalize(device.series) === q).map(publicDevice)
}

module.exports = { devices, normalize, publicDevice, searchDevices, findDevice, getSeries }
