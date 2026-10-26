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

// The score unit's display on the table's left rail: two red seven-segment digits for each player,
// the unlit segments faintly visible, as on the reference's. Seat 0's score is on the side toward
// seat 0's end (the model's texture coordinates run that way), so each player reads their own
// nearer them. Drawn on a canvas only when the score changes.

import { CanvasTexture, MeshStandardMaterial, SRGBColorSpace } from 'three';

/** Which segments light for each digit: a top, b top right, c bottom right, d bottom, e bottom
 * left, f top left, g middle. */
const SEGMENTS = [
  'abcdef',
  'bc',
  'abdeg',
  'abcdg',
  'bcfg',
  'acdfg',
  'acdefg',
  'abc',
  'abcdefg',
  'abcdfg',
] as const;

const LIT = '#ff3b1f';
const UNLIT = 'rgba(120, 18, 10, 0.32)';

export class ScoreDisplay {
  readonly material: MeshStandardMaterial;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: CanvasTexture;
  private shown = '';

  constructor() {
    this.canvas.width = 512;
    this.canvas.height = 160;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.flipY = false;
    this.material = new MeshStandardMaterial({
      color: '#000000',
      emissive: '#ffffff',
      emissiveMap: this.texture,
      emissiveIntensity: 1.4,
      roughness: 0.25,
    });
    this.material.name = 'display';
    this.show(0, 0);
  }

  /** Shows the two scores, seat 0's first. */
  show(a: number, b: number): void {
    const key = `${a}:${b}`;
    if (key === this.shown) return;
    this.shown = key;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = this.canvas;
    ctx.fillStyle = '#0a0202';
    ctx.fillRect(0, 0, width, height);
    const digits = [...pad(a), ...pad(b)];
    const w = width * 0.16;
    const h = height * 0.72;
    const starts = [0.06, 0.25, 0.59, 0.78].map((x) => x * width);
    digits.forEach((digit, i) => drawDigit(ctx, starts[i]!, (height - h) / 2, w, h, digit));
    // A dot between the two scores.
    ctx.fillStyle = LIT;
    ctx.beginPath();
    ctx.arc(width / 2, height * 0.38, height * 0.035, 0, Math.PI * 2);
    ctx.arc(width / 2, height * 0.62, height * 0.035, 0, Math.PI * 2);
    ctx.fill();
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
  }
}

/** A score as two digits, 0 to 99. */
function pad(n: number): number[] {
  const v = Math.max(0, Math.min(99, Math.floor(n)));
  return [Math.floor(v / 10), v % 10];
}

function drawDigit(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  digit: number,
): void {
  const t = w * 0.17;
  const lit = SEGMENTS[digit] ?? '';
  // Each segment as a bar with pointed ends, slanted slightly like a real display's.
  const half = h / 2;
  const bars: Record<string, [number, number, number, number]> = {
    a: [x + t / 2, y, w - t, t],
    g: [x + t / 2, y + half - t / 2, w - t, t],
    d: [x + t / 2, y + h - t, w - t, t],
    f: [x, y + t / 2, t, half - t / 2],
    b: [x + w - t, y + t / 2, t, half - t / 2],
    e: [x, y + half, t, half - t / 2],
    c: [x + w - t, y + half, t, half - t / 2],
  };
  const slant = w * 0.08;
  for (const [name, [bx, by, bw, bh]] of Object.entries(bars)) {
    ctx.fillStyle = lit.includes(name) ? LIT : UNLIT;
    const shift = (yy: number) => slant * (1 - (yy - y) / h);
    ctx.beginPath();
    if (bw > bh) {
      const m = by + bh / 2;
      ctx.moveTo(bx + shift(m), m);
      ctx.lineTo(bx + bh / 2 + shift(by), by);
      ctx.lineTo(bx + bw - bh / 2 + shift(by), by);
      ctx.lineTo(bx + bw + shift(m), m);
      ctx.lineTo(bx + bw - bh / 2 + shift(by + bh), by + bh);
      ctx.lineTo(bx + bh / 2 + shift(by + bh), by + bh);
    } else {
      const m = bx + bw / 2;
      ctx.moveTo(m + shift(by), by);
      ctx.lineTo(bx + bw + shift(by + bw / 2), by + bw / 2);
      ctx.lineTo(bx + bw + shift(by + bh - bw / 2), by + bh - bw / 2);
      ctx.lineTo(m + shift(by + bh), by + bh);
      ctx.lineTo(bx + shift(by + bh - bw / 2), by + bh - bw / 2);
      ctx.lineTo(bx + shift(by + bw / 2), by + bw / 2);
    }
    ctx.closePath();
    ctx.fill();
  }
}
