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

// Guard: the simulation, the table geometry and the rules compute the same bits in every browser.
// Online, the side that takes the puck over carries on the other side's simulation, and the tests
// replay rallies exactly, so these files may use only the arithmetic the language rounds exactly:
// + - * /, Math.sqrt and the exact Math helpers. Exponentials come from src/physics/dmath.ts. They
// may not read clocks or random numbers, and they import nothing from outside the set (no
// three.js, no DOM).

import { describe, expect, it } from 'vitest';
import { read, trackedFiles } from './repoFiles.ts';

const DETERMINISTIC = [/^src\/physics\//, /^src\/table\//, /^src\/rules\//] as const;

const EXACT_MATH = new Set([
  'sqrt',
  'abs',
  'min',
  'max',
  'floor',
  'ceil',
  'round',
  'trunc',
  'sign',
  'fround',
  'imul',
  'PI',
  'SQRT2',
  'SQRT1_2',
]);

const isDeterministic = (file: string) => DETERMINISTIC.some((rule) => rule.test(file));

function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The rules broken by one file's code, given its path (for resolving imports). */
export function violations(file: string, code: string): string[] {
  const found: string[] = [];
  const text = withoutComments(code);
  for (const match of text.matchAll(/\bMath\.(\w+)/g)) {
    if (!EXACT_MATH.has(match[1]!)) found.push(`Math.${match[1]} is not exactly rounded`);
  }
  if (/\*\*/.test(text)) found.push('the ** operator is not exactly rounded');
  for (const name of ['Date', 'performance', 'crypto', 'window', 'document', 'globalThis']) {
    if (new RegExp(`\\b${name}\\b`).test(text)) found.push(`${name} is not deterministic`);
  }
  for (const match of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
    const target = match[1]!;
    if (!target.startsWith('.')) {
      found.push(`imports ${target} from outside the deterministic set`);
      continue;
    }
    const parts = file.split('/').slice(0, -1);
    for (const part of target.split('/')) {
      if (part === '..') parts.pop();
      else if (part !== '.') parts.push(part);
    }
    const resolved = parts.join('/');
    if (!isDeterministic(resolved)) found.push(`imports ${resolved} from outside the set`);
  }
  return found;
}

describe('deterministic simulation', () => {
  const files = trackedFiles().filter((file) => isDeterministic(file) && file.endsWith('.ts'));

  it('has files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('catches what it is meant to catch', () => {
    expect(violations('src/physics/x.ts', 'const a = Math.sin(1);')).toHaveLength(1);
    expect(violations('src/physics/x.ts', 'const a = 2 ** 3;')).toHaveLength(1);
    expect(violations('src/physics/x.ts', "import { Vector3 } from 'three';")).toHaveLength(1);
    expect(violations('src/physics/x.ts', "import { a } from '../scene/a.ts';")).toHaveLength(1);
    expect(violations('src/physics/x.ts', 'const t = Date.now();')).toHaveLength(1);
    expect(violations('src/physics/x.ts', "import { a } from '../table/a.ts';")).toEqual([]);
    expect(violations('src/physics/x.ts', '/** a ** b */ const a = Math.sqrt(2);')).toEqual([]);
  });

  it.each(files)('%s uses only exactly rounded arithmetic', (file) => {
    expect(violations(file, read(file))).toEqual([]);
  });
});
