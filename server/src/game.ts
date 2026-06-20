import { DESTINATIONS } from './destinations.js'

export type SessionStatus = 'active' | 'clear' | 'gameover'

type Pod = {
  id: number
  alive: boolean
  onceFallen: boolean
}

type Session = {
  id: string
  status: SessionStatus
  pods: Pod[]
  score: number
  startedAt: number
  endedAt: number | null
  totalDistance: number
}

const sessions = new Map<string, Session>()

function randomId(): string {
  return Math.random().toString(36).slice(2, 10)
}

export function startGame(): { sessionId: string; destinations: { id: number; name: string; lat: number; lng: number }[] } {
  const sessionId = randomId()
  sessions.set(sessionId, {
    id: sessionId,
    status: 'active',
    pods: DESTINATIONS.map(d => ({ id: d.id, alive: true, onceFallen: false })),
    score: 0,
    startedAt: Date.now(),
    endedAt: null,
    totalDistance: 0,
  })
  return {
    sessionId,
    destinations: DESTINATIONS.map(({ id, name, lat, lng }) => ({ id, name, lat, lng })),
  }
}

export function getSession(sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session) return null
  return {
    status: session.status,
    destinations: DESTINATIONS.map(d => {
      const pod = session.pods.find(p => p.id === d.id)!
      return { id: d.id, name: d.name, alive: pod.alive, onceFallen: pod.onceFallen }
    }),
  }
}

// NFCタップ：本物ならクリア、偽物なら負荷を与えてスコア加算
export function nfcTap(
  sessionId: string,
  destinationId: number,
): { result: 'correct' | 'fake_hit' | 'fake_bonus' | 'already_ended' | 'not_found'; score: number; message: string } {
  const session = sessions.get(sessionId)
  if (!session) return { result: 'not_found', score: 0, message: 'セッションが見つかりません' }
  if (session.status !== 'active') return { result: 'already_ended', score: session.score, message: 'ゲームは既に終了しています' }

  const dest = DESTINATIONS.find(d => d.id === destinationId)
  if (!dest) return { result: 'not_found', score: 0, message: '目的地が見つかりません' }

  if (dest.isReal) {
    session.status = 'clear'
    session.endedAt = Date.now()
    return { result: 'correct', score: session.score, message: 'クリア！本物の目的地に到達しました' }
  }

  const pod = session.pods.find(p => p.id === destinationId)!
  const isBonus = pod.onceFallen
  pod.onceFallen = true
  session.score += isBonus ? 2 : 1

  return {
    result: isBonus ? 'fake_bonus' : 'fake_hit',
    score: session.score,
    message: isBonus ? `ボーナス！+2点 (合計${session.score}点)` : `負荷を与えました +1点 (合計${session.score}点)`,
  }
}

export function updateRunDistance(sessionId: string, distanceMeters: number): boolean {
  const session = sessions.get(sessionId)
  if (!session || session.status !== 'active') return false
  session.totalDistance += distanceMeters
  return true
}

export function getCurrentSessionId(): string | null {
  for (const [id, session] of sessions) {
    if (session.status === 'active') return id
  }
  return null
}

export function getResult(sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session) return null
  const endedAt = session.endedAt ?? Date.now()
  const elapsedMs = endedAt - session.startedAt
  const minutes = Math.floor(elapsedMs / 60000)
  const seconds = Math.floor((elapsedMs % 60000) / 1000)
  return {
    status: session.status,
    score: session.score,
    totalDistance: Math.round(session.totalDistance),
    playTime: `${minutes}分${seconds}秒`,
    onceFallenCount: session.pods.filter(p => p.onceFallen).length,
  }
}
