import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    allowedHosts: ['refinance-uncombed-buffer.ngrok-free.dev'],
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: {
    rollupOptions: {
      input: { main: 'index.html' },
    },
  },
})
