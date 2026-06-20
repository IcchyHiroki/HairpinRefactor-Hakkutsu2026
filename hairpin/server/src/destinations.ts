export type Destination = {
  id: number
  name: string
  lat: number
  lng: number
  isReal: boolean
}

// ハッカソン会場に合わせて座標を変更する
export const DESTINATIONS: Destination[] = [
  { id: 1, name: '東の廃工場',   lat: 33.793100, lng: 130.637200, isReal: false },
  { id: 2, name: '北の給水塔',   lat: 33.793800, lng: 130.636000, isReal: false },
  { id: 3, name: '南の地下道',   lat: 33.791900, lng: 130.636800, isReal: false },
  { id: 4, name: '西の変電所',   lat: 33.792500, lng: 130.634800, isReal: false },
  { id: 5, name: '中央の格納庫', lat: 33.793200, lng: 130.635500, isReal: true  },
]
