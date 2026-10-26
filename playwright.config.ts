/*
 * Copyright (C) 2026 Stanislav Georgiev
 * https://github.com/slaviboy
 *
 * This file is part of Air Hockey 3D.
 *
 * Air Hockey 3D is free software: you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version. See the LICENSE file for the full terms.
 */

// End-to-end tests against the production build.
// Run one file at a time, e.g.: npx playwright test tests/e2e/boot.spec.ts
// (builds first; needs a WebGL-capable browser, so it runs locally, not in CI).
// AIR_HOCKEY_E2E_PORT picks another port, so that two working copies can test side by side without
// one reusing the other's server. The default keeps clear of the sister games' ports.

import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.AIR_HOCKEY_E2E_PORT ?? 4176);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}/`,
    viewport: { width: 1174, height: 880 },
    deviceScaleFactor: 1,
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1174, height: 880 } },
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
