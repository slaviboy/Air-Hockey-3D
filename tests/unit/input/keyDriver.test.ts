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

// The keys on a mallet: up on the keyboard is up on the screen whichever way the view faces; a
// mallet stops where the keys leave it, and the pointer takes over from there.

import { describe, expect, it } from 'vitest';
import { Match } from '../../../src/game/Match.ts';
import { KeyDriver, type ScreenAxes } from '../../../src/input/KeyDriver.ts';
import { MALLET_KEYS } from '../../../src/input/shortcuts.ts';

const behindSeat0: ScreenAxes = { right: { x: 1, y: 0 }, up: { x: 0, y: 1 } };
const behindSeat1: ScreenAxes = { right: { x: -1, y: 0 }, up: { x: 0, y: -1 } };

function setup(axes: ScreenAxes, seat: 0 | 1 = 0) {
  const match = new Match({ mode: 'local', target: 7, names: ['A', 'B'], firstServe: 0 });
  const keys = new KeyDriver(MALLET_KEYS.wasd, () => axes);
  match.drivers[seat] = keys;
  return { match, keys, seat };
}

function hold(seconds: number, match: Match) {
  for (let t = 0; t < seconds; t += 1 / 60) match.update(1 / 60);
}

describe('a mallet on the keys', () => {
  it('goes up the screen on W, from either end of the table', () => {
    for (const [axes, seat, sign] of [
      [behindSeat0, 0, 1],
      [behindSeat1, 1, -1],
    ] as const) {
      const { match, keys } = setup(axes, seat);
      const before = match.world.mallets[seat].y;
      keys.press('w');
      hold(0.2, match);
      expect((match.world.mallets[seat].y - before) * sign).toBeGreaterThan(0.1);
    }
  });

  it('goes right on D and left on A', () => {
    const { match, keys } = setup(behindSeat0);
    const before = match.world.mallets[0].x;
    keys.press('d');
    hold(0.15, match);
    expect(match.world.mallets[0].x).toBeGreaterThan(before + 0.05);
    keys.release('d');
    keys.press('a');
    hold(0.4, match);
    expect(match.world.mallets[0].x).toBeLessThan(before);
  });

  it('stops where the keys leave it, and hands back to the pointer from there', () => {
    const { match, keys } = setup(behindSeat0);
    keys.press('w');
    hold(0.15, match);
    keys.release('w');
    hold(0.5, match);
    const m = match.world.mallets[0];
    expect(Math.hypot(m.vx, m.vy)).toBeLessThan(1e-6);
    expect(Math.hypot(match.targets[0].x - m.x, match.targets[0].y - m.y)).toBeLessThan(0.05);
    // Nothing held: the pointer's target drives it again.
    expect(keys.target(match, 0)).toBeNull();
  });

  it('only takes its own keys, and lets go of everything at once', () => {
    const { keys } = setup(behindSeat0);
    expect(keys.press('ArrowUp')).toBe(false);
    expect(keys.press('w')).toBe(true);
    expect(keys.active).toBe(true);
    keys.clear();
    expect(keys.active).toBe(false);
  });
});
