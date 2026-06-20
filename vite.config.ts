import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: true, // LAN IP でリッスン（実機デバッグ用 QR コードに必要）
    port: 5173,
  },
})
