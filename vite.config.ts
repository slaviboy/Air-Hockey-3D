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

import { defineConfig } from 'vitest/config';
import { airHockeyBuildId } from './scripts/build-id.ts';
import { trysteroClockSkew } from './scripts/trystero-clock-skew.ts';

export default defineConfig({
  // Relative URLs, so the build serves from a GitHub Pages subpath as well as from a domain root.
  base: './',
  // Two devices whose clocks disagree must still find each other (see the plugin); two players
  // compare builds before they play (__AIR_HOCKEY_BUILD__).
  plugins: [trysteroClockSkew(), airHockeyBuildId()],
  // Served as they are in development, so the plugin sees Trystero's own files.
  optimizeDeps: { exclude: ['trystero', '@trystero-p2p/nostr'] },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/architecture/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
  },
});
