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

// The table's geometry as the JSON the Blender scripts build the model from
// (blender/table-geometry.json, written by scripts/export-table.ts). Points are [x, y] in the
// table frame, in metres; Blender places them at X = x - W/2, Y = y - L/2, Z = z.

import { boundary, centreLine, fieldOutline, goalMouth, type Point } from './geometry.ts';
import { TABLE, type TableSpec } from './spec.ts';

export const GEOMETRY_VERSION = 1;

const xy = (p: Point): [number, number] => [p.x, p.y];

export function tableGeometryJson(spec: TableSpec = TABLE): object {
  const faces = boundary(spec, 0);
  const mouth = goalMouth(spec);
  return {
    version: GEOMETRY_VERSION,
    units: 'metres',
    frame:
      "table: x across from the left rail's face, y along from seat 0's end rail's face, z up from the playing surface",
    W: spec.W,
    L: spec.L,
    cornerRadius: spec.cornerRadius,
    goalWidth: spec.goalWidth,
    goal: [mouth.x0, mouth.x1],
    postRadius: spec.postRadius,
    slotDepth: spec.slotDepth,
    railWidth: spec.railWidth,
    railHeight: spec.railHeight,
    outerCornerRadius: spec.outerCornerRadius,
    surfaceHeight: spec.surfaceHeight,
    centreLine: centreLine(spec),
    puck: { radius: spec.puck.radius, thickness: spec.puck.thickness },
    mallet: {
      radius: spec.mallet.radius,
      height: spec.mallet.height,
      knobRadius: spec.mallet.knobRadius,
    },
    // The rails' faces, the slots notched into the end rails, in order round the field.
    outline: fieldOutline(spec, 12).map(xy),
    // Exactly the walls the puck bounces off, at no inset (the models test checks the model).
    walls: {
      lines: faces.lines.map((l) => ({
        id: l.id,
        from: [l.ax, l.ay],
        to: [l.bx, l.by],
        normal: [l.nx, l.ny],
      })),
      corners: faces.corners.map((c) => ({
        id: c.id,
        center: [c.cx, c.cy],
        radius: c.r,
        quadrant: [c.qx, c.qy],
      })),
      posts: faces.posts.map((p) => ({ id: p.id, center: [p.cx, p.cy], radius: p.r })),
    },
  };
}
