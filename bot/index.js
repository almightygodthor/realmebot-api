const http = require('node:http')

const API_BASE_URL = (process.env.REALME_API_URL || 'http://localhost:8080').replace(/\/$/, '')
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const OTA_API_URL = process.env.OTA_API_URL || ''
const PORT = Number(process.env.PORT || 8080)
const HEALTH_PORT = Number(process.env.HEALTH_PORT || PORT)

if (!BOT_TOKEN) {
  throw new Error('TELEGRAM_BOT_TOKEN is required')
}

const TG = 'https://api.telegram.org/bot' + BOT_TOKEN
const BOT_NAME = process.env.BOT_NAME || 'RealmeInfoBot'
const BOT_VERSION = process.env.BOT_VERSION || '2.0.0'

let offset = 0
let stopped = false
let polling = false
const lastRequest = new Map()
const CACHE_TTL = 30_000
const cache = new Map()

const commands = [
  { command: 'start', description: 'Open the Realme device assistant' },
  { command: 'help', description: 'Show help and commands' },
  { command: 'menu', description: 'Open the interactive menu' },
  { command: 'whatis', description: 'Identify a Realme device' },
  { command: 'codename', description: 'Find a device codename' },
  { command: 'deviceinfo', description: 'Show complete device information' },
  { command: 'search', description: 'Search the device database' },
  { command: 'series', description: 'Browse a Realme series' },
  { command: 'devices', description: 'Show database statistics' },
  { command: 'ota', description: 'Check OTA information' },
  { command: 'about', description: 'Show bot and API status' },
]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function telegram(method, body = {}, attempt = 0) {
  const response = await fetch(TG + '/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(method === 'getUpdates' ? 65_000 : 15_000),
  })

  const payload = await response.json().catch(() => ({}))

  if (response.status === 429 && attempt < 3) {
    const retryAfter = Number(payload.parameters?.retry_after || 2)
    await sleep(Math.min(retryAfter * 1000, 15_000))
    return telegram(method, body, attempt + 1)
  }

  if (!response.ok || !payload.ok) {
    throw new Error(payload.description || ('Telegram API error: ' + response.status))
  }

  return payload.result
}

async function api(path, attempt = 0) {
  const cached = cache.get(path)
  if (cached && cached.expires > Date.now()) return cached.value

  try {
    const response = await fetch(API_BASE_URL + path, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })

    const raw = await response.text()
    let body = {}
    try { body = raw ? JSON.parse(raw) : {} } catch {
      body = { error: raw || 'Invalid API response' }
    }

    if (!response.ok) {
      const error = new Error(body.error || 'API request failed')
      error.status = response.status
      throw error
    }

    cache.set(path, { value: body, expires: Date.now() + CACHE_TTL })
    return body
  } catch (error) {
    if (attempt < 2 && (!error.status || error.status >= 500)) {
      await sleep(500 * (attempt + 1))
      return api(path, attempt + 1)
    }
    throw error
  }
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function code(value) {
  return '<code>' + esc(value) + '</code>'
}

function parseCommand(text) {
  const match = String(text || '').match(/^\\/([a-z0-9_]+)(?:@[^\\s]+)?(?:\\s+([\\s\\S]*))?$/i)
  return match ? { command: match[1].toLowerCase(), query: (match[2] || '').trim() } : null
}

function menu() {
  return {
    inline_keyboard: [
      [
        { text: '🔎 Search', callback_data: 'search' },
        { text: '📱 Device', callback_data: 'device' },
      ],
      [
        { text: '🧩 Codename', callback_data: 'codename' },
        { text: '📡 OTA', callback_data: 'ota' },
      ],
      [
        { text: '📚 Series', callback_data: 'series' },
        { text: '📊 Database', callback_data: 'devices' },
      ],
      [
        { text: '❓ Help', callback_data: 'help' },
        { text: 'ℹ️ About', callback_data: 'about' },
      ],
    ],
  }
}

function backMenu() {
  return { inline_keyboard: [[{ text: '⬅️ Main menu', callback_data: 'menu' }]] }
}

async function send(chatId, text, extra = {}) {
  return telegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  })
}

