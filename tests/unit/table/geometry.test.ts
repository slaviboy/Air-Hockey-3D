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

// The table's walls: the outline the model is built from lies on the walls the puck meets (moved
// in by nothing), the walls join without gaps, and the places the game uses are where they should
// be.

import { describe, expect, it } from 'vitest';
import {
  boundary,
  centreLine,
  clampToArea,
  fieldOutline,
  goalMouth,
  goalReached,
  halfOf,
  malletArea,
  malletHome,
  neutralBand,
  serveSpot,
  type Boundary,
  type Point,
} from '../../../src/table/geometry.ts';
import { TABLE } from '../../../src/table/spec.ts';

const { W, L } = TABLE;
const R = TABLE.puck.radius;
const M = TABLE.mallet.radius;

/** How far a point is from the nearest piece of the walls. */
function distanceToWalls(walls: Boundary, p: Point): number {
  let best = Infinity;
  for (const l of walls.lines) {
    const dx = l.bx - l.ax;
    const dy = l.by - l.ay;
    const t = Math.max(
      0,
      Math.min(1, ((p.x - l.ax) * dx + (p.y - l.ay) * dy) / (dx * dx + dy * dy)),
    );
    best = Math.min(best, Math.hypot(p.x - l.ax - dx * t, p.y - l.ay - dy * t));
  }
  for (const c of walls.corners) {
    if ((p.x - c.cx) * c.qx < -1e-9 || (p.y - c.cy) * c.qy < -1e-9) continue;
    best = Math.min(best, Math.abs(Math.hypot(p.x - c.cx, p.y - c.cy) - c.r));
  }
  for (const s of walls.posts) {
    best = Math.min(best, Math.abs(Math.hypot(p.x - s.cx, p.y - s.cy) - s.r));
  }
  return best;
}

describe('the table', () => {
  it('has the proportions of an 8-foot table and a slot the puck goes through', () => {
    expect(L / W).toBeGreaterThan(1.9);
    expect(L / W).toBeLessThan(2.2);
    const { x0, x1 } = goalMouth(TABLE);
    expect(x1 - x0).toBeGreaterThan(4 * R);
    expect((x0 + x1) / 2).toBeCloseTo(W / 2, 12);
    expect(TABLE.cornerRadius).toBeGreaterThan(R);
  });

  it('draws its rails where the puck meets them: the outline lies on the walls at no inset', () => {
    const faces = boundary(TABLE, 0);
    const outline = fieldOutline(TABLE, 16);
    expect(outline.length).toBeGreaterThan(80);
    for (const p of outline) expect(distanceToWalls(faces, p)).toBeLessThan(1e-9);
  });

  it('joins its walls without a gap at every inset', () => {
    for (const inset of [0, R, M]) {
      const walls = boundary(TABLE, inset);
      for (const l of walls.lines) {
        // Each end of a straight wall meets a corner or a post, or is the slot's open end.
        for (const [x, y] of [
          [l.ax, l.ay],
          [l.bx, l.by],
        ] as const) {
          if (y < -TABLE.slotDepth + 1e-9 || y > L + TABLE.slotDepth - 1e-9) continue;
          const joined =
            walls.corners.some((c) => Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.r) < 1e-9) ||
            walls.posts.some((s) => Math.abs(Math.hypot(x - s.cx, y - s.cy) - s.r) < 1e-9);
          expect(joined, `${l.id} at inset ${inset}`).toBe(true);
        }
        // Normals are unit length and point into the field.
        expect(Math.hypot(l.nx, l.ny)).toBeCloseTo(1, 12);
      }
    }
  });

  it('keeps each mallet in its own half, short of the band a puck on the line fills', () => {
    const band = neutralBand(TABLE);
    expect(band).toBeGreaterThan(R);
    const near = malletArea(TABLE, 0);
    const far = malletArea(TABLE, 1);
    expect(near.y1 + M + band).toBeCloseTo(centreLine(TABLE), 12);
    expect(far.y0 - M - band).toBeCloseTo(centreLine(TABLE), 12);
    // A puck centred on the line cannot be touched by either mallet.
    for (const area of [near, far]) {
      const nearest = clampToArea(area, W / 2, centreLine(TABLE));
      expect(Math.abs(nearest.y - centreLine(TABLE))).toBeGreaterThan(R + M);
    }
  });

  it('clamps a mallet into its area, rounded corners and all', () => {
    const area = malletArea(TABLE, 0);
    for (const [x, y] of [
      [-1, -1],
      [W + 1, -1],
      [W / 2, L],
      [0.2, 0.3],
      [W + 1, L / 4],
    ] as const) {
      const p = clampToArea(area, x, y);
      expect(p.x).toBeGreaterThanOrEqual(area.x0 - 1e-12);
      expect(p.x).toBeLessThanOrEqual(area.x1 + 1e-12);
      expect(p.y).toBeGreaterThanOrEqual(area.y0 - 1e-12);
      expect(p.y).toBeLessThanOrEqual(area.y1 + 1e-12);
      // Never into the rails: at least the mallet's radius from every face.
      expect(distanceToWalls(boundary(TABLE, 0), p)).toBeGreaterThanOrEqual(M - 1e-9);
    }
    // A point inside stays where it is.
    expect(clampToArea(area, 0.4, 0.5)).toEqual({ x: 0.4, y: 0.5 });
  });

  it('serves and waits on the right halves, and scores only past the end rails', () => {
    for (const seat of [0, 1] as const) {
      expect(halfOf(TABLE, serveSpot(TABLE, seat).y)).toBe(seat);
      const home = malletHome(TABLE, seat);
      const area = malletArea(TABLE, seat);
      expect(clampToArea(area, home.x, home.y)).toEqual(home);
    }
    expect(goalReached(TABLE, 0)).toBeNull();
    expect(goalReached(TABLE, -R + 1e-6)).toBeNull();
    expect(goalReached(TABLE, -R - 1e-6)).toBe(0);
    expect(goalReached(TABLE, L + R + 1e-6)).toBe(1);
    expect(goalReached(TABLE, L / 2)).toBeNull();
  });
});
