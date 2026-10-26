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

// A QR code of the invitation link, with the game's mark (a mallet and a puck) in the middle, made
// here in the browser: the link holds the game's secret, so it is never sent to a QR service. The
// link is short (66 characters on the published site), which keeps the code small: 41x41 modules at
// error correction level Q. Q rebuilds up to about a quarter of the code, ample for the mark in the
// centre (about a twentieth) plus glare or a smudge. Black on white with the full quiet border,
// drawn at whole pixels per module: what phone cameras read fastest.

import qrcode from 'qrcode-generator';
import { PUCK_MARK } from './icons.ts';

/** The empty border every QR code needs around it, in modules. */
const QUIET = 4;
/** The mark's width as a share of the code's width. */
const MARK = 0.18;

export interface QrCode {
  /** Modules per side, without the border. */
  readonly size: number;
  /** Modules per side with the border: draw the code at a whole multiple of this in pixels. */
  readonly total: number;
  /** Which modules are dark, by row and column (without the border). */
  readonly modules: readonly (readonly boolean[])[];
  /** The square the mark covers, in modules from the code's top-left corner (without the border). */
  readonly covered: { readonly at: number; readonly size: number };
  readonly svg: string;
}

/** The mark's drawing, without its own <svg> element, to place inside the code. */
const DRAWING = PUCK_MARK.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');

/** An SVG QR code for the text, dark on white, with the game's mark in the middle. */
export function qrCode(text: string): QrCode {
  const qr = qrcode(0, 'Q');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const total = n + QUIET * 2;
  let path = '';
  const modules: boolean[][] = [];
  for (let row = 0; row < n; row++) {
    modules.push([]);
    for (let col = 0; col < n; col++) {
      const dark = qr.isDark(row, col);
      modules[row]!.push(dark);
      if (dark) path += `M${col + QUIET} ${row + QUIET}h1v1h-1z`;
    }
  }
  // The mark, as in the main menu, on a white rounded square.
  const mark = Math.round(n * MARK);
  const ring = mark + 2;
  const ringAt = (total - ring) / 2;
  const markAt = (total - mark) / 2;
  const svg =
    `<svg viewBox="0 0 ${total} ${total}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="#fff"/>` +
    `<path d="${path}" fill="#000"/>` +
    `<g shape-rendering="geometricPrecision">` +
    `<rect x="${ringAt}" y="${ringAt}" width="${ring}" height="${ring}" rx="${ring * 0.24}" fill="#fff"/>` +
    `<svg x="${markAt}" y="${markAt}" width="${mark}" height="${mark}" viewBox="0 0 24 24">${DRAWING}</svg>` +
    `</g></svg>`;
  return { size: n, total, modules, covered: { at: ringAt - QUIET, size: ring }, svg };
}
