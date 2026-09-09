import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/eval/' : '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5200,
    proxy: {
      '/api': {
        target: process.env.EVAL_API_TARGET || 'http://127.0.0.1:8100',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8100',
        ws: true,
      },
    },
  },
}))
