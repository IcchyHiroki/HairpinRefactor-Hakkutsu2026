import type { Destination } from './MockPage'

type GamePhase = 'loading' | 'playing' | 'clear' | 'gameover'

type PodStatus = { id: number; name: string; alive: boolean }

type Props = {
  destinations: Destination[]
  podStatus: PodStatus[]
  phase: GamePhase
  arrivedAt: Destination | null
}

export function G2Screen({ destinations, podStatus, phase, arrivedAt }: Props) {
  const aliveCount = podStatus.filter(p => p.alive).length
  const totalCount = podStatus.length

  return (
    <div style={{
      width: 576,
      height: 136,
      background: '#000',
      border: '1px solid #333',
      display: 'flex',
      borderRadius: 4,
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* クリア・ゲームオーバーのオーバーレイ */}
      {phase === 'clear' && (
        <Overlay color="#4f4" message="FATE REACHED" sub={`✓ ${arrivedAt?.name}`} />
      )}
      {phase === 'gameover' && (
        <Overlay color="#f44" message="CAPTURED" sub={`✗ ${arrivedAt?.name} は偽の目的地`} />
      )}

      {/* 左ペイン：目的地リスト */}
      <div style={{
        width: 330,
        borderRight: '1px solid #2a2a2a',
        padding: '6px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}>
        <div style={{ fontSize: 9, color: '#444', letterSpacing: 2, marginBottom: 2 }}>
          DESTINATION LIST
        </div>
        {destinations.map(d => (
          <div key={d.id} style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '1px 4px',
          }}>
            <span style={{ fontSize: 13, color: '#ccc', letterSpacing: 1 }}>
              {d.name}
            </span>
            <span style={{ fontSize: 12, color: '#4f4', letterSpacing: 1 }}>
              {d.arrow} {d.distanceStr}
            </span>
          </div>
        ))}
      </div>

      {/* 右ペイン：システム状態 */}
      <div style={{
        width: 246,
        padding: '6px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        <div style={{ fontSize: 9, color: '#444', letterSpacing: 2 }}>SYSTEM STATUS</div>

        <div>
          <div style={{ fontSize: 9, color: '#555', marginBottom: 4 }}>POD STATUS</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {podStatus.map(p => (
              <span key={p.id} style={{ fontSize: 16, color: p.alive ? '#4f4' : '#333' }}>
                {p.alive ? '●' : '○'}
              </span>
            ))}
            <span style={{ fontSize: 9, color: '#555', marginLeft: 4 }}>
              {aliveCount}/{totalCount}
            </span>
          </div>
        </div>

        <div style={{ marginTop: 'auto', fontSize: 10, color: '#555', letterSpacing: 1 }}>
          目的地に近づいて確認せよ
        </div>
      </div>
    </div>
  )
}

function Overlay({ color, message, sub }: { color: string; message: string; sub: string }) {
  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      zIndex: 10,
    }}>
      <span style={{ fontSize: 22, color, letterSpacing: 3, fontFamily: 'monospace' }}>
        {message}
      </span>
      <span style={{ fontSize: 11, color: '#888', letterSpacing: 1, fontFamily: 'monospace' }}>
        {sub}
      </span>
    </div>
  )
}
