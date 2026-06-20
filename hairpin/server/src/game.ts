import { DESTINATIONS } from './destinations.js'
import { deleteGamePod, checkPodStatuses } from './k8s.js'

export type SessionStatus = 'active' | 'clear' | 'gameover'

type Session = {
  id: string
  status: SessionStatus
  pods: { id: number; alive: boolean }[]
  loadPercent: number
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
    pods: DESTINATIONS.map(d => ({ id: d.id, alive: true })),
    loadPercent: 0,
  })
  return {
    sessionId,
    destinations: DESTINATIONS.map(({ id, name, lat, lng }) => ({ id, name, lat, lng })),
  }
}

export async function getSession(sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session) return null

  // K8s Pod の実在状況を確認して alive 状態を上書きする
  const destinationIds = DESTINATIONS.map(d => d.id)
  const podStatuses = await checkPodStatuses(destinationIds)
  console.log('getSession k8s podStatuses:', JSON.stringify(podStatuses))
  // メモリ状態と K8s 実態を統合
  const merged = DESTINATIONS.map(d => {
    const mem = session.pods.find(p => p.id === d.id)
    const k8s = podStatuses.find(p => p.id === d.id)
    // メモリ上で dead なら dead。K8s Pod が存在しない場合も dead（復活ポーリング用）
    return { id: d.id, name: d.name, alive: mem ? mem.alive && (k8s ? k8s.alive : true) : true }
  })

  return {
    status: session.status,
    loadPercent: session.loadPercent,
    destinations: merged,
  }
}


export function arrive(
  sessionId: string,
  destinationId: number,
): { result: 'correct' | 'wrong' | 'already_ended' | 'not_found'; message: string } {
  const session = sessions.get(sessionId)
  if (!session) return { result: 'not_found', message: 'セッションが見つかりません' }
  if (session.status !== 'active') return { result: 'already_ended', message: 'ゲームは既に終了しています' }

  const dest = DESTINATIONS.find(d => d.id === destinationId)
  if (!dest) return { result: 'not_found', message: '目的地が見つかりません' }

  if (dest.isReal) {
    session.status = 'clear'
    return { result: 'correct', message: 'クリア！本物の目的地に到達しました' }
  } else {
    session.status = 'gameover'
    return { result: 'wrong', message: 'ゲームオーバー。偽の目的地でした' }
  }
}

// K8s担当: ゲーム内podキル = K8s Pod削除
export async function updateRunDistance(
  sessionId: string,
  distanceMetersAdded: number,
): Promise<{ terminated: { id: number; name: string }[]; loadPercent: number } | null> {
  const session = sessions.get(sessionId)
  if (!session || session.status !== 'active') return null

  const KILL_THRESHOLDS = [200, 400, 600, 800]
  const TOTAL = 800
  const prevLoad = session.loadPercent
  const nextLoad = Math.min(100, Math.round(((prevLoad / 100) * TOTAL + distanceMetersAdded) / TOTAL * 100))
  const prevDist = (prevLoad / 100) * TOTAL
  const nextDist = prevDist + distanceMetersAdded

  const terminated: { id: number; name: string }[] = []
  const fakePods = session.pods.filter(p => {
    const dest = DESTINATIONS.find(d => d.id === p.id)
    return dest && !dest.isReal && p.alive
  })

  const thresholdsHit = KILL_THRESHOLDS.filter(t => t <= nextDist && t > prevDist)
  const toKill = Math.min(thresholdsHit.length, fakePods.length)

  for (let i = 0; i < toKill; i++) {
    fakePods[i].alive = false
    const dest = DESTINATIONS.find(d => d.id === fakePods[i].id)!
    terminated.push({ id: dest.id, name: dest.name })

    // K8s Pod を削除（非同期、結果は待たない）
    deleteGamePod(dest.id - 1).catch((err: Error) =>
      console.error(`k8s delete failed for destination ${dest.id}:`, err)
    )
  }

  session.loadPercent = nextLoad
  return { terminated, loadPercent: nextLoad }
}
