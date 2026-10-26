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

// The puck: bounces off rails, corners and posts as specified; takes the mallet's momentum; never
// passes through anything at the speed limit; is never trapped; slows on the air; scores only
// through a slot, once.

import { describe, expect, it } from 'vitest';
import { steer } from '../../../src/physics/mallet.ts';
import {
  MALLET_RESTITUTION,
  MAX_PUCK_SPEED,
  PLAYER_MALLET,
  RAIL_FRICTION,
  RAIL_RESTITUTION,
  STEP,
  STOP_SPEED,
} from '../../../src/physics/params.ts';
import {
  bounce,
  coast,
  createWorld,
  pushInside,
  step,
  type Body,
  type PhysicsEvent,
  type World,
} from '../../../src/physics/puck.ts';
import { exp } from '../../../src/physics/dmath.ts';
import { goalMouth, type Point } from '../../../src/table/geometry.ts';
import { TABLE } from '../../../src/table/spec.ts';

const { W, L } = TABLE;
const R = TABLE.puck.radius;
const M = TABLE.mallet.radius;

/**
 * A world with the puck at (x, y) moving at (vx, vy) and the mallets parked out of the way, in a
 * corner of their halves.
 */
function world(x: number, y: number, vx = 0, vy = 0): World {
  const w = createWorld(TABLE);
  Object.assign(w.puck, { x, y, vx, vy });
  Object.assign(w.mallets[0], { x: 0.1, y: 0.12 });
  Object.assign(w.mallets[1], { x: W - 0.1, y: L - 0.12 });
  return w;
}

const parked = (w: World): [Point, Point] => [
  { x: w.mallets[0].x, y: w.mallets[0].y },
  { x: w.mallets[1].x, y: w.mallets[1].y },
];

/**
 * Runs `seconds`, the mallets steered each step toward where `targets` says, as the game steers
 * them (or sent exactly there, `exact`, for a mallet at a set speed); returns every event.
 */
function run(
  w: World,
  seconds: number,
  targets: (w: World) => [Point, Point] = parked,
  each?: (w: World) => void,
  exact = false,
): PhysicsEvent[] {
  const events: PhysicsEvent[] = [];
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) {
    const [a, b] = targets(w);
    const to: [Point, Point] = exact
      ? [a, b]
      : [
          steer(w.mallets[0], a, w.areas[0], PLAYER_MALLET),
          steer(w.mallets[1], b, w.areas[1], PLAYER_MALLET),
        ];
    events.push(...step(w, to));
    each?.(w);
  }
  return events;
}

const speed = (b: Body) => Math.hypot(b.vx, b.vy);

/** Whether the puck's centre is where the walls allow (or gone into a goal). */
function legal(w: World): boolean {
  if (w.goal !== null) return true;
  const p = pushInside(w.walls, w.puck.x, w.puck.y);
  return Math.hypot(p.x - w.puck.x, p.y - w.puck.y) < 1e-9;
}

describe('bouncing', () => {
  it('keeps the restitution of the speed across the rail, and loses a little along it', () => {
    const puck = { x: 0, y: 0, vx: -2, vy: 1 };
    const closing = bounce(puck, 1, 0, 0, 0, RAIL_RESTITUTION, RAIL_FRICTION);
    expect(closing).toBe(2);
    expect(puck.vx).toBeCloseTo(2 * RAIL_RESTITUTION, 12);
    expect(puck.vy).toBeCloseTo(1 - RAIL_FRICTION * (1 + RAIL_RESTITUTION) * 2, 12);
  });

  it('bounces off a side rail in the simulation as the restitution says', () => {
    const w = world(0.3, L / 4, -2, 0);
    let before = 0;
    let after = 0;
    for (let i = 0; i < 240; i++) {
      const v = w.puck.vx;
      const events = step(w, parked(w));
      if (events.some((e) => e.kind === 'rail')) {
        before = v;
        after = w.puck.vx;
        break;
      }
    }
    expect(before).toBeLessThan(0);
    // The step's drag acts on the speed after the bounce.
    expect(after / -before).toBeCloseTo(RAIL_RESTITUTION * exp(-0.12 * STEP), 9);
    expect(w.puck.vy).toBe(0);
    expect(w.puck.x).toBeGreaterThanOrEqual(R);
  });

  it('turns back from a corner and from a slot post, staying inside', () => {
    for (const [x, y, vx, vy] of [
      [0.3, 0.5, -3, -3],
      [W - 0.3, L - 0.5, 3, 3],
      [goalMouth(TABLE).x0 - 0.05, 0.4, 0, -4],
    ] as const) {
      const w = world(x, y, vx, vy);
      const events = run(w, 0.5, parked, (s) => expect(legal(s)).toBe(true));
      expect(events.some((e) => e.kind === 'rail' || e.kind === 'post')).toBe(true);
      expect(w.goal).toBeNull();
    }
    // Into the post's rounded edge, not the rail: the post answers.
    const w = world(goalMouth(TABLE).x0, 0.3, 0, -3);
    expect(run(w, 0.3).some((e) => e.kind === 'post')).toBe(true);
  });
});

