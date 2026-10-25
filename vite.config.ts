import { defineConfig } from 'vitest/config';

// Relative base so the build works on GitHub Pages under /<repo>/ as well as locally.
export default defineConfig({
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
