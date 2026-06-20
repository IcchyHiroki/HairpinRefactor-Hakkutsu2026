import { useState, useEffect } from 'react'

export function useCompass(enabled: boolean) {
  const [heading, setHeading] = useState<number | null>(null)

  useEffect(() => {
    if (!enabled) return

    const handler = (e: DeviceOrientationEvent) => {
      // iOS: webkitCompassHeading が真北基準
      const ios = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading
      if (ios != null) {
        setHeading(ios)
        return
      }
      // Android: alpha は真北基準でないので deviceorientationabsolute で上書きされる
      if (e.alpha != null) {
        setHeading((360 - e.alpha) % 360)
      }
    }

    // Android Chrome は deviceorientationabsolute が真北基準
    window.addEventListener('deviceorientationabsolute', handler as EventListener)
    window.addEventListener('deviceorientation', handler)

    return () => {
      window.removeEventListener('deviceorientationabsolute', handler as EventListener)
      window.removeEventListener('deviceorientation', handler)
    }
  }, [enabled])

  return heading
}
