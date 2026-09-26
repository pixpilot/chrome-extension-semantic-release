import defineConfig from '@pixpilot/dev-config/vitest';

export default defineConfig({
  test: {
    coverage: {
      enabled: true,
      reportsDirectory: 'coverage',
    },
  },
});
