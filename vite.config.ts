import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import path from 'path'
import { embeddedSignalingPlugin } from './dev/embeddedSignaling'

export default defineConfig({
  plugins: [
    react(),
    basicSsl(),
    embeddedSignalingPlugin(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    https: {},
    host: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    https: {},
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: [
      '@webcontainer/api',
      '@mlc-ai/web-llm',
      'yjs',
    ],
  },
  worker: {
    format: 'es',
  },
})
