import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import { cpSync } from 'node:fs';

export default defineConfig({
  base: './',
  plugins: [react(), { name: 'pdf-assets', closeBundle() { for (const dir of ['cmaps','standard_fonts']) cpSync(`node_modules/pdfjs-dist/${dir}`, `dist/pdf-assets/${dir}`, { recursive: true }); } }, electron({
    main: {
      entry: 'electron/main.ts',
      vite: { build: { lib: { entry: 'electron/main.ts', formats: ['cjs'] }, rollupOptions: { external: ['@napi-rs/canvas', 'pdfjs-dist', '@openai/codex'], output: { format: 'cjs', entryFileNames: 'main.cjs' } } } },
    },
    preload: { input: 'electron/preload.ts', vite: { build: { rollupOptions: { output: { format: 'cjs', entryFileNames: 'preload.cjs' } } } } },
  })],
});
