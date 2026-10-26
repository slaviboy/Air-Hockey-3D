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

// The computer's mallet (docs/ai.md). It plays with a hand's limits: it
// sees the puck as it was a reaction time ago, it moves no faster than its level allows, and it
// commits to a plan for a moment before it changes its mind, so it neither twitches nor reacts
// instantly. Each decision picks one of these plans:
//
//   home       the puck is going away or in the other half: wait in front of the goal, shadowing
//              the puck across the width.
//   defend     the puck is coming and cannot be met in time: stand between it and the goal.
//   intercept  the puck is coming and can be met: be where it will be, and strike it on.
//   attack     the puck is slow in this half: line up behind it and strike it at the other goal,
//              or bank it off a side rail when the other mallet blocks the straight line.
//   clear      the puck is behind the mallet: go round it first, never pushing it back.
//
// It reasons as if it were seat 0, defending y = 0, and turns the table round for seat 1. Its
// predictions run the real simulation forward (coast), so it reads the bounces as they will happen;
// its errors (where it expects the puck, where it aims) are drawn from a seeded generator once per
// decision, so a test plays the same match each time.

import { createRng, range, type Rng } from '../core/rng.ts';
import type { Driver, Match } from '../game/Match.ts';
import { coast, type Body, type World } from '../physics/puck.ts';
import type { Seat } from '../rules/types.ts';
import { centreLine, clampToArea, malletHome, neutralBand, type Point } from '../table/geometry.ts';
import type { TableSpec } from '../table/spec.ts';
import type { Difficulty } from './difficulty.ts';

export type Plan = 'home' | 'defend' | 'intercept' | 'attack' | 'clear';

/** A plan holds at least this long before another decision (unless the puck turns about). */
const HOLD = 0.15;
/** How often the computer reconsiders while a plan holds, seconds. */
const RETHINK = 0.1;
/** Seconds of the puck's past it keeps for its delayed view. */
const MEMORY = 1;
/** Slower than this (m/s) the puck is there to be taken. */
const SLOW = 0.6;
/** How far the defending mallet stands out from the goal's centre, metres. */
const GUARD = 0.2;

