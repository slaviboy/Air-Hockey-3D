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

// The interface over the table (Pool's): the menu bar (or a menu button), the players' cards and
// the buttons along the top (or, with large cards, the cards beside the table), what is going on in
// a pill along the bottom, the banner after a goal, and the notes. It runs the keyboard, pausing,
// and the course of a match on this device (its start, the end of it, rematches), and tells the
// camera which parts of the screen it covers, so the table is framed in the rest.

import { DIFFICULTIES, difficulty } from '../ai/difficulty.ts';
import type { App } from '../app/App.ts';
import type { Settings } from '../app/Settings.ts';
import type { MatchEvent, MatchSetup } from '../game/Match.ts';
import { commandFor, keyName, type Command } from '../input/shortcuts.ts';
import { POSSESSION_LIMIT, TARGETS, type MatchState } from '../rules/match.ts';
import { other, type Seat } from '../rules/types.ts';
import { halfOf, REACH_IDS, serveSpot } from '../table/geometry.ts';
import { dialogOpen, el } from './Dialog.ts';
import {
  aboutDialog,
  controlsDialog,
  FINISH_NAMES,
  mainMenu,
  pauseMenu,
  resultDialog,
  rulesDialog,
  settingsDialog,
} from './dialogs.ts';
import { LINE_ICONS, PUCK_MARK } from './icons.ts';
import { iconButton } from './modern/controls.ts';
import { GoalBanner } from './modern/GoalBanner.ts';
import { GuideOverlay, type GuidePart } from './modern/GuideOverlay.ts';
import { MenuBar, type Menu, type MenuItem } from './modern/MenuBar.ts';
import { newGameSheet, type Opponent } from './modern/newGameSheet.ts';
import { PlayerCard, type PlayerView } from './modern/PlayerCard.ts';
import { Toasts } from './modern/Toasts.ts';
import { REACH_NAMES } from './modern/zonePicker.ts';
import type { OnlineHooks } from './online/hooks.ts';
import { opponentPortrait } from './portraits.ts';

/** The game's version, as package.json gives it, for the About page. */
const VERSION = '0.1.0';

/** Where large cards stand in a row under the buttons rather than beside the table; keep it in
 * step with the same query in hockey.css. */
const PHONE_UPRIGHT = '(max-width: 640px) and (orientation: portrait)';

/** How long the banner shows before the end of a match gives way to its result. */
const RESULT_DELAY_MS = 1400;

/** A coin toss for the first serve. */
function toss(): Seat {
  return crypto.getRandomValues(new Uint8Array(1))[0]! & 1 ? 1 : 0;
}

export class UiRoot {
  readonly element: HTMLElement;
  private readonly cards: [PlayerCard, PlayerCard];
  private readonly race: HTMLElement;
  private readonly status: HTMLElement;
  /** The initial of the player the status is about, at the start of the status pill. */
  private readonly statusMark: HTMLElement;
  private readonly action: HTMLButtonElement;
  private readonly viewButton: HTMLButtonElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly menuButton: HTMLButtonElement;
  private readonly menuBar: MenuBar;
  /** The game's name and the menu bar, at the start of the top bar when the bar is chosen. */
  private readonly menuHead: HTMLElement;
  /** The guide behind the (i) button: what each part of the screen does. */
  private readonly guide = new GuideOverlay();
  private readonly toasts = new Toasts();
  private readonly banner = new GoalBanner();
  private readonly top: HTMLElement;
  /** Where the cards stand when they are large. */
  private readonly players: HTMLElement;
  /** The status pill along the bottom. */
  private readonly bottom: HTMLElement;
  private busyMenu = false;
  private pausing = false;
  /** Whether a match has been started on this page. */
  private started = false;
  /** How the last match ended, for its result: on goals, or given up. */
  private conceded: Seat | null = null;
  /** Online play, where it goes differently (src/ui/online/OnlinePlay.ts sets it). */
  online: OnlineHooks | null = null;

