import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  build: {
    rolldownOptions: {
      treeshake: { manualPureFunctions: ['console.log'] },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: [
        'apple-touch-icon.png',
        'favicon-16x16.png',
        'favicon-32x32.png',
        'favicon.ico',
        'favicon.svg',
        'push-sw.js',
        'icon-192.png',
        'icon-512.png',
      ],
      manifest: false,
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        globPatterns: ['**/*.{css,html,ico,js,png,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api(?:\/|$)/],
        importScripts: ['/push-sw.js'],
      },
    }),
  ],
})
