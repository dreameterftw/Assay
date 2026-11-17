import { defineConfig, loadEnv, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const plugins: PluginOption[] = [react()]

  if (mode !== 'development') {
    const rawSupabaseUrl = loadEnv(mode, '.', '').VITE_SUPABASE_URL
    if (!rawSupabaseUrl) {
      throw new Error('VITE_SUPABASE_URL is required to build the production Content Security Policy.')
    }

    let supabaseUrl: URL
    try {
      supabaseUrl = new URL(rawSupabaseUrl)
    } catch {
      throw new Error('VITE_SUPABASE_URL must be a valid absolute URL.')
    }
    if (supabaseUrl.protocol !== 'https:' && supabaseUrl.protocol !== 'http:') {
      throw new Error('VITE_SUPABASE_URL must use HTTP or HTTPS.')
    }

    const realtimeOrigin = `${supabaseUrl.protocol === 'https:' ? 'wss:' : 'ws:'}//${supabaseUrl.host}`
    const contentSecurityPolicy = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      `img-src 'self' data: blob: ${supabaseUrl.origin}`,
      `connect-src 'self' ${supabaseUrl.origin} ${realtimeOrigin}`,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      'upgrade-insecure-requests',
    ].join('; ')

    plugins.push({
      name: 'environment-content-security-policy',
      transformIndexHtml: {
        order: 'pre' as const,
        handler() {
          return [{
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy },
            injectTo: 'head-prepend' as const,
          }]
        },
      },
    })
  }

  return { plugins }
})
