// frontend/vite.config.js
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig({
  // Tailwind is additive here — see src/tailwind.css for why Preflight is
  // deliberately not imported. App.css remains the styling source of truth.
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true,
    // Proxy API requests to backend
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
      '/chat': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
      '/health': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      }
    }
  },
  // Environment variables
  define: {
    'process.env': {}
  },
  // Optimize dependencies
  optimizeDeps: {
    include: ['react', 'react-dom']
  },
  // Build configuration
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        // 'crypto' was listed here as a chunk. It is a Node builtin with no
        // browser equivalent, so Rollup externalised it and emitted an empty
        // chunk on every build.
        manualChunks: {
          vendor: ['react', 'react-dom']
        }
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js'
  }
});
