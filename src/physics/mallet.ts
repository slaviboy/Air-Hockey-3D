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

// How a mallet follows its player. The pointer, a finger, the keys or the computer say where the
// mallet should be; the mallet gets there as a hand would: no faster than its top speed, its
// velocity changing no faster than its acceleration, slowing in time to stop where it was sent,
// and never out of its own area. A pointer flicked across the table therefore swings the mallet
// hard but never teleports it, and the puck is struck at a speed a hand could give it.

import { clampToArea, type Area, type Point } from '../table/geometry.ts';
import type { Body } from './puck.ts';
import { STEP } from './params.ts';

export interface MalletLimits {
  /** Top speed, m/s. */
  readonly maxSpeed: number;
  /** The fastest the velocity may change, m/s². */
  readonly accel: number;
}

/**
 * Where a mallet at rest or moving at (vx, vy) gets to in one step toward `target`. The result
 * is the step's end point; the step itself works out the velocity from it.
 */
export function steer(
  mallet: Body,
  target: Point,
  area: Area,
  limits: MalletLimits,
  dt = STEP,
): Point {
  const goal = clampToArea(area, target.x, target.y);
  const dx = goal.x - mallet.x;
  const dy = goal.y - mallet.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  // The speed wanted: all the way this step if it is near, never more than the top speed, and no
  // more than lets it stop on the target, slowing by the most a step allows. Going at k such
  // decrements u = accel·dt covers dt·u·k(k+1)/2 before it stops, so k may be as large as that
  // keeps within the distance.
  let wantX = 0;
  let wantY = 0;
  if (distance > 0) {
    const u = limits.accel * dt;
    const stopping = (u / 2) * (Math.sqrt(1 + (8 * distance) / (u * dt)) - 1);
    const speed = Math.min(limits.maxSpeed, distance / dt, stopping);
    wantX = (dx / distance) * speed;
    wantY = (dy / distance) * speed;
  }
  // The velocity turns toward it no faster than the acceleration allows.
  let cx = wantX - mallet.vx;
  let cy = wantY - mallet.vy;
  const change = Math.sqrt(cx * cx + cy * cy);
  const most = limits.accel * dt;
  if (change > most) {
    cx *= most / change;
    cy *= most / change;
  }
  let vx = mallet.vx + cx;
  let vy = mallet.vy + cy;
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed > limits.maxSpeed) {
    vx *= limits.maxSpeed / speed;
    vy *= limits.maxSpeed / speed;
  }
  return clampToArea(area, mallet.x + vx * dt, mallet.y + vy * dt);
}
