import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { execSync } from 'child_process';

// Get version - reads from version.txt (generated before deploy)
function getVersion() {
  try {
    const fs = require('fs');
    const versionFile = path.resolve(__dirname, 'version.txt');
    if (fs.existsSync(versionFile)) {
      return fs.readFileSync(versionFile, 'utf-8').trim();
    }
  } catch {}

  // Fallback to git for local dev
  try {
    const shortHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    return `v0.2-${shortHash}`;
  } catch {
    return 'v0.2-dev';
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(getVersion()),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
