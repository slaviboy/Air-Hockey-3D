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

// A match in time: a puck into a goal scores once, the mallets go home and the player scored on
// is served the puck; the match ends at its target; the same time played in any frames gives the
// same table; pausing stops time; the 7-second rule gives the puck away; a puck put right from
// the other device is drawn where it was, the jump fading.

import { describe, expect, it } from 'vitest';
import { Match, type MatchEvent, type MatchSetup } from '../../../src/game/Match.ts';
import { STEP } from '../../../src/physics/params.ts';
import { GOAL_PAUSE, POSSESSION_LIMIT } from '../../../src/rules/match.ts';
import { malletHome, serveSpot } from '../../../src/table/geometry.ts';
import { TABLE } from '../../../src/table/spec.ts';

const { W, L } = TABLE;
const setup: MatchSetup = { mode: 'local', target: 3, names: ['Ana', 'Ben'], firstServe: 0 };

/** A match with its events recorded and its mallets parked in corners, out of the puck's way. */
function match(terms: MatchSetup = setup) {
  const m = new Match(terms);
  const events: MatchEvent[] = [];
  m.onEvent = (e) => events.push(e);
  m.targets[0] = { x: 0.1, y: 0.12 };
  m.targets[1] = { x: W - 0.1, y: L - 0.12 };
  for (const seat of [0, 1] as const) Object.assign(m.world.mallets[seat], m.targets[seat]);
  return { m, events };
}

/** Plays `seconds` in frames of `frame` seconds. */
function play(m: Match, seconds: number, frame = 1 / 60) {
  for (let t = 0; t < seconds - 1e-9; t += frame) m.update(frame);
}

const shoot = (m: Match, x: number, y: number, vx: number, vy: number) =>
  Object.assign(m.world.puck, { x, y, vx, vy });

describe('a match in time', () => {
  it('scores a goal once, sends the mallets home, then serves to the player scored on', () => {
    const { m, events } = match();
    shoot(m, W / 2, 0.5, 0, -3);
    for (let i = 0; i < 60 && !events.some((e) => e.kind === 'scored'); i++) m.update(1 / 60);
    expect(events.filter((e) => e.kind === 'scored')).toEqual([{ kind: 'scored', scorer: 1 }]);
    expect(m.current).toMatchObject({ score: [0, 1], phase: 'goal', server: 0 });
    // Through the pause: one goal still, and the mallets home by its end.
    play(m, GOAL_PAUSE - 0.1);
    expect(m.current.phase).toBe('goal');
    for (const seat of [0, 1] as const) {
      const home = malletHome(TABLE, seat);
      const mallet = m.world.mallets[seat];
      expect(Math.hypot(mallet.x - home.x, mallet.y - home.y)).toBeLessThan(1e-6);
    }
    // Then the serve, to the player scored on.
    play(m, 0.2);
    expect(events.filter((e) => e.kind === 'scored')).toHaveLength(1);
    expect(events.filter((e) => e.kind === 'served')).toEqual([{ kind: 'served', seat: 0 }]);
    expect(m.current.phase).toBe('play');
    expect(m.world.puck).toMatchObject({ ...serveSpot(TABLE, 0), vx: 0, vy: 0 });
  });

  it('ends at the target, with one win, and plays no more goals', () => {
    const { m, events } = match();
    for (let goal = 0; goal < 3; goal++) {
      // Seat 1's mallet would be home after the pause: aim past it, into seat 1's goal.
      m.targets[1] = { x: W - 0.1, y: L - 0.12 };
      shoot(m, W / 2 + 0.06, L - 0.6, 0, 4);
      play(m, 0.5);
      play(m, GOAL_PAUSE + 0.1);
    }
    expect(m.current).toMatchObject({ score: [3, 0], phase: 'over', winner: 0 });
    expect(events.filter((e) => e.kind === 'won')).toEqual([{ kind: 'won', winner: 0 }]);
    expect(events.filter((e) => e.kind === 'scored')).toHaveLength(3);
  });

  it('plays the same at any frame rate', () => {
    const run = (frame: number) => {
      const { m } = match();
      shoot(m, 0.3, 0.9, 3.1, 2.2);
      m.targets[0] = { x: 0.6, y: 0.4 };
      play(m, 2, frame);
      // Whole steps only: the time left over waits for the next frame.
      const steps = Math.round(m.time / STEP);
      return { steps, puck: { ...m.world.puck } };
    };
    const a = run(1 / 60);
    const b = run(1 / 120);
    const c = run(1 / 30);
    expect(b.steps).toBe(a.steps);
    expect(c.steps).toBe(a.steps);
    expect(b.puck).toEqual(a.puck);
    expect(c.puck).toEqual(a.puck);
  });

  it('stands still while paused or held', () => {
    const { m } = match();
    shoot(m, W / 2, L / 2 + 0.2, 1, 1);
    m.paused = true;
    expect(m.update(0.5)).toBe(false);
    m.paused = false;
    m.held = true;
    play(m, 0.5);
    expect(m.time).toBe(0);
    expect(m.world.puck).toMatchObject({ x: W / 2, y: L / 2 + 0.2 });
  });

  it('gives the puck to the other player when one keeps it in their half too long', () => {
    const { m, events } = match();
    // The puck at rest in seat 0's half, out of the mallet's way.
    shoot(m, W / 2, L / 4, 0, 0);
    play(m, POSSESSION_LIMIT + 0.1);
    expect(events.filter((e) => e.kind === 'foul')).toEqual([{ kind: 'foul', holder: 0 }]);
    expect(m.current).toMatchObject({ phase: 'foul', server: 1, score: [0, 0] });
    play(m, 1.5);
    expect(m.current.phase).toBe('play');
    expect(m.world.puck).toMatchObject(serveSpot(TABLE, 1));
  });

  it('draws between steps: the puck between where it was and where it is', () => {
    const { m } = match();
    shoot(m, W / 2, L / 2 + 0.2, 2, 0);
    m.update(STEP * 2.5);
    const drawn = m.puckAt();
    expect(m.alpha).toBeCloseTo(0.5, 9);
    expect(drawn.x).toBeGreaterThan(m.previous.puck.x);
    expect(drawn.x).toBeLessThan(m.world.puck.x);
  });

  it('draws a puck put right from the other device where it was, the jump fading on the table', () => {
    const { m } = match();
    shoot(m, W / 2, L / 4, 0, 0);
    m.update(STEP * 1.5);
    const before = m.puckAt();
    // Reports, each with the puck somewhere else, faster than the jumps fade.
    for (const x of [0.2, 0.9, 0.3, 0.8, 0.25, 0.85]) {
      m.replay(0, { x, y: L / 4, vx: 0, vy: 0 }, []);
      const drawn = m.puckAt();
      expect(Math.hypot(drawn.x - before.x, drawn.y - before.y)).toBeLessThan(1e-9);
    }
    // A moment on, it is drawn where it is, never past the rails on the way.
    for (let i = 0; i < 30; i++) {
      m.update(1 / 60);
      const drawn = m.puckAt();
      expect(drawn.x).toBeGreaterThan(0);
      expect(drawn.x).toBeLessThan(W);
    }
    expect(Math.hypot(m.drawOffset.x, m.drawOffset.y)).toBeLessThan(0.001);
  });
});
