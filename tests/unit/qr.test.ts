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

import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { createInvite, inviteUrl } from '../../src/net/protocol.ts';
import { qrCode, type QrCode } from '../../src/ui/qr.ts';

/** The code as pixels, the mark's square painted in one colour, as a camera might see it. */
function pixels(code: QrCode, mark: 'white' | 'black', scale = 6) {
  const quiet = 4;
  const side = (code.size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  const { at, size } = code.covered;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const row = Math.floor(y / scale) - quiet;
      const col = Math.floor(x / scale) - quiet;
      let dark = code.modules[row]?.[col] ?? false;
      if (row >= at && row < at + size && col >= at && col < at + size) dark = mark === 'black';
      if (dark) data.fill(0, (y * side + x) * 4, (y * side + x) * 4 + 3);
    }
  }
  return { data, side };
}

const links = [
  inviteUrl('https://slaviboy.github.io/air-hockey-3d/', createInvite()),
  inviteUrl('https://slaviboy.github.io/air-hockey-3d/?quality=low', createInvite()),
  inviteUrl('http://localhost:4176/?quality=low&menu=0', createInvite()),
];

describe('QR code of the invitation', () => {
  it.each(links)('reads back exactly, with the mark covering the middle: %s', (link) => {
    const code = qrCode(link);
    for (const mark of ['white', 'black'] as const) {
      const { data, side } = pixels(code, mark);
      expect(jsQR(data, side, side)?.data, `mark ${mark}`).toBe(link);
    }
  });

  it('keeps the mark small: well under the 30% the code can rebuild', () => {
    const code = qrCode(links[0]!);
    const share = code.covered.size ** 2 / code.size ** 2;
    expect(share).toBeLessThan(0.1);
    expect(code.svg).toContain('viewBox');
    expect(code.svg).not.toContain('<script');
  });
});

describe('the invitation on the published site', () => {
  it('is a 41 by 41 code, as the comment in qr.ts says', () => {
    expect(qrCode(links[0]!).size).toBe(41);
  });
});
