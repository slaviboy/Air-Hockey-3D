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

// The puck on its air cushion, one fixed step at a time (docs/physics.md).
//
// Within a step the puck slides in a straight line and each mallet moves in a straight line to
// where its player sent it. The step finds the first contact in closed form (a line, an arc of a
// corner, a slot's post or a moving mallet), moves everything to it, resolves it and carries on
// with what is left of the step, so nothing passes through anything at any speed. The air's drag,
// the speed limit and the goal lines are applied at the end of the step.
//
// The mallets are driven by hands, not by collisions: they are kinematic, as heavy as the player
// makes them. A puck squeezed between a mallet and a rail cannot give way, so the mallet does.

import type { Seat } from '../rules/types.ts';
import {
  boundary,
  centreLine,
  clampToArea,
  goalReached,
  malletArea,
  neutralBand,
  type Area,
  type Boundary,
  type Point,
} from '../table/geometry.ts';
import type { TableSpec } from '../table/spec.ts';
import { exp } from './dmath.ts';
import {
  BAND_DRIFT_ACCEL,
  BAND_DRIFT_SPEED,
  DAMPING,
  MALLET_FRICTION,
  MALLET_RESTITUTION,
  MAX_EVENTS_PER_STEP,
  MAX_MALLET_SPEED,
  MAX_PUCK_SPEED,
  RAIL_FRICTION,
  RAIL_RESTITUTION,
  REST_SPEED,
  SKIN,
  STEP,
  STEP_DECAY,
  STOP_SPEED,
} from './params.ts';

/** A body on the table: its centre and velocity in the table's frame. */
export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** What happened during a step, for the sounds and the match. */
export type PhysicsEvent =
  | { readonly kind: 'rail'; readonly speed: number }
  | { readonly kind: 'post'; readonly speed: number }
  | { readonly kind: 'mallet'; readonly seat: Seat; readonly speed: number }
  | { readonly kind: 'goal'; readonly seat: Seat };

export interface World {
  readonly spec: TableSpec;
  /** The walls as the puck's centre meets them. */
  readonly walls: Boundary;
  readonly areas: readonly [Area, Area];
  readonly puck: Body;
  readonly mallets: readonly [Body, Body];
  /**
   * Which mallets the puck meets. Both, on one device; online, only the one of the side that
   * simulates the puck (the other cannot reach its half).
   */
  readonly solid: [boolean, boolean];
  /** Whether the puck is in play; out of it (in a goal, or taken up after a foul) it rests. */
  live: boolean;
  /** The goal the puck has gone into, once it has; it then rests in the slot. */
  goal: Seat | null;
}

const body = (x: number, y: number): Body => ({ x, y, vx: 0, vy: 0 });

export function createWorld(spec: TableSpec): World {
  return {
    spec,
    walls: boundary(spec, spec.puck.radius),
    areas: [malletArea(spec, 0), malletArea(spec, 1)],
    puck: body(spec.W / 2, spec.L / 2),
    mallets: [body(spec.W / 2, spec.mallet.radius), body(spec.W / 2, spec.L - spec.mallet.radius)],
    solid: [true, true],
    live: true,
    goal: null,
  };
}

/** What the next contact is, and when. */
interface Hit {
  t: number;
  kind: 'line' | 'corner' | 'post' | 'mallet';
  /** The contact's unit normal, pointing toward the puck's side. */
  nx: number;
  ny: number;
  seat: Seat;
}

const NO_HIT: Hit = { t: Infinity, kind: 'line', nx: 0, ny: 0, seat: 0 };
/** Closing speeds below this are no approach at all (rounding after a resting contact). */
const APPROACH = 1e-9;

/**
 * Advances the world one step: the mallets toward these points (steered there by mallet.ts; kept
 * in their areas and under the mallets' speed limit here whatever is asked), the puck as it
 * slides and bounces. Returns what happened.
 */
