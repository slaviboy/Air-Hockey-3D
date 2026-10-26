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

// The choice of the mallets' zones: how far up the table each player's mallet may go, the same for
// both. The choices (the interface's segmented control) stand over a small map of the table from
// above, both players' zones washed in green up to the line their mallets stop at, so the choice
// shows as it is made.

import { REACH_IDS, type Reach, zoneFront } from '../../table/geometry.ts';
import { TABLE } from '../../table/spec.ts';
import { el } from '../Dialog.ts';
import { segmented } from './controls.ts';

/** The zones by the names the player sees: short on the buttons, in full for the map. */
export const REACH_NAMES: Record<Reach, readonly [short: string, long: string]> = {
  half: ['Half', 'Up to the centre line'],
  twoFifths: ['2/5', 'Two fifths of the table'],
  third: ['1/3', 'A third of the table'],
  quarter: ['1/4', 'A quarter of the table'],
};

/** The map's drawing of the table: its length across, in its own units. */
const MAP = { width: 240, height: 128, rail: 9 } as const;

/** A map of the table from above with both zones in green, as an SVG string. */
export function zoneMap(reach: Reach): string {
  const { width, height, rail } = MAP;
  const fieldW = width - rail * 2;
  const fieldH = height - rail * 2;
  // The table's length runs across the map: seat 0's end on the left.
  const front = (zoneFront(TABLE, reach) / TABLE.L) * fieldW;
  const goal = (TABLE.goalWidth / TABLE.W) * fieldH;
  const mid = height / 2;
  const mallet = (TABLE.mallet.radius / TABLE.L) * fieldW;
  return `<svg class="zone-map" viewBox="0 0 ${width} ${height}" role="img" aria-label="Each mallet stays in its green zone: ${REACH_NAMES[reach][1].toLowerCase()} from its own end">
<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${rail * 1.8}" class="zone-rail"/>
<rect x="${rail}" y="${rail}" width="${fieldW}" height="${fieldH}" rx="${rail * 0.7}" class="zone-field"/>
<rect x="${rail}" y="${rail}" width="${front}" height="${fieldH}" class="zone-fill"/>
<rect x="${width - rail - front}" y="${rail}" width="${front}" height="${fieldH}" class="zone-fill"/>
<line x1="${rail + front}" y1="${rail}" x2="${rail + front}" y2="${height - rail}" class="zone-edge"/>
<line x1="${width - rail - front}" y1="${rail}" x2="${width - rail - front}" y2="${height - rail}" class="zone-edge"/>
<line x1="${width / 2}" y1="${rail}" x2="${width / 2}" y2="${height - rail}" class="zone-centre"/>
<rect x="0" y="${mid - goal / 2}" width="${rail}" height="${goal}" class="zone-goal"/>
<rect x="${width - rail}" y="${mid - goal / 2}" width="${rail}" height="${goal}" class="zone-goal"/>
<circle cx="${rail + front - mallet}" cy="${mid}" r="${mallet}" class="zone-mallet seat-0"/>
<circle cx="${width - rail - front + mallet}" cy="${mid}" r="${mallet}" class="zone-mallet seat-1"/>
</svg>`;
}

/** The choice with its map; `onChange` hears each new choice. */
export function zonePicker(
  current: Reach,
  onChange: (reach: Reach) => void,
): { readonly element: HTMLElement; readonly value: () => Reach } {
  let reach = current;
  const wrap = el('div', 'zone-picker');
  const map = el('div', 'zone-map-frame');
  map.innerHTML = zoneMap(reach);
  const choice = segmented<Reach>(
    'Mallet zone',
    REACH_IDS.map((id) => [id, REACH_NAMES[id][0]] as const),
    reach,
    (value) => {
      reach = value;
      map.innerHTML = zoneMap(value);
      onChange(value);
    },
  );
  for (const button of choice.element.querySelectorAll<HTMLElement>('[data-value]')) {
    const id = button.dataset.value as Reach;
    button.dataset.tip = REACH_NAMES[id][1];
  }
  wrap.append(choice.element, map);
  return { element: wrap, value: () => reach };
}
