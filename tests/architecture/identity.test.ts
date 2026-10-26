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

// Guard: the repository is public, so it names only its author and the credits the licences
// require. No e-mail address but the project's, no path of the computer the work was done on, no
// copyright holder who is not credited, and no metadata in images, whether in text or inside a
// binary file. Runs from .githooks/pre-commit; scripts/audit.ts applies the same rules to the whole
// history.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { metadataBlocks } from '../../scripts/image-metadata.ts';
import { RULE_FILES, scanFile } from '../../scripts/public-safety.ts';
import { repoRoot, trackedFiles } from './repoFiles.ts';

const IDENTITY_RULES = new Set(['e-mail address', 'local path', 'copyright holder not credited']);

function files(): Array<[string, Buffer]> {
  const out: Array<[string, Buffer]> = [];
  for (const file of trackedFiles()) {
    if (RULE_FILES.some((rule) => rule.test(file))) continue;
    try {
      out.push([file, readFileSync(join(repoRoot, file))]);
    } catch {
      // Deleted in the working tree.
    }
  }
  return out;
}

describe('identity', () => {
  const all = files();

  it('has files to scan', () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it('names no one and nothing private: e-mails, local paths, copyright holders', () => {
    const findings: string[] = [];
    for (const [file, data] of all) {
      for (const f of scanFile(file, data, { secrets: false })) {
        if (IDENTITY_RULES.has(f.rule)) findings.push(`${file}: ${f.rule}: ${f.match}`);
      }
    }
    expect(findings, findings.join('\n')).toEqual([]);
  });

  it('keeps no metadata in images', () => {
    const findings: string[] = [];
    for (const [file, data] of all) {
      if (!/\.(?:jpe?g|png)$/i.test(file)) continue;
      const blocks = metadataBlocks(data);
      if (blocks.length) findings.push(`${file}: ${blocks.join(', ')}`);
    }
    expect(
      findings,
      `Run: node scripts/image-metadata.ts strip <files>\n${findings.join('\n')}`,
    ).toEqual([]);
  });

  it('commits come from the project author only (the hook enforces it as well)', () => {
    const hook = readFileSync(join(repoRoot, '.githooks', 'pre-commit'), 'utf8');
    expect(hook).toContain('expected_name="slaviboy"');
    expect(hook).toContain('expected_email="slavi94slavi94@gmail.com"');
  });
});
