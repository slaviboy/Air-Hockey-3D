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

// Puts the game together (Pool's App): the scene, the cameras, the table, the mallets and the
// puck, the match being played and who drives each mallet (a pointer, the keys, the computer or,
// online, the other player). The match leads; the meshes only follow.

import { Vector3 } from 'three';
import { ComputerPlayer } from '../ai/ComputerPlayer.ts';
import { difficulty, type DifficultyId } from '../ai/difficulty.ts';
import { hitFor } from '../audio/hitAudio.ts';
import { SoundManager } from '../audio/SoundManager.ts';
import { FrameMonitor } from '../core/FrameMonitor.ts';
import { createRng } from '../core/rng.ts';
import type { Store } from '../core/Store.ts';
import { Match, type MatchEvent, type MatchSetup } from '../game/Match.ts';
import { KeyDriver, type ScreenAxes } from '../input/KeyDriver.ts';
import { PaddleInput } from '../input/PaddleInput.ts';
import { MALLET_KEYS } from '../input/shortcuts.ts';
import { PLAYER_MALLET } from '../physics/params.ts';
import type { Seat } from '../rules/types.ts';
import { CameraRig, type Insets, type ViewMode } from '../scene/CameraRig.ts';
import { HockeyScene, type Quality } from '../scene/HockeyScene.ts';
import { PiecesView } from '../scene/PiecesView.ts';
import { TableView } from '../scene/TableView.ts';
import { toScene } from '../table/frame.ts';
import { halfOf, type Point } from '../table/geometry.ts';
import { TABLE } from '../table/spec.ts';
import type { Settings } from './Settings.ts';

export class App {
  readonly scene: HockeyScene;
  readonly rig: CameraRig;
  readonly tableView: TableView;
  readonly pieces: PiecesView;
  readonly match: Match;
  readonly input: PaddleInput;
  readonly sound: SoundManager;
  /** W A S D: this player's mallet (with two players on one device, seat 0's). */
  readonly wasd: KeyDriver;
  /** The arrows: with two players on one device, seat 1's mallet. */
  readonly arrows: KeyDriver;
  readonly ready: Promise<void>;
  /** Seats played on this device: both on one device, one against the computer or online. */
  localSeats: readonly Seat[] = [0];
  /** The computer's player, in a match against it. */
  computer: ComputerPlayer | null = null;
  /** Called with everything that happens in the match (the interface listens). */
  onMatchEvent: (event: MatchEvent) => void = () => {};
  /** Called when the graphics were lowered because frames ran slow, with the frame rate seen. */
  onQualityLowered: (fps: number) => void = () => {};
  /** Frame times while something moves, to spot a device too slow for the high quality. */
  private readonly frames = new FrameMonitor();
  private readonly projected = new Vector3();
  private readonly out = { x: 0, y: 0, z: 0 };

  constructor(
    root: HTMLElement,
    baseUrl: string,
    readonly settings: Store<Settings>,
    quality: Quality,
  ) {
    const spec = TABLE;
    this.sound = new SoundManager(undefined, undefined, async (name) => {
      const response = await fetch(`${baseUrl}sounds/${name}.mp3`);
      if (!response.ok) throw new Error(`no sound ${name}`);
      return response.arrayBuffer();
    });
    this.rig = new CameraRig(() => this.scene?.requestRender());
    this.scene = new HockeyScene(root, this.rig.camera, quality);
    this.tableView = new TableView(baseUrl, spec);
    this.pieces = new PiecesView(baseUrl, spec);
    this.scene.scene.add(this.tableView.group, this.pieces.group);
    const s = settings.get();
    this.match = new Match(
      { mode: 'computer', target: s.target, names: [s.name, 'Computer'], firstServe: 0 },
      spec,
    );
    this.match.paused = true;
    this.match.onEvent = (event) => this.onEvent(event);
    this.wasd = new KeyDriver(MALLET_KEYS.wasd, () => this.screenAxes());
    this.arrows = new KeyDriver(MALLET_KEYS.arrows, () => this.screenAxes());
    this.match.drivers[0] = this.wasd;
    this.rig.setTable(spec.W / 2 + spec.railWidth, spec.L / 2 + spec.railWidth + 0.06, -0.04, 0.09);
    this.scene.onResize((w, h) => this.rig.setSize(w, h));
    this.scene.addUpdater((dt) => {
      const moving = this.rig.update(dt);
      this.scene.camera = this.rig.camera;
      const playing = this.match.update(dt);
      const animating = this.pieces.update(this.match, dt);
      const { score } = this.match.current;
      this.tableView.setScore(score[0], score[1]);
      const puck = this.match.world.puck;
      this.sound.setAir(playing && this.match.world.live, Math.hypot(puck.vx, puck.vy));
      this.watchFrames(dt, moving || playing);
      return moving || playing || animating;
    });
    this.input = new PaddleInput(this.scene.renderer.domElement, {
      seatFor: (point, touch) => this.seatFor(point, touch),
      drive: (seat, point) => {
        this.match.targets[seat] = point;
      },
      orbit: (da, de) => this.rig.orbit(da, de),
      zoom: (f) => this.rig.zoom(f),
      pan: (dx, dz) => this.rig.panBy(dx, dz),
      tilts: () => this.rig.view === '3d',
      gestures: () => this.localSeats.length < 2,
      table: () => ({
        W: spec.W,
        L: spec.L,
        railWidth: spec.railWidth,
        grip: spec.mallet.height * 0.6,
      }),
      camera: () => this.rig.camera,
    });
    settings.subscribe((next) => {
      if (next.view !== this.rig.view) this.rig.setView(next.view);
      this.rig.setKeepZoom(next.keepZoom);
      this.sound.configure(next.sound, next.volume);
      this.tableView.setFinish(next.finish);
    });
    this.rig.setView(s.view, true);
    this.ready = Promise.all([this.tableView.show(), this.pieces.load()]).then(() => {
      this.pieces.update(this.match, 0);
      this.scene.requestRender();
    });
  }

