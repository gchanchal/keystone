import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { execSync } from 'child_process';

// Get version from git or Railway environment
function getVersion() {
  // Try Railway environment variable first
  const railwaySha = process.env.RAILWAY_GIT_COMMIT_SHA;
  if (railwaySha) {
    return `v0.2-${railwaySha.substring(0, 7)}`;
  }

  // Try git commands locally
  try {
    const commitCount = execSync('git rev-list --count HEAD', { encoding: 'utf-8' }).trim();
    const shortHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    return `v0.2.${commitCount}-${shortHash}`;
  } catch {
    return 'v0.2';
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
