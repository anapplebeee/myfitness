import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  build: {
    target: 'es2022',
    sourcemap: false,
    outDir: 'dist',
    /*
     * 不自动清空 outDir。
     *
     * 环境的批量删除保护会在一次删除超过 50 个文件时拦截构建，
     * 而 dist/assets 有 80+ 个带哈希的产物。改为覆盖同名文件、
     * 保留旧哈希文件；Android 构建会输出到独立的 dist-build-* 目录，
     * 不受这里的残留影响。
     */
    emptyOutDir: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
