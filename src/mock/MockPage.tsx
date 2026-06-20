import { useState, useEffect, useRef } from 'react'
import { G2Screen } from './G2Screen'
import { useGPS } from './useGPS'
import { useCompass } from './useCompass'
import { distanceMeters, bearing, bearingToArrow, formatDistance } from './geo'
import { startGame, getGameState, arrive } from './api'
import type { GameState } from './api'

const ARRIVAL_RADIUS = 20 // メートル

export type Destination = {
  id: number
  name: string
  lat: number
  lng: number
  distanceStr: string
  arrow: string
}

type GamePhase = 'loading' | 'playing' | 'clear' | 'gameover'

export function MockPage() {
  const { position, error: gpsError } = useGPS()
  const needsPermission = typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission === 'function'
  const [compassGranted, setCompassGranted] = useState(!needsPermission)
  const heading = useCompass(compassGranted)

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [destinations, setDestinations] = useState<Destination[]>([])
  const [phase, setPhase] = useState<GamePhase>('loading')
  const [arrivedAt, setArrivedAt] = useState<Destination | null>(null)
  const [podStatus, setPodStatus] = useState<GameState['destinations']>([])
  const arrivedRef = useRef(false)

  // ゲーム開始：APIからセッションと目的地を取得
  useEffect(() => {
    startGame().then(({ sessionId, destinations: dests }) => {
      setSessionId(sessionId)
      setDestinations(dests.map(d => ({ ...d, distanceStr: '---', arrow: '?' })))
      setPodStatus(dests.map(d => ({ id: d.id, name: d.name, lat: d.lat, lng: d.lng, alive: true, onceFallen: false })))
      setPhase('playing')
    })
  }, [])

  // GPS更新のたびに距離・方角を再計算 + 到着判定
  useEffect(() => {
    if (!position || phase !== 'playing' || destinations.length === 0 || !sessionId) return

    let arrived: Destination | null = null

    const updated = destinations.map(d => {
      const dist = distanceMeters(position.lat, position.lng, d.lat, d.lng)
      const arrow = bearingToArrow(bearing(position.lat, position.lng, d.lat, d.lng), heading)
      if (dist <= ARRIVAL_RADIUS && !arrivedRef.current) arrived = { ...d, distanceStr: formatDistance(dist), arrow }
      return { ...d, distanceStr: formatDistance(dist), arrow }
    })

    setDestinations(updated)

    if (arrived) {
      arrivedRef.current = true
      setArrivedAt(arrived)
      arrive(sessionId, (arrived as Destination).id).then(res => {
        setPhase(res.result === 'correct' ? 'clear' : 'gameover')
      })
    }
  }, [position, heading])

  // ゲーム状態のポーリング（Pod落とし反映用）
  useEffect(() => {
    if (!sessionId || phase !== 'playing') return
    const id = setInterval(() => {
      getGameState(sessionId).then(state => {
        setPodStatus(state.destinations)
      })
    }, 3000)
    return () => clearInterval(id)
  }, [sessionId, phase])

  const requestCompass = () => {
    const iosRequest = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission
    if (typeof iosRequest === 'function') {
      iosRequest().then(s => { if (s === 'granted') setCompassGranted(true) })
    } else {
      setCompassGranted(true)
    }
  }

  const reset = () => {
    arrivedRef.current = false
    setDestinations([])
    setPodStatus([])
    setPhase('loading')
    setArrivedAt(null)
    setSessionId(null)
    startGame().then(({ sessionId, destinations: dests }) => {
      setSessionId(sessionId)
      setDestinations(dests.map(d => ({ ...d, distanceStr: '---', arrow: '?' })))
      setPodStatus(dests.map(d => ({ id: d.id, name: d.name, lat: d.lat, lng: d.lng, alive: true, onceFallen: false })))
      setPhase('playing')
    })
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#111',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 24,
      fontFamily: 'monospace',
      color: '#aaa',
    }}>
      <p style={{ fontSize: 13, letterSpacing: 2, color: '#555' }}>EVEN G2 HUD MOCK — 576 × 136 px</p>

      {gpsError && <p style={{ color: '#f44', fontSize: 12 }}>GPS エラー: {gpsError}</p>}
      {phase === 'loading' && <p style={{ color: '#666', fontSize: 13 }}>サーバーに接続中...</p>}

      {!compassGranted && (
        <button onClick={requestCompass} style={btnStyle}>コンパスを有効にする</button>
      )}

      {destinations.length > 0 && (
        <G2Screen
          destinations={destinations}
          podStatus={podStatus}
          phase={phase}
          arrivedAt={arrivedAt}
        />
      )}

      {position && (
        <p style={{ fontSize: 11, color: '#333' }}>
          精度: ±{Math.round(position.accuracy)}m　lat: {position.lat.toFixed(6)}　lng: {position.lng.toFixed(6)}
        </p>
      )}

      {(phase === 'clear' || phase === 'gameover') && (
        <button onClick={reset} style={btnStyle}>もう一度</button>
      )}
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '8px 24px',
  background: '#1a3a1a',
  color: '#4f4',
  border: '1px solid #2a5a2a',
  borderRadius: 4,
  cursor: 'pointer',
  fontFamily: 'monospace',
  fontSize: 13,
  letterSpacing: 1,
}
