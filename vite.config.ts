import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/wizard-multiplayer/',
  server: {
    port: 5181,
    strictPort: true,
  },
});
