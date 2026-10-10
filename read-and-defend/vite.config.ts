import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

// One id per build. On GitHub the commit, locally the build time. The page
// carries it, and dist/version.json publishes it, so a running copy of the
// game can tell when a newer one is online (src/platform/update.ts).
const APP_VERSION = (process.env.GITHUB_SHA ?? '').slice(0, 12) || `local-${Date.now()}`;

function versionFile(): Plugin {
  let outDir = 'dist';
  return {
    name: 'version-file',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    writeBundle() {
      writeFileSync(join(outDir, 'version.json'), JSON.stringify({ version: APP_VERSION, built: new Date().toISOString() }) + '\n');
    },
  };
}

export default defineConfig({
  // Relative base so the same build works on a web host, under a sub-path,
  // and inside a Capacitor WebView (which serves from capacitor://localhost).
  base: './',
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  plugins: [versionFile()],
  build: { target: 'es2020', outDir: 'dist', sourcemap: true },
  server: {
    // Forward speech-to-text to the local proxy during development so the
    // browser never needs (or sees) an API key.
    proxy: { '/api': 'http://localhost:8787' },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
