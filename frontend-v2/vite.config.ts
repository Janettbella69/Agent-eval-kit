import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => ({
  // Deployed builds are served under /eval/; dev runs at the root.
  base: command === 'build' ? '/eval/' : '/',
  plugins: [react()],
  server: {
    port: 5200,
    proxy: {
      '/api': {
        target: 'http://localhost:8100',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8100',
        ws: true,
      },
    },
  },
}))
