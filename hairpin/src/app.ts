import { showStartup, updateDetail, onListSelect } from './glasses'
import { distanceMeters, bearing, bearingToArrow, formatDistance } from './mock/geo'
import { startGame, getGameState, arrive } from './mock/api'
import type { DestinationFromApi, GameState } from './mock/api'

const ARRIVAL_RADIUS = 20 // メートル

type Destination = DestinationFromApi & { alive: boolean }

let sessionId = ''
let destinations: Destination[] = []
let currentLat = 0
let currentLng = 0
let heading: number | null = null
let arrived = false
let selectedIndex = 0

// ── モニター送信 ──────────────────────────────────
let monitorWs: WebSocket | null = null

function startMonitor() {
  const wsUrl = location.origin.replace('https://', 'wss://').replace('http://', 'ws://') + '/ws/display/push'
  const connect = () => {
    monitorWs = new WebSocket(wsUrl)
    monitorWs.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (typeof data.select === 'number') {
          selectedIndex = Math.min(data.select, destinations.length - 1)
        }
      } catch {}
    }
    monitorWs.onclose = () => setTimeout(connect, 2000)
  }
  connect()
}

function pushMonitor(left: string[], right: string) {
  if (monitorWs?.readyState !== WebSocket.OPEN) return
  monitorWs.send(JSON.stringify({ left, right, selectedIndex }))
}

// ── GPS（startCompassのWebSocketで受信）──────────
function startGPS() { /* compass.html経由でWebSocketから受信 */ }

// ── コンパス＋GPS（WebSocket経由で受信）──────────
function startCompass() {
  const wsUrl = location.origin.replace('https://', 'wss://').replace('http://', 'ws://') + '/ws/compass'
  const connect = () => {
    const ws = new WebSocket(wsUrl)
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data)
      if (typeof data.heading === 'number') heading = data.heading
      if (typeof data.lat === 'number') currentLat = data.lat
      if (typeof data.lng === 'number') currentLng = data.lng
    }
    ws.onclose = () => setTimeout(connect, 2000)
  }
  connect()
}

// ── 表示更新 ──────────────────────────────────────
function buildRightPane(): string {
  const target = destinations[selectedIndex]
  if (!target) return '---'

  const aliveDests = destinations.filter(d => d.alive)

  if (!target.alive) {
    return [
      target.name,
      '',
      'TERMINATED',
      '',
      `${aliveDests.length}/${destinations.length} ALIVE`,
    ].join('\n')
  }

  const dist = distanceMeters(currentLat, currentLng, target.lat, target.lng)
  const absBearing = bearing(currentLat, currentLng, target.lat, target.lng)
  const arrow = bearingToArrow(absBearing, heading)

  return [
    target.name,
    '',
    `   ${arrow}`,
    '',
    `  ${formatDistance(dist)}`,
    '',
    `${aliveDests.length}/${destinations.length} ALIVE`,
  ].join('\n')
}

function buildLeftTitles(): string[] {
  return destinations.map(d => d.alive ? `● ${d.name}` : `× ${d.name}`)
}

// ── 表示ループ（コンパス反映用に定期更新）────────
function startDisplayLoop() {
  let isUpdating = false
  setInterval(async () => {
    if (arrived || !sessionId || currentLat === 0 || isUpdating) return
    isUpdating = true
    try {
    const right = buildRightPane()
    await updateDetail(right)
    pushMonitor(buildLeftTitles(), right)

    // 到着判定
    for (const dest of destinations) {
      if (!dest.alive) continue
      const dist = distanceMeters(currentLat, currentLng, dest.lat, dest.lng)
      if (dist <= ARRIVAL_RADIUS) {
        arrived = true
        const res = await arrive(sessionId, dest.id)
        await updateDetail(
          res.result === 'correct'
            ? `FATE REACHED\n\n✓ ${dest.name}\n\nクリア！`
            : `CAPTURED\n\n✗ ${dest.name}\n\nゲームオーバー`
        )
        return
      }
    }
    } finally {
      isUpdating = false
    }
  }, 200)
}

// ── Podステータスのポーリング ─────────────────────
function startPolling() {
  setInterval(async () => {
    if (arrived || !sessionId) return
    const state: GameState = await getGameState(sessionId)
    const changed = state.destinations.some(s => {
      const local = destinations.find(d => d.id === s.id)
      return local && local.alive !== s.alive
    })
    if (changed) {
      destinations = destinations.map(d => ({
        ...d,
        alive: state.destinations.find(s => s.id === d.id)?.alive ?? d.alive,
      }))
      const left = buildLeftTitles()
      const right = buildRightPane()
      await showStartup(left, right)
      pushMonitor(left, right)
    }
  }, 3000)
}


// ── エントリポイント ──────────────────────────────
export async function start() {
  await updateDetail('接続中...')

  const game = await startGame()
  sessionId = game.sessionId
  destinations = game.destinations.map(d => ({ ...d, alive: true }))

  await showStartup(buildLeftTitles(), buildRightPane())

  onListSelect(
    async (index) => {
      selectedIndex = index
      const right = buildRightPane()
      await updateDetail(right)
      pushMonitor(buildLeftTitles(), right)
    },
    () => destinations.length,
    (raw) => { if (monitorWs?.readyState === WebSocket.OPEN) monitorWs.send(JSON.stringify({ debug: raw })) },
  )

  startGPS()
  startDisplayLoop()
  startPolling()
  startCompass()
  startMonitor()
}
