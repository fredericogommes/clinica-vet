import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globalSetup: ['src/test/global-setup.ts'],
    // Os testes de integração compartilham um banco descartável por execução.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
