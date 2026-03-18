import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
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
  },
});
