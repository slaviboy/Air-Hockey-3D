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

// What may never be published, in one place: credentials, e-mail addresses other than the
// project's, paths of the computer the work was done on, the reference product's name, and
// copyright notices for anyone not credited. The architecture tests apply these rules to the files
// in the repository, scripts/audit.ts to every commit in its history and to the built site.
//
// Text is checked as it is. Binary files (images, models, the .blend) are checked by the readable
// strings inside them, after unpacking a compressed .blend, because that is where tools leave
// paths and names behind.

import { zstdDecompressSync, gunzipSync } from 'node:zlib';

export const AUTHOR = { name: 'slaviboy', email: 'slavi94slavi94@gmail.com' };

/** The only address that may appear anywhere. */
export const ALLOWED_EMAILS: readonly string[] = [AUTHOR.email];

/** Who may hold a copyright notice: the author and the credits the licences require. */
export const COPYRIGHT_HOLDERS: readonly string[] = [
  'Stanislav Georgiev',
  'three.js authors',
  'Dan Motzenbecker',
  'Paul Miller',
  'Kazuhiko Arase',
  // The GNU GPL's own text and its how-to template.
  'Free Software Foundation',
  '<name of author>',
];

/**
 * The reference table's maker, assembled so this file does not contain it. The names the sister
 * games may never use are kept as well (their reference products and publishers): the three share
 * code, and the chess game's folder carries one of them.
 */
export const FORBIDDEN_NAMES: readonly string[] = [
  ['dyna', 'mo'].join(''),
  ['8', 'ball', 'pool'].join(' '),
  ['8', 'ball', 'pool'].join(''),
  ['mini', 'clip'].join(''),
  ['chess', 'master'].join(''),
  ['chess', ' ', 'master'].join(''),
  ['ubi', 'soft'].join(''),
];

export interface Finding {
  readonly rule: string;
  readonly match: string;
}

export interface SecretRule {
  readonly name: string;
  readonly pattern: RegExp;
}

