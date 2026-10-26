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

// The table, the puck and the mallets, measured once. The simulation, the Blender model (through
// scripts/export-table.ts) and the camera all read these numbers, so the rails drawn are the rails
// the puck hits. Lengths are in metres. docs/table.md says where each figure comes from.
//
// The frame is the table's own, seen from above: x across the width from the left rail's face, y
// along the length from seat 0's end rail, z up from the playing surface. Seat 0 defends the goal
// at y = 0, seat 1 the goal at y = L.

/** The table: an 8-foot coin-op table of the reference's kind. */
export interface TableSpec {
  /** The playing field between the rails' faces: across (x) and along (y). */
  readonly W: number;
  readonly L: number;
  /** The field's rounded corners, where the side rails meet the end rails. */
  readonly cornerRadius: number;
  /** The goal slot in each end rail, centred on the width. */
  readonly goalWidth: number;
  /** The rounded edges where an end rail's face turns into the slot. */
  readonly postRadius: number;
  /** How deep the slot runs into the end rail before the puck drops into the return. */
  readonly slotDepth: number;
  /** The flat top rail round the field, as seen from above. */
  readonly railWidth: number;
  /** The rail's top above the playing surface (the height of its inner acrylic wall). */
  readonly railHeight: number;
  /** The outer corners of the top rail: the field's corners, the rail's width further out. */
  readonly outerCornerRadius: number;
  /** The playing surface above the floor. */
  readonly surfaceHeight: number;
  readonly puck: PuckSpec;
  readonly mallet: MalletSpec;
}

export interface PuckSpec {
  readonly radius: number;
  readonly thickness: number;
}

/** A high-top mallet: a wide felt-soled base rising to a knob for the hand. */
export interface MalletSpec {
  /** The base's radius: what the puck bounces off. */
  readonly radius: number;
  readonly height: number;
  /** The knob's radius at its widest. */
  readonly knobRadius: number;
}

const INCH = 0.0254;

/** The top rail's outer outline: the cabinet seen from above, without the goal housings. */
export const OUTLINE_LENGTH = 2.49;
export const OUTLINE_WIDTH = 1.3;
const RAIL_WIDTH = 0.1;
const CORNER_RADIUS = 0.06;

export const TABLE: TableSpec = {
  W: OUTLINE_WIDTH - 2 * RAIL_WIDTH,
  L: OUTLINE_LENGTH - 2 * RAIL_WIDTH,
  cornerRadius: CORNER_RADIUS,
  goalWidth: 0.28,
  postRadius: 0.012,
  slotDepth: 0.07,
  railWidth: RAIL_WIDTH,
  railHeight: 0.028,
  outerCornerRadius: CORNER_RADIUS + RAIL_WIDTH,
  surfaceHeight: 0.8,
  puck: { radius: (3.25 * INCH) / 2, thickness: (3 / 16) * INCH },
  mallet: { radius: 2 * INCH, height: 0.072, knobRadius: 0.021 },
};
