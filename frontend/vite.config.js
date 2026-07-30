// frontend/vite.config.js
import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig({
  // Tailwind is additive here — see src/tailwind.css for why Preflight is
  // deliberately not imported. App.css remains the styling source of truth.
  plugins: [react(), tailwindcss()],
  // shadcn components are generated with `@/` imports. The alias is declared
  // once here and picked up by the Vitest config below, because a test that
  // cannot resolve `@/components/ui/button` fails in a way that looks like a
  // missing file rather than a missing alias.
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
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
        //
        // The rest are split so a change to app code does not invalidate the
        // cached copy of every dependency. They are separated by how often they
        // change and how large they are, not alphabetically.
        // Function form, not the array form. `vendor: ['react','react-dom']`
        // only matches those exact entry modules — React's actual
        // implementation lives in react/cjs/*.js, which the default algorithm
        // then placed into whichever chunk imported it first. The result was an
        // empty 0.03kB vendor stub with React bundled inside the Clerk chunk,
        // so every Clerk release would have invalidated React's cached copy.
        // Matching on the resolved path fixes that.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          // Anything the lazy CodeBlock pulls in must stay unassigned, or
          // naming a chunk would drag it back onto the critical path.
          if (/react-syntax-highlighter|refractor|prismjs|highlight\.js|lowlight/.test(id)) return;

          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor';
          if (id.includes('@clerk')) return 'auth';
          // Radix and the shadcn helpers change on their own release cadence,
          // not with app code, so they get their own cached chunk.
          if (/@radix-ui|class-variance-authority|tailwind-merge|clsx|cmdk|lucide-react/.test(id)) return 'ui';
          if (/framer-motion|motion-dom|motion-utils|animejs/.test(id)) return 'motion';
          if (/react-markdown|remark|micromark|mdast|unist|hast|vfile|unified|property-information|character-entities|decode-named-character|space-separated|comma-separated|markdown-table|longest-streak|zwitch|trough|bail|devlop|estree|html-url-attributes/.test(id)) return 'markdown';
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
