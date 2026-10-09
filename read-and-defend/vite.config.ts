import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the same build works on a web host, under a sub-path,
  // and inside a Capacitor WebView (which serves from capacitor://localhost).
  base: './',
  build: { target: 'es2020', outDir: 'dist', sourcemap: true },
  server: {
    // Forward speech-to-text to the local proxy during development so the
    // browser never needs (or sees) an API key.
    proxy: { '/api': 'http://localhost:8787' },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
