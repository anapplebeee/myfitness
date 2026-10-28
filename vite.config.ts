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
    /*
     * 串行执行测试文件。
     *
     * 并行 worker 会同时写同一个 SSR 转换缓存文件（.tmp/<id>/ssr/<hash>），
     * Windows 上偶发 EPERM 共享冲突，表现为"全部用例通过但 Errors 1"，
     * 卡住发布门禁。用例量不大，串行的代价远小于门禁不稳。
     */
    fileParallelism: false,
  },
});
