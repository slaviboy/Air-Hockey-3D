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
// and in the low quality the lights cast none at all. It reaches a little past the piece's edge,
// darkest just under it, as an overhead lamp's would.

import { CanvasTexture } from 'three';

/** How far the shadow reaches, as a multiple of the piece's radius. */
export const SHADOW_SPREAD = 2;

/** A soft round shadow: darkest under the piece, fading out a little beyond its edge. */
export function contactShadowTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // The piece's edge is at 1 / SHADOW_SPREAD of the way out: half way.
  gradient.addColorStop(0, 'rgba(0,0,0,0.85)');
  gradient.addColorStop(0.45, 'rgba(0,0,0,0.8)');
  gradient.addColorStop(0.52, 'rgba(0,0,0,0.6)');
  gradient.addColorStop(0.64, 'rgba(0,0,0,0.34)');
  gradient.addColorStop(0.78, 'rgba(0,0,0,0.13)');
  gradient.addColorStop(0.9, 'rgba(0,0,0,0.035)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}
