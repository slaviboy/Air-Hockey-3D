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

// The computer's play, headless: a stronger level saves more of the same shots; each level takes a
// puck resting in its half up the table without scoring in its own goal; it settles when there is
// nothing to do; it keeps to its level's limits; and a seeded game plays the same every time.

import { describe, expect, it } from 'vitest';
import { ComputerPlayer } from '../../../src/ai/ComputerPlayer.ts';
import { DIFFICULTIES, difficulty, type DifficultyId } from '../../../src/ai/difficulty.ts';
import { createRng, range } from '../../../src/core/rng.ts';
import { Match } from '../../../src/game/Match.ts';
import { STEP } from '../../../src/physics/params.ts';
import type { Seat } from '../../../src/rules/types.ts';
import { goalMouth } from '../../../src/table/geometry.ts';
import { TABLE } from '../../../src/table/spec.ts';

const { W, L } = TABLE;

/** A match with the computer at `seat` and the other mallet parked in a corner. */
function game(level: DifficultyId, seat: Seat = 1, seed = 7) {
  const match = new Match({ mode: 'computer', target: 99, names: ['A', 'B'], firstServe: 0 });
  const computer = new ComputerPlayer(difficulty(level), createRng(seed));
  match.drivers[seat] = computer;
  const other = seat === 0 ? 1 : 0;
  match.targets[other] = other === 0 ? { x: 0.08, y: 0.08 } : { x: W - 0.08, y: L - 0.08 };
  Object.assign(match.world.mallets[other], match.targets[other]);
  return { match, computer };
}

function run(match: Match, seconds: number, each?: () => boolean | void) {
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    match.stepOnce();
    if (each?.()) return;
  }
}

/**
 * The same shots for every level: from seat 0's half at seat 1's goal mouth, every other one
 * banked off a side rail (aimed at the mouth's image across it).
 */
function shots(count: number) {
  const rng = createRng(2024);
  const { x0, x1 } = goalMouth(TABLE);
  const r = TABLE.puck.radius;
  return Array.from({ length: count }, (_, i) => {
    const from = { x: range(rng, 0.2, W - 0.2), y: range(rng, 0.45, L / 2 - 0.1) };
    let to = { x: range(rng, x0 + 0.02, x1 - 0.02), y: L };
    if (i % 2 === 1) {
      const wall = rng() < 0.5 ? r : W - r;
      to = { x: 2 * wall - to.x, y: L };
    }
    const speed = range(rng, 2.5, 5.5);
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    return { ...from, vx: ((to.x - from.x) / d) * speed, vy: ((to.y - from.y) / d) * speed };
  });
}

/** Goals the computer at seat 1 lets in from these shots. */
function conceded(level: DifficultyId, set: ReturnType<typeof shots>): number {
  let goals = 0;
  for (const shot of set) {
    const { match } = game(level);
    Object.assign(match.world.puck, shot);
    run(match, 2.5, () => match.world.goal !== null);
    if (match.world.goal === 1) goals++;
  }
  return goals;
}

describe('the computer', () => {
  it('saves more of the same shots the stronger it is', () => {
    const set = shots(60);
    const easy = conceded('easy', set);
    const medium = conceded('medium', set);
    const hard = conceded('hard', set);
    expect(hard).toBeLessThan(medium);
    expect(medium).toBeLessThan(easy);
    // Easy is beatable from afar; Hard lets in few of these long shots.
    expect(easy).toBeGreaterThan(set.length * 0.15);
    expect(hard).toBeLessThan(set.length * 0.1);
  });

  it.each(DIFFICULTIES.map((d) => d.id))(
    'at %s, takes a resting puck up the table, never into its own goal',
    (level) => {
      for (const [x, y] of [
        [W / 2, L * 0.75],
        [0.25, L * 0.8],
        [W - 0.2, L - 0.25],
        [W / 2, L - 0.2],
      ] as const) {
        const { match } = game(level);
        Object.assign(match.world.puck, { x, y, vx: 0, vy: 0 });
        let crossed = false;
        run(match, 5, () => {
          if (match.world.goal === 1) throw new Error(`own goal from (${x}, ${y})`);
          crossed = match.world.puck.y < L / 2;
          return crossed;
        });
        expect(crossed, `from (${x}, ${y})`).toBe(true);
      }
    },
  );

  it('settles when there is nothing to do, without twitching', () => {
    const { match } = game('hard');
    Object.assign(match.world.puck, { x: W / 2, y: 0.4, vx: 0, vy: 0 });
    run(match, 1.5);
    const m = match.world.mallets[1];
    expect(Math.hypot(m.vx, m.vy)).toBeLessThan(0.05);
  });

  it('keeps to its level’s limits and to its own half', () => {
    for (const level of DIFFICULTIES) {
      const { match } = game(level.id);
      const limit = Math.max(level.maxSpeed, level.strike);
      for (const shot of shots(6)) {
        Object.assign(match.world.puck, shot);
        match.world.live = true;
        match.world.goal = null;
        run(match, 2, () => {
          const m = match.world.mallets[1];
          expect(Math.hypot(m.vx, m.vy)).toBeLessThanOrEqual(limit + 1e-6);
          expect(m.y).toBeGreaterThan(L / 2);
        });
      }
    }
  });

  it('plays a seeded game the same every time', () => {
    const play = () => {
      const { match } = game('medium', 1, 99);
      Object.assign(match.world.puck, shots(1)[0]!);
      run(match, 3);
      const { x, y } = match.world.puck;
      return [x, y, match.world.mallets[1].x, match.world.mallets[1].y];
    };
    expect(play()).toEqual(play());
  });

  it('plays from either end', () => {
    const { match } = game('medium', 0);
    Object.assign(match.world.puck, { x: W / 2, y: L * 0.25, vx: 0, vy: 0 });
    let crossed = false;
    run(match, 5, () => {
      if (match.world.goal === 0) throw new Error('own goal');
      crossed = match.world.puck.y > L / 2;
      return crossed;
    });
    expect(crossed).toBe(true);
  });
});
