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

// Rebuilds the models with Blender, in order:
//   inputs    the table geometry, from src/ (Node)
//   build     blender/air-hockey.blend: the table, the mallet, the puck
//   export    public/models/table.glb, mallet.glb, puck.glb
//   previews  the reference renders in blender/renders/ (metadata stripped: they are published)
// Usage: npm run models [-- inputs|build|export|previews ...]   (default: all four)
// Set BLENDER to the Blender executable if it is not in its usual place.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripMetadata } from './image-metadata.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const defaultBlender = {
  win32: 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe',
  darwin: '/Applications/Blender.app/Contents/MacOS/Blender',
};
const blender = process.env.BLENDER ?? defaultBlender[process.platform] ?? 'blender';
const blend = join(root, 'blender', 'air-hockey.blend');
const order = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['inputs', 'build', 'export', 'previews'];

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: root });
  if (result.error) console.error(`could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function blenderScript(file, script) {
  const args = ['--background', ...(file ? [file] : []), '--factory-startup'];
  run(blender, [
    ...args,
    '--python-exit-code',
    '1',
    '--python',
    join(root, 'blender', 'scripts', script),
  ]);
}

for (const step of order) {
  console.log(`\n== ${step}`);
  if (step === 'inputs') {
    run(process.execPath, [join(root, 'scripts', 'export-table.ts')]);
  } else if (step === 'build') {
    blenderScript(null, 'build.py');
  } else if (step === 'export') {
    blenderScript(blend, 'export_glb.py');
  } else if (step === 'previews') {
    blenderScript(blend, 'render_previews.py');
    const renders = join(root, 'blender', 'renders');
    for (const name of readdirSync(renders).filter((n) => /\.(jpe?g|png)$/i.test(n))) {
      const file = join(renders, name);
      writeFileSync(file, stripMetadata(readFileSync(file)));
    }
  } else {
    console.error(`unknown step "${step}"; use inputs, build, export or previews`);
    process.exit(1);
  }
}