export function step(world: World, asked: readonly [Point, Point], dt = STEP): PhysicsEvent[] {
  const events: PhysicsEvent[] = [];
  const { puck, mallets } = world;
  const start = [
    { x: mallets[0].x, y: mallets[0].y },
    { x: mallets[1].x, y: mallets[1].y },
  ] as const;
  const targets = [reachable(world, 0, asked[0], dt), reachable(world, 1, asked[1], dt)] as const;
  for (const seat of [0, 1] as const) {
    mallets[seat].vx = (targets[seat].x - mallets[seat].x) / dt;
    mallets[seat].vy = (targets[seat].y - mallets[seat].y) / dt;
  }
  if (!world.live) {
    place(world, targets);
    return events;
  }

  // Mallets stopped against a puck the walls hold: they end the step where they stopped.
  const squeezed: [boolean, boolean] = [false, false];
  let elapsed = 0;
  for (let n = 0; n < MAX_EVENTS_PER_STEP; n++) {
    const hit = nextHit(world, dt - elapsed);
    if (hit.t === Infinity) break;
    advance(world, hit.t);
    elapsed += hit.t;
    resolve(world, hit, events, squeezed);
  }
  advance(world, dt - elapsed);
  place(world, targets, squeezed);
  for (const seat of [0, 1] as const) {
    if (!squeezed[seat]) continue;
    mallets[seat].vx = (mallets[seat].x - start[seat].x) / dt;
    mallets[seat].vy = (mallets[seat].y - start[seat].y) / dt;
  }
  separate(world, start, dt);
  slide(world, dt);

  const goal = goalReached(world.spec, puck.y);
  if (goal !== null) {
    world.goal = goal;
    world.live = false;
    events.push({ kind: 'goal', seat: goal });
  }
  return events;
}

/** Where a mallet sent to `to` can be after `dt`: in its area, at most its top speed away. */
function reachable(world: World, seat: Seat, to: Point, dt: number): Point {
  const m = world.mallets[seat];
  const p = clampToArea(world.areas[seat], to.x, to.y);
  const dx = p.x - m.x;
  const dy = p.y - m.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const most = MAX_MALLET_SPEED * dt;
  if (d <= most) return p;
  return clampToArea(world.areas[seat], m.x + (dx / d) * most, m.y + (dy / d) * most);
}

/** Moves everything on by `t` seconds in straight lines. */
function advance(world: World, t: number): void {
  if (t <= 0) return;
  const { puck } = world;
  puck.x += puck.vx * t;
  puck.y += puck.vy * t;
  for (const m of world.mallets) {
    m.x += m.vx * t;
    m.y += m.vy * t;
  }
}

/**
 * Puts the mallets exactly where they were sent (the steps of `advance` round on the way), but
 * for those stopped short on the way.
 */
function place(
  world: World,
  targets: readonly [Point, Point],
  stopped: readonly [boolean, boolean] = [false, false],
): void {
  for (const seat of [0, 1] as const) {
    if (stopped[seat]) continue;
    world.mallets[seat].x = targets[seat].x;
    world.mallets[seat].y = targets[seat].y;
  }
}

/** The first contact within `horizon` seconds. */
function nextHit(world: World, horizon: number): Hit {
  const { puck, walls, spec } = world;
  let best = NO_HIT;
  const consider = (hit: Hit) => {
    if (hit.t <= horizon && hit.t < best.t) best = hit;
  };
  for (const l of walls.lines) consider(lineHit(puck, l.ax, l.ay, l.bx, l.by, l.nx, l.ny));
  for (const c of walls.corners) consider(cornerHit(puck, c.cx, c.cy, c.r, c.qx, c.qy));
  for (const p of walls.posts) {
    const hit = circleHit(puck.x - p.cx, puck.y - p.cy, puck.vx, puck.vy, p.r);
    if (hit) consider({ ...hit, kind: 'post', seat: 0 });
  }
  const reach = spec.puck.radius + spec.mallet.radius;
  for (const seat of [0, 1] as const) {
    if (!world.solid[seat]) continue;
    const m = world.mallets[seat];
    const hit = circleHit(puck.x - m.x, puck.y - m.y, puck.vx - m.vx, puck.vy - m.vy, reach);
    if (hit) consider({ ...hit, kind: 'mallet', seat });
  }
  return best;
}

