import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // 'base: ./' is CRITICAL for GitHub Pages to find files
  base: './',
  define: {
    // This allows the build to "bake in" the API key from GitHub Secrets
    'process.env': process.env
  },
  server: {
    port: 3000
  }
})