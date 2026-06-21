import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'
import { WebSocketServer, WebSocket } from 'ws'
import { IncomingMessage } from 'http'
import { startGame, beginGame, getSession, nfcTap, updateRunDistance, getResult, getCurrentSessionId, startPodStatusPolling } from './game.js'

const app = new Hono()
app.use('*', cors())

app.get('/api/game/current', (c) => {
  const sessionId = getCurrentSessionId()
  if (!sessionId) return c.json({ error: 'No active session' }, 404)
  return c.json({ sessionId })
})

type NfcResult = { title: string; msg: string; color: string; score: string }
let pendingNfc: NfcResult | null = null

function processNfc(destinationId: number): NfcResult {
  const sessionId = getCurrentSessionId()
  if (!sessionId) return { title: 'エラー', msg: 'ゲームが開始されていません', color: '#f44', score: '-' }
  const result = nfcTap(sessionId, destinationId)
  const score = String(result.score)
  const msg = result.message
  if (result.result === 'correct')    return { title: '🎯 クリア！',   msg, color: '#ff4', score }
  if (result.result === 'fake_bonus') return { title: '⚡ ボーナス！', msg, color: '#f4f', score }
  if (result.result === 'fake_hit')   return { title: '💥 ヒット！',   msg, color: '#f84', score }
  if (result.result === 'pod_down')   return { title: '⏳ 復活待ち',   msg, color: '#888', score }
  return { title: 'エラー', msg, color: '#f44', score }
}

// compass.html がポーリングで取得するエンドポイント
app.get('/api/nfc/pending', (c) => {
  const r = pendingNfc; pendingNfc = null
  return c.json(r ?? null)
})

// NFC タグ URL：処理して結果を保存 → compass.html にリダイレクト
app.get('/api/nfc/:destinationId', (c) => {
  const id = Number(c.req.param('destinationId'))
  console.log(`[NFC] tap destinationId=${id}`)
  pendingNfc = processNfc(id)
  console.log(`[NFC] result: ${JSON.stringify(pendingNfc)}`)
  return c.redirect('/compass.html')
})

app.post('/api/game/:sessionId/begin', (c) => {
  const ok = beginGame(c.req.param('sessionId'))
  if (!ok) return c.json({ error: 'Not found or already begun' }, 400)
  return c.json({ ok: true })
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
  startPodStatusPolling()
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