export const SECRET_RULES: readonly SecretRule[] = [
  { name: 'PEM private key block', pattern: /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----/ },
  { name: 'AWS access key id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'GitHub fine-grained token', pattern: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/ },
  { name: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Stripe key', pattern: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{20,}\b/ },
  { name: 'npm token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: 'Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI API key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/ },
  { name: 'Nostr private key', pattern: /\bnsec1[02-9ac-hj-np-z]{58}\b/ },
  {
    name: 'Cloudflare API token',
    pattern: /\b(?:cf|CF)[_-]?(?:api[_-]?)?token\b\s*[:=]\s*["'][^"'\s]{30,}["']/,
  },
  {
    name: 'JSON web token',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  },
  {
    name: 'TURN or ICE credential',
    pattern: /\bcredential\b["']?\s*[:=]\s*["'][^"'\s]{6,}["']/i,
  },
  {
    name: 'assigned secret literal',
    pattern:
      /\b(?:api[_-]?key|secret|password|passwd|token|access[_-]?key|private[_-]?key)\b["']?\s*[:=]\s*["'][^"'\s]{16,}["']/i,
  },
];

/** Lines that only show what a secret looks like. */
export const SECRET_ALLOWED: readonly RegExp[] = [
  /\bexample\b/i,
  /\bplaceholder\b/i,
  /\bdummy\b/i,
  /\bfake\b/i,
  /\bredacted\b/i,
  /\bprocess\.env\b/,
  /\bimport\.meta\.env\b/,
];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
/** Home folders, temporary folders and Windows user folders: where a path names a computer. */
const LOCAL_PATH = new RegExp(
  [
    String.raw`(?:^|[\s"'(=:])/` + ['Users', ''].join('/') + String.raw`[A-Za-z][^\s"')]*`,
    String.raw`(?:^|[\s"'(=:])/` + ['home', ''].join('/') + String.raw`[a-z][^\s"')]*`,
    String.raw`/` + ['private', 'tmp'].join('/') + String.raw`\b`,
    String.raw`/` + ['private', 'var'].join('/') + String.raw`\b`,
    String.raw`\b[A-Za-z]:\\` + String.raw`(?:Users|Documents and Settings)\\`,
  ].join('|'),
);
/** Paths that look local but name no computer. None are needed yet. */
const VIRTUAL_PATHS: readonly string[] = [];
const COPYRIGHT = /\bcopyright\s*(?:\(c\)|©)/i;

/** Things found in a text: each with the rule it broke and the offending text. */
export function scanText(text: string, { secrets = true } = {}): Finding[] {
  const findings: Finding[] = [];
  const lower = text.toLowerCase();
  for (const name of FORBIDDEN_NAMES) {
    if (lower.includes(name)) findings.push({ rule: 'the reference product', match: name });
  }
  for (const match of text.match(EMAIL) ?? []) {
    if (!ALLOWED_EMAILS.includes(match.toLowerCase())) {
      findings.push({ rule: 'e-mail address', match });
    }
  }
  const lines = text.split('\n');
  for (const line of lines) {
    const path = LOCAL_PATH.exec(line);
    const local = path?.[0].trim().replace(/^["'(=:]/, '');
    if (local && !VIRTUAL_PATHS.some((p) => local === p || local.startsWith(`${p}/`)))
      findings.push({ rule: 'local path', match: local.slice(0, 80) });
    if (COPYRIGHT.test(line) && !COPYRIGHT_HOLDERS.some((h) => line.includes(h))) {
      findings.push({ rule: 'copyright holder not credited', match: line.trim().slice(0, 100) });
    }
    if (!secrets || SECRET_ALLOWED.some((rule) => rule.test(line))) continue;
    for (const rule of SECRET_RULES) {
      const found = rule.pattern.exec(line);
      if (found) findings.push({ rule: rule.name, match: `${found[0].slice(0, 12)}…` });
    }
  }
  return findings;
}

const BINARY_EXTENSIONS =
  /\.(?:png|jpe?g|gif|webp|ico|woff2?|ttf|otf|mp4|webm|zip|gz|pdf|glb|blend|bin|wasm|mp3|ogg|wav)$/i;

/** Whether a file is read as bytes rather than text. */
export function isBinary(name: string, data: Buffer): boolean {
  return BINARY_EXTENSIONS.test(name) || data.subarray(0, 8000).includes(0);
}

const SEEKABLE_MAGIC = 0x8f92eab1;

/**
 * Decompresses zstd data of one or more frames. Blender writes the seekable format: several frames
 * followed by a table of their sizes, which is used to unpack each frame in turn (Node's own
 * decompressor stops after the first).
 */
function unzstd(data: Buffer): Buffer {
  if (data.length < 9 || data.readUInt32LE(data.length - 4) !== SEEKABLE_MAGIC) {
    return zstdDecompressSync(data);
  }
  const frames = data.readUInt32LE(data.length - 9);
  const checksums = (data[data.length - 5]! & 0x80) !== 0;
  const entry = checksums ? 12 : 8;
  const table = data.length - 9 - frames * entry;
  const parts: Buffer[] = [];
  let offset = 0;
  for (let i = 0; i < frames; i++) {
    const size = data.readUInt32LE(table + i * entry);
    parts.push(zstdDecompressSync(data.subarray(offset, offset + size)));
    offset += size;
  }
  return Buffer.concat(parts);
}

/** The readable runs of characters in binary data, unpacking a compressed .blend first. */
export function readableStrings(data: Buffer, minimum = 6): string {
  let bytes: Buffer = data;
  try {
    if (bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd) {
      bytes = unzstd(bytes);
    } else if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      bytes = gunzipSync(bytes);
    }
  } catch {
    // Not really compressed: read it as it is.
  }
  const runs: string[] = [];
  let start = -1;
  for (let i = 0; i <= bytes.length; i++) {
    const c = bytes[i];
    const printable = c !== undefined && c >= 0x20 && c < 0x7f;
    if (printable && start < 0) start = i;
    if (!printable && start >= 0) {
      if (i - start >= minimum) runs.push(bytes.toString('latin1', start, i));
      start = -1;
    }
  }
  return runs.join('\n');
}

/** Things found in a file, text or binary. Binary data is not checked for secrets' shapes. */
export function scanFile(
  name: string,
  data: Buffer,
  options: { secrets?: boolean } = {},
): Finding[] {
  if (isBinary(name, data)) return scanText(readableStrings(data), { ...options, secrets: false });
  return scanText(data.toString('utf8'), options);
}

/**
 * Files that state these rules (and so contain what they forbid) and the lockfile, whose integrity
 * hashes look like secrets. The rules still apply to everything else.
 */
export const RULE_FILES: readonly RegExp[] = [
  /^scripts\/public-safety\.ts$/,
  /^tests\/architecture\/(?:branding|secrets|identity)\.test\.ts$/,
];
export const SECRET_EXEMPT: readonly RegExp[] = [/^package-lock\.json$/];