/** A straight wall: the time the centre reaches it, if it does within the wall's length. */
function lineHit(
  puck: Body,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  nx: number,
  ny: number,
): Hit {
  const vn = puck.vx * nx + puck.vy * ny;
  if (vn >= -APPROACH) return NO_HIT;
  const d = (puck.x - ax) * nx + (puck.y - ay) * ny;
  const t = d <= 0 ? 0 : d / -vn;
  const hx = puck.x + puck.vx * t - ax;
  const hy = puck.y + puck.vy * t - ay;
  const ex = bx - ax;
  const ey = by - ay;
  const s = (hx * ex + hy * ey) / (ex * ex + ey * ey);
  if (s < 0 || s > 1) return NO_HIT;
  return { t, kind: 'line', nx, ny, seat: 0 };
}

/** A rounded corner, met from inside: the time the centre reaches its arc within its quadrant. */
function cornerHit(puck: Body, cx: number, cy: number, r: number, qx: number, qy: number): Hit {
  const dx = puck.x - cx;
  const dy = puck.y - cy;
  const a = puck.vx * puck.vx + puck.vy * puck.vy;
  if (a === 0) return NO_HIT;
  const b = 2 * (dx * puck.vx + dy * puck.vy);
  const c = dx * dx + dy * dy - r * r;
  let t: number;
  if (c >= 0) {
    // On or past the arc already: a contact now if in the quadrant and still going out.
    if (b <= APPROACH) return NO_HIT;
    t = 0;
  } else {
    const root = Math.sqrt(b * b - 4 * a * c);
    t = b >= 0 ? (-2 * c) / (b + root) : (root - b) / (2 * a);
  }
  const hx = dx + puck.vx * t;
  const hy = dy + puck.vy * t;
  if (hx * qx < 0 || hy * qy < 0) return NO_HIT;
  const d = Math.sqrt(hx * hx + hy * hy);
  if (d === 0) return NO_HIT;
  // The normal points back toward the corner's centre: into the field.
  return { t, kind: 'corner', nx: -hx / d, ny: -hy / d, seat: 0 };
}

/**
 * A circle met from outside (a post, or a mallet in the puck's frame): offset (dx, dy) from its
 * centre, closing at (wx, wy). The smallest root, without cancellation.
 */
function circleHit(
  dx: number,
  dy: number,
  wx: number,
  wy: number,
  r: number,
): { t: number; nx: number; ny: number } | null {
  const b = 2 * (dx * wx + dy * wy);
  if (b >= -APPROACH) return null;
  const a = wx * wx + wy * wy;
  const c = dx * dx + dy * dy - r * r;
  let t: number;
  if (c <= 0) {
    t = 0;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    t = (2 * c) / (Math.sqrt(disc) - b);
  }
  const hx = dx + wx * t;
  const hy = dy + wy * t;
  const d = Math.sqrt(hx * hx + hy * hy);
  if (d === 0) return null;
  return { t, nx: hx / d, ny: hy / d };
}

/** How squarely a mallet must push a puck into a wall it touches to be held up by it. */
const PINNED = 0.3;
/** A squeeze is heard only from a real strike, not the push of a mallet held against the puck. */
const SQUEEZE_SOUND = 0.6;

