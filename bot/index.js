const API_BASE_URL = (process.env.REALME_API_URL || 'http://localhost:8080').replace(/\/$/, '')
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const OTA_API_URL = process.env.OTA_API_URL || ''

if (!BOT_TOKEN) {
  throw new Error('TELEGRAM_BOT_TOKEN is required')
}

const TG = 'https://api.telegram.org/bot' + BOT_TOKEN
let offset = 0
let stopped = false
const lastRequest = new Map()

const commands = [
  { command: 'start', description: 'Open the Realme device assistant' },
  { command: 'help', description: 'Show available commands' },
  { command: 'menu', description: 'Open the interactive menu' },
  { command: 'whatis', description: 'Find a device by name, codename, or model' },
  { command: 'codename', description: 'Find the codename of a device' },
  { command: 'deviceinfo', description: 'Show complete device information' },
  { command: 'search', description: 'Search the Realme device database' },
  { command: 'series', description: 'List devices in a series' },
  { command: 'devices', description: 'Browse the device database' },
  { command: 'ota', description: 'Check OTA information' },
]

async function telegram(method, body = {}) {
  const response = await fetch(TG + '/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json()
  if (!response.ok || !payload.ok) {
    throw new Error(payload.description || ('Telegram API error: ' + response.status))
  }
  return payload.result
}

async function api(path) {
  const response = await fetch(API_BASE_URL + path, {
    headers: { accept: 'application/json' },
  })
  const body = await response.json()
  if (!response.ok) {
    const error = new Error(body.error || 'API request failed')
    error.status = response.status
    throw error
  }
  return body
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function parseCommand(text) {
  const match = String(text || '').match(/^\/([a-z0-9_]+)(?:@[^\s]+)?(?:\s+([\s\S]*))?$/i)
  return match ? { command: match[1].toLowerCase(), query: (match[2] || '').trim() } : null
}

function menu() {
  return {
    inline_keyboard: [
      [
        { text: '🔎 Search', callback_data: 'help_search' },
        { text: '📱 Device Info', callback_data: 'help_device' },
      ],
      [
        { text: '🧩 Codename', callback_data: 'help_codename' },
        { text: '📡 OTA', callback_data: 'help_ota' },
      ],
      [
        { text: '📚 Series', callback_data: 'help_series' },
        { text: '❓ Help', callback_data: 'help' },
      ],
    ],
  }
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

async function showDevice(chatId, query, title = 'Device information') {
  if (!query) {
    return send(chatId, 'Please provide a device name, codename, or model number.\n\nExample: <code>/deviceinfo lisaa</code>')
  }

  const device = await api('/api/v1/device/' + encodeURIComponent(query))
  const codenames = device.codenames.length ? device.codenames.join(', ') : '—'
  const models = device.models.length ? device.models.join(', ') : '—'

  return send(chatId,
    '<b>' + esc(title) + '</b>\n\n' +
    '<b>Name:</b> ' + esc(device.name) + '\n' +
    '<b>Series:</b> ' + esc(device.series) + '\n' +
    '<b>Codename:</b> <code>' + esc(codenames) + '</code>\n' +
    '<b>Model:</b> <code>' + esc(models) + '</code>'
  )
}

async function search(chatId, query) {
  if (!query) return send(chatId, 'Usage: <code>/search &lt;query&gt;</code>')

  const body = await api('/api/v1/search?q=' + encodeURIComponent(query) + '&limit=10')
  if (!body.results.length) return send(chatId, 'No matching Realme devices were found.')

  const lines = body.results.map((d, i) =>
    (i + 1) + '. <b>' + esc(d.name) + '</b>\n' +
    '   Series: ' + esc(d.series) + '\n' +
    '   Codename: <code>' + esc(d.codenames.join(', ') || '—') + '</code>\n' +
    '   Model: <code>' + esc(d.models.join(', ') || '—') + '</code>'
  )

  return send(chatId, '<b>Search results</b>\n\n' + lines.join('\n\n'))
}

async function series(chatId, query) {
  if (!query) return send(chatId, 'Usage: <code>/series &lt;series&gt;</code>')

  const body = await api('/api/v1/series/' + encodeURIComponent(query))
  const lines = body.results.map((d) =>
    '• <b>' + esc(d.name) + '</b> — <code>' + esc(d.codenames.join(', ') || d.models.join(', ') || '—') + '</code>'
  )
  return send(chatId, '<b>' + esc(body.series) + '</b>\n\n' + lines.join('\n'))
}

async function ota(chatId, query) {
  if (!query) return send(chatId, 'Usage: <code>/ota &lt;device&gt;</code>')
  if (!OTA_API_URL) {
    return send(chatId, 'OTA service is not configured yet. Set <code>OTA_API_URL</code> on the bot deployment.')
  }

  const url = OTA_API_URL.includes('{query}')
    ? OTA_API_URL.replace('{query}', encodeURIComponent(query))
    : OTA_API_URL + (OTA_API_URL.includes('?') ? '&' : '?') + 'q=' + encodeURIComponent(query)

  const response = await fetch(url, { headers: { accept: 'application/json' } })
  const body = await response.text()

  if (!response.ok) {
    return send(chatId, 'The OTA service returned HTTP <code>' + response.status + '</code>.')
  }

  let output
  try {
    output = JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    output = body
  }

  if (output.length > 3500) output = output.slice(0, 3500) + '\n…'
  return send(chatId, '<b>OTA result</b>\n<pre>' + esc(output) + '</pre>')
}

async function handle(chatId, command, query) {
  switch (command) {
    case 'start':
      return send(chatId,
        '<b>Realme Device Assistant</b>\n\n' +
        'Resolve Realme devices by codename, model number, device name, or series.\n\n' +
        'Use /help for commands or /menu for quick actions.',
        { reply_markup: menu() }
      )
    case 'help':
      return send(chatId,
        '<b>Commands</b>\n\n' +
        '<code>/whatis lisaa</code> — identify a device\n' +
        '<code>/codename GT Neo 3</code> — find codename\n' +
        '<code>/deviceinfo RMX3560</code> — full device information\n' +
        '<code>/search GT Neo 3</code> — search database\n' +
        '<code>/series Realme GT</code> — list a series\n' +
        '<code>/devices</code> — database overview\n' +
        '<code>/ota &lt;device&gt;</code> — OTA lookup\n' +
        '<code>/menu</code> — interactive menu'
      )
    case 'menu':
      return send(chatId, '<b>Realme Device Assistant</b>', { reply_markup: menu() })
    case 'whatis':
      return showDevice(chatId, query, 'Device')
    case 'codename': {
      const d = await api('/api/v1/device/' + encodeURIComponent(query))
      return send(chatId, '<b>' + esc(d.name) + '</b>\n\nCodename: <code>' + esc(d.codenames.join(', ') || '—') + '</code>')
    }
    case 'deviceinfo':
      return showDevice(chatId, query)
    case 'search':
      return search(chatId, query)
    case 'series':
      return series(chatId, query)
    case 'devices': {
      const body = await api('/api/v1/devices?limit=1')
      return send(chatId, '<b>Database</b>\n\nRegistered devices: <b>' + body.count + '</b>\n\nUse <code>/search &lt;query&gt;</code> to find a device.')
    }
    case 'ota':
      return ota(chatId, query)
    default:
      return send(chatId, 'Unknown command. Use <code>/help</code>.')
  }
}

async function processUpdate(update) {
  if (update.callback_query) {
    await telegram('answerCallbackQuery', { callback_query_id: update.callback_query.id })
    const chatId = update.callback_query.message.chat.id
    const action = update.callback_query.data

    if (action === 'help_search') return send(chatId, 'Use <code>/search GT Neo 3</code> or any codename/model.')
    if (action === 'help_device') return send(chatId, 'Use <code>/deviceinfo lisaa</code> or <code>/deviceinfo RMX3560</code>.')
    if (action === 'help_codename') return send(chatId, 'Use <code>/codename GT Neo 3</code>.')
    if (action === 'help_ota') return send(chatId, 'Use <code>/ota &lt;device&gt;</code>.')
    if (action === 'help_series') return send(chatId, 'Use <code>/series Realme GT</code>.')
    if (action === 'help') return handle(chatId, 'help', '')
    return
  }

  const message = update.message
  if (!message?.chat?.id || !message.text) return

  const parsed = parseCommand(message.text)
  if (!parsed) return

  const now = Date.now()
  const previous = lastRequest.get(message.chat.id) || 0
  if (now - previous < 700) return
  lastRequest.set(message.chat.id, now)

  try {
    await handle(message.chat.id, parsed.command, parsed.query)
  } catch (error) {
    console.error('Update failed:', error)
    const text = error.status === 404
      ? 'No matching device was found. Try a codename, RMX model, or a more complete device name.'
      : 'The request could not be completed right now. Please try again shortly.'
    await send(message.chat.id, text)
  }
}

async function poll() {
  await telegram('deleteWebhook', { drop_pending_updates: false })
  await telegram('setMyCommands', { commands })

  console.log('RealmeInfoBot started')

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
      console.error('Polling error:', error.message)
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }
  }
}

process.once('SIGINT', () => { stopped = true })
process.once('SIGTERM', () => { stopped = true })

poll().catch((error) => {
  console.error(error)
  process.exit(1)
})
