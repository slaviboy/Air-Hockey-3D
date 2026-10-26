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

// A mallet driven by four keys. Up on the keyboard is up on the screen, whichever way the view
// faces, so the keys mean the same in the 3D view, the top view and from either end. While a key
// is held the mallet heads that way at full stretch (its steering brings it up to speed and
// keeps it in its half); let go, it stops where it is, and the pointer takes over again from
// there.

import type { Driver, Match } from '../game/Match.ts';
import type { Seat } from '../rules/types.ts';
import type { Point } from '../table/geometry.ts';
import type { KeySet } from './shortcuts.ts';

/** How far ahead of the mallet a held key sends it, metres: far enough for full speed. */
const REACH = 0.35;

/** The screen's right and up directions on the table (unit vectors in the table's frame). */
export interface ScreenAxes {
  readonly right: Point;
  readonly up: Point;
}

export class KeyDriver implements Driver {
  private readonly held = new Set<string>();

  constructor(
    readonly keys: KeySet,
    private readonly axes: () => ScreenAxes,
  ) {}

  /** Whether this driver uses the key; true if it does. */
  press(key: string): boolean {
    if (!this.owns(key)) return false;
    this.held.add(key);
    return true;
  }

  release(key: string): boolean {
    return this.held.delete(key);
  }

  /** Lets go of everything (the window lost the focus, a dialog opened). */
  clear(): void {
    this.held.clear();
  }

  get active(): boolean {
    return this.held.size > 0;
  }

  private owns(key: string): boolean {
    const { up, down, left, right } = this.keys;
    return key === up || key === down || key === left || key === right;
  }

  target(match: Match, seat: Seat): Point | null {
    if (!this.active) return null;
    const { up, down, left, right } = this.keys;
    const across = (this.held.has(right) ? 1 : 0) - (this.held.has(left) ? 1 : 0);
    const along = (this.held.has(up) ? 1 : 0) - (this.held.has(down) ? 1 : 0);
    const mallet = match.world.mallets[seat];
    // When the keys stop, the pointer's target stays where the keys left the mallet.
    match.targets[seat] = { x: mallet.x, y: mallet.y };
    if (across === 0 && along === 0) return { x: mallet.x, y: mallet.y };
    const { right: r, up: u } = this.axes();
    const dx = r.x * across + u.x * along;
    const dy = r.y * across + u.y * along;
    const d = Math.hypot(dx, dy) || 1;
    return { x: mallet.x + (dx / d) * REACH, y: mallet.y + (dy / d) * REACH };
  }
}
