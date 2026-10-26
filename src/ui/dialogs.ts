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

// The game's dialogs (Pool's): the main menu, the settings, the pause menu, the end of a match,
// the controls and the rules. A new match's terms are in the New Game sheet (modern/newGameSheet).

import { DIFFICULTIES, type DifficultyId } from '../ai/difficulty.ts';
import type { Store } from '../core/Store.ts';
import { CONTROLS_HELP } from '../input/shortcuts.ts';
import { POSSESSION_LIMIT, TARGETS } from '../rules/match.ts';
import { FINISHES, type FinishName } from '../scene/surfaces.ts';
import type { QualitySetting, Settings } from '../app/Settings.ts';
import { el, openDialog } from './Dialog.ts';
import { LINE_ICONS, PUCK_MARK } from './icons.ts';
import { segmented, switchRow } from './modern/controls.ts';
import { zonePicker } from './modern/zonePicker.ts';

/** The cabinet's finishes by the names the player sees, in Settings and the menu bar. */
export const FINISH_NAMES: Record<FinishName, string> = {
  silver: 'Silver',
  black: 'Black',
};

function button(text: string, onClick: () => void, className = 'btn'): HTMLButtonElement {
  const b = el('button', className, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function group(title: string, ...children: HTMLElement[]): HTMLElement {
  const box = el('div', 'settings-group');
  box.append(el('div', 'm-heading', title), ...children);
  return box;
}

function field(label: string, control: HTMLElement): HTMLElement {
  const row = el('label', 'field');
  row.append(el('span', '', label), control);
  return row;
}

/**
 * A row of choices with its heading. Not a <label>: that would name the first button after it
 * (the group carries its own name).
 */
function choices(label: string, control: HTMLElement): HTMLElement {
  const row = el('div', 'field');
  row.append(el('span', '', label), control);
  return row;
}

function textInput(value: string, label: string): HTMLInputElement {
  const input = el('input');
  input.type = 'text';
  input.value = value;
  input.maxLength = 24;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', label);
  return input;
}

export type MenuChoice =
  'computer' | 'local' | 'online' | 'join' | 'settings' | 'controls' | 'rules' | 'about' | 'close';

/** The main menu, over the table. */
export function mainMenu(): Promise<MenuChoice> {
  return openDialog<MenuChoice>('Air Hockey', 'close', ({ body, root, close }) => {
    root.classList.add('main-menu');
    const brand = el('div', 'brand');
    brand.innerHTML = `<span class="brand-mark">${PUCK_MARK}</span><span><strong>Air Hockey<span class="brand-3d" aria-hidden="true">3D</span></strong><small>On an 8-foot table, first to the goals you choose</small></span>`;
    const modes = el('div', 'mode-list');
    const mode = (icon: string, title: string, detail: string, value: MenuChoice) => {
      const b = el('button', 'mode-card');
      b.type = 'button';
      b.dataset.mode = value;
      b.innerHTML = `<span class="mode-icon">${icon}</span><span class="mode-text"><strong>${title}</strong><small>${detail}</small></span>${LINE_ICONS.chevronRight}`;
      b.addEventListener('click', () => close(value));
      return b;
    };
    modes.append(
      mode(
        LINE_ICONS.computer,
        'Against the computer',
        'Easy, Medium or Hard, at the strength you choose',
        'computer',
      ),
      mode(
        LINE_ICONS.users,
        'Two players',
        'A match on this device: a finger each on a tablet, or the mouse and the keys',
        'local',
      ),
      mode(
        LINE_ICONS.globe,
        'Play a friend online',
        'A match over the internet with voice and video: send your friend a link',
        'online',
      ),
      mode(LINE_ICONS.link, 'Join a game', 'Open the link a friend sent you', 'join'),
    );
    const links = el('div', 'menu-links');
    links.append(
      button('Settings', () => close('settings')),
      button('Keyboard and mouse', () => close('controls')),
      button('Rules', () => close('rules')),
      button('About', () => close('about')),
    );
    body.append(brand, modes, links);
  });
}

/** The settings, applied as they change. */
export function settingsDialog(store: Store<Settings>): Promise<void> {
  return openDialog<void>('Settings', undefined, ({ body }) => {
    const s = store.get();
    const set = (patch: Partial<Settings>) => store.update(patch);
    const view = segmented(
      'Camera',
      [
        ['3d', '3D'],
        ['top', 'Top'],
      ] as const,
      s.view,
      (v) => set({ view: v }),
    );
    const finish = segmented<FinishName>(
      'Table finish',
      (Object.keys(FINISHES) as FinishName[]).map((f) => [f, FINISH_NAMES[f]] as const),
      s.finish,
      (v) => set({ finish: v }),
    );
    const level = segmented<DifficultyId>(
      'Computer',
      DIFFICULTIES.map((d) => [d.id, d.label] as const),
      s.difficulty,
      (v) => set({ difficulty: v }),
    );
    const target = segmented(
      'Goals to win',
      TARGETS.map((t) => [String(t), String(t)] as const),
      String(s.target),
      (v) => set({ target: Number(v) }),
    );
    const zone = zonePicker(s.reach, (reach) => set({ reach }));
    const [showZones] = switchRow(
      'Show the mallet zones in green while playing',
      s.showZones,
      (on) => set({ showZones: on }),
    );
    const quality = segmented<QualitySetting>(
      'Graphics',
      [
        ['auto', 'Auto'],
        ['high', 'High'],
        ['low', 'Low'],
      ],
      s.quality,
      (v) => set({ quality: v }),
    );
    const [sound] = switchRow('Sound', s.sound, (on) => set({ sound: on }));
    const volume = el('input', 'volume');
    volume.type = 'range';
    volume.min = '0';
    volume.max = '100';
    volume.value = String(Math.round(s.volume * 100));
    volume.setAttribute('aria-label', 'Volume');
    volume.addEventListener('input', () => set({ volume: Number(volume.value) / 100 }));
    const [large] = switchRow('Large player cards, for video calls', s.largeCards, (on) =>
      set({ largeCards: on }),
    );
    const [menuBar] = switchRow('Menu bar, instead of the menu button', s.menuBar, (on) =>
      set({ menuBar: on }),
    );
    const [hints] = switchRow('Hints when hovering over the controls', s.hints, (on) =>
      set({ hints: on }),
    );
    const [keepZoom] = switchRow('Keep the zoom while turning the view', s.keepZoom, (on) =>
      set({ keepZoom: on }),
    );
    const name = textInput(s.name, 'Your name');
    name.addEventListener('change', () => set({ name: name.value.trim() || s.name }));
    body.append(
      group(
        'Table',
        choices('Camera', view.element),
        keepZoom,
        choices('Table finish', finish.element),
      ),
      group(
        'Play',
        choices('The computer’s strength (next match)', level.element),
        choices('Goals to win (next match)', target.element),
        choices('Mallet zone, for both players (next match)', zone.element),
        showZones,
      ),
      group('Sound', sound, field('Volume', volume)),
      group(
        'Screen',
        menuBar,
        large,
        hints,
        choices('Graphics (takes effect when the page reloads)', quality.element),
      ),
      group('You', field('Name', name)),
    );
  });
}

export type PauseChoice =
  'resume' | 'restart' | 'newGame' | 'settings' | 'controls' | 'rules' | 'concede' | 'menu';

/** The pause menu's choices, with those of an online game. */
export type AnyPauseChoice = PauseChoice | 'resign' | 'leave';

export function pauseMenu(options: {
  readonly canConcede: boolean;
  /** In an online game: Resign (while the match is on) and Leave, instead of a new game. */
  readonly online?: { readonly canResign: boolean };
}): Promise<AnyPauseChoice> {
  if (options.online) return onlinePauseMenu(options.online.canResign);
  return openDialog<PauseChoice>('Paused', 'resume', ({ body, root, close }) => {
    root.classList.add('pause-menu');
    const list = el('div', 'pause-list');
    const item = (icon: string, text: string, value: PauseChoice, className = '') => {
      const b = el('button', `pause-item ${className}`.trim());
      b.type = 'button';
      b.dataset.choice = value;
      b.innerHTML = `${icon}<span>${text}</span>`;
      b.addEventListener('click', () => close(value));
      return b;
    };
    list.append(
      item(LINE_ICONS.next, 'Resume', 'resume', 'primary'),
      item(LINE_ICONS.restart, 'Restart the match', 'restart'),
      item(LINE_ICONS.plus, 'New game', 'newGame'),
      item(LINE_ICONS.sliders, 'Settings', 'settings'),
      item(LINE_ICONS.target, 'Keyboard and mouse', 'controls'),
      item(LINE_ICONS.book, 'Rules', 'rules'),
    );
    if (options.canConcede) list.append(item(LINE_ICONS.flag, 'Concede the match', 'concede'));
    list.append(item(LINE_ICONS.exit, 'Main menu', 'menu'));
    body.append(list);
  });
}

/** The pause menu of an online game: the match goes on meanwhile. */
function onlinePauseMenu(canResign: boolean): Promise<AnyPauseChoice> {
  return openDialog<AnyPauseChoice>('Menu', 'resume', ({ body, root, close }) => {
    root.classList.add('pause-menu');
    const list = el('div', 'pause-list');
    const item = (icon: string, text: string, value: AnyPauseChoice, className = '') => {
      const b = el('button', `pause-item ${className}`.trim());
      b.type = 'button';
      b.dataset.choice = value;
      b.innerHTML = `${icon}<span>${text}</span>`;
      b.addEventListener('click', () => close(value));
      return b;
    };
    list.append(
      item(LINE_ICONS.next, 'Back to the game', 'resume', 'primary'),
      item(LINE_ICONS.sliders, 'Settings', 'settings'),
      item(LINE_ICONS.target, 'Keyboard and mouse', 'controls'),
      item(LINE_ICONS.book, 'Rules', 'rules'),
    );
    if (canResign) list.append(item(LINE_ICONS.flag, 'Resign the match', 'resign'));
    list.append(item(LINE_ICONS.exit, 'Leave the online game', 'leave'));
    body.append(list);
  });
}

export type ResultChoice = 'rematch' | 'menu' | 'look';

/** The end of the match. */
export function resultDialog(options: {
  readonly title: string;
  readonly detail: string;
  readonly names: readonly [string, string];
  readonly score: readonly [number, number];
}): Promise<ResultChoice> {
  return openDialog<ResultChoice>(
    options.title,
    'look',
    ({ body, root, close }) => {
      root.classList.add('result-dialog');
      const trophy = el('div', 'result-trophy');
      trophy.innerHTML = LINE_ICONS.trophy;
      body.append(trophy, el('p', 'result-detail', options.detail));
      const score = el('div', 'result-score');
      score.innerHTML = `<span>${escapeHtml(options.names[0])}</span><strong>${options.score[0]}</strong><em>–</em><strong>${options.score[1]}</strong><span>${escapeHtml(options.names[1])}</span>`;
      body.append(score);
      const actions = el('div', 'dialog-actions');
      actions.append(
        button('Rematch', () => close('rematch')),
        button('Main menu', () => close('menu')),
        button('Look at the table', () => close('look'), 'btn btn-quiet'),
      );
      body.append(actions);
    },
    { backdropCloses: false },
  );
}

/** Every key and mouse control. */
export function controlsDialog(): Promise<void> {
  return openDialog<void>('Keyboard and mouse', undefined, ({ body }) => {
    for (const section of CONTROLS_HELP) {
      const table = el('table', 'shortcuts');
      for (const [keys, action] of section.rows) {
        const tr = el('tr');
        tr.append(el('td', '', keys), el('td', '', action));
        table.append(tr);
      }
      body.append(group(section.title, table));
    }
  });
}

/** The rules in brief (docs/rules.md has them in full). */
export function rulesDialog(): Promise<void> {
  return openDialog<void>('Air hockey rules', undefined, ({ body, root }) => {
    root.classList.add('rules-dialog');
    body.innerHTML = `
      <ul>
        <li><strong>The aim.</strong> Strike the puck with your mallet into the slot in the other
          player's end rail. The first to the goals agreed wins the match.</li>
        <li><strong>Your zone.</strong> Your mallet stays in your own zone, shown in green: your
          whole half up to the centre line in the standard game, or less when the match is set up
          so (the same for both players). The puck goes anywhere: off the rails, the corners and
          the posts of the goals. When the puck comes to rest, or slides from side to side, where
          neither mallet may go, the player whose half it lies in may take their mallet out of
          their zone to strike it, as at a real table; once it is struck, the zone holds
          again.</li>
        <li><strong>A goal</strong> counts once the whole puck has gone into the slot. The player
          scored on serves next, from the middle of their half.</li>
        <li><strong>Keeping the puck.</strong> A player may keep the puck in their half for
          ${POSSESSION_LIMIT} seconds; then it goes to the other player, who serves. The ring round
          your card's picture counts them down.</li>
        <li><strong>Online</strong>, each player's own half is simulated on their own device, so your
          hits are never late; the puck changes hands at the centre line.</li>
      </ul>
      <p class="fine">The puck stays on the table: it never jumps the rails.</p>`;
  });
}

/** What the game is, whose, under what licence, and what it is built with (as NOTICE.md says). */
export function aboutDialog(version: string, build: string): Promise<void> {
  return openDialog<void>('About Air Hockey 3D', undefined, ({ body, root }) => {
    root.classList.add('about-dialog');
    const link = (href: string, text: string) =>
      `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
    body.innerHTML = `
      <div class="brand">
        <span class="brand-mark">${PUCK_MARK}</span>
        <span><strong>Air Hockey<span class="brand-3d" aria-hidden="true">3D</span></strong>
          <small>Version ${escapeHtml(version)} · build ${escapeHtml(build)}</small></span>
      </div>
      <p>A 3D game of air hockey for the browser: an 8-foot table, mallets and a puck modelled in
        Blender, a puck that slides and bounces in real time, a computer opponent at three
        strengths, and play against a friend online with voice and video.</p>
      <p>Copyright © 2026 Stanislav Georgiev. Free software under the
        ${link('https://www.gnu.org/licenses/gpl-3.0.html', 'GNU General Public License v3 or later')}.</p>
      <p><strong>Built with</strong></p>
      <ul class="credits">
        <li>${link('https://threejs.org/', 'three.js')}, MIT License.</li>
        <li>${link('https://github.com/dmotz/trystero', 'Trystero')} and
          ${link('https://github.com/paulmillr/noble-secp256k1', 'noble-secp256k1')}, MIT License,
          for online play.</li>
        <li>${link('https://github.com/kazuhikoarase/qrcode-generator', 'QR Code Generator')}, MIT
          License, for the invitation's QR code.</li>
        <li>Hits cut from recordings by Alex_Jauk and freesound_community on
          ${link('https://pixabay.com/', 'Pixabay')}, under the Pixabay Content License.</li>
        <li>Table, mallets and puck modelled in ${link('https://www.blender.org/', 'Blender')} for
          this project; the icons, the surface and the game's notes are original.</li>
      </ul>
      <p class="fine">The interface, the online play and the computer's portraits come from the
        author's own games, Pool and Grandmaster 3D. No artwork, models or code from any commercial
        game are used.</p>`;
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
