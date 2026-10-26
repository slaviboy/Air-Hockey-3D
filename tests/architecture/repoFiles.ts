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

// Shared helpers for the architecture guards that run from the pre-commit hook. They work on the
// files git knows about (tracked, staged, and untracked but not ignored), which keeps them fast and
// keeps them out of node_modules and the local-only reference screenshots.

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export function trackedFiles(): string[] {
  const listed = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return [...new Set(listed.split('\0').filter(Boolean))].sort();
}

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.mp4',
  '.webm',
  '.zip',
  '.gz',
  '.pdf',
  '.glb',
  '.blend',
  '.bin',
  '.wasm',
]);

/** Text files only, skipping deleted files and anything too large to be hand-written. */
export function readableFiles(maxBytes = 2 * 1024 * 1024): string[] {
  return trackedFiles().filter((relative) => {
    const dot = relative.lastIndexOf('.');
    const extension = dot === -1 ? '' : relative.slice(dot).toLowerCase();
    if (BINARY_EXTENSIONS.has(extension)) return false;
    try {
      return statSync(join(repoRoot, relative)).size <= maxBytes;
    } catch {
      return false;
    }
  });
}

export function read(relative: string): string {
  return readFileSync(join(repoRoot, relative), 'utf8');
}

export function matchesAny(relative: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(relative));
}
