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

// The table's walls as a disc's centre meets them, and the places on the table the game uses.
//
// A disc of radius r touches a rail when its centre is r from the rail's face. So the walls are
// built once for each kind of disc, moved in by its radius: straight rails become lines r inside
// the faces, the field's rounded corners become arcs of the corner's radius less r (the centre
// stays inside them), and the rounded edges of the goal slots become posts of their radius plus r
// (the centre stays outside them). With r = 0 the same pieces are the faces themselves, which the
// Blender model is built from: the rails drawn are the rails the puck hits.

import { cos, PI, sin } from '../physics/dmath.ts';
import type { Seat } from '../rules/types.ts';
import type { TableSpec } from './spec.ts';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A straight wall from a to b; the centre stays on the side the unit normal n points to. */
export interface Line {
  readonly id: string;
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly nx: number;
  readonly ny: number;
}

/**
 * A rounded field corner: the centre stays within r of (cx, cy) where it is past the centre in
 * both quadrant directions, (x − cx)·qx ≥ 0 and (y − cy)·qy ≥ 0.
 */
export interface Corner {
  readonly id: string;
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly qx: number;
  readonly qy: number;
}

/** A rounded slot edge: the centre stays at least r from (cx, cy). */
export interface Post {
  readonly id: string;
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

export interface Boundary {
  readonly lines: readonly Line[];
  readonly corners: readonly Corner[];
  readonly posts: readonly Post[];
}

/** Where a mallet's centre may be: a rectangle with rounded corners. */
export interface Area {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly r: number;
}

/** The goal slots' edges across the width. */
export function goalMouth(spec: TableSpec): { readonly x0: number; readonly x1: number } {
  return { x0: (spec.W - spec.goalWidth) / 2, x1: (spec.W + spec.goalWidth) / 2 };
}

/**
 * The walls a disc of radius `inset` meets. The slots' side walls run from the posts down to the
 * slot's depth; past the end rail's face the disc has gone into the goal.
 */
export function boundary(spec: TableSpec, inset: number): Boundary {
  const { W, L, cornerRadius: rc, postRadius: rp, slotDepth } = spec;
  const r = inset;
  const { x0: g0, x1: g1 } = goalMouth(spec);
  const lines: Line[] = [
    line('left', r, rc, r, L - rc, 1, 0),
    line('right', W - r, rc, W - r, L - rc, -1, 0),
    line('end-0-left', rc, r, g0 - rp, r, 0, 1),
    line('end-0-right', g1 + rp, r, W - rc, r, 0, 1),
    line('end-1-left', rc, L - r, g0 - rp, L - r, 0, -1),
    line('end-1-right', g1 + rp, L - r, W - rc, L - r, 0, -1),
    line('slot-0-left', g0 + r, -rp, g0 + r, -slotDepth, 1, 0),
    line('slot-0-right', g1 - r, -rp, g1 - r, -slotDepth, -1, 0),
    line('slot-1-left', g0 + r, L + rp, g0 + r, L + slotDepth, 1, 0),
    line('slot-1-right', g1 - r, L + rp, g1 - r, L + slotDepth, -1, 0),
  ];
  const corners: Corner[] = [
    { id: 'corner-0-left', cx: rc, cy: rc, r: rc - r, qx: -1, qy: -1 },
    { id: 'corner-0-right', cx: W - rc, cy: rc, r: rc - r, qx: 1, qy: -1 },
    { id: 'corner-1-left', cx: rc, cy: L - rc, r: rc - r, qx: -1, qy: 1 },
    { id: 'corner-1-right', cx: W - rc, cy: L - rc, r: rc - r, qx: 1, qy: 1 },
  ];
  const posts: Post[] = [
    { id: 'post-0-left', cx: g0 - rp, cy: -rp, r: rp + r },
    { id: 'post-0-right', cx: g1 + rp, cy: -rp, r: rp + r },
    { id: 'post-1-left', cx: g0 - rp, cy: L + rp, r: rp + r },
    { id: 'post-1-right', cx: g1 + rp, cy: L + rp, r: rp + r },
  ];
  return { lines, corners, posts };
}

function line(id: string, ax: number, ay: number, bx: number, by: number, nx: number, ny: number) {
  return { id, ax, ay, bx, by, nx, ny };
}

/** The centre line across the width, which divides the halves. */
export function centreLine(spec: TableSpec): number {
  return spec.L / 2;
}

/**
 * The gap a mallet keeps from the centre line, beyond its own radius: wide enough that a puck
 * on the line touches at most one mallet. Online, each side then only ever hits the puck in its
 * own half, where it alone simulates it (docs/protocol.md).
 */
export function neutralBand(spec: TableSpec): number {
  return spec.puck.radius + 0.002;
}

/**
 * How far up the table a mallet may go, as a share of the table's length from its own end rail:
 * the whole of its half (to the centre line, less the band: the standard game) or less, a match's
 * choice that holds for both players. The share is where the mallet's front edge stops.
 */
export const REACHES = { half: 0.5, twoFifths: 0.4, third: 1 / 3, quarter: 0.25 } as const;
export type Reach = keyof typeof REACHES;
export const REACH_IDS = Object.keys(REACHES) as Reach[];

export function isReach(value: unknown): value is Reach {
  return typeof value === 'string' && value in REACHES;
}

/** How far from its own end rail a mallet's front edge may go in a match with this reach. */
export function zoneFront(spec: TableSpec, reach: Reach = 'half'): number {
  return Math.min(REACHES[reach] * spec.L, centreLine(spec) - neutralBand(spec));
}

/** Where a seat's mallet centre may go: inside the rails, from its own end to its zone's front. */
export function malletArea(spec: TableSpec, seat: Seat, reach: Reach = 'half'): Area {
  const { W, L } = spec;
  const m = spec.mallet.radius;
  const front = zoneFront(spec, reach);
  const r = Math.max(0, spec.cornerRadius - m);
  return seat === 0
    ? { x0: m, x1: W - m, y0: m, y1: front - m, r }
    : { x0: m, x1: W - m, y0: L - front + m, y1: L - m, r };
}

/** The point of the area nearest to (x, y). */
export function clampToArea(area: Area, x: number, y: number): Point {
  const cx = Math.min(area.x1, Math.max(area.x0, x));
  const cy = Math.min(area.y1, Math.max(area.y0, y));
  // Into a rounded corner: back onto its arc when outside it.
  const kx =
    cx < area.x0 + area.r ? area.x0 + area.r : cx > area.x1 - area.r ? area.x1 - area.r : cx;
  const ky =
    cy < area.y0 + area.r ? area.y0 + area.r : cy > area.y1 - area.r ? area.y1 - area.r : cy;
  const dx = cx - kx;
  const dy = cy - ky;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= area.r || d === 0) return { x: cx, y: cy };
  return { x: kx + (dx / d) * area.r, y: ky + (dy / d) * area.r };
}

