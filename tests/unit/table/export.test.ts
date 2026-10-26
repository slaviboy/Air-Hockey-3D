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

// The geometry file the Blender model is built from is the one the simulation's table makes: a
// change to src/table/ without re-running scripts/export-table.ts fails here.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tableGeometryJson } from '../../../src/table/serialize.ts';

const root = join(import.meta.dirname, '..', '..', '..');

describe('exported table geometry', () => {
  it('blender/table-geometry.json is up to date', () => {
    const file = readFileSync(join(root, 'blender', 'table-geometry.json'), 'utf8');
    expect(JSON.parse(file)).toEqual(JSON.parse(JSON.stringify(tableGeometryJson())));
  });
});
