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

/** A small seeded PRNG (mulberry32): the same seed always gives the same sequence. */
export type Rng = () => number;

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform number in [min, max). */
export function range(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}

/** Smooth 1-D value noise in roughly [-1, 1], built from a fixed table of random values. */
export function createNoise1D(rng: Rng, size = 256): (x: number) => number {
  const table = Array.from({ length: size }, () => rng() * 2 - 1);
  return (x: number) => {
    const i = Math.floor(x);
    const t = x - i;
    const a = table[((i % size) + size) % size]!;
    const b = table[(((i + 1) % size) + size) % size]!;
    const s = t * t * (3 - 2 * t);
    return a + (b - a) * s;
  };
}
