import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], build: { minify: true, sourcemap: false } },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { minify: true, sourcemap: false, rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].js' } } }
  },
  renderer: { plugins: [react()], build: { minify: true, sourcemap: false } }
})
