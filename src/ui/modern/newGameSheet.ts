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

// The New Game sheet (the chess game's): pick the opponent (the computer by its portrait, a second
// player on this device, or a friend online), the goals to win, the mallets' zone and the first
// serve, all visible at once. The computer's levels show as a slider of big cards (the default) or a compact grid; the
// player's choice of view is remembered. A friend online takes the goals and the serve from here;
// the link comes next.

import { DIFFICULTIES, type DifficultyId } from '../../ai/difficulty.ts';
import type { LevelView, Settings } from '../../app/Settings.ts';
import { TARGETS } from '../../rules/match.ts';
import type { Seat } from '../../rules/types.ts';
import type { Reach } from '../../table/geometry.ts';
import { el, openDialog } from '../Dialog.ts';
import { LINE_ICONS } from '../icons.ts';
import { opponentPortrait } from '../portraits.ts';
import { carousel, choiceGroup, segmented } from './controls.ts';
import { zonePicker } from './zonePicker.ts';

export type Opponent = 'computer' | 'local' | 'online';
/** Who serves first: a seat, or a coin toss. */
export type FirstServe = Seat | 'toss';

export interface NewGame {
  readonly mode: Opponent;
  readonly level: DifficultyId;
  readonly target: number;
  /** The players' names (with the computer, the second is its own). */
  readonly names: readonly [string, string];
  readonly firstServe: FirstServe;
  /** How far up the table the mallets may go, for both players. */
  readonly reach: Reach;
}

function section(title: string, ...content: HTMLElement[]): HTMLElement {
  const wrap = el('div', 'm-section');
  wrap.append(el('div', 'm-heading', title), ...content);
  return wrap;
}

function nameField(value: string, label: string): HTMLLabelElement {
  const row = el('label', 'field');
  const input = el('input');
  input.type = 'text';
  input.value = value;
  input.maxLength = 24;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', label);
  row.append(el('span', '', label), input);
  return row;
}

export interface SheetOptions {
  /** The opponent chosen when the sheet opens (otherwise the last one played on this device). */
  readonly opponent?: Opponent;
  /** Called when the player switches between the slider and the compact grid. */
  readonly onLevelView?: (view: LevelView) => void;
}

export function newGameSheet(
  current: Settings,
  { opponent: first, onLevelView }: SheetOptions = {},
): Promise<NewGame | null> {
  return openDialog<NewGame | null>('New game', null, ({ body, root, close }) => {
    root.classList.add('new-game-sheet');
    let mode: Opponent = first ?? current.mode;
    let level: DifficultyId = current.difficulty;
    let target = String(current.target);
    let serve: 'toss' | '0' | '1' = 'toss';
    let reach: Reach = current.reach;
    const zone = zonePicker(reach, (value) => (reach = value));

    const opponent = segmented<Opponent>(
      'Opponent',
      [
        ['computer', 'Against the computer'],
        ['local', 'Two players'],
        ['online', 'A friend online'],
      ],
      mode,
      (value) => {
        mode = value;
        update();
      },
    );

    const levelChoices = DIFFICULTIES.map((d) => {
      const portrait = opponentPortrait(d.id);
      return {
        value: d.id,
        label: `${d.label}: ${d.blurb}`,
        html: `<img src="${portrait.src}" alt="" draggable="false"><span class="m-level-text"><span class="m-level-name">${d.label}</span><span class="m-level-rating">${d.blurb}</span></span>`,
      };
    });
    // Two views of one choice: the slider of big cards and the compact grid, kept in step.
    const chooseLevel = (value: DifficultyId) => {
      level = value;
      slider.select(value);
      grid.select(value);
    };
    const slider = carousel<DifficultyId>(
      'Strength',
      'opponent',
      levelChoices,
      level,
      chooseLevel,
      'm-level',
    );
    const grid = choiceGroup<DifficultyId>(
      'Strength',
      levelChoices,
      level,
      chooseLevel,
      'm-levels',
      'm-level',
    );
    let view = current.levelView;
    const views = choiceGroup<LevelView>(
      'Show opponents as',
      [
        { value: 'slider', label: 'Slider', html: LINE_ICONS.slider },
        { value: 'compact', label: 'Compact', html: LINE_ICONS.grid },
      ],
      view,
      (value) => {
        view = value;
        onLevelView?.(value);
        update();
      },
      'm-view-toggle',
      'm-view-btn',
    );
    for (const button of views.element.querySelectorAll<HTMLElement>('.m-view-btn')) {
      button.dataset.tip = button.getAttribute('aria-label') ?? '';
    }
    const strengthHead = el('div', 'm-section-head');
    strengthHead.append(el('div', 'm-heading', 'Strength'), views.element);
    const strength = el('div', 'm-section');
    strength.append(strengthHead, slider.element, grid.element);

    const name1 = nameField(current.name, 'First player');
    const name2 = nameField(current.name2, 'Second player');
    const names = el('div', 'name-pair');
    names.append(name1, name2);
    const players = section('Players', names);
    const value = (row: HTMLLabelElement, fallback: string) =>
      row.querySelector('input')!.value.trim().slice(0, 24) || fallback;

    const targets = segmented<string>(
      'Goals to win',
      TARGETS.map((t) => [String(t), String(t)] as const),
      target,
      (v) => (target = v),
    );
    const serveLabels = (): readonly (readonly ['toss' | '0' | '1', string])[] => [
      ['toss', 'Coin toss'],
      ['0', mode === 'local' ? 'First player' : 'You'],
      [
        '1',
        mode === 'computer' ? 'The computer' : mode === 'local' ? 'Second player' : 'Your friend',
      ],
    ];
    const serveSlot = el('div');
    const renderServe = () => {
      const choice = segmented('First serve', serveLabels(), serve, (v) => (serve = v));
      serveSlot.replaceChildren(choice.element);
    };

    const update = () => {
      strength.hidden = mode !== 'computer';
      slider.element.hidden = view !== 'slider';
      grid.element.hidden = view !== 'compact';
      players.hidden = mode !== 'local';
      start.textContent = mode === 'online' ? 'Create link' : 'Start game';
      renderServe();
    };
    const actions = el('div', 'dialog-actions');
    const start = el('button', 'btn', 'Start game');
    start.type = 'button';
    start.setAttribute('autofocus', '');
    start.addEventListener('click', () => {
      const firstServe: FirstServe = serve === 'toss' ? 'toss' : serve === '0' ? 0 : 1;
      close({
        mode,
        level,
        target: Number(target),
        names:
          mode === 'local'
            ? [value(name1, 'Player 1'), value(name2, 'Player 2')]
            : [current.name, mode === 'computer' ? 'Computer' : 'Friend'],
        firstServe,
        reach,
      });
    });
    const cancel = el('button', 'btn', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => close(null));
    actions.append(start, cancel);
    update();

    body.append(
      section('Opponent', opponent.element),
      strength,
      players,
      section('Goals to win', targets.element),
      section('Mallet zone, the same for both players', zone.element),
      section('First serve', serveSlot),
      actions,
    );
  });
}
