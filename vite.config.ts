import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: './',
  resolve: {
    // The published artifact loads Phaser from a CDN; locally it is bundled.
    alias: mode === 'artifact' ? { phaser: '/src/phaser-global.ts' } : {},
  },
  build: {
    outDir: mode === 'artifact' ? 'dist-artifact' : 'dist',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 2000,
  },
  server: { host: '127.0.0.1', port: 5173 },
  test: { include: ['tests/**/*.test.ts'] },
}));
