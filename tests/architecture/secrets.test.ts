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

// Guard: no credentials reach a commit. Runs from .githooks/pre-commit. The rules live in
// scripts/public-safety.ts, shared with the audit of the whole history.

import { describe, expect, it } from 'vitest';
import {
  RULE_FILES,
  SECRET_ALLOWED,
  SECRET_EXEMPT,
  SECRET_RULES,
} from '../../scripts/public-safety.ts';
import { read, readableFiles } from './repoFiles.ts';

const SKIP_FILES = [...RULE_FILES, ...SECRET_EXEMPT];

describe('secret scanning', () => {
  const files = readableFiles().filter((file) => !SKIP_FILES.some((rule) => rule.test(file)));

  it('has files to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('finds no credentials in tracked files', () => {
    const findings: string[] = [];
    for (const file of files) {
      read(file)
        .split('\n')
        .forEach((line, index) => {
          if (SECRET_ALLOWED.some((rule) => rule.test(line))) return;
          for (const rule of SECRET_RULES) {
            if (rule.pattern.test(line))
              findings.push(`${file}:${index + 1} looks like a ${rule.name}`);
          }
        });
    }
    expect(findings, findings.join('\n')).toEqual([]);
  });
});