describe('the speed limit and tunnelling', () => {
  it('never lets the puck through a wall, in any direction, at the top speed', () => {
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * 2 * Math.PI + 0.013;
      const w = world(
        W / 2,
        L / 2 + 0.1,
        Math.cos(a) * MAX_PUCK_SPEED,
        Math.sin(a) * MAX_PUCK_SPEED,
      );
      run(w, 3, parked, (s) => {
        expect(legal(s), `direction ${k}`).toBe(true);
        expect(speed(s.puck)).toBeLessThanOrEqual(MAX_PUCK_SPEED + 1e-9);
      });
    }
  });

  it('caps a puck struck hard, still leaving the mallet', () => {
    const w = world(W / 2, 0.6, 0, -MAX_PUCK_SPEED);
    const m = w.mallets[0];
    Object.assign(m, { x: W / 2, y: 0.4 });
    let struck = false;
    run(
      w,
      0.2,
      (s) => [
        { x: W / 2, y: Math.min(s.mallets[0].y + 5 * STEP, s.areas[0].y1) },
        { x: s.mallets[1].x, y: s.mallets[1].y },
      ],
      (s) => {
        expect(speed(s.puck)).toBeLessThanOrEqual(MAX_PUCK_SPEED + 1e-9);
        if (s.puck.vy > 0) struck = true;
        expect(Math.hypot(s.puck.x - s.mallets[0].x, s.puck.y - s.mallets[0].y)).toBeGreaterThan(
          R + M - 1e-6,
        );
      },
      true,
    );
    expect(struck).toBe(true);
  });
});

describe('mallet hits', () => {
  it('gives a resting puck the mallet’s momentum: (1 + e) times its speed', () => {
    const w = world(W / 2, 0.5);
    Object.assign(w.mallets[0], { x: W / 2, y: 0.5 - R - M - 0.02, vx: 0, vy: 3 });
    const hits: PhysicsEvent[] = [];
    for (let i = 0; i < 24 && !hits.length; i++) {
      const m = w.mallets[0];
      hits.push(
        ...step(w, [
          { x: m.x, y: m.y + 3 * STEP },
          { x: w.mallets[1].x, y: w.mallets[1].y },
        ]).filter((e) => e.kind === 'mallet'),
      );
    }
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: 'mallet', seat: 0 });
    expect(w.puck.vx).toBeCloseTo(0, 12);
    expect(w.puck.vy).toBeCloseTo((1 + MALLET_RESTITUTION) * 3 * exp(-0.12 * STEP), 6);
  });

  it('sends a puck back off a mallet at rest with the restitution of its speed', () => {
    const w = world(W / 2, 0.6, 0, -2);
    Object.assign(w.mallets[0], { x: W / 2, y: 0.35 });
    run(w, 0.3);
    expect(w.puck.vy).toBeGreaterThan(0);
    // The air's drag over the whole run, before the hit and after it.
    expect(w.puck.vy).toBeCloseTo(2 * MALLET_RESTITUTION * exp(-0.12 * 0.3), 9);
  });

  it('turns the puck by the angle of the contact', () => {
    // Struck off-centre, the puck leaves along the line between the centres.
    const w = world(W / 2 + 0.03, 0.5);
    Object.assign(w.mallets[0], { x: W / 2, y: 0.5 - R - M - 0.01, vx: 0, vy: 2 });
    run(
      w,
      0.1,
      (s) => [
        { x: W / 2, y: s.mallets[0].y + 2 * STEP },
        { x: s.mallets[1].x, y: s.mallets[1].y },
      ],
      undefined,
      true,
    );
    expect(w.puck.vx).toBeGreaterThan(0);
    expect(w.puck.vy).toBeGreaterThan(0);
  });

  it('is not trapped between a mallet and a rail: the mallet gives way, nothing shakes', () => {
    const w = world(R, L / 4);
    Object.assign(w.mallets[0], { x: 0.4, y: L / 4 });
    const xs: number[] = [];
    const events = run(
      w,
      1,
      (s) => [
        { x: 0, y: L / 4 },
        { x: s.mallets[1].x, y: s.mallets[1].y },
      ],
      (s) => {
        expect(legal(s)).toBe(true);
        const gap = Math.hypot(s.puck.x - s.mallets[0].x, s.puck.y - s.mallets[0].y);
        expect(gap).toBeGreaterThan(R + M - 1e-6);
        xs.push(s.puck.x);
      },
    );
    // Pinned still against the rail, at rest there, not vibrating, and silent once settled.
    const last = xs.slice(-60);
    expect(Math.max(...last) - Math.min(...last)).toBeLessThan(1e-4);
    expect(w.puck.x).toBeLessThan(R + 0.002);
    expect(Math.hypot(w.puck.vx, w.puck.vy)).toBeLessThan(1e-9);
    const settled = run(w, 0.5, (s) => [
      { x: 0, y: L / 4 },
      { x: s.mallets[1].x, y: s.mallets[1].y },
    ]);
    expect(settled).toEqual([]);
    expect(events.length).toBeLessThan(40);
  });
});

