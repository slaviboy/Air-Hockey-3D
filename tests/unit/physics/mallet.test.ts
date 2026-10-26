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

// A mallet follows its player as a hand would: never faster than its limit, never changing speed
// faster than its acceleration, never out of its half, and it stops where it was sent.

import { describe, expect, it } from 'vitest';
import { steer } from '../../../src/physics/mallet.ts';
import { PLAYER_MALLET, STEP } from '../../../src/physics/params.ts';
import type { Body } from '../../../src/physics/puck.ts';
import { clampToArea, malletArea } from '../../../src/table/geometry.ts';
import { TABLE } from '../../../src/table/spec.ts';

const area = malletArea(TABLE, 0);

/** Drives a mallet toward `target` for `steps` steps; returns each step's velocity. */
function drive(m: Body, target: { x: number; y: number }, steps: number) {
  const velocities: { vx: number; vy: number }[] = [];
  for (let i = 0; i < steps; i++) {
    const next = steer(m, target, area, PLAYER_MALLET);
    m.vx = (next.x - m.x) / STEP;
    m.vy = (next.y - m.y) / STEP;
    m.x = next.x;
    m.y = next.y;
    velocities.push({ vx: m.vx, vy: m.vy });
    expect(clampToArea(area, m.x, m.y)).toEqual({ x: m.x, y: m.y });
  }
  return velocities;
}

describe('steering a mallet', () => {
  it('never teleports: its speed and its change of speed stay within the limits', () => {
    const m = { x: 0.2, y: 0.2, vx: 0, vy: 0 };
    // The pointer jumps to the far corner and back, as a flick does.
    const v = [...drive(m, { x: 1, y: 1 }, 30), ...drive(m, { x: 0.1, y: 0.1 }, 60)];
    let previous = { vx: 0, vy: 0 };
    for (const u of v) {
      expect(Math.hypot(u.vx, u.vy)).toBeLessThanOrEqual(PLAYER_MALLET.maxSpeed + 1e-9);
      const change = Math.hypot(u.vx - previous.vx, u.vy - previous.vy) / STEP;
      expect(change).toBeLessThanOrEqual(PLAYER_MALLET.accel + 1e-6);
      previous = u;
    }
  });

  it('arrives and stops on a target it can reach, without passing it', () => {
    const m = { x: 0.3, y: 0.3, vx: 0, vy: 0 };
    const target = { x: 0.7, y: 0.5 };
    let nearest = Infinity;
    for (let i = 0; i < 240; i++) {
      drive(m, target, 1);
      const d = Math.hypot(m.x - target.x, m.y - target.y);
      // Distance only shrinks: no overshoot and no circling back.
      expect(d).toBeLessThanOrEqual(nearest + 1e-12);
      nearest = d;
    }
    expect(m.x).toBeCloseTo(target.x, 9);
    expect(m.y).toBeCloseTo(target.y, 9);
    expect(Math.hypot(m.vx, m.vy)).toBeLessThan(1e-6);
  });

  it('stays in its own half, short of the centre line, whatever it is sent toward', () => {
    const m = { x: TABLE.W / 2, y: 0.3, vx: 0, vy: 0 };
    drive(m, { x: TABLE.W / 2, y: TABLE.L }, 120);
    expect(m.y).toBeCloseTo(area.y1, 9);
    drive(m, { x: -5, y: -5 }, 240);
    expect(m.x).toBeGreaterThanOrEqual(TABLE.mallet.radius - 1e-12);
    expect(m.y).toBeGreaterThanOrEqual(TABLE.mallet.radius - 1e-12);
  });
});
