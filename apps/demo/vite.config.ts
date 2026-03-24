import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: '../../packages/contracts/src/managed/totp-verifier/zkir/*',
          dest: 'circuits/totp-verifier/zkir',
        },
        {
          src: '../../packages/contracts/src/managed/totp-verifier/keys/*',
          dest: 'circuits/totp-verifier/keys',
        },
      ],
    }),
  ],
  server: {
    port: 3000,
    open: true,
    cors: true, // Allow extension to fetch circuits
  },
});
