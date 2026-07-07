import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works on any static host (subpaths too).
  base: './',
  plugins: [react()],
});
