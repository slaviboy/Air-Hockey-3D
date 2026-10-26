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

// What the interface asks of online play (src/ui/online/OnlinePlay.ts), at the few points where a
// match against a friend online goes differently from one on this device (Pool's hooks).

import type { Seat } from '../../rules/types.ts';
import type { Reach } from '../../table/geometry.ts';
import type { FirstServe } from '../modern/newGameSheet.ts';

/** The terms the host chose in the New Game sheet. */
export interface HostTerms {
  readonly target: number;
  readonly firstServe: FirstServe;
  /** The mallets' zone, the same for both players. */
  readonly reach: Reach;
}

export interface OnlineHooks {
  /** An online game is open: connected, or waiting for the friend; not closed. */
  readonly active: boolean;
  /** The seat this device plays in the online match on the table, or null. */
  readonly seat: Seat | null;
  /**
   * Before the main menu opens: an invitation in the address bar, or a game this tab was playing,
   * comes first. Resolves true when it took over (the menu is not needed).
   */
  intercept(): Promise<boolean>;
  /** "Play a friend online", with the terms already chosen or asked for; true once set up. */
  host(terms?: HostTerms): Promise<boolean>;
  /** The main menu's "Join a game"; true once a game is set up. */
  join(): Promise<boolean>;
  /** After the match: a rematch with the same player, the other one serving first. */
  rematch(): Promise<void>;
  /** The pause menu's Resign: gives up the match, staying connected for a rematch. */
  resign(): Promise<void>;
  /** The pause menu's Leave: resigns a match in progress, leaves and opens the main menu. */
  leave(): Promise<void>;
  /** Before another match replaces the online one: asks, and leaves; false to stay. */
  leaveForNewMatch(): Promise<boolean>;
  /** What the status should say instead of the match (play held, the friend away), or null. */
  status(): string | null;
}
