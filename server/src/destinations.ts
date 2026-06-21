export type Destination = {
  id: number
  name: string
  lat: number
  lng: number
  isReal: boolean
}

// ハッカソン会場に合わせて座標を変更する
export const DESTINATIONS: Destination[] = [
  { id: 1, name: '水道たち',             lat: 33.792342, lng: 130.636340, isReal: false },
  { id: 2, name: '花壇',                 lat: 33.792527, lng: 130.637548, isReal: false },
  { id: 3, name: 'ブルガリアパビリオン', lat: 33.792850, lng: 130.637385, isReal: false },
  { id: 4, name: 'カラフルな椅子たち',   lat: 33.793221, lng: 130.637694, isReal: false },
  { id: 5, name: 'サウナの裏に隠れた椅子', lat: 33.792809, lng: 130.638199, isReal: true  },
]
