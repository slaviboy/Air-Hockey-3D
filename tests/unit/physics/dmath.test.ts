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

// The deterministic elementary functions agree with the browser's own to within a few units in the
// last place. (Agreement between browsers comes from using only correctly rounded operations, which
// the architecture tests enforce; this checks that the functions are also right.)

import { describe, expect, it } from 'vitest';
import { PI, acos, asin, cos, exp, radians, sin } from '../../../src/physics/dmath.ts';

const EPS = Number.EPSILON;

function grid(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let i = 0; from + i * step <= to; i++) out.push(from + i * step);
  return out;
}

describe('dmath', () => {
  it('has exact values where they are exact', () => {
    expect(sin(0)).toBe(0);
    expect(cos(0)).toBe(1);
    expect(exp(0)).toBe(1);
    expect(acos(1)).toBe(0);
    expect(acos(-1)).toBe(PI);
    expect(acos(0)).toBe(PI / 2);
    expect(asin(0)).toBe(0);
    expect(radians(180)).toBe(PI);
  });

  it('sin and cos match Math to 2.3e-16 absolute on [-30, 30]', () => {
    let worst = 0;
    for (const x of grid(-30, 30, 0.000731)) {
      worst = Math.max(worst, Math.abs(sin(x) - Math.sin(x)), Math.abs(cos(x) - Math.cos(x)));
    }
    expect(worst).toBeLessThan(2.3e-16);
  });

  it('sin and cos are accurate relative to their size away from zero', () => {
    let worst = 0;
    for (const x of grid(-10, 10, 0.000917)) {
      for (const [a, b] of [
        [sin(x), Math.sin(x)],
        [cos(x), Math.cos(x)],
      ] as const) {
        if (Math.abs(b) > 1e-3) worst = Math.max(worst, Math.abs(a - b) / Math.abs(b));
      }
    }
    expect(worst).toBeLessThan(6 * EPS);
  });

  it('keeps sin² + cos² at 1 to rounding', () => {
    for (const x of grid(-7, 7, 0.0123)) {
      const s = sin(x);
      const c = cos(x);
      expect(Math.abs(s * s + c * c - 1)).toBeLessThan(4 * EPS);
    }
  });

  it('exp matches Math.exp to 4 ulp on [-60, 60]', () => {
    let worst = 0;
    for (const x of grid(-60, 60, 0.00377)) {
      worst = Math.max(worst, Math.abs(exp(x) - Math.exp(x)) / Math.exp(x));
    }
    expect(worst).toBeLessThan(4 * EPS);
    expect(exp(800)).toBe(Infinity);
    expect(exp(-800)).toBe(0);
  });

  it('asin and acos match Math on [-1, 1]', () => {
    let worst = 0;
    for (const x of [...grid(-1, 1, 0.000113), -1, 1, 0.5, -0.5, 1 - 1e-12, -1 + 1e-12]) {
      worst = Math.max(worst, Math.abs(asin(x) - Math.asin(x)), Math.abs(acos(x) - Math.acos(x)));
    }
    expect(worst).toBeLessThan(1e-15);
    expect(acos(1.0000001)).toBeNaN();
    expect(asin(-1.0000001)).toBeNaN();
  });
});
