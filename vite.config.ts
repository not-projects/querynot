import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  clearScreen: false,
  plugins: [svelte()],
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**', '**/target/**']
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
});
