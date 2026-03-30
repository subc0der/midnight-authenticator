import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait(),
    react(),
    // Copy circuit assets from contracts package for browser ZK config provider
    viteStaticCopy({
      targets: [
        {
          src: '../contracts/src/managed/totp-verifier/zkir/*',
          dest: 'circuits/totp-verifier/zkir',
        },
        {
          src: '../contracts/src/managed/totp-verifier/keys/*',
          dest: 'circuits/totp-verifier/keys',
        },
      ],
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        offscreen: resolve(__dirname, 'offscreen.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        injected: resolve(__dirname, 'src/content/injected.ts'),
        'page-api': resolve(__dirname, 'src/content/page-api.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
    target: 'esnext',
    minify: false, // Keep readable for debugging
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.wasm'],
  },
  optimizeDeps: {
    include: ['@midnight-ntwrk/compact-runtime'],
  },
});