function resolve(
  world: World,
  hit: Hit,
  events: PhysicsEvent[],
  squeezed: [boolean, boolean],
): void {
  const { puck, spec } = world;
  if (hit.kind !== 'mallet') {
    const speed = bounce(puck, hit.nx, hit.ny, 0, 0, RAIL_RESTITUTION, RAIL_FRICTION);
    puck.x += hit.nx * SKIN;
    puck.y += hit.ny * SKIN;
    if (speed > 0) events.push({ kind: hit.kind === 'post' ? 'post' : 'rail', speed });
    return;
  }
  const m = world.mallets[hit.seat];
  const wall = wallNormal(world.walls, puck.x, puck.y);
  if (wall && wall.x * hit.nx + wall.y * hit.ny < -PINNED) {
    // The puck lies against a wall the mallet pushes it into: it cannot give way, so the mallet
    // stops pushing (it may still slide along the puck's edge) and nothing bounces.
    const un = m.vx * hit.nx + m.vy * hit.ny;
    const closing = -((puck.vx - m.vx) * hit.nx + (puck.vy - m.vy) * hit.ny);
    if (un > 0) {
      m.vx -= un * hit.nx;
      m.vy -= un * hit.ny;
    }
    bounce(puck, hit.nx, hit.ny, m.vx, m.vy, 0, MALLET_FRICTION);
    squeezed[hit.seat] = true;
    if (closing > SQUEEZE_SOUND) events.push({ kind: 'mallet', seat: hit.seat, speed: closing });
    return;
  }
  const speed = bounce(puck, hit.nx, hit.ny, m.vx, m.vy, MALLET_RESTITUTION, MALLET_FRICTION);
  limitAfterHit(puck, hit.nx, hit.ny, m.vx * hit.nx + m.vy * hit.ny);
  const reach = spec.puck.radius + spec.mallet.radius + SKIN;
  puck.x = m.x + hit.nx * reach;
  puck.y = m.y + hit.ny * reach;
  if (speed > 0) events.push({ kind: 'mallet', seat: hit.seat, speed });
}

/**
 * A bounce off a surface moving at (ux, uy) with unit normal n toward the puck: the closing speed
 * across the contact comes back times the restitution (none for a gentle touch, which only pushes
 * the puck along), and friction takes from the sliding speed along it, up to all of it. Returns
 * the closing speed, 0 if the two were not closing.
 */
export function bounce(
  puck: Body,
  nx: number,
  ny: number,
  ux: number,
  uy: number,
  restitution: number,
  friction: number,
): number {
  const wx = puck.vx - ux;
  const wy = puck.vy - uy;
  const wn = wx * nx + wy * ny;
  if (wn >= 0) return 0;
  const e = -wn < REST_SPEED ? 0 : restitution;
  const impulse = -(1 + e) * wn;
  let tx = wx - wn * nx;
  let ty = wy - wn * ny;
  const sliding = Math.sqrt(tx * tx + ty * ty);
  if (sliding > 0) {
    const kept = Math.max(0, sliding - friction * impulse) / sliding;
    tx *= kept;
    ty *= kept;
  }
  const out = -e * wn;
  puck.vx = ux + tx + out * nx;
  puck.vy = uy + ty + out * ny;
  return -wn;
}

/**
 * Keeps a struck puck under the speed limit by trimming its speed along the mallet first, so it
 * still leaves the mallet at least as fast as the mallet follows (`un`, its speed along n).
 */
function limitAfterHit(puck: Body, nx: number, ny: number, un: number): void {
  const speed2 = puck.vx * puck.vx + puck.vy * puck.vy;
  if (speed2 <= MAX_PUCK_SPEED * MAX_PUCK_SPEED) return;
  let vn = puck.vx * nx + puck.vy * ny;
  vn = Math.min(Math.max(vn, un), MAX_PUCK_SPEED);
  const tx = puck.vx - (puck.vx * nx + puck.vy * ny) * nx;
  const ty = puck.vy - (puck.vx * nx + puck.vy * ny) * ny;
  const along = Math.sqrt(tx * tx + ty * ty);
  const room = Math.sqrt(Math.max(0, MAX_PUCK_SPEED * MAX_PUCK_SPEED - vn * vn));
  const k = along > room ? room / along : 1;
  puck.vx = tx * k + vn * nx;
  puck.vy = ty * k + vn * ny;
}

