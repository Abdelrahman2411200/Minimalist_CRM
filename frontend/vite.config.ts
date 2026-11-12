import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

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

  return {
    plugins: [react()],
    base,
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: { '/api': { target, changeOrigin: false } },
    },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  };
});
