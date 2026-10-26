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

// The table on screen: the model made in Blender (public/models/table.glb), which is already in the
// scene's frame, with the game's own surfaces put in by material name (Pool's TableView): the lit
// playing surface, the acrylic, the rail, the cabinet in the chosen finish, and the score unit's
// display showing the match's score.

import {
  Group,
  type Material,
  type Mesh,
  type MeshPhysicalMaterial,
  type MeshStandardMaterial,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { TableSpec } from '../table/spec.ts';
import { ScoreDisplay } from './ScoreDisplay.ts';
import {
  cabinetMaterial,
  type FinishName,
  panelColour,
  railMaterial,
  surfaceMaterial,
  wallMaterial,
} from './surfaces.ts';

/** Parts that throw a shadow, and parts that show one. */
const CASTS = new Set(['rail', 'cabinet', 'housing-0', 'housing-1', 'score-unit', 'legs', 'feet']);
const RECEIVES = new Set(['surface', 'rail', 'rail-wall', 'housing-0', 'housing-1', 'score-unit']);

export class TableView {
  readonly group = new Group();
  readonly display = new ScoreDisplay();
  private readonly loader = new GLTFLoader();
  private model: Promise<Object3D> | null = null;
  private finish: FinishName = 'silver';
  private cabinet: MeshPhysicalMaterial = cabinetMaterial('silver');
  private panel: MeshStandardMaterial | null = null;
  private readonly materials: Material[] = [];

  constructor(
    private readonly baseUrl: string,
    private readonly spec: TableSpec,
  ) {
    this.group.name = 'table';
  }

  /** Loads the table and puts it in the scene; resolves once it is there. */
  async show(): Promise<void> {
    this.model ??= this.loader.loadAsync(`${this.baseUrl}models/table.glb`).then((gltf) => {
      const root = gltf.scene;
      root.name = 'table-model';
      root.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const parts = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const swapped = parts.map((m) => this.surface(m));
        mesh.material = Array.isArray(mesh.material) ? swapped : swapped[0]!;
        mesh.castShadow = CASTS.has(mesh.name);
        mesh.receiveShadow = RECEIVES.has(mesh.name);
        // The acrylic is see-through: draw it after the surface it stands on.
        if (mesh.name === 'rail-wall') mesh.renderOrder = 1;
      });
      return root;
    });
    const model = await this.model;
    if (model.parent !== this.group) this.group.add(model);
  }

  /** The cabinet's finish: silver panels with black caps, or all black. */
  setFinish(finish: FinishName): void {
    if (finish === this.finish) return;
    this.finish = finish;
    const next = cabinetMaterial(finish);
    this.group.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((m) => (m === this.cabinet ? next : m));
      } else if (mesh.material === this.cabinet) {
        mesh.material = next;
      }
    });
    this.cabinet.dispose();
    this.cabinet = next;
    this.panel?.color.copy(panelColour(finish));
  }

  /** Shows the score on the table's own display, seat 0's first. */
  setScore(a: number, b: number): void {
    this.display.show(a, b);
  }

  /** The game's version of a model material, chosen by its name. */
  private surface(material: Material): Material {
    const name = material.name;
    let next: Material | null = null;
    if (name === 'surface') next = surfaceMaterial(this.spec);
    else if (name === 'rail-wall') next = wallMaterial();
    else if (name === 'rail-top') next = railMaterial();
    else if (name === 'cabinet') next = this.cabinet;
    else if (name === 'display') next = this.display.material;
    else if (name === 'panel') {
      this.panel = material as MeshStandardMaterial;
      this.panel.color.copy(panelColour(this.finish));
      return material;
    }
    if (!next) return material;
    material.dispose();
    if (next !== this.cabinet && next !== this.display.material) this.materials.push(next);
    return next;
  }

  dispose(): void {
    this.cabinet.dispose();
    this.display.dispose();
    for (const m of this.materials) m.dispose();
  }
}
