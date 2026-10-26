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

// The exported models match the simulation: the acrylic walls stand on the walls the puck bounces
// off, along every straight piece of them; the mallet and the puck have the simulation's radius.
// Also checks the files are valid glTF 2.0 of a sensible size, with the parts the game looks for.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boundary } from '../../src/table/geometry.ts';
import { TABLE } from '../../src/table/spec.ts';

const root = join(import.meta.dirname, '..', '..');

interface Gltf {
  asset: { version: string };
  nodes: {
    name: string;
    mesh?: number;
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }[];
  meshes: {
    primitives: { attributes: { POSITION: number; TEXCOORD_0?: number }; indices?: number }[];
  }[];
  accessors: {
    bufferView: number;
    byteOffset?: number;
    count: number;
    type: string;
    componentType: number;
  }[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
}

function readGlb(file: string): { json: Gltf; bin: Buffer } {
  const data = readFileSync(join(root, 'public', 'models', file));
  expect(data.readUInt32LE(0)).toBe(0x46546c67); // "glTF"
  expect(data.readUInt32LE(4)).toBe(2);
  const jsonLength = data.readUInt32LE(12);
  const json = JSON.parse(data.toString('utf8', 20, 20 + jsonLength)) as Gltf;
  const binStart = 20 + jsonLength;
  const bin = data.subarray(binStart + 8, binStart + 8 + data.readUInt32LE(binStart));
  return { json, bin };
}

/** Every vertex position of a node's mesh, in glTF (scene) coordinates. */
function positions(gltf: { json: Gltf; bin: Buffer }, name: string): number[][] {
  const node = gltf.json.nodes.find((n) => n.name === name)!;
  const out: number[][] = [];
  for (const primitive of gltf.json.meshes[node.mesh!]!.primitives) {
    const accessor = gltf.json.accessors[primitive.attributes.POSITION]!;
    const view = gltf.json.bufferViews[accessor.bufferView]!;
    const stride = view.byteStride ?? 12;
    const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    for (let i = 0; i < accessor.count; i++) {
      const at = base + i * stride;
      out.push([
        gltf.bin.readFloatLE(at),
        gltf.bin.readFloatLE(at + 4),
        gltf.bin.readFloatLE(at + 8),
      ]);
    }
  }
  return out;
}

function triangles(gltf: { json: Gltf }): number {
  let count = 0;
  for (const mesh of gltf.json.meshes) {
    for (const p of mesh.primitives) {
      const accessor = gltf.json.accessors[p.indices ?? p.attributes.POSITION]!;
      count += accessor.count / 3;
    }
  }
  return count;
}

const isIdentity = (node: Gltf['nodes'][number]) =>
  (!node.translation || node.translation.every((v) => v === 0)) &&
  (!node.rotation || (node.rotation[3] === 1 && node.rotation.slice(0, 3).every((v) => v === 0))) &&
  (!node.scale || node.scale.every((v) => v === 1));

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}

describe('the table model', () => {
  const gltf = readGlb('table.glb');
  const { W, L } = TABLE;

  it('is glTF 2.0 with the parts the game uses, each placed at the origin', () => {
    expect(gltf.json.asset.version).toBe('2.0');
    const names = gltf.json.nodes.map((n) => n.name);
    for (const part of [
      'surface',
      'rail-wall',
      'rail',
      'screws',
      'cabinet',
      'panel',
      'buttons',
      'housing-0',
      'housing-1',
      'returns',
      'score-unit',
      'score-display',
      'legs',
      'feet',
    ]) {
      expect(names).toContain(part);
    }
    for (const node of gltf.json.nodes) expect(isIdentity(node), node.name).toBe(true);
    expect(triangles(gltf)).toBeLessThan(30000);
  });

  it('gives the surface and the score display texture coordinates for the game to draw on', () => {
    for (const name of ['surface', 'score-display']) {
      const node = gltf.json.nodes.find((n) => n.name === name)!;
      const primitive = gltf.json.meshes[node.mesh!]!.primitives[0]!;
      expect(primitive.attributes.TEXCOORD_0, name).toBeDefined();
    }
  });

  it('stands the acrylic walls on the walls the puck bounces off, along all of them', () => {
    const faces = boundary(TABLE, 0);
    // glTF (scene) to the table frame: x = X + W/2, y = L/2 - Z, z = Y.
    const inner: number[][] = [];
    for (const [X, Y, Z] of positions(gltf, 'rail-wall')) {
      const x = X! + W / 2;
      const y = L / 2 - Z!;
      let d = Infinity;
      for (const l of faces.lines) d = Math.min(d, segmentDistance(x, y, l.ax, l.ay, l.bx, l.by));
      for (const c of faces.corners) {
        if ((x - c.cx) * c.qx < -1e-6 || (y - c.cy) * c.qy < -1e-6) continue;
        d = Math.min(d, Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.r));
      }
      for (const p of faces.posts) d = Math.min(d, Math.abs(Math.hypot(x - p.cx, y - p.cy) - p.r));
      // The wall's face toward the field lies on the walls; its back is its thickness behind.
      if (d < 1e-4) inner.push([x, y, Y!]);
      else expect(d).toBeGreaterThan(0.004);
    }
    expect(inner.length).toBeGreaterThan(100);
    // From the surface up to the rail, and along every straight wall from end to end.
    expect(Math.min(...inner.map((p) => p[2]!))).toBeCloseTo(0, 5);
    expect(Math.max(...inner.map((p) => p[2]!))).toBeGreaterThan(TABLE.puck.thickness * 2);
    for (const l of faces.lines) {
      for (const [x, y] of [
        [l.ax, l.ay],
        [l.bx, l.by],
      ] as const) {
        if (y < -TABLE.slotDepth + 1e-9 || y > L + TABLE.slotDepth - 1e-9) continue;
        const nearest = Math.min(...inner.map(([px, py]) => Math.hypot(px! - x, py! - y)));
        expect(nearest, l.id).toBeLessThan(1e-4);
      }
    }
  });

  it('sets the playing surface at the height the puck slides on', () => {
    const tops = positions(gltf, 'surface').map((p) => p[1]!);
    expect(Math.max(...tops)).toBeCloseTo(0, 6);
    const floor = Math.min(...positions(gltf, 'feet').map((p) => p[1]!));
    expect(floor).toBeCloseTo(-TABLE.surfaceHeight, 4);
  });
});

describe('the mallet and the puck', () => {
  it('are the simulation’s sizes, standing on their base at the origin', () => {
    for (const [file, name, radius, height] of [
      ['mallet.glb', 'mallet', TABLE.mallet.radius, TABLE.mallet.height],
      ['puck.glb', 'puck', TABLE.puck.radius, TABLE.puck.thickness],
    ] as const) {
      const gltf = readGlb(file);
      const points = positions(gltf, name);
      const reach = Math.max(...points.map(([x, , z]) => Math.hypot(x!, z!)));
      expect(reach).toBeCloseTo(radius, 5);
      expect(Math.max(...points.map((p) => p[1]!))).toBeCloseTo(height, 5);
      expect(Math.min(...points.map((p) => p[1]!))).toBeGreaterThanOrEqual(-1e-6);
      expect(triangles(gltf)).toBeLessThan(8000);
    }
  });
});
