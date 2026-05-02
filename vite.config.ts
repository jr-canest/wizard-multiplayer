import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Firebase Hosting serves at the site root.
  base: '/',
  server: {
    port: 5181,
    strictPort: true,
  },
});
