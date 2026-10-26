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

// The mallets and the puck on screen (public/models/mallet.glb and puck.glb, made in Blender), each
// with a soft shadow under it, drawn where the match says, between its last two steps. The match
// leads and the meshes follow: a puck gone into a goal slides on into the slot and drops out of
// sight; one taken up after a foul fades away; a served puck is set down on its spot.

import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, type Material, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Match, MatchEvent } from '../game/Match.ts';
import type { Seat } from '../rules/types.ts';
import { toScene } from '../table/frame.ts';
import type { TableSpec } from '../table/spec.ts';
import { contactShadowTexture, SHADOW_SPREAD } from './contactShadow.ts';
import { malletMaterial, puckMaterial } from './surfaces.ts';

/** Seconds a scored puck takes to slide into the slot and drop away. */
const DROP_SECONDS = 0.45;
/** Seconds a served puck takes to settle on its spot. */
const SERVE_SECONDS = 0.3;

export class PiecesView {
  readonly group = new Group();
  private readonly loader = new GLTFLoader();
  private mallets: [Object3D, Object3D] | null = null;
  private puck: Object3D | null = null;
  private readonly shadowGeometry = new PlaneGeometry(1, 1);
  private readonly shadowMaterial = new MeshBasicMaterial({
    map: contactShadowTexture(),
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly shadows: Mesh[] = [];
  private readonly materials: Material[] = [];
  /** Seconds since the puck left play (into a goal or taken up), or -1 while it is in play. */
  private out = -1;
  /** Whether it left play into a goal (it slides on), rather than being taken up. */
  private intoGoal = false;
  /** Seconds since the puck was served. */
  private served = SERVE_SECONDS;
  private readonly at = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly baseUrl: string,
    private readonly spec: TableSpec,
  ) {
    this.group.name = 'pieces';
  }

  async load(): Promise<void> {
    const [mallet, puck] = await Promise.all([
      this.loader.loadAsync(`${this.baseUrl}models/mallet.glb`),
      this.loader.loadAsync(`${this.baseUrl}models/puck.glb`),
    ]);
    const make = (seat: Seat): Object3D => {
      const copy = mallet.scene.clone(true);
      copy.name = `mallet-${seat}`;
      const body = malletMaterial(seat);
      this.materials.push(body);
      copy.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        if ((mesh.material as Material).name === 'mallet') mesh.material = body;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      });
      return copy;
    };
    const mallets: [Object3D, Object3D] = [make(0), make(1)];
    const disc = puck.scene;
    disc.name = 'puck';
    const surface = puckMaterial();
    this.materials.push(surface);
    disc.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.material = surface;
      mesh.castShadow = true;
    });
    this.mallets = mallets;
    this.puck = disc;
    for (const radius of [
      this.spec.mallet.radius,
      this.spec.mallet.radius,
      this.spec.puck.radius,
    ]) {
      const shadow = new Mesh(this.shadowGeometry, this.shadowMaterial);
      shadow.rotation.x = -Math.PI / 2;
      shadow.scale.setScalar(radius * 2 * SHADOW_SPREAD);
      shadow.renderOrder = 2;
      this.shadows.push(shadow);
    }
    this.group.add(mallets[0], mallets[1], disc, ...this.shadows);
  }

  /** Follows what happens to the puck: a goal, a foul, a serve. */
  onEvent(event: MatchEvent): void {
    if (event.kind === 'goal' || event.kind === 'foul') {
      this.out = 0;
      this.intoGoal = event.kind === 'goal';
    } else if (event.kind === 'served') {
      this.out = -1;
      this.served = 0;
    }
  }

  /** Places everything as the match is now. Returns whether an animation is under way. */
  update(match: Match, dt: number): boolean {
    if (!this.mallets || !this.puck) return false;
    const { W, L } = this.spec;
    for (const seat of [0, 1] as Seat[]) {
      const p = match.malletAt(seat);
      toScene(p.x, p.y, 0, W, L, this.at);
      this.mallets[seat].position.set(this.at.x, this.at.y, this.at.z);
      this.shadows[seat]!.position.set(this.at.x, 0.0007, this.at.z);
    }
    const p = match.puckAt();
    toScene(p.x, p.y, 0, W, L, this.at);
    const puck = this.puck;
    const shadow = this.shadows[2]!;
    puck.position.set(this.at.x, 0, this.at.z);
    shadow.position.set(this.at.x, 0.0006, this.at.z);
    let animating: boolean;
    if (this.out >= 0) {
      this.out += dt;
      const t = Math.min(1, this.out / DROP_SECONDS);
      if (this.intoGoal) {
        // On along the slot, then down into the return.
        const goal = match.world.goal;
        const inward = goal === 0 ? 1 : -1;
        puck.position.z += inward * 0.05 * t;
        puck.position.y = -0.06 * t * t;
        puck.scale.setScalar(1);
      } else {
        puck.scale.setScalar(1 - 0.6 * t);
      }
      puck.visible = t < 1;
      shadow.visible = t < 0.3;
      animating = t < 1;
    } else {
      puck.visible = true;
      shadow.visible = true;
      this.served = Math.min(SERVE_SECONDS, this.served + dt);
      const t = this.served / SERVE_SECONDS;
      // Set down from just above its spot.
      puck.position.y = 0.04 * (1 - t) * (1 - t);
      puck.scale.setScalar(1);
      animating = t < 1;
    }
    return animating;
  }

  dispose(): void {
    this.shadowGeometry.dispose();
    this.shadowMaterial.map?.dispose();
    this.shadowMaterial.dispose();
    for (const m of this.materials) m.dispose();
  }
}
