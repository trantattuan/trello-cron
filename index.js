const https = require('https')
const http = require('http')
const url = require('url')

const API_BASE = process.env.API_BASE || 'http://api:3001'
const EMAIL = process.env.CRON_EMAIL || 'admin@gmail.com'
const PASSWORD = process.env.CRON_PASSWORD || '123456'
const TARGET_WORKSPACE = process.env.TARGET_WORKSPACE || '1'
const TARGET_BOARD = process.env.TARGET_BOARD || '1'
const TARGET_LIST = process.env.TARGET_LIST || 'việc phải làm'
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS || '180000') // 3 minutes

let token = null

function request(method, path, body, auth) {
  return new Promise((resolve, reject) => {
    const parsed = new url.URL(API_BASE + path)
    const isHttps = parsed.protocol === 'https:'
    const lib = isHttps ? https : http
    const data = body ? JSON.stringify(body) : null
    const headers = { 'Content-Type': 'application/json' }
    if (auth) headers['Authorization'] = `Bearer ${auth}`
    if (data) headers['Content-Length'] = Buffer.byteLength(data)

    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers,
    }, (res) => {
      let buf = ''
      res.on('data', (chunk) => buf += chunk)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }) }
        catch { resolve({ status: res.statusCode, body: buf }) }
      })
    })
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

async function login() {
  const res = await request('POST', '/auth/login', { email: EMAIL, password: PASSWORD })
  if (res.status !== 200) throw new Error(`Login failed: ${JSON.stringify(res.body)}`)
  token = res.body.token
  console.log(`[${ts()}] Logged in as ${EMAIL}`)
}

async function findListId() {
  const wsRes = await request('GET', '/workspaces', null, token)
  if (wsRes.status !== 200) throw new Error('Failed to get workspaces')

  const ws = wsRes.body.find((w) => w.name === TARGET_WORKSPACE || w.id === TARGET_WORKSPACE)
  if (!ws) throw new Error(`Workspace "${TARGET_WORKSPACE}" not found`)

  const wsDetail = await request('GET', `/workspaces/${ws.id}`, null, token)
  const board = (wsDetail.body.boards || []).find((b) => b.title === TARGET_BOARD || b.id === TARGET_BOARD)
  if (!board) throw new Error(`Board "${TARGET_BOARD}" not found`)

  const boardRes = await request('GET', `/boards/${board.id}`, null, token)
  const list = (boardRes.body.lists || []).find((l) => l.title === TARGET_LIST)
  if (!list) throw new Error(`List "${TARGET_LIST}" not found`)

  return list.id
}

async function addCard(listId) {
  const title = `Auto card ${ts()}`
  const res = await request('POST', '/cards', { listId, title }, token)
  if (res.status !== 201) throw new Error(`Create card failed: ${JSON.stringify(res.body)}`)
  console.log(`[${ts()}] Created card: "${title}" in list "${TARGET_LIST}"`)
}

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

async function run() {
  try {
    await login()
    const listId = await findListId()
    console.log(`[${ts()}] Target list ID: ${listId} — running every ${INTERVAL_MS / 1000}s`)

    await addCard(listId)

    setInterval(async () => {
      try {
        await addCard(listId)
      } catch (err) {
        console.error(`[${ts()}] Error:`, err.message)
        // re-login on auth error
        if (err.message.includes('401') || err.message.includes('auth')) {
          try { await login() } catch {}
        }
      }
    }, INTERVAL_MS)
  } catch (err) {
    console.error(`[${ts()}] Startup error:`, err.message)
    process.exit(1)
  }
}

run()
