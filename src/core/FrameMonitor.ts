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

// Watches how long frames take while something animates. Idle frames (nothing to draw) are left
// out, so waiting between moves never counts, and the average runs over the latest animated
// frames however they are spread: on a slow machine a whole move animation may be a frame or two.
// The render loop keeps ticking while idle, so the first animated frame after a pause still has an
// ordinary frame time. The median is used rather than the mean, so a one-off hitch (a shader
// compiling, a texture uploading) never makes a fast machine look slow.

export class FrameMonitor {
  private readonly deltas: number[] = [];

  /**
   * @param window how many of the latest animated frames are looked at
   * @param limit the median frame time, in seconds, above which frames count as slow
   */
  constructor(
    private readonly window = 9,
    private readonly limit = 0.025,
  ) {}

  /** Records one frame; `animating` says whether it drew something that moves. */
  record(deltaSeconds: number, animating: boolean): void {
    if (!animating) return;
    this.deltas.push(deltaSeconds);
    if (this.deltas.length > this.window) this.deltas.shift();
  }

  /** Median time of the latest animated frames, in seconds (0 before any animated frame). */
  get median(): number {
    if (this.deltas.length === 0) return 0;
    const sorted = [...this.deltas].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  }

  /** True once a full window of animated frames has a median above the limit. */
  get slow(): boolean {
    return this.deltas.length >= this.window && this.median > this.limit;
  }

  reset(): void {
    this.deltas.length = 0;
  }
}
