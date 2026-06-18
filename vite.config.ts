import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'src': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/key': { target: 'http://localhost:8008', changeOrigin: true },
      '/user': { target: 'http://localhost:8008', changeOrigin: true },
      '/chat': { target: 'http://localhost:8008', changeOrigin: true },
      '/ws': { target: 'http://localhost:8008', ws: true },
      '/prompts': { target: 'http://localhost:8008', changeOrigin: true },
      '/instruction': { target: 'http://localhost:8008', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
  },
})
