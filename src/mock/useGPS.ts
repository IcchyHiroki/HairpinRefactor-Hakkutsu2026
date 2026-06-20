import { useState, useEffect } from 'react'

export type GPSPosition = {
  lat: number
  lng: number
  accuracy: number
}

export function useGPS() {
  const [position, setPosition] = useState<GPSPosition | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!navigator.geolocation) {
      setError('GPS非対応のブラウザです')
      return
    }

    const id = navigator.geolocation.watchPosition(
      (pos) => setPosition({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      (err) => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 1000 }
    )

    return () => navigator.geolocation.clearWatch(id)
  }, [])

  return { position, error }
}
