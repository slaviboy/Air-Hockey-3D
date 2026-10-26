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

// Owns the renderer, the room, the lights and the render loop. Frames are drawn only when something
// changed or an animation is running, so a table at rest costs nothing (Pool's scene, lit for an
// arcade table).
//
// The light is a games room's: three long lamps in a row over the table, whose shapes the glossy
// surface and the puck reflect; a light from almost straight above for the shadows of the mallets
// and the puck; a dark room around, lit mostly by the table's own glowing surface.

import {
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  NeutralToneMapping,
  PCFShadowMap,
  PlaneGeometry,
  PMREMGenerator,
  RectAreaLight,
  Scene,
  SRGBColorSpace,
  Timer,
  WebGLRenderer,
  type Camera,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { fixRectAreaLights } from './shaderFixes.ts';

/** Called every frame with the elapsed seconds; returns true while it still needs frames. */
export type FrameUpdater = (deltaSeconds: number) => boolean;

export type Quality = 'high' | 'low';

/** The dark room around the table. */
const ROOM_COLOUR = new Color('#090b10');
const LAMP_HEIGHT = 1.15;
/** The three lamps: each this wide across the table and this long along it, at these places. */
const LAMP = { width: 0.7, length: 0.5, intensity: 5, at: [-0.8, 0, 0.8] } as const;
/** The device pixels per CSS pixel the high quality draws at, at most. */
export const HIGH_PIXEL_RATIO = 2;
/** A device too slow lowers its resolution by this much at a time, down to one. */
const PIXEL_RATIO_STEP = 0.25;
/** The floor, the playing surface's height below it (src/table/spec.ts). */
const FLOOR = -0.8;

export class HockeyScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  /** The camera frames are drawn with; the camera rig decides which. */
  camera: Camera;
  private readonly shadowLight: DirectionalLight;
  private readonly lamps = new Group();
  private pixelRatio: number;
  private readonly updaters = new Set<FrameUpdater>();
  private readonly resizeListeners = new Set<(width: number, height: number) => void>();
  private readonly timer = new Timer();
  private dirty = true;
  private readonly resizeObserver: ResizeObserver;
  private currentQuality: Quality;

  /**
   * @param maxPixelRatio the device pixels per CSS pixel the high quality draws at, at most (fewer
   *   on a phone or a tablet, whose screens look as sharp with fewer)
   */
  constructor(
    private readonly container: HTMLElement,
    camera: Camera,
    quality: Quality,
    maxPixelRatio = HIGH_PIXEL_RATIO,
  ) {
    this.camera = camera;
    this.currentQuality = quality;
    this.pixelRatio =
      quality === 'high' ? Math.max(1, Math.min(window.devicePixelRatio, maxPixelRatio)) : 1;
    this.renderer = new WebGLRenderer({
      antialias: quality === 'high',
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = quality === 'high';
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.domElement.className = 'scene-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene.background = ROOM_COLOUR.clone();
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.12;
    pmrem.dispose();

    // The lamps themselves are not drawn: the cameras look down from above them, and a hood would
    // stand between the player and the table. Their light, and their shapes in the surface's gloss,
    // remain.
    RectAreaLightUniformsLib.init();
    fixRectAreaLights();
    this.lamps.name = 'lamps';
    this.hangLamps(quality === 'high');
    this.scene.add(this.lamps);

    this.scene.add(new HemisphereLight('#e6ecff', '#10131c', 0.45));

    // From almost straight above, like the lamps: shadows fall under the mallets and the puck.
    this.shadowLight = new DirectionalLight('#f6f8ff', 0.9);
    this.shadowLight.position.set(0.15, 4, 0.35);
    this.shadowLight.target.position.set(0, 0, 0);
    this.shadowLight.castShadow = quality === 'high';
    const shadow = this.shadowLight.shadow;
    shadow.mapSize.set(2048, 2048);
    shadow.camera.left = -0.95;
    shadow.camera.right = 0.95;
    shadow.camera.top = 1.6;
    shadow.camera.bottom = -1.6;
    shadow.camera.near = 2.5;
    shadow.camera.far = 6;
    shadow.radius = 5;
    shadow.bias = -0.0002;
    shadow.normalBias = 0.01;
    this.scene.add(this.shadowLight, this.shadowLight.target);

    const floor = new Mesh(
      new PlaneGeometry(14, 14),
      new MeshStandardMaterial({ color: '#121418', roughness: 0.85 }),
    );
    floor.name = 'floor';
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.timer.connect(document);
    this.renderer.setAnimationLoop((time) => this.tick(time));
  }

  /** Registers a per-frame update; returns a function that removes it. */
  addUpdater(updater: FrameUpdater): () => void {
    this.updaters.add(updater);
    this.requestRender();
    return () => this.updaters.delete(updater);
  }

  onResize(listener: (width: number, height: number) => void): void {
    this.resizeListeners.add(listener);
    listener(this.width, this.height);
  }

  requestRender(): void {
    this.dirty = true;
  }

  get width(): number {
    return Math.max(1, this.container.clientWidth);
  }

  get height(): number {
    return Math.max(1, this.container.clientHeight);
  }

  get quality(): Quality {
    return this.currentQuality;
  }

  /**
   * One step down while running, for a device too slow for what it draws: first fewer pixels, a
   * little at a time down to one per CSS pixel, which costs the look least; then the low quality,
   * with no shadows and one lamp for three. (Antialiasing stays as the renderer was made.) Returns
   * what was lowered, or null if nothing is left to lower.
   */
  lowerQuality(): 'resolution' | 'quality' | null {
    if (this.currentQuality === 'low') return null;
    if (this.pixelRatio > 1) {
      this.pixelRatio = Math.max(1, this.pixelRatio - PIXEL_RATIO_STEP);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
      return 'resolution';
    }
    this.currentQuality = 'low';
    this.renderer.shadowMap.enabled = false;
    this.shadowLight.castShadow = false;
    this.hangLamps(false);
    // The materials were compiled with shadows and three lamps; they must be compiled again.
    this.scene.traverse((object) => {
      const material = (object as Mesh).material;
      for (const m of Array.isArray(material) ? material : material ? [material] : []) {
        m.needsUpdate = true;
      }
    });
    this.resize();
    return 'quality';
  }

  /**
   * The lamps over the table: three in a row, or (for the low quality) one as long as the row,
   * giving as much light. Each lamp is worked out for every pixel it lights, so three cost the
   * most of anything in the room; one shows a single long shape in the gloss instead of three.
   */
  private hangLamps(three: boolean): void {
    this.lamps.clear();
    const { width, length, intensity, at } = LAMP;
    const spans = three
      ? at.map((z) => ({ z, length }))
      : [{ z: 0, length: at[at.length - 1]! - at[0]! + length }];
    // A lamp's light is its intensity times its area: the one shares out the three's.
    const total = intensity * at.length * length;
    for (const span of spans) {
      const share = three ? intensity : total / span.length;
      const lamp = new RectAreaLight('#f3f6ff', share, width, span.length);
      lamp.position.set(0, LAMP_HEIGHT, span.z);
      lamp.lookAt(0, 0, span.z);
      this.lamps.add(lamp);
    }
  }

  /** Renders a frame now, regardless of the dirty flag (used before screenshots). */
  renderNow(): void {
    this.renderer.render(this.scene, this.camera);
    this.dirty = false;
  }

  private resize(): void {
    this.renderer.setSize(this.width, this.height, false);
    for (const listener of this.resizeListeners) listener(this.width, this.height);
    this.requestRender();
  }

  private tick(time: number): void {
    this.timer.update(time);
    const delta = Math.min(this.timer.getDelta(), 0.1);
    let active = false;
    for (const update of this.updaters) {
      if (update(delta)) active = true;
    }
    if (active || this.dirty) this.renderNow();
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.timer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
