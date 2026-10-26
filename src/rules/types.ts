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

// The match's shared vocabulary.

/** A player's place at the table: seat 0 defends the goal at y = 0, seat 1 the one at y = L. */
export type Seat = 0 | 1;

export const SEATS: readonly Seat[] = [0, 1];

/** The other player. */
export function other(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}
