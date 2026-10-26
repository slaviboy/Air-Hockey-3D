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

// The mallets' zones on the playing surface: a green wash over each player's zone, from their end
// rail to the line their mallet's edge stops at, and that line drawn brighter. Faint while playing
// (it can be switched off), bright for a few seconds when a match starts, so both players see
// where they may go. The zones follow the match each frame: a player fetching a puck stranded
// beyond both zones sees theirs reach to the centre line while they may go there.

import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, type Material } from 'three';
import type { Area } from '../table/geometry.ts';
import type { TableSpec } from '../table/spec.ts';

const GREEN = '#2fe079';
/** The wash's and the line's opacity at full strength. */
const FILL = 0.2;
const LINE = 0.95;
/** How bright the zones show while playing, as a share of full strength. */
const PLAYING = 0.35;
/** Seconds the zones stay bright after a match begins. */
const BRIGHT_SECONDS = 3;
const LINE_WIDTH = 0.008;

export class ZoneView {
  readonly group = new Group();
  private readonly fillMaterial = new MeshBasicMaterial({
    color: GREEN,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly lineMaterial = new MeshBasicMaterial({
    color: GREEN,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly plane = new PlaneGeometry(1, 1);
  /** Each seat's wash and front line. */
  private readonly parts: { fill: Mesh; line: Mesh }[] = [];
  /** How far each zone reaches from its end rail, as drawn now. */
  private readonly fronts = [0, 0];
  /** Whether the zones show while playing (the player's setting). */
  private shown = true;
  private bright = 0;
  private level = 0;

  constructor(private readonly spec: TableSpec) {
    this.group.name = 'zones';
    for (let seat = 0; seat < 2; seat++) {
      const fill = new Mesh(this.plane, this.fillMaterial);
      const line = new Mesh(this.plane, this.lineMaterial);
      for (const mesh of [fill, line]) {
        mesh.rotation.x = -Math.PI / 2;
        mesh.renderOrder = 1;
        this.group.add(mesh);
      }
      this.parts.push({ fill, line });
    }
  }

  /** Draws the zones as these areas of the mallets' centres make them. */
  setAreas(areas: readonly [Area, Area]): boolean {
    const { W, L } = this.spec;
    const m = this.spec.mallet.radius;
    const fronts = [areas[0].y1 + m, L - (areas[1].y0 - m)];
    if (fronts[0] === this.fronts[0] && fronts[1] === this.fronts[1]) return false;
    for (const seat of [0, 1] as const) {
      const front = fronts[seat]!;
      this.fronts[seat] = front;
      // Scene z = L/2 - y: seat 0's end (y = 0) is at +L/2, seat 1's at -L/2.
      const end = seat === 0 ? 1 : -1;
      const { fill, line } = this.parts[seat]!;
      fill.scale.set(W, front, 1);
      fill.position.set(0, 0.0004, end * (L / 2 - front / 2));
      line.scale.set(W, LINE_WIDTH, 1);
      line.position.set(0, 0.0005, end * (L / 2 - front));
    }
    return true;
  }

  /** Whether the zones show, faintly, while playing. */
  setShown(on: boolean): void {
    this.shown = on;
  }

  /** Shows the zones brightly for a moment (a match began). */
  flash(): void {
    this.bright = BRIGHT_SECONDS;
  }

  /** Follows the match's zones and eases toward the brightness wanted; true while changing. */
  update(dt: number, areas: readonly [Area, Area]): boolean {
    const moved = this.setAreas(areas);
    this.bright = Math.max(0, this.bright - dt);
    const goal = this.bright > 0 ? 1 : this.shown ? PLAYING : 0;
    const k = 1 - Math.exp(-6 * dt);
    const before = this.level;
    this.level += (goal - this.level) * k;
    if (Math.abs(goal - this.level) < 0.002) this.level = goal;
    this.fillMaterial.opacity = FILL * this.level;
    this.lineMaterial.opacity = LINE * this.level;
    this.group.visible = this.level > 0;
    return moved || this.level !== before;
  }

  dispose(): void {
    this.plane.dispose();
    for (const material of [this.fillMaterial, this.lineMaterial] as Material[]) material.dispose();
  }
}
