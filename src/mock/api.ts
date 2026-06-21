const BASE = '/api'

export type DestinationFromApi = {
  id: number
  name: string
  lat: number
  lng: number
}

export type GameState = {
  status: 'active' | 'clear' | 'gameover'
  loadPercent: number
  destinations: { id: number; name: string; lat: number; lng: number; alive: boolean; onceFallen: boolean }[]
}

export async function beginGame(sessionId: string): Promise<void> {
  await fetch(`${BASE}/game/${sessionId}/begin`, { method: 'POST' })
}

export async function startGame(): Promise<{ sessionId: string; destinations: DestinationFromApi[] }> {
  const res = await fetch(`${BASE}/game/start`, { method: 'POST' })
  return res.json()
}

export async function getGameState(sessionId: string): Promise<GameState> {
  const res = await fetch(`${BASE}/game/${sessionId}`)
  return res.json()
}

export type GameResult = {
  status: string
  score: number
  totalDistance: number
  playTime: string
  onceFallenCount: number
  correctId: number
  correctName: string
}

export async function getResult(sessionId: string): Promise<GameResult> {
  const res = await fetch(`${BASE}/game/${sessionId}/result`)
  return res.json()
}

export async function updateRunDistance(sessionId: string, distanceMeters: number): Promise<void> {
  await fetch(`${BASE}/game/${sessionId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ distanceMeters }),
  })
}

export async function arrive(sessionId: string, destinationId: number): Promise<{ result: string; message: string }> {
  const res = await fetch(`${BASE}/game/${sessionId}/arrive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ destinationId }),
  })
  return res.json()
}
