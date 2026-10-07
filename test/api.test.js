const test = require('node:test')
const assert = require('node:assert/strict')
const { app } = require('../index')

async function withServer(fn) {
  const server = app.listen(0)
  const port = server.address().port
  try {
    await fn('http://127.0.0.1:' + port)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('resolves GT Neo 3 by codename', () => withServer(async (base) => {
  const response = await fetch(base + '/api/v1/device/lisaa')
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.name, 'Realme GT Neo 3 5G')
  assert.ok(body.codenames.includes('lisaa'))
}))

test('resolves GT Neo 3 by 150W model number', () => withServer(async (base) => {
  const response = await fetch(base + '/api/v1/search?q=RMX3563')
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.ok(body.results.some((device) => device.name === 'Realme GT Neo 3 5G'))
}))

test('resolves GT Neo 3 by model number', () => withServer(async (base) => {
  const response = await fetch(base + '/api/v1/search?q=RMX3560')
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.ok(body.results.some((device) => device.name === 'Realme GT Neo 3 5G'))
}))

test('resolves natural device names', () => withServer(async (base) => {
  const response = await fetch(base + '/GT%20Neo%203')
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body[0].model, 'Realme GT Neo 3 5G')
}))

test('returns a useful 404 for unknown devices', () => withServer(async (base) => {
  const response = await fetch(base + '/api/v1/device/not-a-real-device')
  const body = await response.json()
  assert.equal(response.status, 404)
  assert.equal(body.error, 'Device not found.')
}))
