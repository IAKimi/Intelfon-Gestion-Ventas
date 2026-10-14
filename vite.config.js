import { defineConfig } from 'vite';

export default defineConfig({
  appType: 'spa',
  server: {
    port: 5173,
    host: true,
  },
  preview: {
    port: 5173,
    host: true,
  },
});
