import { defineConfig, loadEnv } from 'vite'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const envDir = fileURLToPath(new URL('.', import.meta.url))
  const publicEnv = loadEnv(mode, envDir, 'STRIPE_PUBLISHABLE_KEY')
  const publishableKey = publicEnv.STRIPE_PUBLISHABLE_KEY?.trim() || ''
  if (command === 'build' && !/^pk_(test|live)_\S+$/.test(publishableKey)) {
    throw new Error('Set STRIPE_PUBLISHABLE_KEY on the frontend build environment before building checkout. Use the publishable key matching the backend Stripe account and mode, then rebuild.')
  }
  return {
    plugins: [react()],
    // Expose only this public value, never the rest of the Stripe environment.
    define: { 'import.meta.env.STRIPE_PUBLISHABLE_KEY': JSON.stringify(publishableKey) },
  }
})
