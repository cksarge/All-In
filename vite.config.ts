import { copyFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Where the site is served from. GitHub Pages project sites live under
 * "/<repo>/" (e.g. https://cksarge.github.io/All-In/), so the deploy workflow
 * sets VITE_BASE. Everywhere else (local dev, custom domain, Netlify, …) it's "/".
 */
function basePath(): string {
  const raw = (process.env.VITE_BASE ?? '/').trim() || '/';
  const withLead = raw.startsWith('/') ? raw : `/${raw}`;
  return withLead.endsWith('/') ? withLead : `${withLead}/`;
}

/**
 * GitHub Pages has no SPA rewrites. Serving a copy of index.html as 404.html
 * makes deep links like /All-In/lounge load the app, which then routes client-side.
 */
function spaFallback(): Plugin {
  return {
    name: 'spa-404-fallback',
    apply: 'build',
    closeBundle() {
      const dist = fileURLToPath(new URL('./dist/', import.meta.url));
      copyFileSync(`${dist}index.html`, `${dist}404.html`);
    },
  };
}

export default defineConfig({
  base: basePath(),
  plugins: [react(), tailwindcss(), spaFallback()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          motion: ['framer-motion'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
