import { defineConfig, loadEnv } from 'vite'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_')
  if (command === 'build' && !/^pk_(test|live)_\S+$/.test(env.VITE_STRIPE_PUBLISHABLE_KEY?.trim() || '')) {
    throw new Error('Set VITE_STRIPE_PUBLISHABLE_KEY on the frontend build environment before building checkout. Use the publishable key matching the backend Stripe account and mode, then rebuild.')
  }
  return { plugins: [react()] }
})