/**
 * Where the puck is put down for a seat to serve: the middle of its half, or nearer its end where
 * the match's zones are short, so the server's mallet always reaches it.
 */
export function serveSpot(spec: TableSpec, seat: Seat, reach: Reach = 'half'): Point {
  const y = Math.min(spec.L / 4, zoneFront(spec, reach) * 0.75);
  return { x: spec.W / 2, y: seat === 0 ? y : spec.L - y };
}

/** Where a seat's mallet waits: in front of its goal. */
export function malletHome(spec: TableSpec, seat: Seat): Point {
  const y = spec.mallet.radius + 0.11;
  return { x: spec.W / 2, y: seat === 0 ? y : spec.L - y };
}

/** Which half a point is in: seat 0's below the centre line, seat 1's from it on. */
export function halfOf(spec: TableSpec, y: number): Seat {
  return y < centreLine(spec) ? 0 : 1;
}

/** The goal a centre has gone into once it is a radius past an end rail's face, or null. */
export function goalReached(spec: TableSpec, y: number): Seat | null {
  const r = spec.puck.radius;
  if (y < -r) return 0;
  if (y > spec.L + r) return 1;
  return null;
}

/**
 * The faces of the rails as one closed outline, counter-clockwise from above, with each goal
 * slot as a notch: what the rails' inner walls and the playing surface are built from. Arcs are
 * cut into `steps` pieces.
 */
export function fieldOutline(spec: TableSpec, steps = 12): Point[] {
  const { W, L, cornerRadius: rc, postRadius: rp, slotDepth } = spec;
  const { x0: g0, x1: g1 } = goalMouth(spec);
  const out: Point[] = [];
  const arc = (cx: number, cy: number, r: number, from: number, to: number) => {
    for (let i = 0; i <= steps; i++) {
      const a = from + ((to - from) * i) / steps;
      out.push({ x: cx + r * cos(a), y: cy + r * sin(a) });
    }
  };
  const Q = PI / 2;
  // Seat 0's end rail, left to right, with its slot.
  arc(rc, rc, rc, 2 * Q, 3 * Q);
  arc(g0 - rp, -rp, rp, Q, 0);
  out.push({ x: g0, y: -slotDepth }, { x: g1, y: -slotDepth });
  arc(g1 + rp, -rp, rp, 2 * Q, Q);
  arc(W - rc, rc, rc, 3 * Q, 4 * Q);
  // The right rail, then seat 1's end rail right to left, then the left rail.
  arc(W - rc, L - rc, rc, 0, Q);
  arc(g1 + rp, L + rp, rp, 3 * Q, 2 * Q);
  out.push({ x: g1, y: L + slotDepth }, { x: g0, y: L + slotDepth });
  arc(g0 - rp, L + rp, rp, 4 * Q, 3 * Q);
  arc(rc, L - rc, rc, Q, 2 * Q);
  return out;
}
