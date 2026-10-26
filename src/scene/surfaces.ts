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

// The table's surfaces, which the models carry only as plain colours (blender/scripts/materials.py):
// the playing surface lit from within, its markings and its grid of air holes; the acrylic walls
// glowing with it; the cabinet's speckled powder coat in either finish; the mallets' and the puck's
// plastics. The holes and the speckle are drawn from the world position (Pool's way with the cloth
// and the wood), so they stay sharp at any distance without a texture.

import { CanvasTexture, Color, MeshPhysicalMaterial, SRGBColorSpace, type Texture } from 'three';
import type { Seat } from '../rules/types.ts';
import type { TableSpec } from '../table/spec.ts';

/** The cabinet's finishes, as in the reference: silver panels with black caps, or all black. */
export const FINISHES = {
  silver: { cabinet: '#c3c5c8', speck: 0.62, panel: '#a9abae' },
  black: { cabinet: '#17181b', speck: 1.9, panel: '#26272b' },
} as const;
export type FinishName = keyof typeof FINISHES;

/** Each seat's mallet. */
export const MALLET_COLOURS: Record<Seat, string> = { 0: '#d21f2b', 1: '#17a05a' };

/** The playing surface's blue, at its middle and at its edges. */
const SURFACE = { middle: '#2e72f2', edge: '#1c55dc' } as const;

const NOISE = /* glsl */ `
float hockeyHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float hockeyNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hockeyHash(i), hockeyHash(i + vec3(1, 0, 0)), f.x),
                 mix(hockeyHash(i + vec3(0, 1, 0)), hockeyHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hockeyHash(i + vec3(0, 0, 1)), hockeyHash(i + vec3(1, 0, 1)), f.x),
                 mix(hockeyHash(i + vec3(0, 1, 1)), hockeyHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

/** Adds the world position to a material's shaders and runs `colourCode` on its colour. */
function withWorldPosition(material: MeshPhysicalMaterial, colourCode: string, key: string) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHockeyWorld;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n  vHockeyWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vHockeyWorld;\n${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${colourCode}`);
  };
  material.customProgramCacheKey = () => key;
}

/** Air holes every this many metres, in rows across the surface. */
const HOLE_PITCH = 0.025;
const HOLE_RADIUS = 0.0011;

/**
 * The playing surface's markings drawn on a canvas laid over its texture coordinates (u across
 * from the left rail, the canvas's top at seat 1's end): the blue, brighter in the middle as under
 * its lights; the centre line; the centre circle with the game's mark in it.
 */
export function drawMarkings(canvas: HTMLCanvasElement, spec: TableSpec): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  const sx = width / spec.W;
  const sy = height / spec.L;
  const glow = ctx.createRadialGradient(
    width / 2,
    height / 2,
    0,
    width / 2,
    height / 2,
    height * 0.62,
  );
  glow.addColorStop(0, SURFACE.middle);
  glow.addColorStop(1, SURFACE.edge);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#f3f6ff';
  ctx.fillStyle = '#f3f6ff';
  // The centre line across the width.
  const line = 0.012 * sy;
  ctx.fillRect(0, height / 2 - line / 2, width, line);
  // The centre circle, and inside it the mark: a mallet and a puck either side of the line.
  const ellipse = (x: number, y: number, r: number) => {
    ctx.beginPath();
    ctx.ellipse(width / 2 + x * sx, height / 2 - y * sy, r * sx, r * sy, 0, 0, Math.PI * 2);
  };
  ctx.lineWidth = 0.011 * sx;
  ellipse(0, 0, 0.115);
  ctx.stroke();
  ctx.lineWidth = 0.007 * sx;
  ellipse(-0.032, -0.036, 0.038);
  ctx.stroke();
  ellipse(-0.032, -0.036, 0.019);
  ctx.fill();
  ellipse(0.04, 0.042, 0.026);
  ctx.fill();
}

/**
 * The playing surface: glossy, lit from within (its markings glow as well), and pierced by the
 * air holes, which fade to the surface's average shade where they grow too small to see.
 */
