import { execSync } from 'node:child_process';
import process from 'node:process';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Build stamp: build date + short commit, e.g. "2026.09.09-95bb69e".
// Baked into the bundle as import.meta.env.VITE_APP_VERSION and written
// to dist/version.json, so a running client can tell when a newer build
// is live (src/hooks/useUpdateCheck.ts) and offer to reload. Same scheme
// as the scorekeeper.
function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return (process.env.GITHUB_SHA || 'dev').slice(0, 7);
  }
}
const APP_VERSION = `${new Date().toISOString().slice(0, 10).replace(/-/g, '.')}-${gitSha()}`;

function versionJson(): Plugin {
  return {
    name: 'version-json',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version: APP_VERSION }),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), versionJson()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(APP_VERSION),
  },
  // Firebase Hosting serves at the site root.
  base: '/',
  server: {
    port: 5181,
    strictPort: true,
  },
});
