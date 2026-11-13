import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.API_PROXY_TARGET || 'http://127.0.0.1:3000';
  const url = new URL(target);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('API_PROXY_TARGET must be an HTTP or HTTPS URL');
  }

  const base = env.VITE_BASE_PATH || '/';
  if (!base.startsWith('/') || !base.endsWith('/') || base.startsWith('//')) {
    throw new Error('VITE_BASE_PATH must be a path with leading and trailing slashes');
  }

  const fullCrmUrl = env.VITE_FULL_CRM_URL || '';
  if (fullCrmUrl) {
    const fullUrl = new URL(fullCrmUrl);
    if (!['http:', 'https:'].includes(fullUrl.protocol) || fullUrl.username || fullUrl.password) {
      throw new Error('VITE_FULL_CRM_URL must be a public HTTP or HTTPS URL');
    }
  }

  return {
    plugins: [react()],
    resolve: { alias: {
      '@crm-data': fileURLToPath(new URL(mode === 'demo' ? './src/data/demo.ts' : './src/data/http.ts', import.meta.url)),
    } },
    base,
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: mode === 'demo' ? undefined : { '/api': { target, changeOrigin: false } },
    },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  };
});
