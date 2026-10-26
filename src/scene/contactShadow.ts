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

// The soft round shadow under a piece standing on the surface (Pool's under its balls). It grounds
// the piece at every quality: the lit surface glows, so the lamps' own shadows barely show on it,
// and in the low quality the lights cast none at all. It is a contact shadow, right under the
// piece and hugging its foot: a faint rim just past the edge where it meets the surface, fading
// out within a few millimetres, so the piece stands on the table rather than over it.

import { CanvasTexture } from 'three';

/** How far the shadow reaches, as a multiple of the piece's radius. */
export const SHADOW_SPREAD = 1.12;

/** A round shadow the size of the piece, darkest where its edge meets the surface. */
export function contactShadowTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // The piece's edge is at 1 / SHADOW_SPREAD of the way out (about 0.89).
  gradient.addColorStop(0, 'rgba(0,0,0,0.3)');
  gradient.addColorStop(0.87, 'rgba(0,0,0,0.3)');
  gradient.addColorStop(0.91, 'rgba(0,0,0,0.2)');
  gradient.addColorStop(0.96, 'rgba(0,0,0,0.06)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}
