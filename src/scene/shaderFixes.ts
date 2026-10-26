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

// A fix to three.js's lighting from rectangular lamps, applied once before any material compiles.
//
// The lamps' light (linearly transformed cosines) builds a frame around the surface normal N from
// the direction to the eye V: T1 = normalize(V − N(V·N)). Seen exactly face-on, V − N(V·N) is
// zero and the frame is NaN, and the lamp's whole contribution, diffuse and specular, drops out of
// the pixel. The top view's orthographic camera looks along one direction for the whole screen,
// straight down on the flat cloth, so whether a frame hits that case depends on the rounding of the
// camera's matrices: the lamps' light came and went from frame to frame, a flicker while the view
// moved. Face-on, the lighting is symmetric about the normal and any tangent serves; so when the
// difference is (all but) zero, a tangent is made from the normal instead.

import { ShaderChunk } from 'three';

const CHUNK = 'lights_physical_pars_fragment';
const ORIGINAL = 'T1 = normalize( V - N * dot( V, N ) );';
const FIXED = `T1 = V - N * dot( V, N );
	T1 = dot( T1, T1 ) > 1e-12 ? normalize( T1 ) : normalize( cross( N, abs( N.y ) < 0.9 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 ) ) );`;

/** Applies the fix; true once it is in place. Throws if three.js no longer has the line it fixes. */
export function fixRectAreaLights(chunks: Record<string, string> = ShaderChunk): boolean {
  const source = chunks[CHUNK];
  if (source === undefined) throw new Error(`three.js has no shader chunk ${CHUNK}`);
  if (source.includes(FIXED)) return true;
  if (!source.includes(ORIGINAL)) {
    throw new Error('three.js changed the rectangular lights; review src/scene/shaderFixes.ts');
  }
  chunks[CHUNK] = source.replace(ORIGINAL, FIXED);
  return true;
}
