import { defineConfig } from 'vite';

// Relative base so the build works at https://<user>.github.io/<repo>/ (or any sub-path).
export default defineConfig({
  base: './',
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 1200 },
});
