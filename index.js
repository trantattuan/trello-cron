const https = require('https')
const http = require('http')
const url = require('url')

const API_BASE = process.env.API_BASE || 'http://api:3001'
const CRON_SECRET = process.env.CRON_SECRET || ''
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '60000') // 60s

function request(method, path, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const parsed = new url.URL(API_BASE + path)
    const isHttps = parsed.protocol === 'https:'
    const lib = isHttps ? https : http
    const data = body ? JSON.stringify(body) : null
    const headers = {
      'Content-Type': 'application/json',
      'x-cron-secret': CRON_SECRET,
      ...extraHeaders,
    }
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

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

// Parse "*/N * * * *" → interval in minutes, return null for unsupported patterns
function parseMinuteInterval(expr) {
  if (!expr) return null
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [min, hour, dom, month, dow] = parts
  if (hour !== '*' || dom !== '*' || month !== '*' || dow !== '*') return null
  const m = min.match(/^\*\/(\d+)$/)
  if (m) return parseInt(m[1])
  if (min === '*') return 1
  return null
}

function isDue(job) {
  const now = new Date()

  // One-time job
  if (job.scheduledAt && !job.cronExpression) {
    return !job.lastRunAt && new Date(job.scheduledAt) <= now
  }

  // Recurring job
  if (job.cronExpression) {
    const intervalMin = parseMinuteInterval(job.cronExpression)
    if (intervalMin === null) {
      console.warn(`[${ts()}] Unsupported cron expression "${job.cronExpression}" for job ${job.id}`)
      return false
    }
    if (!job.lastRunAt) return true
    const msElapsed = now - new Date(job.lastRunAt)
    return msElapsed >= intervalMin * 60 * 1000
  }

  return false
}

async function createCard(listId, title) {
  const res = await request('POST', '/cards', { listId, title }, {})
  if (res.status !== 201) throw new Error(`Create card failed: ${JSON.stringify(res.body)}`)
  return res.body
}

async function markRun(jobId) {
  await request('PATCH', `/schedules/${jobId}/run`, null, {})
}

async function poll() {
  const res = await request('GET', '/schedules/pending', null, {})
  if (res.status !== 200) {
    console.error(`[${ts()}] Failed to fetch pending jobs: ${res.status}`)
    return
  }

  const jobs = Array.isArray(res.body) ? res.body : []
  const due = jobs.filter(isDue)

  if (due.length === 0) return

  console.log(`[${ts()}] ${due.length} job(s) due`)

  for (const job of due) {
    try {
      const cardTitle = job.title.replace('{date}', ts())
      const card = await createCard(job.listId, cardTitle)
      await markRun(job.id)
      console.log(`[${ts()}] Job ${job.id}: created card "${card.title}"`)
    } catch (err) {
      console.error(`[${ts()}] Job ${job.id} error:`, err.message)
    }
  }
}

async function run() {
  if (!CRON_SECRET) {
    console.error(`[${ts()}] CRON_SECRET is not set — aborting`)
    process.exit(1)
  }

  console.log(`[${ts()}] Cron service started, polling every ${POLL_INTERVAL_MS / 1000}s`)

  // Initial poll
  try { await poll() } catch (err) { console.error(`[${ts()}] Poll error:`, err.message) }

  setInterval(async () => {
    try { await poll() } catch (err) { console.error(`[${ts()}] Poll error:`, err.message) }
  }, POLL_INTERVAL_MS)
}

run()
