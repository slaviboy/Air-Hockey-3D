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

// The cameras: at rest they ask for no frames; turning refits the table to the screen, or, with
// the zoom kept, moves round it at one distance and one size, in the 3D and the top view.

import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig } from '../../src/scene/CameraRig.ts';

function rig(keepZoom: boolean) {
  let frames = 0;
  const r = new CameraRig(() => frames++);
  r.setTable(0.8, 1.45);
  r.setSize(1280, 800);
  r.setKeepZoom(keepZoom);
  r.setView('3d', true);
  settle(r);
  return { r, frames: () => frames };
}

/** Runs frames until the camera rests; how many it took. */
function settle(r: CameraRig): number {
  let n = 0;
  while (r.update(1 / 60)) if (++n > 2000) throw new Error('never settles');
  return n;
}

const distance = (r: CameraRig) => r.perspective.position.length();
const frameHeight = (r: CameraRig) => r.ortho.top - r.ortho.bottom;

describe('the camera rig', () => {
  it('asks for no frames while nothing moves', () => {
    const { r } = rig(false);
    expect(r.update(1 / 60)).toBe(false);
    r.orbit(0.2, 0);
    expect(r.update(1 / 60)).toBe(true);
    expect(settle(r)).toBeGreaterThan(5);
    expect(r.update(1 / 60)).toBe(false);
  });

  it('refits the table at each angle unless the zoom is kept (3D)', () => {
    for (const keep of [false, true]) {
      const { r } = rig(keep);
      const start = distance(r);
      r.orbit(Math.PI / 4, 0);
      settle(r);
      if (keep) expect(distance(r)).toBeCloseTo(start, 9);
      else expect(Math.abs(distance(r) - start)).toBeGreaterThan(0.1);
      // Tilting keeps it too.
      r.orbit(0, 0.3);
      settle(r);
      if (keep) expect(distance(r)).toBeCloseTo(start, 9);
    }
  });

  it('keeps the top view the same size while it turns, when asked', () => {
    for (const keep of [false, true]) {
      const { r } = rig(keep);
      r.setView('top', true);
      settle(r);
      const start = frameHeight(r);
      r.orbit(Math.PI / 5, 0);
      settle(r);
      if (keep) expect(frameHeight(r)).toBeCloseTo(start, 9);
      else expect(frameHeight(r)).toBeGreaterThan(start * 1.2);
    }
  });

  it('hands over from the 3D to the top view at the same framing, with the zoom kept', () => {
    const { r } = rig(true);
    r.orbit(0.7, 0);
    settle(r);
    r.setView('top');
    // The table's corner where the last perspective frame shows it, and the first orthographic one.
    const corner = () => new Vector3(0.8, 0, 1.45).project(r.camera);
    let before = corner();
    let guard = 0;
    while (r.camera === r.perspective && guard++ < 500) {
      r.perspective.updateMatrixWorld();
      before = corner();
      r.update(1 / 60);
    }
    r.ortho.updateMatrixWorld();
    const after = corner();
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(0.03);
    expect(r.camera).toBe(r.ortho);
  });

  it('looks from either end of the table, in both views', () => {
    const { r } = rig(true);
    r.lookFrom(1, true);
    settle(r);
    // From behind the far end (scene -Z), still level with the table's middle across.
    expect(r.perspective.position.z).toBeLessThan(0);
    expect(r.perspective.position.x).toBeCloseTo(0, 6);
    r.lookFrom(0);
    settle(r);
    expect(r.perspective.position.z).toBeGreaterThan(0);
    // The top view turns with it: the screen's up runs the other way along the table.
    r.setView('top', true);
    const up0 = r.ortho.up.clone();
    r.lookFrom(1, true);
    settle(r);
    expect(r.ortho.up.dot(up0)).toBeCloseTo(-1, 6);
  });

  it('keeps in view what stands above the surface when told how high it reaches', () => {
    const low = new CameraRig(() => undefined);
    const high = new CameraRig(() => undefined);
    for (const [r, above] of [
      [low, 0.05],
      [high, 1.5],
    ] as const) {
      r.setTable(0.65, 1.3, -0.04, above);
      r.setSize(1280, 800);
      r.setView('3d', true);
      settle(r);
    }
    expect(high.perspective.position.length()).toBeGreaterThan(low.perspective.position.length());
  });
});