  /** What a match event sounds like and does to the pieces; then the interface hears of it. */
  private onEvent(event: MatchEvent): void {
    const hit = hitFor(event);
    if (hit) this.sound.hit(hit);
    if (event.kind === 'scored') {
      // A goal for a player at this device is a cheer; against them, a groan (on one device with
      // two players, every goal is someone's cheer).
      const ours = this.localSeats.includes(event.scorer);
      this.sound.cue(ours ? 'goal' : 'conceded');
    } else if (event.kind === 'foul') {
      this.sound.cue('foul');
    } else if (event.kind === 'served') {
      this.sound.cue('serve');
      this.computer?.reset();
    } else if (event.kind === 'won') {
      this.sound.cue('match');
    }
    this.pieces.onEvent(event);
    this.onMatchEvent(event);
  }

  /** The seat a pointer at this point drives, if any may be moved now. */
  private seatFor(point: Point, _touch: boolean): Seat | null {
    if (this.match.paused || this.match.held) return null;
    if (this.localSeats.length === 2) return halfOf(this.match.spec, point.y);
    return this.localSeats[0] ?? null;
  }

  /** The screen's right and up on the table, for the keys. */
  screenAxes(): ScreenAxes {
    const camera = this.rig.camera;
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    // The camera's right in the scene, onto the table: scene (X, Z) is table (x, -y).
    const rx = e[0]!;
    const ry = -e[2]!;
    const r = Math.hypot(rx, ry) || 1;
    const right = { x: rx / r, y: ry / r };
    return { right, up: { x: -right.y, y: right.x } };
  }

  /**
   * Starts a match with these terms: against the computer (at this level), two players on this
   * device, or (online) with one seat here and the other driven from outside.
   */
  newMatch(
    setup: MatchSetup,
    options: { localSeats?: readonly Seat[]; level?: DifficultyId } = {},
  ): void {
    const local = options.localSeats ?? (setup.mode === 'local' ? [0, 1] : [0]);
    this.localSeats = local;
    this.computer = null;
    this.wasd.clear();
    this.arrows.clear();
    this.match.drivers[0] = null;
    this.match.drivers[1] = null;
    this.match.limits[0] = PLAYER_MALLET;
    this.match.limits[1] = PLAYER_MALLET;
    if (setup.mode === 'computer') {
      const level = difficulty(options.level ?? this.settings.get().difficulty);
      // A new seed each match, so no two games against the computer go alike.
      this.computer = new ComputerPlayer(level, createRng((Date.now() ^ 0x9e3779b9) >>> 0));
      this.match.drivers[1] = this.computer;
    }
    // The keys drive this device's mallets: W A S D the first, the arrows the second of two.
    if (local[0] !== undefined) this.match.drivers[local[0]] = this.wasd;
    if (local.length === 2) this.match.drivers[1] = this.arrows;
    this.match.start(setup);
    this.match.held = false;
    this.pieces.onEvent({ kind: 'served', seat: setup.firstServe });
    // Each player looks from behind their own goal; two on one device share the top view.
    const own = local.length === 1 ? local[0]! : 0;
    this.rig.lookFrom(own === 1 ? 1 : 0, true);
    if (local.length === 2 && this.rig.view !== 'top') this.setView('top', true);
    this.scene.requestRender();
  }

  /** Plays the same match again from 0–0. */
  restart(): void {
    this.newMatch(this.match.setup, {
      localSeats: this.localSeats,
      level: this.computer?.level.id,
    });
  }

  /** Stops or restarts time (the pause menu, on one device). */
  setPaused(paused: boolean): void {
    this.match.paused = paused;
    if (paused) {
      this.wasd.clear();
      this.arrows.clear();
    }
    this.scene.requestRender();
  }

  setView(mode: ViewMode, immediate = false): void {
    this.rig.setView(mode, immediate);
    this.settings.update({ view: mode });
  }

  setInsets(insets: Insets): void {
    this.rig.setInsets(insets);
  }

  /**
   * On the automatic setting, a device that animates at under 40 frames a second is given the low
   * quality, once, and told why.
   */
  private watchFrames(dt: number, animating: boolean): void {
    if (this.settings.get().quality !== 'auto' || this.scene.quality === 'low') return;
    this.frames.record(dt, animating);
    if (!this.frames.slow) return;
    const fps = Math.round(1 / this.frames.median);
    this.frames.reset();
    this.scene.lowerQuality();
    this.onQualityLowered(fps);
  }

  /** Where a point of the table (its frame; z above the surface) appears, in client pixels. */
  toClient(x: number, y: number, z = 0): { x: number; y: number; visible: boolean } {
    const { W, L } = this.match.spec;
    toScene(x, y, z, W, L, this.out);
    this.projected.set(this.out.x, this.out.y, this.out.z).project(this.rig.camera);
    const rect = this.scene.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((this.projected.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - this.projected.y) / 2) * rect.height,
      visible: this.projected.z > -1 && this.projected.z < 1,
    };
  }
}
