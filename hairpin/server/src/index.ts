import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import { WebSocketServer, WebSocket } from 'ws'
import { IncomingMessage } from 'http'
import { startGame, getSession, arrive, updateRunDistance } from './game.js'

const app = new Hono()
app.use('*', cors())

// 本番: ビルド済みフロントエンドを配信
// dist/ に index.html, compass.html, monitor.html, src/ などが含まれる
app.use('/*', serveStatic({ root: 'dist' }))
// Vite が assets/ を dist/assets/ に書き出す
app.use('/assets/*', serveStatic({ root: 'dist' }))

app.post('/api/game/start', async (c) => {
  const result = startGame()
  return c.json({ sessionId: result.sessionId, destinations: result.destinations })
})

app.get('/api/game/:sessionId', async (c) => {
  const session = await getSession(c.req.param('sessionId'))
  if (!session) return c.json({ error: 'Not found' }, 404)
  return c.json(session)
})

app.post('/api/game/:sessionId/arrive', async (c) => {
  const { destinationId } = await c.req.json<{ destinationId: number }>()
  const result = arrive(c.req.param('sessionId'), destinationId)
  return c.json(result)
})

app.post('/api/game/:sessionId/run', async (c) => {
  const { distanceMeters } = await c.req.json<{ distanceMeters: number }>()
  const result = await updateRunDistance(c.req.param('sessionId'), distanceMeters)
  if (!result) return c.json({ error: 'Not found or game ended' }, 404)
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
