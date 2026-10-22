import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 운영: jbslab.co.kr/auction/ 아래에 올린다(GitHub Pages).
// demo: 파일 하나짜리 데모(샘플 데이터) — 미리보기용.
export default defineConfig(({ mode }) => ({
  base: mode === 'demo' ? './' : '/auction/',
  plugins: [react(), ...(mode === 'demo' ? [viteSingleFile()] : [])],
  resolve: mode === 'demo' ? { alias: [{ find: /^firebase\/.*/, replacement: new URL('./src/stubs/firebase.js', import.meta.url).pathname }] } : {},
  build: { outDir: mode === 'demo' ? 'dist-demo' : 'dist', emptyOutDir: true },
}));
