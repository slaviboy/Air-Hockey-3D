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

// window.__hockeyDebug: what the end-to-end tests drive and read, without going through the
// interface for everything (Pool's debug hook). It exposes the match and lets a test put the puck
// somewhere and send a mallet somewhere, nothing an opponent could use against the player: online
// games remove it, as the sister games do.

import type { ViewMode } from '../scene/CameraRig.ts';
import type { App } from './App.ts';

export interface HockeyDebug {
  match(): {
    mode: string;
    phase: string;
    score: readonly number[];
    target: number;
    server: number;
    winner: number | null;
    goals: number;
    paused: boolean;
    time: number;
  };
  puck(): { x: number; y: number; vx: number; vy: number; live: boolean };
  mallet(seat: 0 | 1): { x: number; y: number; vx: number; vy: number };
  /** Puts the puck at (x, y) moving at (vx, vy), in the table's frame. */
  shoot(x: number, y: number, vx: number, vy: number): void;
  /** Sends a mallet toward a point, as a pointer would. */
  drive(seat: 0 | 1, x: number, y: number): void;
  /** Where a point of the table (z above the surface) appears in the window. */
  toClient(x: number, y: number, z?: number): { x: number; y: number };
  table(): { W: number; L: number };
  setView(mode: ViewMode, immediate?: boolean): void;
  view(): ViewMode;
  /** Whether the camera has come to rest. */
  cameraSettled(): boolean;
  render(): void;
}

declare global {
  interface Window {
    __hockeyDebug?: HockeyDebug;
  }
}

export function installDebugHook(app: App): void {
  window.__hockeyDebug = {
    match: () => {
      const s = app.match.current;
      return {
        mode: app.match.setup.mode,
        phase: s.phase,
        score: s.score,
        target: s.target,
        server: s.server,
        winner: s.winner,
        goals: s.goals,
        paused: app.match.paused,
        time: app.match.time,
      };
    },
    puck: () => {
      const { x, y, vx, vy } = app.match.world.puck;
      return { x, y, vx, vy, live: app.match.world.live };
    },
    mallet: (seat) => {
      const { x, y, vx, vy } = app.match.world.mallets[seat];
      return { x, y, vx, vy };
    },
    shoot(x, y, vx, vy) {
      Object.assign(app.match.world.puck, { x, y, vx, vy });
    },
    drive(seat, x, y) {
      app.match.targets[seat] = { x, y };
    },
    toClient: (x, y, z) => app.toClient(x, y, z),
    table: () => ({ W: app.match.spec.W, L: app.match.spec.L }),
    setView: (mode, immediate) => app.setView(mode, immediate),
    view: () => app.rig.view,
    cameraSettled: () => !app.rig.moving,
    render: () => app.scene.renderNow(),
  };
}

export function removeDebugHook(): void {
  delete window.__hockeyDebug;
}
