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

// Which build of the game this is, as far as online play cares. Two players can play together
// only if they simulate and referee alike, so the build is named by a fingerprint of the code that
// does that: the simulation, the table, the rules, the match and its messages, and the session's
// envelope. Anything else (the look, the sounds, the menus) may differ between two players' copies
// without telling them to reload. The players compare it when they say hello.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Plugin } from 'vite';

/** The code both players must share, from the project's root. */
export const SHARED_CODE = [
  'src/physics',
  'src/table',
  'src/rules',
  'src/game',
  'src/net/protocol.ts',
] as const;

export interface SourceFile {
  readonly path: string;
  readonly text: string;
}

/**
 * 12 hexadecimal digits of SHA-256 over the files' paths and contents, in path order, with line
 * endings made alike so that a checkout on Windows names the same build as one on Linux.
 */
export function fingerprint(files: readonly SourceFile[]): string {
  const hash = createHash('sha256');
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    hash.update(`${file.path}\0${file.text.replace(/\r\n/g, '\n')}\0`);
  }
  return hash.digest('hex').slice(0, 12);
}

/** The TypeScript files of the shared code under `root`. */
export function sharedFiles(root: string): SourceFile[] {
  const out: SourceFile[] = [];
  const visit = (path: string) => {
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path)) visit(join(path, name));
    } else if (path.endsWith('.ts')) {
      out.push({
        path: relative(root, path).split('\\').join('/'),
        text: readFileSync(path, 'utf8'),
      });
    }
  };
  // A part not written yet adds nothing.
  for (const part of SHARED_CODE) if (existsSync(join(root, part))) visit(join(root, part));
  return out;
}

export function buildId(root: string): string {
  return fingerprint(sharedFiles(root));
}

/** Defines __AIR_HOCKEY_BUILD__ for the game's code, in development and in builds. */
export function airHockeyBuildId(): Plugin {
  return {
    name: 'air-hockey-build-id',
    config(config) {
      const root = resolve(config.root ?? '.');
      return { define: { __AIR_HOCKEY_BUILD__: JSON.stringify(buildId(root)) } };
    },
  };
}
