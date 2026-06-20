export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const φ1 = lat1 * Math.PI / 180
  const φ2 = lat2 * Math.PI / 180
  const Δφ = (lat2 - lat1) * Math.PI / 180
  const Δλ = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const φ1 = lat1 * Math.PI / 180
  const φ2 = lat2 * Math.PI / 180
  const Δλ = (lng2 - lng1) * Math.PI / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

export function bearingToArrow(absoluteBearing: number, deviceHeading: number | null): string {
  const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖']
  const relative = deviceHeading !== null
    ? (absoluteBearing - deviceHeading + 360) % 360
    : absoluteBearing
  return arrows[Math.round(relative / 45) % 8]
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`
  return `${(meters / 1000).toFixed(1)}km`
}

export function randomDestination(baseLat: number, baseLng: number, minM: number, maxM: number) {
  const distance = minM + Math.random() * (maxM - minM)
  const angle = Math.random() * 2 * Math.PI
  const lat = baseLat + (distance * Math.cos(angle)) / 111320
  const lng = baseLng + (distance * Math.sin(angle)) / (111320 * Math.cos(baseLat * Math.PI / 180))
  return { lat, lng }
}
