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

// Guard: this product is Air Hockey 3D. The commercial table whose look inspired it is never named
// in anything we publish: not in source, identifiers, UI strings, docs or commit-tracked files.
// The needles are assembled from fragments (in scripts/public-safety.ts) so no file contains the
// words it forbids. Binary files are read for the strings inside them: tools write paths and
// names into images and models.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_NAMES as FORBIDDEN,
  RULE_FILES,
  isBinary,
  readableStrings,
} from '../../scripts/public-safety.ts';
import { read, readableFiles, repoRoot, trackedFiles } from './repoFiles.ts';

const SKIP_FILES = [...RULE_FILES, /^package-lock\.json$/];

describe('product naming', () => {
  const files = readableFiles().filter((file) => !SKIP_FILES.some((rule) => rule.test(file)));

  it('has files to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(FORBIDDEN)('never mentions %s', (needle) => {
    const findings: string[] = [];
    for (const file of files) {
      if (file.toLowerCase().includes(needle)) findings.push(`${file} (file name)`);
      read(file)
        .toLowerCase()
        .split('\n')
        .forEach((line, index) => {
          if (line.includes(needle)) findings.push(`${file}:${index + 1}`);
        });
    }
    expect(findings, `Say "the reference" instead. Found at:\n${findings.join('\n')}`).toEqual([]);
  });

  it('no image, model or other binary file carries the names inside it', () => {
    const findings: string[] = [];
    for (const file of trackedFiles()) {
      let data: Buffer;
      try {
        data = readFileSync(join(repoRoot, file));
      } catch {
        continue;
      }
      if (!isBinary(file, data)) continue;
      const text = readableStrings(data).toLowerCase();
      for (const needle of FORBIDDEN) if (text.includes(needle)) findings.push(file);
    }
    expect(findings, `Found inside:\n${findings.join('\n')}`).toEqual([]);
  });

  it('names the product in the package manifest', () => {
    expect(JSON.parse(read('package.json')).name).toBe('air-hockey-3d');
  });
});
