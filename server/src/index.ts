import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'
import { WebSocketServer, WebSocket } from 'ws'
import { IncomingMessage } from 'http'
import { startGame, getSession, nfcTap, updateRunDistance, getResult, getCurrentSessionId } from './game.js'

const app = new Hono()
app.use('*', cors())

app.get('/api/game/current', (c) => {
  const sessionId = getCurrentSessionId()
  if (!sessionId) return c.json({ error: 'No active session' }, 404)
  return c.json({ sessionId })
})

app.post('/api/game/start', async (c) => {
  const result = startGame()
  return c.json({ sessionId: result.sessionId, destinations: result.destinations })
})

app.get('/api/game/:sessionId', (c) => {
  const session = getSession(c.req.param('sessionId'))
  if (!session) return c.json({ error: 'Not found' }, 404)
  return c.json(session)
})

app.post('/api/game/:sessionId/nfc/:destinationId', (c) => {
  const result = nfcTap(c.req.param('sessionId'), Number(c.req.param('destinationId')))
  return c.json(result)
})

app.post('/api/game/:sessionId/run', async (c) => {
  const { distanceMeters } = await c.req.json<{ distanceMeters: number }>()
  const ok = updateRunDistance(c.req.param('sessionId'), distanceMeters)
  if (!ok) return c.json({ error: 'Not found or game ended' }, 404)
  return c.json({ ok: true })
})

app.get('/api/game/:sessionId/result', (c) => {
  const result = getResult(c.req.param('sessionId'))
  if (!result) return c.json({ error: 'Not found' }, 404)
  return c.json(result)
})

const server = serve({ fetch: app.fetch, port: 3000 }, () => {
  console.log('Server running on http://localhost:3000')
})

// ── WebSocket ─────────────────────────────────────
const wss = new WebSocketServer({ server: server as never })
const compassReceivers = new Set<WebSocket>()
const monitorClients = new Set<WebSocket>()
const displaySenders = new Set<WebSocket>()

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  const url = req.url ?? ''

  if (url === '/ws/compass/send') {
    ws.on('message', (data) => {
      const msg = data.toString()
      compassReceivers.forEach(r => {
        if (r.readyState === WebSocket.OPEN) r.send(msg)
      })
    })
  } else if (url === '/ws/compass') {
    compassReceivers.add(ws)
    ws.on('close', () => compassReceivers.delete(ws))
  } else if (url === '/ws/display/push') {
    // G2アプリ：表示状態を送信、選択コマンドを受信
    displaySenders.add(ws)
    ws.on('message', (data) => {
      const msg = data.toString()
      monitorClients.forEach(m => {
        if (m.readyState === WebSocket.OPEN) m.send(msg)
      })
    })
    ws.on('close', () => displaySenders.delete(ws))
  } else if (url === '/ws/monitor') {
    // モニターブラウザ：表示状態を受信、選択コマンドを送信
    monitorClients.add(ws)
    ws.on('message', (data) => {
      const msg = data.toString()
      displaySenders.forEach(s => {
        if (s.readyState === WebSocket.OPEN) s.send(msg)
      })
    })
    ws.on('close', () => monitorClients.delete(ws))
  }
})
