import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// `npm run dev`        docs (/), radio demo (/demo/radio.html), playground (/playground.html)
// `npm run build`      the distributable library in dist/
// `npm run build:site` the static docs site in site-dist/ (deployed to GitHub Pages)
export default defineConfig(({ mode }) => {
  if (mode === 'site') {
    return {
      base: './',
      build: {
        outDir: 'site-dist',
        emptyOutDir: true,
        rollupOptions: {
          input: {
            index: resolve(import.meta.dirname, 'index.html'),
            radio: resolve(import.meta.dirname, 'demo/radio.html'),
            playground: resolve(import.meta.dirname, 'playground.html'),
          },
        },
      },
    };
  }
  return {
    build: {
      lib: {
        entry: 'src/build-entry.js',
        name: 'HamUI',
        fileName: 'hamui',
        cssFileName: 'hamui',
        formats: ['es', 'umd'],
      },
      sourcemap: true,
      rollupOptions: {
        // UMD global is the namespace: window.HamUI.Spectrum, HamUI.init(), …
        output: { exports: 'named' },
      },
    },
  };
});
