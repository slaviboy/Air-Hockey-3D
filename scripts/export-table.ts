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

// Writes the table geometry the Blender scripts build the model from: blender/table-geometry.json.
// Run it (or `npm run models`, which runs it first) whenever src/table/ changes; a unit test fails
// while the file is stale.
// Usage: node scripts/export-table.ts

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tableGeometryJson } from '../src/table/serialize.ts';

const root = join(import.meta.dirname, '..');
const file = join(root, 'blender', 'table-geometry.json');
writeFileSync(file, `${JSON.stringify(tableGeometryJson(), null, 2)}\n`);
console.log(`wrote ${file.slice(root.length + 1)}`);
