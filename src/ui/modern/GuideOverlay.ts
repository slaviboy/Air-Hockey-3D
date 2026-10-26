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

// A guide over the game, as many games keep behind an (i) button: the screen dims but for the
// parts of the interface, each ringed in gold, and a gold line leads from each part to a label
// saying what it is and how to use it. Each label goes on the side of its part that is asked for,
// as near as it can without covering another label or another part; failing that, on another
// side. A click anywhere, or Escape, closes the guide.

import { el } from '../Dialog.ts';

export interface GuidePart {
  /** Where the part is on the screen now, or null when it is not shown (it then has no label). */
  readonly target: () => DOMRect | null;
  readonly title: string;
  readonly text: string;
  /** The side of the part its label goes on, room allowing. */
  readonly side: Side;
}

type Side = 'top' | 'bottom' | 'left' | 'right';

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const SVG = 'http://www.w3.org/2000/svg';
/** Room around a part's ring, and between a ring and its label at the nearest. */
const PAD = 6;
const GAP = 26;
/** How far a label moves out at each try, and how many tries a side gets. */
const STEP = 14;
const TRIES = 16;
/** The least room between a label and the screen's edge, or another label. */
const EDGE = 8;

const OTHER_SIDES: Record<Side, readonly Side[]> = {
  top: ['top', 'left', 'right', 'bottom'],
  bottom: ['bottom', 'right', 'left', 'top'],
  left: ['left', 'top', 'bottom', 'right'],
  right: ['right', 'top', 'bottom', 'left'],
};

const grow = (b: Box, by: number): Box => ({
  left: b.left - by,
  top: b.top - by,
  right: b.right + by,
  bottom: b.bottom + by,
});

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** The point of box `b` nearest to (x, y). */
const nearest = (b: Box, x: number, y: number) => ({
  x: Math.min(b.right, Math.max(b.left, x)),
  y: Math.min(b.bottom, Math.max(b.top, y)),
});

export class GuideOverlay {
  readonly element: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly labels: HTMLElement;
  private parts: readonly GuidePart[] = [];

  constructor() {
    this.element = el('div', 'guide');
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-label', 'What each part does');
    this.svg = document.createElementNS(SVG, 'svg');
    this.svg.classList.add('guide-lines');
    this.svg.setAttribute('aria-hidden', 'true');
    this.labels = el('div', 'guide-labels');
    this.element.append(this.svg, this.labels);
    this.element.addEventListener('click', () => this.close());
    window.addEventListener('resize', () => {
      if (this.open) this.layout();
    });
  }

  get open(): boolean {
    return !this.element.hidden;
  }

  show(parts: readonly GuidePart[]): void {
    this.parts = parts;
    this.element.hidden = false;
    this.layout();
  }

  close(): void {
    this.element.hidden = true;
    this.svg.replaceChildren();
    this.labels.replaceChildren();
  }

  private layout(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.svg.setAttribute('width', String(w));
    this.svg.setAttribute('height', String(h));
    this.labels.replaceChildren();
    const shown = this.parts
      .map((part) => ({ part, rect: part.target() }))
      .filter((p): p is { part: GuidePart; rect: DOMRect } => {
        const r = p.rect;
        return r !== null && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < h;
      })
      .map(({ part, rect }) => ({ part, ring: grow(rect, PAD) }));

    // The labels, placed one after another clear of the rings and of each other.
    const placed: Box[] = [];
    const ends: { label: Box; ring: Box }[] = [];
    for (const { part, ring } of shown) {
      const label = el('div', 'guide-label');
      label.append(el('div', 'guide-title', part.title), el('div', 'guide-text', part.text));
      this.labels.append(label);
      const size = { w: label.offsetWidth, h: label.offsetHeight };
      const others = [...placed, ...shown.filter((s) => s.ring !== ring).map((s) => s.ring)];
      const box = this.place(ring, size, part.side, others, w, h);
      label.style.left = `${box.left}px`;
      label.style.top = `${box.top}px`;
      placed.push(grow(box, EDGE / 2));
      ends.push({ label: box, ring });
    }

    // How to close it, near the middle of the screen, clear of the rest.
    const note = el('div', 'guide-close', 'Tap or click anywhere to close');
    this.labels.append(note);
    const middle = { left: w / 2, top: h / 2, right: w / 2, bottom: h / 2 };
    const spot = this.place(
      middle,
      { w: note.offsetWidth, h: note.offsetHeight },
      'bottom',
      [...placed, ...shown.map((s) => s.ring)],
      w,
      h,
    );
    note.style.left = `${spot.left}px`;
    note.style.top = `${spot.top}px`;

    // The dimming with a hole at each part, the gold rings, and the lines to the labels.
    const mask = document.createElementNS(SVG, 'mask');
    mask.id = 'guide-holes';
    mask.append(rect({ left: 0, top: 0, right: w, bottom: h }, { fill: 'white' }));
    for (const { ring } of shown) mask.append(rect(ring, { fill: 'black', rx: '14' }));
    const defs = document.createElementNS(SVG, 'defs');
    defs.append(mask);
    const shade = rect(
      { left: 0, top: 0, right: w, bottom: h },
      { class: 'guide-shade', mask: 'url(#guide-holes)' },
    );
    this.svg.replaceChildren(defs, shade);
    for (const { ring } of shown) this.svg.append(rect(ring, { class: 'guide-ring', rx: '14' }));
    for (const { label, ring } of ends) {
      const centre = { x: (label.left + label.right) / 2, y: (label.top + label.bottom) / 2 };
      const to = nearest(ring, centre.x, centre.y);
      const from = nearest(label, to.x, to.y);
      const line = document.createElementNS(SVG, 'line');
      line.setAttribute('class', 'guide-line');
      line.setAttribute('x1', String(from.x));
      line.setAttribute('y1', String(from.y));
      line.setAttribute('x2', String(to.x));
      line.setAttribute('y2', String(to.y));
      const dot = document.createElementNS(SVG, 'circle');
      dot.setAttribute('class', 'guide-dot');
      dot.setAttribute('cx', String(to.x));
      dot.setAttribute('cy', String(to.y));
      dot.setAttribute('r', '4');
      this.svg.append(line, dot);
    }
  }

