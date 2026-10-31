import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

const apiTarget = process.env.API_URL ?? 'http://localhost:8080';

export default defineConfig({
  root: 'src/web',
  plugins: [preact()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, ws: true },
    },
  },
  test: {
    root: '.',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
  },
});
