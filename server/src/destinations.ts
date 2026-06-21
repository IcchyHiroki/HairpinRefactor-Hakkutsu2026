export type Destination = {
  id: number
  name: string
  lat: number
  lng: number
  isReal: boolean
}

// ハッカソン会場に合わせて座標を変更する
export const DESTINATIONS: Destination[] = [
  { id: 1, name: '窓前',           lat: 33.792616, lng: 130.636478, isReal: true  },
  { id: 2, name: 'クラブハウス入口', lat: 33.792843, lng: 130.636324, isReal: false },
]