  /**
   * Where a label of this size goes: the nearest spot on the side asked for (moving out, and
   * along the side), then on the others, where it covers nothing and its line crosses nothing;
   * failing that, the spot that covers and crosses least.
   */
  private place(
    ring: Box,
    size: { w: number; h: number },
    side: Side,
    others: readonly Box[],
    w: number,
    h: number,
  ): Box {
    const midX = (ring.left + ring.right) / 2;
    const midY = (ring.top + ring.bottom) / 2;
    const clamp = (left: number, top: number): Box => {
      const x = Math.min(w - EDGE - size.w, Math.max(EDGE, left));
      const y = Math.min(h - EDGE - size.h, Math.max(EDGE, top));
      return { left: x, top: y, right: x + size.w, bottom: y + size.h };
    };
    const crossings = (box: Box) => {
      const to = nearest(ring, (box.left + box.right) / 2, (box.top + box.bottom) / 2);
      const from = nearest(box, to.x, to.y);
      return others.filter((o) => crosses(from, to, grow(o, -2))).length;
    };
    let best: { box: Box; cost: number } | null = null;
    for (const s of OTHER_SIDES[side]) {
      for (let i = 0; i < TRIES; i++) {
        const d = GAP + i * STEP;
        for (const k of SHIFTS) {
          const along = k * STEP * 2;
          const box =
            s === 'top'
              ? clamp(midX - size.w / 2 + along, ring.top - d - size.h)
              : s === 'bottom'
                ? clamp(midX - size.w / 2 + along, ring.bottom + d)
                : s === 'left'
                  ? clamp(ring.left - d - size.w, midY - size.h / 2 + along)
                  : clamp(ring.right + d, midY - size.h / 2 + along);
          const cost =
            others.reduce((sum, o) => sum + overlap(box, o), 0) +
            overlap(box, ring) * 4 +
            crossings(box) * 4000;
          if (cost === 0) return box;
          if (!best || cost < best.cost) best = { box, cost };
        }
      }
    }
    // A crowded screen (a phone's): the clear spot nearest the part, anywhere, crossing least.
    let free: { box: Box; cost: number } | null = null;
    for (let top = EDGE; top + size.h <= h - EDGE; top += GRID) {
      for (let left = EDGE; left + size.w <= w - EDGE; left += GRID) {
        const box = { left, top, right: left + size.w, bottom: top + size.h };
        if (overlap(box, ring) > 0 || others.some((o) => overlap(box, o) > 0)) continue;
        const cost =
          Math.hypot((box.left + box.right) / 2 - midX, (box.top + box.bottom) / 2 - midY) +
          crossings(box) * 400;
        if (!free || cost < free.cost) free = { box, cost };
      }
    }
    return (free ?? best!).box;
  }
}

/** The step of the search for a clear spot over the whole screen, in pixels. */
const GRID = 10;

/** Shifts along a side, in steps either way, nearest first. */
const SHIFTS = [0, 1, -1, 2, -2, 3, -3, 4, -4, 6, -6] as const;

/** Whether the segment from a to b passes through box r (Liang–Barsky clipping). */
function crosses(a: { x: number; y: number }, b: { x: number; y: number }, r: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return (
    clip(-dx, a.x - r.left) &&
    clip(dx, r.right - a.x) &&
    clip(-dy, a.y - r.top) &&
    clip(dy, r.bottom - a.y) &&
    t0 < t1
  );
}

function rect(b: Box, attributes: Record<string, string>): SVGRectElement {
  const r = document.createElementNS(SVG, 'rect');
  r.setAttribute('x', String(b.left));
  r.setAttribute('y', String(b.top));
  r.setAttribute('width', String(b.right - b.left));
  r.setAttribute('height', String(b.bottom - b.top));
  for (const [name, value] of Object.entries(attributes)) r.setAttribute(name, value);
  return r;
}