/**
 * After the step, nothing may overlap. A mallet into the puck pushes it out; where the walls stop
 * the puck, the mallet gives way instead, back along the line between them. A puck the step left
 * past a wall (more contacts than a step resolves) is put back inside.
 */
function separate(world: World, start: readonly Point[], dt: number): void {
  const { puck, spec } = world;
  const reach = spec.puck.radius + spec.mallet.radius;
  const inside = pushInside(world.walls, puck.x, puck.y);
  if (inside.x !== puck.x || inside.y !== puck.y) {
    // Back inside, and no longer heading out.
    const ox = inside.x - puck.x;
    const oy = inside.y - puck.y;
    const o = Math.sqrt(ox * ox + oy * oy);
    const vn = (puck.vx * ox + puck.vy * oy) / o;
    if (vn < 0) {
      puck.vx -= (vn * ox) / o;
      puck.vy -= (vn * oy) / o;
    }
    puck.x = inside.x;
    puck.y = inside.y;
  }
  for (const seat of [0, 1] as const) {
    if (!world.solid[seat]) continue;
    const m = world.mallets[seat];
    let dx = puck.x - m.x;
    let dy = puck.y - m.y;
    let d = Math.sqrt(dx * dx + dy * dy);
    if (d >= reach - SKIN) continue;
    if (d === 0) {
      // Dead centre: out toward the other half.
      dx = 0;
      dy = seat === 0 ? 1 : -1;
      d = 1;
    }
    const nx = dx / d;
    const ny = dy / d;
    const free = { x: m.x + nx * reach, y: m.y + ny * reach };
    const inside = pushInside(world.walls, free.x, free.y);
    if (inside.x === free.x && inside.y === free.y) {
      puck.x = free.x;
      puck.y = free.y;
    } else {
      // Pinned: the puck goes as far as the walls let it, and the mallet stops short of it.
      puck.x = inside.x;
      puck.y = inside.y;
      let bx = m.x - inside.x;
      let by = m.y - inside.y;
      const bd = Math.sqrt(bx * bx + by * by);
      if (bd > 0) {
        bx /= bd;
        by /= bd;
      } else {
        bx = -nx;
        by = -ny;
      }
      const back = clampToArea(world.areas[seat], inside.x + bx * reach, inside.y + by * reach);
      m.x = back.x;
      m.y = back.y;
      m.vx = (m.x - start[seat]!.x) / dt;
      m.vy = (m.y - start[seat]!.y) / dt;
    }
    // Whatever the puck was doing, it no longer closes on the mallet.
    const wn = (puck.vx - m.vx) * nx + (puck.vy - m.vy) * ny;
    if (wn < 0) {
      puck.vx -= wn * nx;
      puck.vy -= wn * ny;
    }
  }
}

/** Closer than this to a wall, the puck is touching it. */
const TOUCHING = 1e-4;

/** The normal (into the field) of the wall the centre at (x, y) touches, if it touches one. */
export function wallNormal(walls: Boundary, x: number, y: number): Point | null {
  let best: Point | null = null;
  let nearest = TOUCHING;
  for (const l of walls.lines) {
    const ex = l.bx - l.ax;
    const ey = l.by - l.ay;
    const s = ((x - l.ax) * ex + (y - l.ay) * ey) / (ex * ex + ey * ey);
    if (s < 0 || s > 1) continue;
    const d = (x - l.ax) * l.nx + (y - l.ay) * l.ny;
    if (d < nearest) {
      nearest = d;
      best = { x: l.nx, y: l.ny };
    }
  }
  for (const c of walls.corners) {
    const dx = x - c.cx;
    const dy = y - c.cy;
    if (dx * c.qx < 0 || dy * c.qy < 0) continue;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 0 && c.r - d < nearest) {
      nearest = c.r - d;
      best = { x: -dx / d, y: -dy / d };
    }
  }
  for (const p of walls.posts) {
    const dx = x - p.cx;
    const dy = y - p.cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 0 && d - p.r < nearest) {
      nearest = d - p.r;
      best = { x: dx / d, y: dy / d };
    }
  }
  return best;
}

