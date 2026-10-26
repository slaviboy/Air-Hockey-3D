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

// Image metadata says more than the picture: Blender writes the .blend file's full path into every
// render, cameras and editors add Exif, Photoshop and XMP blocks. This removes it without touching
// the pixels: JPEG keeps only its JFIF header, colour profile and image data; PNG drops its text,
// Exif and time chunks.
//
//   node scripts/image-metadata.ts strip <files...>   remove metadata in place
//   node scripts/image-metadata.ts check <files...>   list files that still carry any

import { readFileSync, writeFileSync } from 'node:fs';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_METADATA = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

/** The metadata blocks in an image, by name; empty when it is clean or not a JPEG or PNG. */
interface Scan {
  readonly found: string[];
  readonly clean: Buffer;
}

export function metadataBlocks(data: Buffer): string[] {
  return scan(data).found;
}

/** The image without its metadata; the same bytes when there is none. */
export function stripMetadata(data: Buffer): Buffer {
  return scan(data).clean;
}

function scan(data: Buffer): Scan {
  if (data[0] === 0xff && data[1] === 0xd8) return scanJpeg(data);
  if (data.subarray(0, 8).equals(PNG_SIGNATURE)) return scanPng(data);
  return { found: [], clean: data };
}

function scanJpeg(data: Buffer): Scan {
  const keep = [data.subarray(0, 2)];
  const found: string[] = [];
  let i = 2;
  while (i + 4 <= data.length && data[i] === 0xff) {
    const marker = data[i + 1]!;
    // Start of scan: the compressed picture runs to the end of the file.
    if (marker === 0xda) break;
    const length = data.readUInt16BE(i + 2);
    const segment = data.subarray(i, i + 2 + length);
    const body = segment.subarray(4);
    const app = marker >= 0xe0 && marker <= 0xef;
    const jfif = marker === 0xe0 && body.subarray(0, 5).toString('latin1') === 'JFIF\0';
    const icc = marker === 0xe2 && body.subarray(0, 12).toString('latin1') === 'ICC_PROFILE\0';
    if (marker === 0xfe || (app && !jfif && !icc)) {
      found.push(marker === 0xfe ? 'comment' : `APP${marker - 0xe0}`);
    } else {
      keep.push(segment);
    }
    i += 2 + length;
  }
  keep.push(data.subarray(i));
  return { found, clean: found.length ? Buffer.concat(keep) : data };
}

function scanPng(data: Buffer): Scan {
  const keep = [data.subarray(0, 8)];
  const found: string[] = [];
  let i = 8;
  while (i + 12 <= data.length) {
    const length = data.readUInt32BE(i);
    const type = data.subarray(i + 4, i + 8).toString('latin1');
    const chunk = data.subarray(i, i + 12 + length);
    if (PNG_METADATA.has(type)) found.push(type);
    else keep.push(chunk);
    i += 12 + length;
  }
  return { found, clean: found.length ? Buffer.concat(keep) : data };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...files] = process.argv.slice(2);
  let dirty = 0;
  for (const file of files) {
    const data = readFileSync(file);
    const found = metadataBlocks(data);
    if (!found.length) continue;
    if (command === 'strip') {
      writeFileSync(file, stripMetadata(data));
      console.log(`${file}: removed ${found.join(', ')}`);
    } else {
      dirty++;
      console.log(`${file}: ${found.join(', ')}`);
    }
  }
  if (command === 'check' && dirty) process.exit(1);
}
