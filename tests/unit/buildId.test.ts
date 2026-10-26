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

import { describe, expect, it } from 'vitest';
import { buildId, fingerprint, sharedFiles } from '../../scripts/build-id.ts';

const files = [
  { path: 'src/rules/match.ts', text: 'export const a = 1;\n' },
  { path: 'src/physics/puck.ts', text: 'export const b = 2;\n' },
];

describe('build id', () => {
  it('names the shared code: the same files give the same name, in any order or line ending', () => {
    const id = fingerprint(files);
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    expect(fingerprint([...files].reverse())).toBe(id);
    expect(fingerprint(files.map((f) => ({ ...f, text: f.text.replace(/\n/g, '\r\n') })))).toBe(id);
  });

  it('changes with any change to the shared code', () => {
    const id = fingerprint(files);
    expect(fingerprint([files[0]!, { ...files[1]!, text: 'export const b = 3;\n' }])).not.toBe(id);
    expect(fingerprint([files[0]!])).not.toBe(id);
    expect(fingerprint([files[0]!, { ...files[1]!, path: 'src/physics/other.ts' }])).not.toBe(id);
  });

  it('covers the simulation, the rules, the match and the protocol, and nothing else', () => {
    const paths = sharedFiles('.').map((f) => f.path);
    for (const path of [
      'src/physics/dmath.ts',
      'src/table/frame.ts',
      'src/rules/types.ts',
      'src/net/protocol.ts',
    ]) {
      expect(paths).toContain(path);
    }
    expect(paths.some((p) => p.startsWith('src/ui/') || p.startsWith('src/scene/'))).toBe(false);
    expect(buildId('.')).toMatch(/^[0-9a-f]{12}$/);
  });
});
