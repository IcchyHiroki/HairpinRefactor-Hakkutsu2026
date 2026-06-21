import { showStartup, rebuildPage, updateDetail, onListSelect } from './glasses'
import { distanceMeters, bearing, bearingToArrow, formatDistance } from './mock/geo'
import { beginGame, getGameState, getResult, updateRunDistance } from './mock/api'
import type { DestinationFromApi, GameState, GameResult } from './mock/api'

type Destination = DestinationFromApi & { alive: boolean; onceFallen: boolean }

let sessionId = ''
let destinations: Destination[] = []
let currentLat = 0
let currentLng = 0
let heading: number | null = null
let selectedIndex = 0
let gameEnded = false
let gameStarted = false
let compassReady = false

let displayLoopId: ReturnType<typeof setInterval> | null = null
let pollingId: ReturnType<typeof setInterval> | null = null
let statusId: ReturnType<typeof setInterval> | null = null

let prevLat = 0
let prevLng = 0
let pendingDistance = 0

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
      if (typeof data.lat === 'number') {
        const newLat = data.lat
        const newLng = typeof data.lng === 'number' ? data.lng : currentLng
        if (gameStarted && !gameEnded && prevLat !== 0) {
          const d = distanceMeters(prevLat, prevLng, newLat, newLng)
          if (d > 3 && d < 50) pendingDistance += d
        }
        prevLat = newLat
        currentLat = newLat
        compassReady = true
      }
      if (typeof data.lng === 'number') { currentLng = data.lng; prevLng = data.lng }
    }
    ws.onclose = () => { compassReady = false; setTimeout(connect, 2000) }
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

function buildLeftTitles(correctId?: number): string[] {
  return destinations.map(d => {
    if (correctId != null && d.id === correctId) return `>> ${d.name}`
    if (!d.alive) return `× ${d.name}`
    if (d.onceFallen) return `○ ${d.name}`
    return `● ${d.name}`
  })
}

function buildClearRightPane(result: GameResult): string {
  return [
    '** CLEAR **',
    '',
    `時間: ${result.playTime}`,
    `スコア: ${result.score}pt`,
    `移動: ${result.totalDistance}m`,
    `撃墜: ${result.onceFallenCount}回`,
  ].join('\n')
}

// ── 表示ループ（コンパス反映用に定期更新）────────
function startDisplayLoop() {
  if (displayLoopId) clearInterval(displayLoopId)
  let isUpdating = false
  let lastLeft = ''
  displayLoopId = setInterval(async () => {
    if (!sessionId || currentLat === 0 || isUpdating || gameEnded || !gameStarted) return
    isUpdating = true
    try {
      const left = buildLeftTitles()
      const right = buildRightPane()
      const leftStr = left.join(',')
      if (leftStr !== lastLeft) {
        lastLeft = leftStr
        await rebuildPage(left, right)
      } else {
        await updateDetail(right)
      }
      pushMonitor(left, right)
    } finally {
      isUpdating = false
    }
  }, 200)
}

// ── Podステータスのポーリング ─────────────────────
function startPolling() {
  if (pollingId) clearInterval(pollingId)
  let cleared = false
  pollingId = setInterval(async () => {
    if (!sessionId) return
    const capturedSession = sessionId
    const state: GameState = await getGameState(capturedSession)
    if (sessionId !== capturedSession) return

    if (state.status === 'clear' && !cleared) {
      cleared = true
      gameEnded = true
      const result = await getResult(sessionId)
      const left = buildLeftTitles(result.correctId)
      const right = buildClearRightPane(result)
      await rebuildPage(left, right)
      pushMonitor(left, right)
      return
    }

    const changed = state.destinations.some(s => {
      const local = destinations.find(d => d.id === s.id)
      return local && (local.alive !== s.alive || local.onceFallen !== s.onceFallen)
    })
    if (changed) {
      destinations = destinations.map(d => {
        const s = state.destinations.find(s => s.id === d.id)
        return { ...d, alive: s?.alive ?? d.alive, onceFallen: s?.onceFallen ?? d.onceFallen }
      })
      // 選択中の目的地が terminated になったら生存中の最初に切り替え
      if (!destinations[selectedIndex]?.alive) {
        const firstAlive = destinations.findIndex(d => d.alive)
        if (firstAlive >= 0) selectedIndex = firstAlive
      }
      // 描画は display loop に任せる（rebuildPage の競合を避ける）
      pushMonitor(buildLeftTitles(), buildRightPane())
    }
  }, 3000)
}

