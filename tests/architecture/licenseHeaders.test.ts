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

// Guard: every hand-written source file carries the project's GPL header. Runs from
// .githooks/pre-commit, so it has to stay fast.

import { describe, expect, it } from 'vitest';
import { matchesAny, read, readableFiles } from './repoFiles.ts';

const REQUIRES_HEADER = [
  /^src\/.*\.(ts|css)$/,
  /^tests\/.*\.ts$/,
  /^scripts\/.*\.(ts|mjs|js)$/,
  /^blender\/scripts\/.*\.py$/,
  /^\.githooks\/[^/.]+$/,
  /^[^/]+\.config\.(ts|js|mjs)$/,
] as const;

const EXEMPT = [/^src\/vite-env\.d\.ts$/] as const;

const COPYRIGHT = 'Copyright (C) 2026 Stanislav Georgiev';
const PROFILE = 'https://github.com/slaviboy';
const NOTICE = 'GNU General Public License';

describe('license headers', () => {
  const files = readableFiles().filter(
    (file) => matchesAny(file, REQUIRES_HEADER) && !matchesAny(file, EXEMPT),
  );

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s carries the GPL header', (file) => {
    // Only the top of the file counts: a mention further down is a reference, not a header.
    const head = read(file).slice(0, 1200);
    expect(head, `${file} is missing the copyright line`).toContain(COPYRIGHT);
    expect(head, `${file} is missing the author profile line`).toContain(PROFILE);
    expect(head, `${file} is missing the GPL notice`).toContain(NOTICE);
    expect(head, `${file} still carries a proprietary header`).not.toMatch(
      /proprietary|all rights reserved/i,
    );
  });
});