  constructor(private readonly app: App) {
    document.documentElement.dataset.ui = 'modern';
    const scale = () => {
      const factor = Math.min(window.innerWidth / 1024, window.innerHeight / 768);
      document.documentElement.style.setProperty(
        '--ui-scale',
        String(Math.min(1.6, Math.max(0.55, factor))),
      );
    };
    scale();
    window.addEventListener('resize', scale);

    this.element = el('div', 'm-ui hockey-ui');

    // Along the top: the menu bar (when chosen), the cards with the goals to win between them,
    // and the buttons, the last of them the menu's when there is no bar.
    this.top = el('div', 'm-topbar hud-top');
    this.menuBar = new MenuBar(
      this.menus(),
      () => this.app.settings.get().menuBar && !dialogOpen(),
    );
    this.menuHead = el('div', 'hud-menus');
    const brand = el('div', 'm-brand');
    brand.setAttribute('aria-label', 'Air Hockey 3D');
    brand.innerHTML = `<span class="m-brand-mark">${PUCK_MARK}</span><span class="m-brand-name" aria-hidden="true">Air Hockey<small>3D</small></span>`;
    this.menuHead.append(brand, this.menuBar.element);
    this.cards = [new PlayerCard(0), new PlayerCard(1)];
    this.race = el('div', 'race');
    this.viewButton = iconButton(LINE_ICONS.topView, 'Top view (T)', () =>
      this.run({ kind: 'toggleView' }),
    );
    this.pauseButton = iconButton(
      LINE_ICONS.pause,
      'Pause (Esc)',
      () => void this.pause(),
      'm-icon-btn hud-pause',
    );
    this.menuButton = iconButton(LINE_ICONS.menu, 'Menu (Esc)', () => void this.pause());
    // As in the chess game, New game stands by the full screen button and opens the New Game sheet.
    const newGame = el('button', 'm-btn m-btn-primary m-new-game');
    newGame.type = 'button';
    newGame.innerHTML = `${LINE_ICONS.plus}<span>New game</span>`;
    newGame.setAttribute('aria-label', 'New game');
    newGame.addEventListener('click', () => void this.startNew());
    const buttons = el('div', 'hud-buttons m-topbar-end');
    buttons.append(
      iconButton(LINE_ICONS.info, 'What each part does', () => this.toggleGuide()),
      this.pauseButton,
      this.viewButton,
      iconButton(
        LINE_ICONS.restart,
        'Reset the view (Home)',
        () => this.run({ kind: 'home' }),
        'm-icon-btn hud-reset',
      ),
      newGame,
      iconButton(
        LINE_ICONS.fullscreen,
        'Full screen',
        () => this.toggleFullscreen(),
        'm-icon-btn hud-fullscreen',
      ),
      this.menuButton,
    );
    this.top.append(
      this.menuHead,
      this.cards[0].element,
      this.race,
      this.cards[1].element,
      buttons,
    );
    this.players = el('div', 'hud-players');
    this.players.hidden = true;

    // Along the bottom: what is going on, in a pill, with Rematch once the match is over.
    this.bottom = el('div', 'hud-bottom');
    const pill = el('div', 'm-card status-pill');
    this.statusMark = el('span', 'status-mark');
    this.statusMark.setAttribute('aria-hidden', 'true');
    this.status = el('div', 'status');
    this.status.dataset.testid = 'status';
    this.status.setAttribute('role', 'status');
    this.action = el('button', 'm-btn m-btn-primary dock-action');
    this.action.type = 'button';
    this.action.textContent = 'Rematch';
    this.action.addEventListener('click', () => void this.rematch());
    pill.append(this.statusMark, this.status, this.action);
    this.bottom.append(pill);

    this.element.append(
      this.top,
      this.players,
      this.bottom,
      this.banner.element,
      this.toasts.element,
      this.guide.element,
    );
    document.body.append(this.element);
    // A button pressed with the mouse or a finger lets go of the focus, so that the keys then go
    // to the mallet rather than pressing it again; one pressed from the keyboard keeps it.
    this.element.addEventListener('click', (event) => {
      if (event.detail > 0) (event.target as HTMLElement).closest('button')?.blur();
    });

    app.onQualityLowered = (fps) =>
      this.toasts.show(`Graphics lowered for smoother play (it ran at ${fps} frames a second)`);
    app.onMatchEvent = (event) => this.onMatchEvent(event);
    app.match.state.subscribe(() => this.render());
    app.settings.subscribe((settings) => {
      this.element.classList.toggle('menu-bar', settings.menuBar);
      this.element.classList.toggle('no-hints', !settings.hints);
      this.menuHead.hidden = !settings.menuBar;
      this.menuButton.hidden = settings.menuBar;
      if (!settings.menuBar) this.menuBar.close();
      this.placeCards(settings.largeCards);
      this.render();
      this.measure();
    });
    window.addEventListener('keydown', (event) => this.onKey(event));
    window.addEventListener('keyup', (event) => {
      const key = keyName(event);
      this.app.wasd.release(key);
      this.app.arrows.release(key);
    });
    window.addEventListener('blur', () => {
      this.app.wasd.clear();
      this.app.arrows.clear();
    });
    // A match on this device stops when the page is hidden (another tab, the phone locked).
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.playingHere()) void this.pause();
    });
    const observer = new ResizeObserver(() => this.measure());
    for (const part of [this.top, this.players, this.bottom]) observer.observe(part);
    window.addEventListener('resize', () => this.measure());
    setInterval(() => this.tick(), 100);
    this.render();
    this.measure();
  }

  /** Opens the main menu (at the start, and from the pause menu). */
  async menu(): Promise<void> {
    if (this.busyMenu) return;
    this.busyMenu = true;
    this.app.setPaused(true);
    try {
      if (await this.online?.intercept()) return;
      for (;;) {
        const choice = await mainMenu();
        if (choice === 'computer' || choice === 'local') {
          if (await this.startNew(choice)) return;
          continue;
        }
        if (choice === 'online' || choice === 'join') {
          const online = this.online;
          if (online && (await (choice === 'online' ? online.host() : online.join()))) return;
          continue;
        }
        if (choice === 'settings') await settingsDialog(this.app.settings);
        else if (choice === 'controls') await controlsDialog();
        else if (choice === 'rules') await rulesDialog();
        else if (choice === 'about') await aboutDialog(VERSION, __AIR_HOCKEY_BUILD__);
        else {
          // Closed: play goes on with the match on the table, or a first one against the computer.
          if (this.app.match.current.phase === 'over' || !this.started) {
            await this.play();
          } else {
            this.app.setPaused(false);
          }
          return;
        }
      }
    } finally {
      this.busyMenu = false;
    }
  }

  /** A match against the computer with the terms in the settings, no questions asked. */
  async play(): Promise<void> {
    if (!(await this.leavesOnline())) return;
    const s = this.app.settings.get();
    const level = difficulty(s.difficulty);
    this.begin(
      {
        mode: 'computer',
        target: s.target,
        names: [s.name, 'Computer'],
        firstServe: 0,
        reach: s.reach,
      },
      { level: level.id },
    );
  }

  /** The New Game sheet, then the match it asks for; false if cancelled. */
  async startNew(opponent?: Opponent): Promise<boolean> {
    if (!(await this.leavesOnline())) return false;
    const settings = this.app.settings;
    const wasPaused = this.app.match.paused;
    this.app.setPaused(true);
    const choice = await newGameSheet(settings.get(), {
      ...(opponent ? { opponent } : {}),
      onLevelView: (view) => settings.update({ levelView: view }),
    });
    if (!choice) {
      this.app.setPaused(wasPaused);
      return false;
    }
    if (choice.mode === 'online') {
      const online = this.online;
      const set = online
        ? await online.host({
            target: choice.target,
            firstServe: choice.firstServe,
            reach: choice.reach,
          })
        : false;
      if (!set) this.app.setPaused(wasPaused);
      return set;
    }
    const patch: Partial<Settings> = {
      mode: choice.mode,
      target: choice.target,
      reach: choice.reach,
      ...(choice.mode === 'computer'
        ? { difficulty: choice.level }
        : { name: choice.names[0], name2: choice.names[1] }),
    };
    settings.update(patch);
    const first = choice.firstServe === 'toss' ? toss() : choice.firstServe;
    this.begin(
      {
        mode: choice.mode,
        target: choice.target,
        names: choice.names,
        firstServe: first,
        reach: choice.reach,
      },
      { level: choice.level },
    );
    this.toasts.show(
      `${choice.firstServe === 'toss' ? 'Coin toss: ' : ''}${this.serveText(choice.names, first)}`,
    );
    return true;
  }

  /** Starts a match on this device. */
  private begin(setup: MatchSetup, options: { level?: Settings['difficulty'] } = {}): void {
    this.toasts.clear();
    this.banner.hide();
    this.conceded = null;
    this.started = true;
    this.app.newMatch(setup, options);
    this.app.setPaused(false);
    this.render();
  }

  private serveText(names: readonly [string, string], seat: Seat): string {
    const mode = this.app.match.setup.mode;
    return mode === 'computer' && seat === 0 ? 'You serve' : `${names[seat]} serves`;
  }

  // --- for online play (src/ui/online) ---------------------------------------------------------

  /** Starts a match with this device playing `seats` (online: one). */
  beginMatch(setup: MatchSetup, seats: readonly Seat[]): void {
    this.toasts.clear();
    this.banner.hide();
    this.conceded = null;
    this.started = true;
    this.app.newMatch(setup, { localSeats: seats });
    this.render();
  }

  /** A note under the cards. */
  say(text: string, kind: 'info' | 'foul' | 'good' = 'info'): void {
    this.toasts.show(text, kind);
  }

  playerCard(seat: Seat): PlayerCard {
    return this.cards[seat];
  }

  /** Before a match on this device replaces an online one: leaves it, unless the player stays. */
  private async leavesOnline(): Promise<boolean> {
    return !this.online?.active || (await this.online.leaveForNewMatch());
  }

  /** Whether a match on this device is being played (not online, not over, not paused). */
  private playingHere(): boolean {
    const match = this.app.match;
    return (
      this.started &&
      match.setup.mode !== 'online' &&
      match.current.phase !== 'over' &&
      !match.paused
    );
  }

  /** The pause menu. On this device the match stands still until it closes. */
  async pause(): Promise<void> {
    if (dialogOpen() || this.pausing) return;
    const match = this.app.match;
    const online = match.setup.mode === 'online' && (this.online?.active ?? false);
    this.pausing = true;
    if (!online) this.app.setPaused(true);
    try {
      for (;;) {
        const choice = await pauseMenu({
          canConcede: this.canConcede(),
          ...(online ? { online: { canResign: match.current.phase !== 'over' } } : {}),
        });
        switch (choice) {
          case 'settings':
            await settingsDialog(this.app.settings);
            continue;
          case 'controls':
            await controlsDialog();
            continue;
          case 'rules':
            await rulesDialog();
            continue;
          case 'restart':
            this.restart();
            return;
          case 'newGame':
            if (await this.startNew()) return;
            continue;
          case 'concede':
            this.concede();
            return;
          case 'menu':
            this.pausing = false;
            await this.menu();
            return;
          case 'resign':
            await this.online?.resign();
            return;
          case 'leave':
            await this.online?.leave();
            return;
          default:
            // Back to the game (before the first match there is none to go back to).
            if (!online) this.app.setPaused(!this.started);
            return;
        }
      }
    } finally {
      this.pausing = false;
    }
  }

  /** The same match again from 0–0, on this device. */
  private restart(): void {
    if (this.app.match.setup.mode === 'online') return;
    this.toasts.clear();
    this.banner.hide();
    this.conceded = null;
    this.app.restart();
    this.app.setPaused(false);
    this.toasts.show(
      `Restarted: ${this.serveText(this.app.match.setup.names, this.app.match.setup.firstServe)}`,
    );
  }

  /** Whether the player may give up the match (against the computer). */
  private canConcede(): boolean {
    const match = this.app.match;
    return match.setup.mode === 'computer' && match.current.phase !== 'over';
  }

  private concede(): void {
    if (!this.canConcede()) return;
    const seat = this.app.localSeats[0] ?? 0;
    this.conceded = seat;
    this.app.match.concede(seat);
  }

  /** What happens in the match, as the interface shows it: the banner, notes, the result. */
  private onMatchEvent(event: MatchEvent): void {
    const state = this.app.match.current;
    const names = this.app.match.setup.names;
    const local = this.app.localSeats;
    if (event.kind === 'scored') {
      const kind = local.length === 2 ? 'ours' : local.includes(event.scorer) ? 'ours' : 'theirs';
      const who =
        this.app.match.setup.mode === 'computer' && event.scorer === 0
          ? 'You score'
          : `${names[event.scorer]} scores`;
      this.banner.show(
        state.phase === 'over' ? 'Match!' : 'Goal!',
        `${who} · ${state.score[0]}–${state.score[1]}`,
        kind,
      );
    } else if (event.kind === 'foul') {
      this.toasts.show(
        `${names[event.holder]} kept the puck over ${POSSESSION_LIMIT} seconds: ${names[other(event.holder)]} serves`,
        'foul',
      );
    } else if (event.kind === 'won') {
      setTimeout(() => void this.showResult(), this.conceded === null ? RESULT_DELAY_MS : 0);
    }
    this.render();
  }

  /** The end of the match: the result, then a rematch, the menu or a look at the table. */
  private async showResult(): Promise<void> {
    const match = this.app.match;
    const state = match.current;
    if (state.winner === null) return;
    const names = match.setup.names;
    const computer = match.setup.mode === 'computer';
    const title =
      computer && state.winner === 0
        ? 'You win the match'
        : computer
          ? 'The computer wins the match'
          : `${names[state.winner]} wins the match`;
    const detail =
      this.conceded !== null
        ? `${names[this.conceded]} gave up the match.`
        : `First to ${state.target}, ${state.score[state.winner]}–${state.score[other(state.winner)]}.`;
    this.banner.hide();
    const choice = await resultDialog({ title, detail, names, score: state.score });
    if (choice === 'rematch') await this.rematch();
    else if (choice === 'menu') await this.menu();
    this.render();
  }

  /** After the match: the same terms again, the loser serving first (online, both must ask). */
  private async rematch(): Promise<void> {
    const match = this.app.match;
    const state = match.current;
    if (state.winner === null) return;
    if (match.setup.mode === 'online') {
      await this.online?.rematch();
      return;
    }
    const firstServe = other(state.winner);
    this.begin({ ...match.setup, firstServe }, { level: this.app.computer?.level.id });
    this.toasts.show(`Rematch: ${this.serveText(match.setup.names, firstServe)}`);
  }

  /** Opens the guide to the screen's parts, or closes it. */
  private toggleGuide(): void {
    if (this.guide.open) {
      this.guide.close();
      return;
    }
    this.menuBar.close();
    this.guide.show(this.guideParts());
  }

  /** The guide's parts, as the screen shows them now: what each is and how to use it. */
  private guideParts(): GuidePart[] {
    const { largeCards, menuBar } = this.app.settings.get();
    // The box round whichever of these elements show (none: no part).
    const around =
      (...elements: (HTMLElement | null)[]) =>
      (): DOMRect | null => {
        const boxes = elements
          .filter((e): e is HTMLElement => e !== null)
          .map((e) => e.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0);
        if (boxes.length === 0) return null;
        const left = Math.min(...boxes.map((r) => r.left));
        const top = Math.min(...boxes.map((r) => r.top));
        const right = Math.max(...boxes.map((r) => r.right));
        const bottom = Math.max(...boxes.map((r) => r.bottom));
        return new DOMRect(left, top, right - left, bottom - top);
      };
    const find = (selector: string) => this.element.querySelector<HTMLElement>(selector);
    const mallet = (): DOMRect | null => {
      const seat = this.app.localSeats[0] ?? 0;
      const m = this.app.match.world.mallets[seat];
      const p = this.app.toClient(m.x, m.y, 0.04);
      return p.visible ? new DOMRect(p.x - 18, p.y - 18, 36, 36) : null;
    };
    return [
      {
        target: around(find('.status-pill')),
        title: 'Status',
        text: 'Who serves, who scored, and the last seconds to clear the puck from your half.',
        side: 'top',
      },
      {
        target: mallet,
        title: 'Your mallet',
        text: 'Move the mouse over the table, or drag a finger: the mallet follows, in its green zone. W A S D move it too.',
        side: 'right',
      },
      {
        target: largeCards ? around(this.players) : around(...this.cards.map((c) => c.element)),
        title: 'Players',
        text: 'Goals scored, with the goals to win as pips. A card glows while the puck is in that player’s half, its ring counting down the seconds they may keep it.',
        side: largeCards ? 'right' : 'bottom',
      },
      {
        target: around(menuBar ? this.menuBar.element : this.menuButton),
        title: 'Menus',
        text: 'A new game, the view, the settings and the rules.',
        side: 'bottom',
      },
      {
        target: around(find('.m-new-game')),
        title: 'New game',
        text: 'Against the computer, two players on this device, or a friend online.',
        side: 'bottom',
      },
      {
        target: around(
          this.pauseButton,
          this.viewButton,
          find('.hud-reset'),
          find('.hud-fullscreen'),
        ),
        title: 'Pause and the view',
        text: 'Pause (Esc), the 3D or the top view (T), the view as it began (Home), full screen.',
        side: 'bottom',
      },
    ];
  }

  private toggleFullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }

  /** The menu bar: what the main and pause menus offer, and the settings used most, at a click. */
  private menus(): Menu[] {
    const app = this.app;
    const settings = app.settings;
    const sep: MenuItem = { separator: true };
    const toggle = (
      label: string,
      key: 'keepZoom' | 'largeCards' | 'sound' | 'hints' | 'showZones',
      shortcut?: string,
    ): MenuItem => ({
      label,
      ...(shortcut ? { shortcut } : {}),
      checked: () => settings.get()[key],
      action: () => settings.update({ [key]: !settings.get()[key] }),
    });
    const choose = <K extends 'difficulty' | 'target' | 'reach' | 'finish' | 'quality'>(
      key: K,
      options: readonly (readonly [Settings[K], string])[],
    ): MenuItem[] =>
      options.map(([value, label]) => ({
        label,
        checked: () => settings.get()[key] === value,
        action: () => settings.update({ [key]: value }),
      }));
    const online = () => this.online;
    const onlineNow = () => app.match.setup.mode === 'online' && (online()?.active ?? false);
    return [
      {
        label: '&Game',
        items: () => {
          const items: MenuItem[] = [
            {
              label: 'Against the &computer…',
              action: () => void this.startNew('computer'),
            },
            { label: '&Two players…', action: () => void this.startNew('local') },
            {
              label: 'Play a friend &online…',
              enabled: () => online() !== null,
              action: () => void online()?.host(),
            },
            {
              label: '&Join a game…',
              enabled: () => online() !== null,
              action: () => void online()?.join(),
            },
          ];
          if (onlineNow()) {
            items.push(sep);
            if (app.match.current.phase !== 'over') {
              items.push({ label: '&Resign the match', action: () => void online()?.resign() });
            }
            items.push({ label: '&Leave the online game', action: () => void online()?.leave() });
          } else {
            items.push(
              sep,
              {
                label: '&Pause',
                shortcut: 'Esc',
                enabled: () => this.started,
                action: () => void this.pause(),
              },
              {
                label: '&Restart the match',
                shortcut: 'R',
                enabled: () => this.started,
                action: () => this.restart(),
              },
              {
                label: 'Con&cede the match',
                enabled: () => this.canConcede(),
                action: () => this.concede(),
              },
            );
          }
          return items;
        },
      },
      {
        label: '&View',
        items: () => [
          {
            label: '&Top view',
            shortcut: 'T',
            checked: () => app.rig.view === 'top',
            action: () => this.run({ kind: 'toggleView' }),
          },
          { label: '&Reset the view', shortcut: 'Home', action: () => this.run({ kind: 'home' }) },
          {
            label: 'Look from the &other end',
            shortcut: 'F',
            action: () => this.run({ kind: 'flip' }),
          },
          {
            label: '&Full screen',
            checked: () => document.fullscreenElement !== null,
            action: () => this.toggleFullscreen(),
          },
          sep,
          toggle('Show the mallet &zones', 'showZones'),
          toggle('&Keep the zoom while turning', 'keepZoom'),
          toggle('Large player &cards', 'largeCards'),
        ],
      },
      {
        label: '&Options',
        items: () => [
          toggle('&Sound', 'sound', 'M'),
          {
            label: 'The computer’s s&trength',
            submenu: () =>
              choose(
                'difficulty',
                DIFFICULTIES.map((d) => [d.id, d.label] as const),
              ),
          },
          {
            label: '&Goals to win',
            submenu: () =>
              choose(
                'target',
                TARGETS.map((t) => [t, String(t)] as const),
              ),
          },
          {
            label: '&Mallet zone',
            submenu: () =>
              choose(
                'reach',
                REACH_IDS.map((id) => [id, REACH_NAMES[id][1]] as const),
              ),
          },
          {
            label: 'Table &finish',
            submenu: () =>
              choose(
                'finish',
                (Object.keys(FINISH_NAMES) as (keyof typeof FINISH_NAMES)[]).map(
                  (f) => [f, FINISH_NAMES[f]] as const,
                ),
              ),
          },
          {
            label: 'Graphics, after a &reload',
            submenu: () =>
              choose('quality', [
                ['auto', 'Auto'],
                ['high', 'High'],
                ['low', 'Low'],
              ]),
          },
          sep,
          { label: 'All &settings…', action: () => void settingsDialog(settings) },
        ],
      },
      {
        label: '&Help',
        items: () => [
          { label: '&Keyboard and mouse', shortcut: '?', action: () => void controlsDialog() },
          { label: '&Rules of air hockey', action: () => void rulesDialog() },
          toggle('&Hints on hover', 'hints'),
          { label: '&What each part does', action: () => this.toggleGuide() },
          sep,
          {
            label: '&About Air Hockey 3D…',
            action: () => void aboutDialog(VERSION, __AIR_HOCKEY_BUILD__),
          },
        ],
      },
    ];
  }

  private onKey(event: KeyboardEvent): void {
    if (dialogOpen()) return;
    // The guide takes the keys while it is open; Escape closes it.
    if (this.guide.open) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.guide.close();
      }
      return;
    }
    // An open menu takes the keys (its own handle them where it has the focus); Escape shuts it.
    if (this.menuBar.isOpen) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.menuBar.close();
      }
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [role="menubar"]')) return;
    // The mallets' keys: W A S D, and with two players on one device the arrows.
    const twoHere = this.app.localSeats.length === 2;
    if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      const key = keyName(event);
      if (this.app.wasd.press(key) || (twoHere && this.app.arrows.press(key))) {
        event.preventDefault();
        return;
      }
    }
    const command = commandFor(event, twoHere);
    if (!command) return;
    event.preventDefault();
    this.run(command);
  }

  /** Carries out a command from the keyboard or a button. */
  run(command: Command): void {
    const app = this.app;
    switch (command.kind) {
      case 'orbit':
        app.rig.orbit(command.azimuth, command.elevation);
        break;
      case 'zoom':
        app.rig.zoom(command.factor);
        break;
      case 'home':
        app.rig.home();
        break;
      case 'flip':
        app.rig.flip();
        break;
      case 'toggleView':
        app.setView(app.rig.view === '3d' ? 'top' : '3d');
        break;
      case 'sound': {
        const on = !app.settings.get().sound;
        app.settings.update({ sound: on });
        this.toasts.show(on ? 'Sound on' : 'Sound off');
        break;
      }
      case 'pause':
        void this.pause();
        break;
      case 'restart':
        if (this.started) this.restart();
        break;
      case 'newGame':
        void this.startNew();
        break;
      case 'help':
        void controlsDialog();
        break;
    }
    this.render();
  }

  /** Ten times a second: the possession clocks on the cards, and the status. */
  private tick(): void {
    this.renderCards(this.app.match.current);
    this.status.textContent = this.statusText(this.app.match.current);
  }

  /** The player whose half the puck is in, while it is in play. */
  private holder(state: MatchState): Seat | null {
    const world = this.app.match.world;
    if (state.phase !== 'play' || !world.live) return null;
    return halfOf(this.app.match.spec, world.puck.y);
  }

  private renderCards(state: MatchState): void {
    for (const seat of [0, 1] as const) this.cards[seat].render(this.cardView(state, seat));
  }

  private cardView(state: MatchState, seat: Seat): PlayerView {
    const match = this.app.match;
    const computer = match.setup.mode === 'computer' && seat === 1 ? this.app.computer : null;
    const holder = this.holder(state);
    const active = holder === seat && this.started;
    const left = Math.max(0, POSSESSION_LIMIT - match.possessionTime);
    const waiting = this.serving(state);
    return {
      name: match.setup.names[seat],
      score: state.score[seat],
      target: state.target,
      tag: computer ? computer.level.label : null,
      note: waiting && state.server === seat ? 'To serve' : null,
      active,
      clock: active ? left / POSSESSION_LIMIT : null,
      seconds: active ? Math.ceil(left) : null,
      portrait: computer ? opponentPortrait(computer.level.id) : null,
    };
  }

  /** Whether the puck lies still on the server's spot, waiting to be struck. */
  private serving(state: MatchState): boolean {
    const match = this.app.match;
    if (state.phase !== 'play' || !match.world.live) return false;
    const spot = serveSpot(match.spec, state.server, match.reach);
    const p = match.world.puck;
    return p.vx === 0 && p.vy === 0 && Math.hypot(p.x - spot.x, p.y - spot.y) < 1e-9;
  }

  /** Brings everything in line with the match. */
  render(): void {
    const app = this.app;
    const state = app.match.current;
    const zone = app.match.reach;
    this.race.textContent = `First to ${state.target}${zone === 'half' ? '' : ` · zone ${REACH_NAMES[zone][0]}`}`;
    this.renderCards(state);
    this.status.textContent = this.statusText(state);
    const shown =
      state.winner ??
      (state.phase === 'play' ? (this.holder(state) ?? state.server) : state.server);
    this.statusMark.textContent =
      app.match.setup.names[shown].trim().charAt(0).toUpperCase() || '?';
    this.action.hidden = state.phase !== 'over';
    const online = app.match.setup.mode === 'online';
    this.pauseButton.hidden = online;
    const top = app.rig.view === 'top';
    this.viewButton.innerHTML = top ? LINE_ICONS.perspective : LINE_ICONS.topView;
    const label = top ? '3D view (T)' : 'Top view (T)';
    this.viewButton.setAttribute('aria-label', label);
    this.viewButton.dataset.tip = label;
    this.element.classList.toggle('paused', app.match.paused && this.started);
  }

  private statusText(state: MatchState): string {
    const match = this.app.match;
    const names = match.setup.names;
    const held = this.online?.status();
    if (held) return held;
    if (!this.started) return 'Choose a game to begin';
    if (state.winner !== null) {
      return match.setup.mode === 'computer' && state.winner === 0
        ? 'You win the match'
        : `${names[state.winner]} wins the match`;
    }
    if (match.paused && match.setup.mode !== 'online') return 'Paused';
    if (state.phase === 'goal' && state.conceded !== null) {
      return `Goal for ${names[other(state.conceded)]} · ${names[state.server]} serves next`;
    }
    if (state.phase === 'foul') return `${names[state.server]} serves`;
    if (this.serving(state)) return this.serveText(names, state.server);
    if (match.fetching !== null) {
      const seat = match.fetching;
      return this.app.localSeats.length === 1 && this.app.localSeats[0] === seat
        ? 'Go and get the puck: your mallet may leave its zone'
        : `${names[seat]} may leave their zone to get the puck`;
    }
    const holder = this.holder(state);
    const left = POSSESSION_LIMIT - match.possessionTime;
    if (holder !== null && left <= 3) {
      return `${names[holder]}: ${Math.max(1, Math.ceil(left))} s to clear the puck`;
    }
    return `First to ${state.target} · ${state.score[0]}–${state.score[1]}`;
  }

  /** The cards in the top bar, with the goals to win between them, or large on their own. */
  private placeCards(large: boolean): void {
    const [first, second] = this.cards;
    if (large) {
      this.players.append(first.element, second.element);
    } else {
      this.race.before(first.element);
      this.race.after(second.element);
    }
    this.players.hidden = !large;
    this.element.classList.toggle('large-cards', large);
    for (const card of this.cards) card.setLarge(large);
  }

  /**
   * Tells the camera how much of each edge the interface covers: the top bar, the status pill,
   * and large cards on the left (or, on a phone held upright, in a row under the top bar).
   */
  private measure(): void {
    const h = window.innerHeight;
    const top = this.top.getBoundingClientRect();
    this.element.style.setProperty('--bar-bottom', `${Math.round(top.bottom)}px`);
    const bottom = this.bottom.getBoundingClientRect();
    const insets = {
      top: Math.max(0, top.bottom),
      bottom: bottom.height > 0 ? Math.max(0, h - bottom.top) : 0,
      right: 0,
      left: 0,
    };
    const players = this.players.getBoundingClientRect();
    if (!this.players.hidden && players.width > 0) {
      const inRow = window.matchMedia(PHONE_UPRIGHT).matches;
      if (inRow) insets.top = Math.max(insets.top, players.bottom);
      else insets.left = Math.max(0, players.right);
    }
    this.element.style.setProperty('--hud-top', `${Math.round(insets.top)}px`);
    this.app.setInsets(insets);
  }
}