// ── 移動距離をサーバーに定期送信 ─────────────────
function startDistanceReporting() {
  setInterval(async () => {
    if (!sessionId || !gameStarted || gameEnded || pendingDistance < 1) return
    const d = pendingDistance
    pendingDistance = 0
    await updateRunDistance(sessionId, d).catch(() => { pendingDistance += d })
  }, 10000)
}

// ── 新セッション開始（インプレースリセット）────────
async function loadNewSession(newSessionId: string) {
  if (displayLoopId) { clearInterval(displayLoopId); displayLoopId = null }
  if (pollingId) { clearInterval(pollingId); pollingId = null }
  if (statusId) { clearInterval(statusId); statusId = null }

  sessionId = newSessionId
  gameEnded = false
  gameStarted = false
  selectedIndex = 0
  prevLat = 0
  prevLng = 0
  pendingDistance = 0

  const state = await getGameState(sessionId)
  destinations = state.destinations.map(d => ({ ...d, alive: d.alive ?? true, onceFallen: d.onceFallen ?? false }))

  const startDetail = compassReady
    ? `Hairpin Refactor\n\n目的地を探し出せ\n\nリングを操作して\nゲームスタート`
    : `Hairpin Refactor\n\n目的地を探し出せ\n\nGPS接続待ち...\ncompass.htmlを開いてください`
  await rebuildPage(['▶ START'], startDetail)
  pushMonitor(['▶ START'], startDetail)

  statusId = setInterval(async () => {
    if (gameStarted) { clearInterval(statusId!); statusId = null; return }
    const detail = compassReady
      ? `Hairpin Refactor\n\n目的地を探し出せ\n\nリングを操作して\nゲームスタート`
      : `Hairpin Refactor\n\n目的地を探し出せ\n\nGPS接続待ち...\ncompass.htmlを開いてください`
    await updateDetail(detail)
    pushMonitor(['▶ START'], detail)
  }, 1000)
}

// ── セッション監視（リスタート検知）─────────────
function watchForNewSession() {
  setInterval(async () => {
    const current = await fetch('/api/game/current').then(r => r.ok ? r.json() : null).catch(() => null)
    if (current?.sessionId && current.sessionId !== sessionId) {
      await loadNewSession(current.sessionId)
    }
  }, 3000)
}

// ── エントリポイント ──────────────────────────────
export async function start() {
  await updateDetail('接続中...')

  const current = await fetch('/api/game/current').then(r => r.ok ? r.json() : null)
  if (!current?.sessionId) {
    const waitMsg = `Hairpin Refactor\n\nセッション待機中...\n\n起動スクリプトを実行して\nゲームを開始してください`
    await showStartup(['---'], waitMsg)
    startGPS()
    startCompass()
    startMonitor()
    pushMonitor(['---'], waitMsg)
    watchForNewSession()
    return
  }

  sessionId = current.sessionId
  const state = await getGameState(sessionId)
  destinations = state.destinations.map(d => ({ ...d, alive: d.alive ?? true, onceFallen: d.onceFallen ?? false }))

  await showStartup(
    ['▶ START'],
    `Hairpin Refactor\n\n目的地を探し出せ\n\nGPS接続待ち...\ncompass.htmlを開いてください`,
  )

  statusId = setInterval(async () => {
    if (gameStarted) { clearInterval(statusId!); statusId = null; return }
    const detail = compassReady
      ? `Hairpin Refactor\n\n目的地を探し出せ\n\nリングを操作して\nゲームスタート`
      : `Hairpin Refactor\n\n目的地を探し出せ\n\nGPS接続待ち...\ncompass.htmlを開いてください`
    await updateDetail(detail)
    pushMonitor(['▶ START'], detail)
  }, 1000)

  onListSelect(
    async (index) => {
      if (!gameStarted) {
        if (!compassReady) return
        gameStarted = true
        if (statusId) { clearInterval(statusId); statusId = null }
        await beginGame(sessionId)
        const left = buildLeftTitles()
        const right = buildRightPane()
        await rebuildPage(left, right)
        pushMonitor(left, right)
        startDisplayLoop()
        startPolling()
        startDistanceReporting()
        return
      }
      if (gameEnded) return
      selectedIndex = index
      if (!destinations[selectedIndex]?.alive) {
        const firstAlive = destinations.findIndex(d => d.alive)
        if (firstAlive >= 0) selectedIndex = firstAlive
      }
      const right = buildRightPane()
      await updateDetail(right)
      pushMonitor(buildLeftTitles(), right)
    },
    () => gameStarted ? destinations.length : 1,
    (raw) => { if (monitorWs?.readyState === WebSocket.OPEN) monitorWs.send(JSON.stringify({ debug: raw })) },
  )

  startGPS()
  startCompass()
  startMonitor()
  watchForNewSession()
}