export function surfaceMaterial(spec: TableSpec, size = 1024): MeshPhysicalMaterial {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size * 2;
  drawMarkings(canvas, spec);
  const map = markingsTexture(canvas);
  const material = new MeshPhysicalMaterial({
    color: '#ffffff',
    map,
    emissive: '#ffffff',
    emissiveMap: map,
    emissiveIntensity: 0.34,
    roughness: 0.42,
    metalness: 0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.32,
    envMapIntensity: 0.6,
  });
  material.name = 'surface';
  withWorldPosition(
    material,
    /* glsl */ `
  vec2 cell = vHockeyWorld.xz / ${HOLE_PITCH.toFixed(4)};
  // Every other row is set half a pitch across, as the holes of a real surface are.
  cell.x += 0.5 * mod(floor(cell.y), 2.0);
  vec2 offset = (fract(cell) - 0.5) * ${HOLE_PITCH.toFixed(4)};
  float d = length(offset);
  float edge = fwidth(d) + 1e-5;
  float hole = 1.0 - smoothstep(${HOLE_RADIUS.toFixed(4)} - edge, ${HOLE_RADIUS.toFixed(4)} + edge, d);
  // Far away a hole is smaller than a pixel: blend to the share of the surface the holes take.
  float far = clamp(length(fwidth(cell)) * 3.0 - 0.6, 0.0, 1.0);
  float share = 3.14159 * ${HOLE_RADIUS.toFixed(4)} * ${HOLE_RADIUS.toFixed(4)} / (${HOLE_PITCH.toFixed(4)} * ${HOLE_PITCH.toFixed(4)});
  diffuseColor.rgb *= 1.0 - 0.7 * mix(hole, share, far);`,
    'hockey-surface',
  );
  return material;
}

function markingsTexture(canvas: HTMLCanvasElement): Texture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  // The models' texture coordinates are glTF's: the canvas's top row at v = 0.
  texture.flipY = false;
  texture.anisotropy = 8;
  return texture;
}

/** The acrylic walls round the field, lit through by the surface. */
export function wallMaterial(): MeshPhysicalMaterial {
  const material = new MeshPhysicalMaterial({
    color: '#4f7dfa',
    emissive: '#2c5cf0',
    emissiveIntensity: 0.55,
    roughness: 0.08,
    metalness: 0,
    clearcoat: 1,
    transparent: true,
    opacity: 0.82,
  });
  material.name = 'rail-wall';
  return material;
}

/** The top rail: a satin, lightly brushed metal finish. */
export function railMaterial(): MeshPhysicalMaterial {
  const material = new MeshPhysicalMaterial({
    color: '#d4d6d9',
    roughness: 0.38,
    metalness: 0.35,
    clearcoat: 0.2,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.8,
  });
  material.name = 'rail-top';
  withWorldPosition(
    material,
    /* glsl */ `
  // Fine brushing along each rail.
  vec3 q = abs(vHockeyWorld.x) > abs(vHockeyWorld.z) * 0.47 ? vHockeyWorld.zyx : vHockeyWorld;
  diffuseColor.rgb *= 0.96 + 0.06 * hockeyNoise(q * vec3(4.0, 900.0, 900.0));`,
    'hockey-rail',
  );
  return material;
}

/** The cabinet's powder coat: its finish's colour, with a fine speckle. */
export function cabinetMaterial(finish: FinishName): MeshPhysicalMaterial {
  const { cabinet, speck } = FINISHES[finish];
  const material = new MeshPhysicalMaterial({
    color: new Color().setStyle(cabinet, SRGBColorSpace),
    roughness: finish === 'black' ? 0.5 : 0.62,
    metalness: 0.12,
    clearcoat: 0.15,
    clearcoatRoughness: 0.45,
    envMapIntensity: 0.7,
  });
  material.name = 'cabinet';
  withWorldPosition(
    material,
    /* glsl */ `
  float grain = hockeyHash(floor(vHockeyWorld * 700.0));
  float fleck = step(0.86, grain);
  diffuseColor.rgb *= mix(1.0, ${speck.toFixed(2)}, fleck * 0.55) * (0.97 + 0.05 * grain);`,
    `hockey-cabinet-${finish}`,
  );
  return material;
}

/** The coin door's panel in a finish. */
export function panelColour(finish: FinishName): Color {
  return new Color().setStyle(FINISHES[finish].panel, SRGBColorSpace);
}

/** A seat's mallet: glossy moulded plastic. */
export function malletMaterial(seat: Seat): MeshPhysicalMaterial {
  const material = new MeshPhysicalMaterial({
    color: new Color().setStyle(MALLET_COLOURS[seat], SRGBColorSpace),
    roughness: 0.32,
    metalness: 0,
    clearcoat: 0.8,
    clearcoatRoughness: 0.1,
  });
  material.name = `mallet-${seat}`;
  return material;
}

/** The puck: yellow polycarbonate, faintly translucent at its edge. */
export function puckMaterial(): MeshPhysicalMaterial {
  const material = new MeshPhysicalMaterial({
    color: '#f6c21a',
    emissive: '#5a3a00',
    emissiveIntensity: 0.25,
    roughness: 0.3,
    metalness: 0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.1,
    sheen: 0.3,
  });
  material.name = 'puck';
  return material;
}
