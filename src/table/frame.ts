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

// The one mapping between the table's frame and the 3D scene's.
//
// Table: x across (0 at the left cushion nose), y along (0 at the head cushion nose), z up from the
// cloth. Scene (three.js, and Blender after glTF export): X across through the table's centre,
// Y up, Z toward the head rail, so the default view looks down the table from behind the head.
//
//   X = x - W/2,   Y = z,   Z = L/2 - y
//
// This is a proper rotation (a quarter turn about x, plus a shift), so spins carry over the same
// way positions do: an angular velocity (ωx, ωy, ωz) becomes (ωx, ωz, -ωy).

export interface SceneVector {
  x: number;
  y: number;
  z: number;
}

/** A table-frame point to scene coordinates, written into `out`. */
export function toScene(
  x: number,
  y: number,
  z: number,
  W: number,
  L: number,
  out: SceneVector,
): SceneVector {
  out.x = x - W / 2;
  out.y = z;
  out.z = L / 2 - y;
  return out;
}

/** A table-frame direction (velocity, spin) to scene axes, written into `out`. */
export function directionToScene(x: number, y: number, z: number, out: SceneVector): SceneVector {
  out.x = x;
  out.y = z;
  out.z = -y;
  return out;
}

/** A scene point back to the table frame. */
export function fromScene(
  X: number,
  Y: number,
  Z: number,
  W: number,
  L: number,
  out: SceneVector,
): SceneVector {
  out.x = X + W / 2;
  out.y = L / 2 - Z;
  out.z = Y;
  return out;
}