describe('the air and the centre line', () => {
  it('slows the puck by the drag alone in open play', () => {
    const w = world(W / 2, L / 2 + 0.3, 1, 0);
    const events = run(w, 0.4);
    expect(events).toEqual([]);
    expect(speed(w.puck)).toBeCloseTo(exp(-0.12 * 0.4), 9);
  });

  it('brings a slow puck to rest', () => {
    const w = world(W / 2, L / 4, STOP_SPEED * 1.01, 0);
    run(w, 1);
    expect(speed(w.puck)).toBe(0);
  });

  it('lets a puck at rest on the centre line slide off it, into reach', () => {
    const w = world(W / 2, L / 2);
    run(w, 1);
    expect(w.puck.y - L / 2).toBeGreaterThan(0.012);
    const low = world(W / 2, L / 2 - 1e-4);
    run(low, 1);
    expect(low.puck.y - L / 2).toBeLessThan(-0.012);
  });
});

describe('goals', () => {
  it('scores once when the puck goes through a slot, and the puck then stays there', () => {
    const w = world(W / 2, 0.4, 0, -3);
    const events = run(w, 1);
    expect(events.filter((e) => e.kind === 'goal')).toEqual([{ kind: 'goal', seat: 0 }]);
    expect(w.goal).toBe(0);
    const resting = { ...w.puck };
    expect(run(w, 0.5).filter((e) => e.kind === 'goal')).toEqual([]);
    expect(w.puck.x).toBe(resting.x);
    expect(w.puck.y).toBe(resting.y);
  });

  it('scores at the other end for seat 1’s goal, and never off a rail beside the slot', () => {
    const w = world(W / 2 - 0.02, L - 0.5, 0, 4);
    expect(run(w, 1).filter((e) => e.kind === 'goal')).toEqual([{ kind: 'goal', seat: 1 }]);
    const beside = world(goalMouth(TABLE).x0 - 0.06, 0.5, 0, -4);
    expect(run(beside, 1).filter((e) => e.kind === 'goal')).toEqual([]);
  });
});

describe('determinism and prediction', () => {
  it('gives the same bits from the same start', () => {
    const play = () => {
      const w = world(0.31, 0.77, 4.2, -3.1);
      run(w, 2, (s) => [
        { x: 0.5 + 0.2 * Math.sin(s.puck.y * 7), y: 0.3 },
        { x: s.mallets[1].x, y: s.mallets[1].y },
      ]);
      return [w.puck.x, w.puck.y, w.puck.vx, w.puck.vy];
    };
    expect(play()).toEqual(play());
  });

  it('coasts a copy, leaving the world as it was', () => {
    const w = world(W / 2, L / 2 + 0.2, 1.5, 2);
    // Coasting passes the mallets by, so the run it is compared with does too.
    w.solid[0] = false;
    w.solid[1] = false;
    const before = structuredClone(w.puck);
    const seen: number[] = [];
    const end = coast(w, 0.5, (_, t) => seen.push(t));
    expect(w.puck).toEqual(before);
    expect(seen.length).toBe(120);
    run(w, 0.5);
    expect(end.x).toBeCloseTo(w.puck.x, 12);
    expect(end.y).toBeCloseTo(w.puck.y, 12);
  });
});
