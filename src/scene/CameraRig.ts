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

// The two ways of looking at the table, over one scene:
//
//   3d   a perspective camera orbiting the table, by default from behind the player's goal, framed to
//        fit the part of the screen the interface leaves free; the player may turn, tilt, zoom and
//        pan it.
//   top  an orthographic camera straight down, no perspective at all, the table upright with the
//        player's own end at the bottom, as standing at a real table and looking down (with two
//        players sharing a wide screen, across it instead, each at a side); the player may turn
//        it about the vertical, zoom and pan it.
//
// Each view keeps its own turn, zoom and pan, so going to the top view and back finds the 3D view
// where it was left. Switching is a dolly zoom: the perspective camera rises overhead while its
// field of view narrows and it backs away, keeping the table the same size, until it is all but
// orthographic; then the orthographic camera takes over with the same framing. Back again the
// other way. The game and its state are untouched; only the camera moves.

import { MathUtils, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';

export type ViewMode = '3d' | 'top';

export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

interface Orbit {
  /** Radians round the table; 0 is behind seat 0's goal. In the top view, the turn from upright. */
  azimuth: number;
  elevation: number;
  /** Distance (or, in the top view, size) as a multiple of what just fits the table. */
  zoom: number;
  targetX: number;
  targetZ: number;
}

const DEG = Math.PI / 180;
const FOV = 38;
/** The field of view the switch to the top view narrows to before handing over. */
const NEAR_ORTHO_FOV = 3;
const MARGIN = 0.94;
const TRANSITION_SECONDS = 0.9;
const MIN_ELEVATION = 10 * DEG;
const MAX_ELEVATION = 88 * DEG;
const ZOOM: Record<ViewMode, readonly [number, number]> = { '3d': [0.3, 1.4], top: [0.25, 1.2] };
/** A half turn (a flip to the other end) takes this long. */
const TURN_SECONDS = 1.1;

/** The 3D view's tilt from behind the player's goal, high enough that the far goal reads clearly;
 * steeper on a tall screen, where a low view would leave the table a thin strip across the middle. */
const WIDE_ELEVATION = 44 * DEG;
const TALL_ELEVATION = 62 * DEG;

const HOME: Record<ViewMode, Orbit> = {
  '3d': { azimuth: 0, elevation: WIDE_ELEVATION, zoom: 1, targetX: 0, targetZ: 0 },
  top: { azimuth: 0, elevation: 90 * DEG, zoom: 1, targetX: 0, targetZ: 0 },
};

export class CameraRig {
  readonly perspective = new PerspectiveCamera(FOV, 1, 0.05, 60);
  readonly ortho = new OrthographicCamera(-1, 1, 1, -1, 0.05, 30);
  private width = 1;
  private height = 1;
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  /** Half extents of what must stay in view (the table to the rails' outer edges), metres. */
  private halfX = 0.8;
  private halfZ = 1.45;
  private mode: ViewMode = '3d';
  private readonly goal: Record<ViewMode, Orbit> = {
    '3d': { ...HOME['3d'] },
    top: { ...HOME.top },
  };
  private readonly current: Record<ViewMode, Orbit> = {
    '3d': { ...HOME['3d'] },
    top: { ...HOME.top },
  };
  /** A timed, eased turn of a view round the table (a flip), where plain easing would whip. */
  private turn: { mode: ViewMode; from: number; to: number; elapsed: number } | null = null;
  /** 0: fully 3D, 1: fully top; moves toward the mode. */
  private blend = 0;
  /** Whether the player has moved the 3D view; until then it follows the screen's shape. */
  private moved = false;
  /**
   * Whether turning and tilting keep the zoom. Otherwise the table is refitted to the screen at each
   * angle, which zooms in and out as the view turns.
   */
  private keepZoom = false;
  /** Whether the top view lays the table across a wide screen (two players sharing it). */
  private across = false;
  private readonly corners: Vector3[] = [];
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();

  constructor(private readonly requestRender: () => void) {}

  /** The camera to draw with now. */
  get camera(): PerspectiveCamera | OrthographicCamera {
    return this.blend >= 1 ? this.ortho : this.perspective;
  }

  get view(): ViewMode {
    return this.mode;
  }

  get moving(): boolean {
    return (
      this.blend !== (this.mode === 'top' ? 1 : 0) ||
      this.turn !== null ||
      !same(this.current['3d'], this.goal['3d']) ||
      !same(this.current.top, this.goal.top)
    );
  }

  /**
   * The table to keep in view: its outer half width and half length, and how far below and above
   * the playing surface what must be seen reaches.
   */
  setTable(halfX: number, halfZ: number, below = -0.17, above = 0.05): void {
    this.halfX = halfX;
    this.halfZ = halfZ;
    this.corners.length = 0;
    for (const x of [-halfX, halfX]) {
      for (const z of [-halfZ, halfZ]) {
        for (const y of [below, above]) this.corners.push(new Vector3(x, y, z));
      }
    }
    for (const mode of ['3d', 'top'] as const) {
      this.pan(mode, this.goal[mode].targetX, this.goal[mode].targetZ);
    }
    this.apply();
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.fitHome();
    this.apply();
  }

  /** Space the interface covers at each edge, in CSS pixels; the table is framed in the rest. */
  setInsets(insets: Insets): void {
    const old = this.insets;
    const unchanged = (['top', 'right', 'bottom', 'left'] as const).every(
      (side) => Math.abs(insets[side] - old[side]) < 0.5,
    );
    if (unchanged) return;
    this.insets = { ...insets };
    this.fitHome();
    this.apply();
  }

  setKeepZoom(on: boolean): void {
    if (on === this.keepZoom) return;
    this.keepZoom = on;
    this.apply();
  }

  setView(mode: ViewMode, immediate = false): void {
    this.mode = mode;
    if (immediate) {
      this.blend = mode === 'top' ? 1 : 0;
      this.apply();
    }
    this.requestRender();
  }

  /** Back to the view's home, from the end of the table it is looking from. */
  home(): void {
    this.stopTurn();
    Object.assign(this.goal[this.mode], this.homeOf(this.mode), { azimuth: this.endAzimuth() });
    if (this.mode === '3d') this.moved = false;
    this.requestRender();
  }

  private homeOf(mode: ViewMode): Orbit {
    if (mode === 'top') return HOME.top;
    return { ...HOME['3d'], elevation: this.landscape ? WIDE_ELEVATION : TALL_ELEVATION };
  }

  /** Until the player moves the 3D view, its tilt follows the shape of the free area. */
  private fitHome(): void {
    if (this.moved) return;
    const elevation = this.homeOf('3d').elevation;
    this.goal['3d'].elevation = elevation;
    this.current['3d'].elevation = elevation;
  }

  /**
   * Looks from one end of the table (0 the near end at azimuth 0, 1 the far one), in both views:
   * online, each player plays from behind their own goal.
   */
  lookFrom(end: 0 | 1, immediate = false): void {
    this.stopTurn();
    for (const mode of ['3d', 'top'] as const) {
      this.goal[mode].azimuth = end * Math.PI;
      if (immediate) this.current[mode].azimuth = end * Math.PI;
    }
    this.apply();
  }

  /** Turns the view half round, to look from the other end of the table. */
  flip(): void {
    const mode = this.mode;
    const from = this.current[mode].azimuth;
    const to = this.endAzimuth() + Math.PI;
    this.goal[mode].azimuth = to;
    this.turn = { mode, from, to, elapsed: 0 };
    if (mode === '3d') this.moved = true;
    this.requestRender();
  }

  /**
   * Turns and tilts the view by these angles (radians); a larger azimuth turns the table clockwise
   * on screen. The top view only turns.
   */
  orbit(dAzimuth: number, dElevation: number): void {
    this.stopTurn();
    const goal = this.goal[this.mode];
    goal.azimuth += dAzimuth;
    if (this.mode === '3d') this.moved = true;
    if (this.mode === '3d') {
      goal.elevation = MathUtils.clamp(goal.elevation + dElevation, MIN_ELEVATION, MAX_ELEVATION);
    }
    this.requestRender();
  }

  /** Zooms the view by a factor (below 1 closer). */
  zoom(factor: number): void {
    const goal = this.goal[this.mode];
    const [min, max] = ZOOM[this.mode];
    goal.zoom = MathUtils.clamp(goal.zoom * factor, min, max);
    this.requestRender();
  }

  /**
   * Moves the point looked at by this much on the cloth (scene metres), at once rather than eased,
   * so that a grabbed point of the table stays under the pointer. It stays over the table.
   */
  panBy(dx: number, dz: number): void {
    const goal = this.goal[this.mode];
    this.pan(this.mode, goal.targetX + dx, goal.targetZ + dz);
    const current = this.current[this.mode];
    current.targetX = goal.targetX;
    current.targetZ = goal.targetZ;
    this.apply();
  }

  private pan(mode: ViewMode, x: number, z: number): void {
    const goal = this.goal[mode];
    goal.targetX = MathUtils.clamp(x, -this.halfX, this.halfX);
    goal.targetZ = MathUtils.clamp(z, -this.halfZ, this.halfZ);
    this.requestRender();
  }

  /** The azimuth of the end of the table the view looks from (0 the head, π the foot). */
  private endAzimuth(): number {
    return Math.round(this.goal[this.mode].azimuth / Math.PI) * Math.PI;
  }

  /** The player takes over: a turn stops where it is. */
  private stopTurn(): void {
    if (!this.turn) return;
    this.goal[this.turn.mode].azimuth = this.current[this.turn.mode].azimuth;
    this.turn = null;
  }

  /**
   * Per frame: eases toward the goal; true when the view changed and must be drawn. At rest it does
   * nothing, so a still table is not drawn again and again.
   */
  update(dt: number): boolean {
    if (!this.moving) return false;
    const k = 1 - Math.exp(-12 * dt);
    const turn = this.turn;
    if (turn) {
      turn.elapsed += dt;
      const t = Math.min(1, turn.elapsed / TURN_SECONDS);
      this.current[turn.mode].azimuth = turn.from + (turn.to - turn.from) * smooth(t);
      if (t >= 1) this.turn = null;
    }
    for (const mode of ['3d', 'top'] as const) {
      const current = this.current[mode];
      const goal = this.goal[mode];
      for (const key of ['azimuth', 'elevation', 'zoom', 'targetX', 'targetZ'] as const) {
        if (key === 'azimuth' && turn?.mode === mode) continue;
        current[key] += (goal[key] - current[key]) * k;
        if (Math.abs(goal[key] - current[key]) < 1e-5) current[key] = goal[key];
      }
    }
    const target = this.mode === 'top' ? 1 : 0;
    if (this.blend !== target) {
      const step = dt / TRANSITION_SECONDS;
      this.blend =
        target > this.blend ? Math.min(1, this.blend + step) : Math.max(0, this.blend - step);
    }
    this.apply();
    return true;
  }

  /**
   * Whether the top view lays the table across a wide screen, each end at a side, for two players
   * sharing it; otherwise it stands upright from the player's end.
   */
  setAcross(on: boolean): void {
    if (this.across === on) return;
    this.across = on;
    this.apply();
  }

  /** Whether the free area is wider than tall. */
  private get landscape(): boolean {
    const { top, right, bottom, left } = this.insets;
    return this.width - left - right >= this.height - top - bottom;
  }

  private apply(): void {
    const { top, right, bottom, left } = this.insets;
    const freeW = Math.max(1, this.width - left - right);
    const freeH = Math.max(1, this.height - top - bottom);
    // Shift the picture so the table centres in the free area.
    const shiftX = -(left - right) / 2;
    const shiftY = -(top - bottom) / 2;

    // The top view: straight down, the screen's up along the table from the player's end (or, for
    // two players on a wide screen, across it), then turned as far as the player turned it.
    const o3 = this.current['3d'];
    const oT = this.current.top;
    const topBase = this.across && this.landscape ? 90 * DEG : 0;
    const topAzimuth = topBase + oT.azimuth;
    const t = smooth(this.blend);
    const azimuth = mixAngle(o3.azimuth, topAzimuth, t);
    const elevation = o3.elevation + (90 * DEG - 1e-4 - o3.elevation) * t;
    const fov = FOV + (NEAR_ORTHO_FOV - FOV) * t;
    const zoom = o3.zoom + (oT.zoom - o3.zoom) * t;
    const tx = o3.targetX + (oT.targetX - o3.targetX) * t;
    const tz = o3.targetZ + (oT.targetZ - o3.targetZ) * t;

    // The framing: fitted to the table as it is seen now, or, keeping the zoom, as it is seen from
    // the view's home angle and tilt, so that turning and tilting move the camera round at one
    // distance.
    const homeElevation = this.homeOf('3d').elevation;
    const fitAzimuth = this.keepZoom ? mixAngle(0, topBase, t) : azimuth;
    const fitElevation = this.keepZoom
      ? homeElevation + (90 * DEG - 1e-4 - homeElevation) * t
      : elevation;
    const tanHalf = Math.tan((fov * DEG) / 2);
    const distance = this.fitDistance(fitAzimuth, fitElevation, tanHalf, freeW, freeH) * zoom;
    const camera = this.perspective;
    camera.fov = fov;
    camera.aspect = this.width / this.height;
    camera.near = Math.max(0.02, distance * 0.05);
    camera.far = distance + 12;
    const ce = Math.cos(elevation);
    camera.position.set(
      tx + Math.sin(azimuth) * ce * distance,
      Math.sin(elevation) * distance,
      tz + Math.cos(azimuth) * ce * distance,
    );
    // "Up" on screen is away from the camera along the cloth, which stays defined overhead.
    camera.up.set(-Math.sin(azimuth), 0, -Math.cos(azimuth));
    camera.lookAt(tx, 0, tz);
    camera.setViewOffset(this.width, this.height, shiftX, shiftY, this.width, this.height);
    camera.updateProjectionMatrix();

    // The orthographic camera, framed the same way: the table's extent along the screen's right
    // and up directions, fitted to the free area.
    const ortho = this.ortho;
    const ux = -Math.sin(topAzimuth);
    const uz = -Math.cos(topAzimuth);
    const fitTop = this.keepZoom ? topBase : topAzimuth;
    const fx = -Math.sin(fitTop);
    const fz = -Math.cos(fitTop);
    const acrossScreen = Math.abs(this.halfX * fz) + Math.abs(this.halfZ * fx);
    const upScreen = Math.abs(this.halfX * fx) + Math.abs(this.halfZ * fz);
    const scale =
      Math.min((freeW * MARGIN) / (2 * acrossScreen), (freeH * MARGIN) / (2 * upScreen)) / oT.zoom;
    const halfH = this.height / (2 * scale);
    const halfW = halfH * (this.width / this.height);
    ortho.left = -halfW;
    ortho.right = halfW;
    ortho.top = halfH;
    ortho.bottom = -halfH;
    ortho.position.set(oT.targetX, 10, oT.targetZ);
    ortho.up.set(ux, 0, uz);
    ortho.lookAt(oT.targetX, 0, oT.targetZ);
    ortho.setViewOffset(this.width, this.height, shiftX, shiftY, this.width, this.height);
    ortho.updateProjectionMatrix();
    this.requestRender();
  }

  /**
   * The distance at which the table, seen from this direction, just fits the free area: for each
   * corner of the table's box, how far back the camera must be to see it inside the margin.
   */
  private fitDistance(
    azimuth: number,
    elevation: number,
    tanHalf: number,
    freeW: number,
    freeH: number,
  ): number {
    const ce = Math.cos(elevation);
    // From the camera toward the target.
    this.forward.set(-Math.sin(azimuth) * ce, -Math.sin(elevation), -Math.cos(azimuth) * ce);
    this.up.set(-Math.sin(azimuth), 0, -Math.cos(azimuth));
    this.right.crossVectors(this.forward, this.up).normalize();
    this.up.crossVectors(this.right, this.forward).normalize();
    const kx = (tanHalf * freeW * MARGIN) / this.height;
    const ky = (tanHalf * freeH * MARGIN) / this.height;
    let d = 0.5;
    for (const corner of this.corners) {
      const px = corner.dot(this.right);
      const py = corner.dot(this.up);
      const pz = corner.dot(this.forward);
      d = Math.max(d, Math.abs(px) / kx - pz, Math.abs(py) / ky - pz);
    }
    return d;
  }
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Interpolates angles the short way round. */
function mixAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

function same(a: Orbit, b: Orbit): boolean {
  return (
    a.azimuth === b.azimuth &&
    a.elevation === b.elevation &&
    a.zoom === b.zoom &&
    a.targetX === b.targetX &&
    a.targetZ === b.targetZ
  );
}
