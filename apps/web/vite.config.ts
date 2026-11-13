import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The server runs on its own port; the pages reach it through this proxy, so the browser only
// ever talks to one origin and the access token never crosses to another.
//
// `base: './'` makes the built page name its script and stylesheet by relative paths. The pages
// are also served under a mount, such as a hub's /ui/<name>, where a path starting at the root
// of the address would leave the mount and find nothing.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:4400',
    },
  },
});
