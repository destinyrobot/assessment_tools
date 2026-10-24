import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// GitHub Pages project sites are served from `https://<user>.github.io/<repo>/`,
// so `base` must be configurable via VITE_BASE_PATH (defaults to `/`).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const rawBase = env.VITE_BASE_PATH ?? '/';
  const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;

  return {
    base,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      },
    },
    server: { port: 5173, host: true },
    preview: { port: 4173, host: true },
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'shared/**/*.test.ts'],
      setupFiles: ['./src/test/setup.ts'],
      // Public, non-secret placeholders so the api layer is reachable in tests.
      env: {
        VITE_SUPABASE_URL: 'https://project-test.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_only_0000000000000000000000',
      },
    },
  };
});