/**
 * The place nearest to (x, y) that the walls allow a centre to be, found by moving it onto each
 * wall it is past (a few rounds settle a corner where two meet); (x, y) itself if it is allowed.
 */
export function pushInside(walls: Boundary, x: number, y: number): Point {
  let px = x;
  let py = y;
  for (let round = 0; round < 4; round++) {
    let moved = false;
    for (const l of walls.lines) {
      const ex = l.bx - l.ax;
      const ey = l.by - l.ay;
      const s = ((px - l.ax) * ex + (py - l.ay) * ey) / (ex * ex + ey * ey);
      if (s < 0 || s > 1) continue;
      const d = (px - l.ax) * l.nx + (py - l.ay) * l.ny;
      if (d < 0) {
        px -= d * l.nx;
        py -= d * l.ny;
        moved = true;
      }
    }
    for (const c of walls.corners) {
      const dx = px - c.cx;
      const dy = py - c.cy;
      if (dx * c.qx < 0 || dy * c.qy < 0) continue;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > c.r && d > 0) {
        px = c.cx + (dx * c.r) / d;
        py = c.cy + (dy * c.r) / d;
        moved = true;
      }
    }
    for (const p of walls.posts) {
      const dx = px - p.cx;
      const dy = py - p.cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < p.r && d > 0) {
        px = p.cx + (dx * p.r) / d;
        py = p.cy + (dy * p.r) / d;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { x: px, y: py };
}

/** The air's drag, the drift out of the band at the centre line, rest, and the speed limit. */
function slide(world: World, dt: number): void {
  const { puck, spec } = world;
  const decay = dt === STEP ? STEP_DECAY : exp(-DAMPING * dt);
  puck.vx *= decay;
  puck.vy *= decay;
  const middle = centreLine(spec);
  // Where neither mallet reaches: a mallet's edge stops the band short of the line, so it touches
  // no centre closer to the line than the band less the puck's radius (and a little more, so a
  // puck only just within reach does not wait there either).
  const unreached = neutralBand(spec) - spec.puck.radius + 0.006;
  const speed = Math.sqrt(puck.vx * puck.vx + puck.vy * puck.vy);
  if (speed < BAND_DRIFT_SPEED && Math.abs(puck.y - middle) < unreached) {
    puck.vy += (puck.y < middle ? -1 : 1) * BAND_DRIFT_ACCEL * dt;
    return;
  }
  if (speed < STOP_SPEED) {
    puck.vx = 0;
    puck.vy = 0;
    return;
  }
  if (speed > MAX_PUCK_SPEED) {
    const k = MAX_PUCK_SPEED / speed;
    puck.vx *= k;
    puck.vy *= k;
  }
}

/**
 * Lets the puck slide on its own for `seconds`, off the walls but past the mallets (none are
 * solid): where it will be. For dead reckoning and for the computer's predictions; the world is
 * a copy, the real one is not touched.
 */
export function coast(world: World, seconds: number, out?: (puck: Body, t: number) => void): Body {
  const copy: World = {
    ...world,
    puck: { ...world.puck },
    mallets: [{ ...world.mallets[0] }, { ...world.mallets[1] }],
    solid: [false, false],
  };
  const still: [Point, Point] = [
    { x: copy.mallets[0].x, y: copy.mallets[0].y },
    { x: copy.mallets[1].x, y: copy.mallets[1].y },
  ];
  let t = 0;
  while (t < seconds - 1e-12 && copy.live) {
    const dt = Math.min(STEP, seconds - t);
    step(copy, still, dt);
    t += dt;
    out?.(copy.puck, t);
  }
  return copy.puck;
}
