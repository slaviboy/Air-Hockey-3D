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

// The mallets' zones, a match's choice for both players: each mallet stops at its zone's front,
// the serve lies inside the server's reach, and a puck that stops where neither mallet may go is
// fetched: the player whose half it lies in may leave their zone to strike it, then goes back.

import { describe, expect, it } from 'vitest';
import { ComputerPlayer } from '../../../src/ai/ComputerPlayer.ts';
import { difficulty } from '../../../src/ai/difficulty.ts';
import { createRng } from '../../../src/core/rng.ts';
import { Match } from '../../../src/game/Match.ts';
import { STEP } from '../../../src/physics/params.ts';
import { FETCH_DELAY } from '../../../src/rules/match.ts';
import {
  centreLine,
  malletArea,
  neutralBand,
  REACH_IDS,
  REACHES,
  serveSpot,
  zoneFront,
  type Reach,
} from '../../../src/table/geometry.ts';
import { TABLE } from '../../../src/table/spec.ts';

const { L, W } = TABLE;
const M = TABLE.mallet.radius;
const R = TABLE.puck.radius;

const game = (reach: Reach) =>
  new Match({ mode: 'local', target: 7, names: ['A', 'B'], firstServe: 0, reach });

function play(match: Match, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 60) match.update(1 / 60);
}

describe('the mallets’ zones', () => {
  it('end where the match says, alike for both players, never past the band', () => {
    for (const reach of REACH_IDS) {
      const front = zoneFront(TABLE, reach);
      expect(front).toBeLessThanOrEqual(centreLine(TABLE) - neutralBand(TABLE) + 1e-12);
      if (reach !== 'half') expect(front).toBeCloseTo(REACHES[reach] * L, 12);
      const near = malletArea(TABLE, 0, reach);
      const far = malletArea(TABLE, 1, reach);
      expect(near.y1 + M).toBeCloseTo(front, 12);
      expect(L - (far.y0 - M)).toBeCloseTo(front, 12);
      // The server reaches the puck on its spot, with room to spare.
      for (const seat of [0, 1] as const) {
        const spot = serveSpot(TABLE, seat, reach);
        const fromEnd = seat === 0 ? spot.y : L - spot.y;
        expect(fromEnd + R).toBeLessThan(front + R);
        expect(fromEnd).toBeGreaterThan(M * 2);
      }
    }
  });

  it('keep each mallet in its zone however far it is sent', () => {
    for (const reach of REACH_IDS) {
      const match = game(reach);
      match.targets[0] = { x: W / 2, y: L };
      match.targets[1] = { x: W / 2, y: 0 };
      play(match, 1.5);
      const front = zoneFront(TABLE, reach);
      expect(match.world.mallets[0].y + M).toBeCloseTo(front, 6);
      expect(L - (match.world.mallets[1].y - M)).toBeCloseTo(front, 6);
    }
  });

  it('let the player whose half a stranded puck lies in fetch it, then go back', () => {
    for (const [seat, y] of [
      [0, L * 0.42],
      [1, L * 0.6],
    ] as const) {
      const match = game('quarter');
      Object.assign(match.world.puck, { x: W / 2, y, vx: 0, vy: 0 });
      const zone = { ...match.world.areas[seat] };
      // Not at once: the puck must lie there a moment.
      for (let t = 0; t < FETCH_DELAY - 0.1; t += STEP) match.stepOnce();
      expect(match.fetching).toBeNull();
      for (let t = 0; t < 0.2; t += STEP) match.stepOnce();
      expect(match.fetching).toBe(seat);
      // The way is open to the centre line, for that player only.
      expect(match.world.areas[seat]).toEqual(malletArea(TABLE, seat));
      expect(match.world.areas[seat === 0 ? 1 : 0]).toEqual(
        malletArea(TABLE, seat === 0 ? 1 : 0, 'quarter'),
      );
      // The player goes and strikes it, up the table.
      match.targets[seat] = { x: W / 2, y: seat === 0 ? L / 2 : L / 2 };
      let struck = false;
      for (let t = 0; t < 2 && !struck; t += STEP) {
        match.stepOnce();
        struck = Math.abs(match.world.puck.vy) > 0.5;
      }
      expect(struck, `seat ${seat}`).toBe(true);
      // The next step sees the puck struck: the zone holds again.
      match.stepOnce();
      expect(match.fetching).toBeNull();
      expect(match.world.areas[seat]).toEqual(zone);
      // The mallet glides back into its zone, at a hand's speed, not at once.
      match.targets[seat] = { x: W / 2, y: seat === 0 ? 0.2 : L - 0.2 };
      play(match, 1);
      const m = match.world.mallets[seat];
      expect(m.y).toBeGreaterThanOrEqual(zone.y0 - 1e-9);
      expect(m.y).toBeLessThanOrEqual(zone.y1 + 1e-9);
    }
  });

  it('never leave a puck sliding along the centre line out of everyone’s reach', () => {
    const touch = M + R;
    for (const reach of REACH_IDS) {
      for (const [vx, dy] of [
        [0.5, 0.001],
        [1.5, 0.0005],
        [0.2, 0],
        [-0.8, -0.001],
      ] as const) {
        const match = game(reach);
        // Both players stay at home, by their own goals.
        match.targets[0] = { x: 0.1, y: 0.1 };
        match.targets[1] = { x: 0.1, y: L - 0.1 };
        Object.assign(match.world.puck, { x: W / 2, y: L / 2 + dy, vx, vy: 0 });
        let reached = false;
        for (let t = 0; t < 0.7 && !reached; t += STEP) {
          match.stepOnce();
          const p = match.world.puck;
          // Within reach of a mallet, in its zone or in the half it may fetch from.
          reached =
            p.y <= match.world.areas[0].y1 + touch || p.y >= match.world.areas[1].y0 - touch;
        }
        expect(reached, `${reach}, sliding at ${vx} m/s`).toBe(true);
      }
    }
  });

  it('leave the computer playing in the smallest zone', () => {
    const match = game('quarter');
    match.drivers[1] = new ComputerPlayer(difficulty('hard'), createRng(3));
    match.targets[0] = { x: 0.08, y: 0.08 };
    Object.assign(match.world.puck, { x: W / 2, y: L - 0.4, vx: 0, vy: 0 });
    let crossed = false;
    for (let i = 0; i < 6 * 60 && !crossed; i++) {
      match.update(1 / 60);
      crossed = match.world.puck.y < L / 2;
      expect(match.world.goal).not.toBe(1);
    }
    expect(crossed).toBe(true);
    const front = zoneFront(TABLE, 'quarter');
    expect(L - (match.world.mallets[1].y - M)).toBeLessThanOrEqual(front + 1e-9);
  });
});
