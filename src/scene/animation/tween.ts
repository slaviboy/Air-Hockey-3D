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

// A small promise-based tween runner driven by the render loop. Each tween calls back with its
// progress from 0 to 1 and resolves when done. Speed scales every duration; at speed 0 tweens jump
// straight to their end, which is also what finishAll() does to tweens already running.

export type Easing = (t: number) => number;

export const linear: Easing = (t) => t;
export const easeInOutCubic: Easing = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const easeOutCubic: Easing = (t) => 1 - (1 - t) ** 3;
export const easeInOutSine: Easing = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

/** Steady speed with gentle acceleration over the first and last `ramp` of the time. */
export function easeTrapezoid(ramp = 0.18): Easing {
  const r = Math.min(0.49, Math.max(0.01, ramp));
  const peak = 1 / (1 - r); // velocity on the flat part so the area is 1
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    if (t < r) return (peak * t * t) / (2 * r);
    if (t > 1 - r) {
      const u = 1 - t;
      return 1 - (peak * u * u) / (2 * r);
    }
    return peak * (t - r / 2);
  };
}

interface ActiveTween {
  readonly duration: number;
  elapsed: number;
  readonly update: (progress: number) => void;
  readonly easing: Easing;
  readonly resolve: () => void;
}

export class Tweener {
  private readonly active = new Set<ActiveTween>();
  /** Multiplies every duration; 0 makes animations instant. */
  speed = 1;

  get running(): boolean {
    return this.active.size > 0;
  }

  /** Runs `update(progress)` over `seconds` (scaled by speed) and resolves at the end. */
  run(
    seconds: number,
    update: (progress: number) => void,
    easing: Easing = easeInOutCubic,
  ): Promise<void> {
    const duration = seconds * this.speed;
    if (duration <= 0) {
      update(1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      update(0);
      this.active.add({ duration, elapsed: 0, update, easing, resolve });
    });
  }

  wait(seconds: number): Promise<void> {
    return this.run(seconds, () => {}, linear);
  }

  /** Advances every tween; returns true while any is still running. */
  update(delta: number): boolean {
    for (const tween of [...this.active]) {
      tween.elapsed += delta;
      const t = Math.min(1, tween.elapsed / tween.duration);
      tween.update(tween.easing(t));
      if (t >= 1) {
        this.active.delete(tween);
        tween.resolve();
      }
    }
    return this.active.size > 0;
  }

  /** Jumps every running tween to its end. */
  finishAll(): void {
    for (const tween of [...this.active]) {
      this.active.delete(tween);
      tween.update(tween.easing(1));
      tween.resolve();
    }
  }
}
