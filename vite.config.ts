import { defineConfig } from 'vite';

export default defineConfig({
  // 相対パスで出力し、GitHub Pages のサブパス（/image-trimmer/）でも動くようにする
  base: './',
});
