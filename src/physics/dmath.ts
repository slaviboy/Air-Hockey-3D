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

// Deterministic elementary functions for the simulation.
//
// Both players' browsers simulate every shot, and the results must agree to the last bit. The
// language guarantees that + - * / and Math.sqrt are correctly rounded, but leaves Math.sin, cos,
// exp, pow, atan2 and the ** operator "implementation-approximated": two engines may differ in the
// last digit, and a billiards break magnifies one digit into a different game. So the simulation
// uses these functions instead, built only from the guaranteed operations. They are accurate to a
// few units in the last place, which is far more than the physics needs; what matters is that
// every engine computes exactly the same value.

export const PI = Math.PI;
const HALF_PI = PI / 2;

// π/2 in three pieces. The first two carry 33 significant bits, so n times either is exact for
// any |n| below 2^20, and x - n·(π/2) can be formed without losing the low bits.
const PIO2_1 = 1.5707963267341256;
const PIO2_2 = 6.077100506303966e-11;
const PIO2_3 = 2.0222662487111665e-21;
const TWO_OVER_PI = 2 / PI;

// Taylor coefficients, Horner order in r² (exact factorials, each divided once).
const S1 = -1 / 6;
const S2 = 1 / 120;
const S3 = -1 / 5040;
const S4 = 1 / 362880;
const S5 = -1 / 39916800;
const S6 = 1 / 6227020800;
const S7 = -1 / 1307674368000;
const S8 = 1 / 355687428096000;
const C1 = -1 / 2;
const C2 = 1 / 24;
const C3 = -1 / 720;
const C4 = 1 / 40320;
const C5 = -1 / 3628800;
const C6 = 1 / 479001600;
const C7 = -1 / 87178291200;
const C8 = 1 / 20922789888000;
const C9 = -1 / 6402373705728000;

/** sin(r) for |r| ≤ π/4. */
function sinKernel(r: number): number {
  const z = r * r;
  return (
    r + r * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * (S6 + z * (S7 + z * S8)))))))
  );
}

/** cos(r) for |r| ≤ π/4. */
function cosKernel(r: number): number {
  const z = r * r;
  return (
    1 +
    z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * (C6 + z * (C7 + z * (C8 + z * C9))))))))
  );
}

/** The quadrant (0–3) and the remainder in [-π/4, π/4] of x: x = q·(π/2) + r. */
function reduce(x: number, out: { q: number; r: number }): void {
  if (Math.abs(x) <= PI / 4) {
    out.q = 0;
    out.r = x;
    return;
  }
  const n = Math.round(x * TWO_OVER_PI);
  out.r = x - n * PIO2_1 - n * PIO2_2 - n * PIO2_3;
  out.q = ((n % 4) + 4) % 4;
}

const scratch = { q: 0, r: 0 };

/** Sine, for arguments well inside ±10^5. */
export function sin(x: number): number {
  reduce(x, scratch);
  const r = scratch.r;
  switch (scratch.q) {
    case 0:
      return sinKernel(r);
    case 1:
      return cosKernel(r);
    case 2:
      return -sinKernel(r);
    default:
      return -cosKernel(r);
  }
}

/** Cosine, for arguments well inside ±10^5. */
export function cos(x: number): number {
  reduce(x, scratch);
  const r = scratch.r;
  switch (scratch.q) {
    case 0:
      return cosKernel(r);
    case 1:
      return -sinKernel(r);
    case 2:
      return -cosKernel(r);
    default:
      return sinKernel(r);
  }
}

/** Degrees to radians, the same way everywhere. */
export function radians(degrees: number): number {
  return degrees * (PI / 180);
}

// ln 2 in two pieces; the first has trailing zero bits, so k·LN2_HI is exact.
const LN2_HI = 0.6931471803691238;
const LN2_LO = 1.9082149292705877e-10;
const INV_LN2 = 1.4426950408889634;
const E1 = 1;
const E2 = 1 / 2;
const E3 = 1 / 6;
const E4 = 1 / 24;
const E5 = 1 / 120;
const E6 = 1 / 720;
const E7 = 1 / 5040;
const E8 = 1 / 40320;
const E9 = 1 / 362880;
const E10 = 1 / 3628800;
const E11 = 1 / 39916800;
const E12 = 1 / 479001600;
const E13 = 1 / 6227020800;

/** e^x. Exact powers of two scale the reduced result, so no rounding depends on the engine. */
export function exp(x: number): number {
  if (x !== x) return NaN;
  if (x > 709) return Infinity;
  if (x < -745) return 0;
  const k = Math.round(x * INV_LN2);
  const r = x - k * LN2_HI - k * LN2_LO;
  let y =
    1 +
    r *
      (E1 +
        r *
          (E2 +
            r *
              (E3 +
                r *
                  (E4 +
                    r *
                      (E5 +
                        r *
                          (E6 +
                            r *
                              (E7 +
                                r *
                                  (E8 +
                                    r * (E9 + r * (E10 + r * (E11 + r * (E12 + r * E13))))))))))));
  // Multiplying by 2 or ½ is exact (no subnormal results occur in the range the physics uses).
  if (k > 0) for (let i = 0; i < k; i++) y *= 2;
  else for (let i = 0; i > k; i--) y *= 0.5;
  return y;
}

// arcsine series: asin z = Σ c_n z^(2n+1), c_n = (2n)! / (4^n (n!)² (2n+1)). Used for |z| ≤ ½,
// where 26 terms reach full double precision.
const ASIN_TERMS = 26;
const ASIN_C: number[] = [];
{
  let t = 1;
  for (let n = 0; n < ASIN_TERMS; n++) {
    if (n > 0) t = (t * (2 * n - 1)) / (2 * n);
    ASIN_C.push(t / (2 * n + 1));
  }
}

function asinSmall(z: number): number {
  const z2 = z * z;
  let sum = ASIN_C[ASIN_TERMS - 1]!;
  for (let n = ASIN_TERMS - 2; n >= 0; n--) sum = sum * z2 + ASIN_C[n]!;
  return z * sum;
}

/** Arcsine on [-1, 1]. */
export function asin(x: number): number {
  if (!(x >= -1 && x <= 1)) return NaN;
  const a = Math.abs(x);
  if (a <= 0.5) return asinSmall(x);
  const y = HALF_PI - 2 * asinSmall(Math.sqrt((1 - a) / 2));
  return x < 0 ? -y : y;
}

/** Arccosine on [-1, 1], in [0, π]. */
export function acos(x: number): number {
  if (!(x >= -1 && x <= 1)) return NaN;
  if (x > 0.5) return 2 * asinSmall(Math.sqrt((1 - x) / 2));
  if (x < -0.5) return PI - 2 * asinSmall(Math.sqrt((1 + x) / 2));
  return HALF_PI - asinSmall(x);
}