interface Seen {
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export class ComputerPlayer implements Driver {
  plan: Plan = 'home';
  private readonly history: Seen[] = [];
  private since = 0;
  private decidedAt = -Infinity;
  /** Where the plan wants the puck met, and where the shot goes (this side's frame). */
  private meet: Point | null = null;
  private aim: Point = { x: 0, y: 0 };
  private striking = false;
  /** The puck's velocity when the plan was made, to notice it turning (about, or off a rail). */
  private heading = { x: 0, y: 0 };
  private noise: Point = { x: 0, y: 0 };

  constructor(
    readonly level: Difficulty,
    private readonly rng: Rng = createRng(0x5eed),
  ) {}

  /** Forgets what it saw (a new match or serve). */
  reset(): void {
    this.history.length = 0;
    this.plan = 'home';
    this.meet = null;
    this.striking = false;
    this.decidedAt = -Infinity;
  }

  target(match: Match, seat: Seat, dt: number): Point {
    const spec = match.spec;
    const now = match.time;
    const flip = (p: Point): Point => (seat === 0 ? p : { x: p.x, y: spec.L - p.y });
    const puck = this.mirrorBody(match.world.puck, seat, spec);
    this.remember(now, puck);
    const mallet = flip(match.world.mallets[seat]);
    const area = this.area(spec);
    match.limits[seat] = {
      maxSpeed: this.striking
        ? Math.max(this.level.strike, this.level.maxSpeed)
        : this.level.maxSpeed,
      accel: this.level.accel,
    };
    if (!match.world.live || match.waiting) {
      this.reset();
      return flip(malletHome(spec, 0));
    }
    const seen = this.perceive(now - this.level.reaction) ?? { t: now, ...puck };
    this.since += dt;
    // Turned since the plan was made: about, or off a rail by more than 25 degrees.
    const speed = Math.hypot(seen.vx, seen.vy);
    const was = Math.hypot(this.heading.x, this.heading.y);
    const turned =
      speed > 0.4 &&
      was > 0.4 &&
      (seen.vx * this.heading.x + seen.vy * this.heading.y) / (speed * was) < 0.9;
    if (now - this.decidedAt >= RETHINK && (this.since >= HOLD || turned || this.plan === 'home')) {
      this.decide(match, seat, seen, mallet);
    }
    const want = this.follow(spec, seen, mallet);
    const p = clampToArea(area, want.x, want.y);
    return flip(p);
  }

  /** The puck as this side sees the table: its own goal at y = 0. */
  private mirrorBody(b: Body, seat: Seat, spec: TableSpec): Body {
    return seat === 0 ? { ...b } : { x: b.x, y: spec.L - b.y, vx: b.vx, vy: -b.vy };
  }

  /** Where this side's mallet may go, in its own frame. */
  private area(spec: TableSpec) {
    const m = spec.mallet.radius;
    return {
      x0: m,
      x1: spec.W - m,
      y0: m,
      y1: centreLine(spec) - neutralBand(spec) - m,
      r: Math.max(0, spec.cornerRadius - m),
    };
  }

  private remember(t: number, puck: Body): void {
    this.history.push({ t, x: puck.x, y: puck.y, vx: puck.vx, vy: puck.vy });
    while (this.history.length > 2 && this.history[0]!.t < t - MEMORY) this.history.shift();
  }

  /** The puck as it was at time t (between the two remembered steps around it). */
  private perceive(t: number): Seen | null {
    const h = this.history;
    if (h.length === 0) return null;
    if (t <= h[0]!.t) return h[0]!;
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1]!;
      const b = h[i]!;
      if (a.t <= t && t <= b.t) {
        const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
        return {
          t,
          x: a.x + (b.x - a.x) * k,
          y: a.y + (b.y - a.y) * k,
          vx: a.vx + (b.vx - a.vx) * k,
          vy: a.vy + (b.vy - a.vy) * k,
        };
      }
    }
    return h[h.length - 1]!;
  }

  /** The path the puck will take from what was seen, with how long it takes to each point. */
  private predict(match: Match, seat: Seat, seen: Seen): { t: number; x: number; y: number }[] {
    const spec = match.spec;
    // The puck as it is now, by the computer's guess: what it saw, carried on by its delay.
    const real = seat === 0 ? seen : { ...seen, y: spec.L - seen.y, vy: -seen.vy };
    const world: World = {
      ...match.world,
      puck: { x: real.x, y: real.y, vx: real.vx, vy: real.vy },
    };
    const path: { t: number; x: number; y: number }[] = [];
    const ahead = match.time - seen.t;
    coast(world, ahead + this.level.lookahead, (p, t) => {
      if (t < ahead) return;
      const y = seat === 0 ? p.y : spec.L - p.y;
      path.push({ t: t - ahead, x: p.x, y });
    });
    return path;
  }

  private decide(match: Match, seat: Seat, seen: Seen, mallet: Point): void {
    const spec = match.spec;
    const level = this.level;
    const R = spec.puck.radius;
    const M = spec.mallet.radius;
    const area = this.area(spec);
    const speed = Math.hypot(seen.vx, seen.vy);
    const before = this.plan;
    this.decidedAt = match.time;
    this.heading = { x: seen.vx, y: seen.vy };
    this.noise = {
      x: range(this.rng, -1, 1) * level.predictionNoise,
      y: range(this.rng, -1, 1) * level.predictionNoise,
    };
    const ownHalf = seen.y < centreLine(spec);
    const other = seat === 0 ? match.world.mallets[1] : match.world.mallets[0];
    const opponent = seat === 0 ? other : { x: other.x, y: spec.L - other.y };
    this.aim = this.chooseAim(spec, seen, opponent);

    const coming = seen.vy < -0.15 && speed > SLOW;
    const leaving = seen.vy > 0.8;
    if (ownHalf && !coming && !leaving) {
      // In this half and not bearing down on the goal: go and take it, where it will be by the
      // time the mallet gets there. Behind the mallet (between it and the goal), round it first.
      this.plan = seen.y < mallet.y - M * 0.5 ? 'clear' : 'attack';
      const path = speed < 0.05 ? [] : this.predict(match, seat, seen);
      const reach = Math.hypot(seen.x - mallet.x, seen.y - mallet.y);
      const by = Math.min(0.5, reach / (0.7 * level.maxSpeed));
      const ahead = path.find((p) => p.t >= by) ?? path.at(-1);
      this.meet =
        ahead && ahead.y < area.y1 + R ? { x: ahead.x, y: ahead.y } : { x: seen.x, y: seen.y };
      this.aim = this.chooseAim(spec, this.meet, opponent);
    } else if (seen.vy < -0.15) {
      // Coming this way: meet it where the mallet can be first, or guard the goal.
      const path = this.predict(match, seat, seen);
      // Where the mallet can be first: the first such point within its own end (by then the puck
      // has made its bounces and runs straight), or else the first anywhere.
      let meet: Point | null = null;
      let first: Point | null = null;
      for (const p of path) {
        if (p.y > area.y1 || p.y < area.y0 + 0.08) continue;
        const reach = Math.hypot(p.x - mallet.x, p.y - R - M - mallet.y);
        // How far the mallet gets by then, starting from rest at its level's acceleration.
        const t = p.t;
        const vmax = level.maxSpeed;
        const tAccel = vmax / level.accel;
        const can =
          t <= tAccel ? 0.5 * level.accel * t * t : 0.5 * vmax * tAccel + vmax * (t - tAccel);
        if (can < reach) continue;
        first ??= { x: p.x, y: p.y };
        if (p.y < level.depth + 0.3) {
          meet = { x: p.x, y: p.y };
          break;
        }
      }
      meet ??= first;
      // A bolder player goes out to meet it; a careful one only when it must.
      const bold = this.rng() < level.aggression || (meet !== null && meet.y < 0.4);
      if (meet && bold) {
        this.plan = 'intercept';
        this.meet = meet;
      } else {
        this.plan = 'defend';
        const cross = path.find((p) => p.y < GUARD + R) ?? path.at(-1);
        this.meet = cross ? { x: cross.x, y: cross.y } : { x: seen.x, y: seen.y };
      }
    } else {
      this.plan = 'home';
    }
    if (this.plan !== before) {
      this.since = 0;
      this.striking = false;
    }
  }

  /**
   * Where the shot goes: the other goal's middle, or, for a level that banks, its image across a
   * side rail when the other mallet stands in the straight line; off by the level's aim error.
   */
  private chooseAim(spec: TableSpec, seen: Point, opponent: Point): Point {
    const goal = { x: spec.W / 2, y: spec.L + spec.puck.radius };
    let target = goal;
    if (this.level.banks) {
      const blocked =
        distanceToSegment(opponent, seen, goal) < spec.puck.radius + spec.mallet.radius + 0.02;
      if (blocked) {
        // Off the rail on the side the puck is nearer: the goal's mirror image across it.
        const r = spec.puck.radius;
        const wall = seen.x < spec.W / 2 ? r : spec.W - r;
        target = { x: 2 * wall - goal.x, y: goal.y };
      }
    }
    const angle = Math.atan2(target.y - seen.y, target.x - seen.x);
    const off = range(this.rng, -1, 1) * this.level.aimError;
    const d = Math.hypot(target.x - seen.x, target.y - seen.y);
    return { x: seen.x + Math.cos(angle + off) * d, y: seen.y + Math.sin(angle + off) * d };
  }

  /** Where the plan sends the mallet this step. */
  private follow(spec: TableSpec, seen: Seen, mallet: Point): Point {
    const R = spec.puck.radius;
    const M = spec.mallet.radius;
    const home = malletHome(spec, 0);
    switch (this.plan) {
      case 'home': {
        // Shadow the puck across the width (a weaker player follows it further, leaving more of
        // the goal open), standing as far out as the level does.
        return {
          x: spec.W / 2 + (seen.x - spec.W / 2) * this.level.shadow,
          y: home.y - 0.11 + this.level.depth,
        };
      }
      case 'defend': {
        const goal = { x: spec.W / 2, y: 0 };
        const towards = this.meet ?? seen;
        const dx = towards.x + this.noise.x - goal.x;
        const dy = Math.max(0.05, towards.y + this.noise.y - goal.y);
        const d = Math.hypot(dx, dy);
        return { x: goal.x + (dx / d) * GUARD, y: goal.y + (dy / d) * GUARD };
      }
      case 'intercept': {
        const meet = this.meet ?? seen;
        const at = { x: meet.x + this.noise.x, y: meet.y + this.noise.y };
        const d = unit(this.aim.x - at.x, this.aim.y - at.y);
        // Wait just behind where the puck will be; once it is close, strike through it.
        const close = Math.hypot(seen.x - at.x, seen.y - at.y) < 0.18 + R;
        this.striking = close;
        return close
          ? { x: at.x + d.x * 0.15, y: at.y + d.y * 0.15 }
          : { x: at.x - d.x * (R + M + 0.01), y: at.y - d.y * (R + M + 0.01) };
      }
      case 'attack':
      case 'clear': {
        // The puck where the mallet will meet it (a resting puck where it is).
        const at = this.meet ?? seen;
        const d = this.safeDirection(unit(this.aim.x - at.x, this.aim.y - at.y));
        const standoff = { x: at.x - d.x * (R + M + 0.07), y: at.y - d.y * (R + M + 0.07) };
        if (!this.striking) {
          // Going round the puck: never through it, toward this side's own goal.
          if (distanceToSegment(seen, mallet, standoff) < R + M + 0.01) {
            const side = mallet.x >= seen.x ? 1 : -1;
            return { x: seen.x + side * (R + M + 0.06), y: Math.min(mallet.y, seen.y) };
          }
          // Strike once lined up behind the puck along the shot, near enough to reach it.
          const tx = at.x - mallet.x;
          const ty = at.y - mallet.y;
          const gap = Math.hypot(tx, ty);
          const lined = gap > 0 && (tx * d.x + ty * d.y) / gap > 0.92;
          const near = Math.hypot(mallet.x - standoff.x, mallet.y - standoff.y) < 0.04;
          if ((lined && gap < R + M + 0.14) || near || this.since > 2) this.striking = true;
        }
        return this.striking ? { x: at.x + d.x * 0.3, y: at.y + d.y * 0.3 } : standoff;
      }
    }
  }

  /** A shot never goes back toward this side's own goal: up the table at the least. */
  private safeDirection(d: Point): Point {
    if (d.y >= 0.25) return d;
    const x = Math.sign(d.x || 1) * Math.sqrt(1 - 0.25 * 0.25);
    return { x, y: 0.25 };
  }
}

function unit(x: number, y: number): Point {
  const d = Math.hypot(x, y);
  return d > 1e-9 ? { x: x / d, y: y / d } : { x: 0, y: 1 };
}

/** The distance from p to the segment from a to b. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t =
    length2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}
