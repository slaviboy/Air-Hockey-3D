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

// The fix to the rectangular lamps' light seen face-on (the top view's flicker) finds the line it
// replaces in this version of three.js, applies once, and fails loudly if three.js changes it.

import { ShaderChunk } from 'three';
import { describe, expect, it } from 'vitest';
import { fixRectAreaLights } from '../../src/scene/shaderFixes.ts';

describe('the rectangular-lamp fix', () => {
  it("replaces three.js's face-on tangent with a guarded one, once", () => {
    const chunks = { ...ShaderChunk } as Record<string, string>;
    const before = chunks.lights_physical_pars_fragment!;
    expect(before).toContain('T1 = normalize( V - N * dot( V, N ) );');
    expect(fixRectAreaLights(chunks)).toBe(true);
    const after = chunks.lights_physical_pars_fragment!;
    expect(after).not.toContain('T1 = normalize( V - N * dot( V, N ) );');
    expect(after).toContain('dot( T1, T1 ) > 1e-12');
    // Applying it again changes nothing.
    expect(fixRectAreaLights(chunks)).toBe(true);
    expect(chunks.lights_physical_pars_fragment).toBe(after);
  });

  it('refuses a three.js whose lamp code it does not recognise', () => {
    expect(() =>
      fixRectAreaLights({ lights_physical_pars_fragment: 'something else entirely' }),
    ).toThrow(/changed/);
  });
});
