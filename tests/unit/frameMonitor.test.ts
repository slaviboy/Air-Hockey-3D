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

import { describe, expect, it } from 'vitest';
import { FrameMonitor } from '../../src/core/FrameMonitor.ts';

describe('FrameMonitor', () => {
  it('flags a full window of slow animated frames', () => {
    const monitor = new FrameMonitor(9, 0.025);
    for (let i = 0; i < 8; i++) monitor.record(0.04, true);
    expect(monitor.slow).toBe(false); // not a full window yet
    monitor.record(0.04, true);
    expect(monitor.slow).toBe(true);
    expect(monitor.median).toBeCloseTo(0.04);
  });

  it('ignores hitches at a smooth frame rate', () => {
    const monitor = new FrameMonitor(9, 0.025);
    // A shader compiling on the first frame, then the odd stall.
    monitor.record(0.1, true);
    for (let i = 0; i < 50; i++) monitor.record(i % 4 === 0 ? 0.1 : 0.016, true);
    expect(monitor.slow).toBe(false);
  });

  it('only looks at the latest frames', () => {
    const monitor = new FrameMonitor(9, 0.025);
    for (let i = 0; i < 9; i++) monitor.record(0.05, true);
    for (let i = 0; i < 9; i++) monitor.record(0.016, true);
    expect(monitor.median).toBeCloseTo(0.016);
    expect(monitor.slow).toBe(false);
  });

  it('leaves idle frames out, so short animations between pauses still add up', () => {
    const monitor = new FrameMonitor(9, 0.025);
    // A slow machine: each move animates for two frames, with idle frames in between.
    for (let move = 0; move < 5; move++) {
      monitor.record(0.1, true);
      monitor.record(0.1, true);
      for (let i = 0; i < 20; i++) monitor.record(0.016, false);
    }
    expect(monitor.slow).toBe(true);
    monitor.reset();
    expect(monitor.median).toBe(0);
  });
});
