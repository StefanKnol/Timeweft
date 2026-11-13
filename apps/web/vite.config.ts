import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The server runs on its own port; the pages reach it through this proxy, so the browser only
// ever talks to one origin and the access token never crosses to another.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:4400',
    },
  },
});
