/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

// build id attached to feedback: git commit (or GIT_SHA in Docker) + build date
const sha = process.env.GIT_SHA || (() => { try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return 'nogit' } })()

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __BUILD__: JSON.stringify(`${sha} ${new Date().toISOString().slice(0, 10)}`) },
  resolve: { alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) } },
  // public/ only holds the generated, copyrighted book bundle: never copy it into dist/.
  build: { copyPublicDir: false },
  // Pre-bundle deps up front so Vite never reloads mid-session with a second React copy.
  optimizeDeps: {
    include: ['react', 'react-dom/client', 'dexie', 'chess.js', '@lichess-org/chessground', 'xstate', '@xstate/react',
      '@tanstack/react-router', 'motion/react', '@base-ui/react'],
  },
  // dev: site on :5190, API (auth, sync, feedback) from ../server on :8790 — distinct from other local apps
  server: { port: 5190, fs: { allow: ['..'] }, proxy: { '/api': `http://localhost:${process.env.API_PORT ?? 8790}` } },
  test: { environment: 'node', include: ['src/**/*.test.ts', '../shared/**/*.test.ts'] },
})