async function edit(chatId, messageId, text, extra = {}) {
  return telegram('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  })
}

function deviceText(device, title = '📱 Device information') {
  const codenames = device.codenames?.length ? device.codenames.join(', ') : '—'
  const models = device.models?.length ? device.models.join(', ') : '—'
  const aliases = device.aliases?.filter(Boolean).slice(0, 8).join(', ') || '—'

  return '<b>' + esc(title) + '</b>\n\n' +
    '<b>Name</b>    ' + esc(device.name) + '\n' +
    '<b>Series</b>  ' + esc(device.series) + '\n' +
    '<b>Codename</b> ' + code(codenames) + '\n' +
    '<b>Model</b>    ' + code(models) + '\n' +
    '<b>Aliases</b>  ' + esc(aliases)
}

async function showDevice(chatId, query, title = '📱 Device information', replyMarkup = backMenu()) {
  if (!query) {
    return send(chatId,
      '<b>Device lookup</b>\n\n' +
      'Send a codename, model number, or device name.\n\n' +
      code('/deviceinfo lisaa') + '\n' +
      code('/deviceinfo RMX3560') + '\n' +
      code('/deviceinfo GT Neo 3'),
      { reply_markup: replyMarkup }
    )
  }

  const device = await api('/api/v1/device/' + encodeURIComponent(query))
  return send(chatId, deviceText(device, title), { reply_markup: replyMarkup })
}

async function search(chatId, query) {
  if (!query) {
    return send(chatId,
      '<b>🔎 Search</b>\n\n' +
      'Try a codename, RMX model, or natural device name.\n\n' +
      code('/search lisaa') + '\n' +
      code('/search RMX3560') + '\n' +
      code('/search GT Neo 3'),
      { reply_markup: backMenu() }
    )
  }

  const body = await api('/api/v1/search?q=' + encodeURIComponent(query) + '&limit=10')
  if (!body.results?.length) {
    return send(chatId, '❌ No matching Realme devices were found.\n\nTry a model such as ' + code('RMX3560') + ' or a codename such as ' + code('lisaa') + '.', { reply_markup: backMenu() })
  }

  const lines = body.results.map((d, i) => {
    const model = d.models?.join(', ') || '—'
    const codename = d.codenames?.join(', ') || '—'
    return '<b>' + (i + 1) + '. ' + esc(d.name) + '</b>\n' +
      '   ' + esc(d.series) + '\n' +
      '   ' + code(codename) + ' · ' + code(model)
  })

  return send(chatId,
    '<b>🔎 Search results</b>\n' +
    'Query: ' + code(query) + '\n\n' +
    lines.join('\n\n'),
    { reply_markup: backMenu() }
  )
}

async function series(chatId, query) {
  if (!query) {
    return send(chatId, '<b>📚 Series browser</b>\n\nUsage: ' + code('/series GT') + ' or ' + code('/series Narzo') + '.', { reply_markup: backMenu() })
  }

  const body = await api('/api/v1/series/' + encodeURIComponent(query))
  if (!body.results?.length) {
    return send(chatId, '❌ No devices were found for series ' + code(query) + '.', { reply_markup: backMenu() })
  }

  const lines = body.results.map((d) =>
    '• <b>' + esc(d.name) + '</b> — ' +
    code(d.codenames?.join(', ') || d.models?.join(', ') || '—')
  )

  return send(chatId,
    '<b>📚 ' + esc(body.series) + '</b>\n\n' + lines.join('\n'),
    { reply_markup: backMenu() }
  )
}

async function devices(chatId) {
  const body = await api('/api/v1/devices?limit=1')
  return send(chatId,
    '<b>📊 Realme device database</b>\n\n' +
    'Registered devices: <b>' + esc(body.count) + '</b>\n' +
    'API version: <code>v2</code>\n' +
    'Status: 🟢 online\n\n' +
    'Use ' + code('/search <query>') + ' to find a device.',
    { reply_markup: backMenu() }
  )
}

async function about(chatId) {
  let apiStatus = '🔴 unavailable'
  try {
    const health = await api('/health')
    apiStatus = health?.status === 'ok' ? '🟢 online' : '🟡 reachable'
  } catch {}

  return send(chatId,
    '<b>ℹ️ RealmeInfoBot</b>\n\n' +
    'A rebuilt Realme device information assistant.\n\n' +
    '<b>Bot</b>     <code>' + esc(BOT_VERSION) + '</code>\n' +
    '<b>API</b>     ' + apiStatus + '\n' +
    '<b>Runtime</b> <code>Node.js ' + esc(process.versions.node) + '</code>\n\n' +
    'Device lookup, model/codename resolution, series browsing and OTA integration.',
    { reply_markup: backMenu() }
  )
}

async function ota(chatId, query) {
  if (!query) {
    return send(chatId,
      '<b>📡 OTA lookup</b>\n\nUsage: ' + code('/ota RMX3560') + '\n\n' +
      'The OTA provider is kept behind a small adapter so the bot can be updated without touching device lookup.',
      { reply_markup: backMenu() }
    )
  }

  if (!OTA_API_URL) {
    return send(chatId,
      '📡 <b>OTA service is not configured.</b>\n\n' +
      'Device lookup is fully operational. Add ' + code('OTA_API_URL') + ' to the bot runtime when the OTA endpoint is available.',
      { reply_markup: backMenu() }
    )
  }

  const url = OTA_API_URL.includes('{query}')
    ? OTA_API_URL.replace('{query}', encodeURIComponent(query))
    : OTA_API_URL + (OTA_API_URL.includes('?') ? '&' : '?') + 'q=' + encodeURIComponent(query)

  const response = await fetch(url, {
    headers: { accept: 'application/json, text/plain;q=0.9' },
    signal: AbortSignal.timeout(15_000),
  })
  const body = await response.text()

  if (!response.ok) {
    return send(chatId, '📡 OTA provider returned HTTP ' + code(response.status) + '.', { reply_markup: backMenu() })
  }

  let output
  try {
    output = JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    output = body
  }

  if (!output.trim()) output = 'No OTA information was returned.'
  if (output.length > 3500) output = output.slice(0, 3500) + '\n…'

  return send(chatId, '<b>📡 OTA result</b>\n\n<pre>' + esc(output) + '</pre>', { reply_markup: backMenu() })
}

async function help(chatId) {
  return send(chatId,
    '<b>❓ RealmeInfoBot commands</b>\n\n' +
    code('/whatis <device>') + ' — identify a device\n' +
    code('/codename <device>') + ' — find codename\n' +
    code('/deviceinfo <device>') + ' — full information\n' +
    code('/search <query>') + ' — search database\n' +
    code('/series <series>') + ' — browse a series\n' +
    code('/devices') + ' — database statistics\n' +
    code('/ota <device>') + ' — OTA lookup\n' +
    code('/about') + ' — bot/API status\n' +
    code('/menu') + ' — interactive menu\n\n' +
    '<i>You can also send a device name or model directly in a private chat.</i>',
    { reply_markup: backMenu() }
  )
}

async function handle(chatId, command, query, message = null) {
  switch (command) {
    case 'start':
      return send(chatId,
        '<b>⚡ RealmeInfoBot — Reborn</b>\n\n' +
        'Realme device intelligence, rebuilt from the ground up.\n\n' +
        'Search by <b>name</b>, <b>codename</b>, <b>model</b> or <b>series</b>.\n\n' +
        'Example: ' + code('GT Neo 3') + ' · ' + code('lisaa') + ' · ' + code('RMX3560'),
        { reply_markup: menu() }
      )
    case 'help': return help(chatId)
    case 'menu': return send(chatId, '<b>⚡ RealmeInfoBot</b>\nChoose an action:', { reply_markup: menu() })
    case 'whatis': return showDevice(chatId, query, '📱 Device')
    case 'codename': {
      if (!query) return showDevice(chatId, '', '🧩 Codename')
      const d = await api('/api/v1/device/' + encodeURIComponent(query))
      return send(chatId, '<b>🧩 ' + esc(d.name) + '</b>\n\nCodename: ' + code(d.codenames?.join(', ') || '—') + '\nModel: ' + code(d.models?.join(', ') || '—'), { reply_markup: backMenu() })
    }
    case 'deviceinfo': return showDevice(chatId, query)
    case 'search': return search(chatId, query)
    case 'series': return series(chatId, query)
    case 'devices': return devices(chatId)
    case 'ota': return ota(chatId, query)
    case 'about': return about(chatId)
    default:
      if (message?.chat?.type === 'private' && query) return search(chatId, query)
      return help(chatId)
  }
}

async function processUpdate(update) {
  if (update.callback_query) {
    const callback = update.callback_query
    await telegram('answerCallbackQuery', { callback_query_id: callback.id })
    const chatId = callback.message?.chat?.id
    if (!chatId) return

    const data = callback.data || ''
    if (data === 'menu') return edit(chatId, callback.message.message_id, '<b>⚡ RealmeInfoBot</b>\nChoose an action:', { reply_markup: menu() })
    if (data === 'help') return edit(chatId, callback.message.message_id, await callbackText('help'), { reply_markup: backMenu() })
    if (data === 'about') return edit(chatId, callback.message.message_id, await callbackText('about'), { reply_markup: backMenu() })
    if (data === 'search') return send(chatId, '<b>🔎 Search</b>\n\nUse ' + code('/search <query>') + '.', { reply_markup: backMenu() })
    if (data === 'device') return send(chatId, '<b>📱 Device lookup</b>\n\nUse ' + code('/deviceinfo <device>') + '.', { reply_markup: backMenu() })
    if (data === 'codename') return send(chatId, '<b>🧩 Codename</b>\n\nUse ' + code('/codename <device>') + '.', { reply_markup: backMenu() })
    if (data === 'ota') return send(chatId, '<b>📡 OTA</b>\n\nUse ' + code('/ota <device>') + '.', { reply_markup: backMenu() })
    if (data === 'series') return send(chatId, '<b>📚 Series</b>\n\nUse ' + code('/series <series>') + '.', { reply_markup: backMenu() })
    if (data === 'devices') return devices(chatId)
    return
  }

  const message = update.message
  if (!message?.chat?.id || !message.text) return

  const parsed = parseCommand(message.text)
  const isPrivate = message.chat.type === 'private'

  if (!parsed) {
    if (isPrivate) {
      const query = message.text.trim()
      if (query) {
        return processCommand(message.chat.id, 'search', query, message)
      }
    }
    return
  }

  return processCommand(message.chat.id, parsed.command, parsed.query, message)
}

async function callbackText(type) {
  if (type === 'about') {
    return '<b>ℹ️ RealmeInfoBot</b>\n\nVersion <code>' + esc(BOT_VERSION) + '</code>\nAPI <code>v2</code>\nNode.js <code>' + esc(process.versions.node) + '</code>'
  }
  return '<b>❓ Help</b>\n\nUse /search, /deviceinfo, /codename, /series, /devices or /ota.\n\nSend a device name directly in a private chat for instant search.'
}

async function processCommand(chatId, command, query, message) {
  const now = Date.now()
  const previous = lastRequest.get(chatId) || 0
  if (now - previous < 600) return
  lastRequest.set(chatId, now)

  try {
    await handle(chatId, command, query, message)
  } catch (error) {
    console.error('Update failed:', error)
    const text = error.status === 404
      ? '❌ No matching device was found. Try a codename, RMX model, or a more complete device name.'
      : '⚠️ The request failed temporarily. Please try again shortly.'
    await send(chatId, text, { reply_markup: backMenu() }).catch(() => {})
  }
}

function startHealthServer() {
  const server = http.createServer((request, response) => {
    if (request.url === '/health' || request.url === '/') {
      const payload = JSON.stringify({
        status: 'ok',
        service: BOT_NAME,
        version: BOT_VERSION,
        polling,
        uptime: Math.round(process.uptime()),
      })
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(payload)
      return
    }

    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'Not found' }))
  })

  server.listen(HEALTH_PORT, '0.0.0.0', () => {
    console.log('Health server listening on :' + HEALTH_PORT)
  })

  return server
}

async function poll() {
  await telegram('deleteWebhook', { drop_pending_updates: false })
  await telegram('setMyCommands', { commands })
  polling = true
  console.log(BOT_NAME + ' ' + BOT_VERSION + ' started')

  while (!stopped) {
    try {
      const updates = await telegram('getUpdates', {
        offset,
        timeout: 50,
        allowed_updates: ['message', 'callback_query'],
      })

      for (const update of updates) {
        offset = update.update_id + 1
        await processUpdate(update)
      }
    } catch (error) {
      if (!stopped) {
        polling = false
        console.error('Polling error:', error.message)
        await sleep(3000)
        polling = true
      }
    }
  }
}

const healthServer = startHealthServer()

async function shutdown(signal) {
  stopped = true
  polling = false
  console.log(signal + ' received, shutting down')
  healthServer.close()
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))

poll().catch((error) => {
  console.error(error)
  process.exit(1)
})
