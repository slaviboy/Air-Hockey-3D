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

// Checks what a public repository and its site would give away, with the rules of
// scripts/public-safety.ts.
//
//   node scripts/audit.ts            every commit in the history: its author and committer, its
//                                    message, and every version of every file it ever held
//   node scripts/audit.ts dist       the built site: no source maps, no local addresses, nothing
//                                    the rules forbid
//
// Exits with 1 and lists what it found, or prints a short all-clear.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { AUTHOR, RULE_FILES, SECRET_EXEMPT, scanFile, scanText } from './public-safety.ts';

const root = join(import.meta.dirname, '..');
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });

function auditHistory(): string[] {
  const problems: string[] = [];

  // Who made each commit, and what its message says.
  const log = git('log', '--all', '--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x01');
  let commits = 0;
  for (const record of log.split('\x01')) {
    const [hash, an, ae, cn, ce, body] = record.replace(/^\n/, '').split('\0');
    if (!hash) continue;
    commits++;
    const short = hash.slice(0, 7);
    for (const [who, name, email] of [
      ['author', an, ae],
      ['committer', cn, ce],
    ] as const) {
      if (name !== AUTHOR.name || email !== AUTHOR.email) {
        problems.push(`${short}: ${who} is ${name} <${email}>`);
      }
    }
    if (/^(?:co-authored-by|signed-off-by):/im.test(body ?? '')) {
      problems.push(`${short}: message has a Co-Authored-By or Signed-off-by trailer`);
    }
    for (const f of scanText(body ?? '')) problems.push(`${short} message: ${f.rule}: ${f.match}`);
  }

  // Every version of every file, each blob once, under the first path it was seen at.
  const blobs = new Map<string, string>();
  for (const line of git('rev-list', '--objects', '--all').split('\n')) {
    const space = line.indexOf(' ');
    if (space < 0) continue;
    const id = line.slice(0, space);
    if (!blobs.has(id)) blobs.set(id, line.slice(space + 1));
  }
  const types = git('cat-file', '--batch-check=%(objectname) %(objecttype)', '--batch-all-objects');
  const isBlob = new Set(
    types
      .split('\n')
      .filter((l) => l.endsWith(' blob'))
      .map((l) => l.split(' ')[0]),
  );
  let files = 0;
  for (const [id, path] of blobs) {
    if (!isBlob.has(id) || RULE_FILES.some((rule) => rule.test(path))) continue;
    files++;
    const data = execFileSync('git', ['cat-file', 'blob', id], {
      cwd: root,
      maxBuffer: 512 * 1024 * 1024,
    });
    const secrets = !SECRET_EXEMPT.some((rule) => rule.test(path));
    for (const f of scanFile(path, data, { secrets })) {
      problems.push(`${path} (${id.slice(0, 7)}): ${f.rule}: ${f.match}`);
    }
  }
  console.log(`audit: ${commits} commits and ${files} file versions checked`);
  return problems;
}

function auditDist(dir: string): string[] {
  const problems: string[] = [];
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((name) => {
      const full = join(d, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  const files = walk(dir);
  for (const full of files) {
    const path = relative(dir, full);
    if (path.endsWith('.map')) problems.push(`${path}: a source map would publish the sources`);
    const data = readFileSync(full);
    // Library code bundles its own licence headers; only our rules about people and places,
    // secrets and the reference apply to it.
    for (const f of scanFile(path, data)) {
      if (f.rule === 'copyright holder not credited') continue;
      problems.push(`${path}: ${f.rule}: ${f.match}`);
    }
    if (/\.(?:html|js|css)$/.test(path)) {
      const text = data.toString('utf8');
      const local = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/.exec(text);
      if (local) problems.push(`${path}: local address ${local[0]}`);
    }
  }
  console.log(`audit: ${files.length} built files checked`);
  return problems;
}

const target = process.argv[2];
const problems = target ? auditDist(join(root, target)) : auditHistory();
if (problems.length) {
  console.error(problems.map((p) => `  ${p}`).join('\n'));
  console.error(`audit: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('audit: clean');
