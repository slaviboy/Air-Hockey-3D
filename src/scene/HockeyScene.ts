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
/** The floor, the playing surface's height below it (src/table/spec.ts). */
const FLOOR = -0.8;

export class HockeyScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  /** The camera frames are drawn with; the camera rig decides which. */
  camera: Camera;
  private readonly shadowLight: DirectionalLight;
  private readonly updaters = new Set<FrameUpdater>();
  private readonly resizeListeners = new Set<(width: number, height: number) => void>();
  private readonly timer = new Timer();
  private dirty = true;
  private readonly resizeObserver: ResizeObserver;
  private currentQuality: Quality;

  constructor(
    private readonly container: HTMLElement,
    camera: Camera,
    quality: Quality,
  ) {
    this.camera = camera;
    this.currentQuality = quality;
    this.renderer = new WebGLRenderer({
      antialias: quality === 'high',
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = quality === 'high';
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : 1));
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
    const lamps = new Group();
    lamps.name = 'lamps';
    for (const z of [-0.8, 0, 0.8]) {
      const lamp = new RectAreaLight('#f3f6ff', 5, 0.7, 0.5);
      lamp.position.set(0, LAMP_HEIGHT, z);
      lamp.lookAt(0, 0, z);
      lamps.add(lamp);
    }
    this.scene.add(lamps);

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
   * Drops to the low quality while running, for a device too slow for the high one: no shadows and
   * one pixel per CSS pixel. (Antialiasing stays as the renderer was made.)
   */
  lowerQuality(): void {
    if (this.currentQuality === 'low') return;
    this.currentQuality = 'low';
    this.renderer.shadowMap.enabled = false;
    this.shadowLight.castShadow = false;
    this.renderer.setPixelRatio(1);
    // The materials were compiled with shadows; they must be compiled again without.
    this.scene.traverse((object) => {
      const material = (object as Mesh).material;
      for (const m of Array.isArray(material) ? material : material ? [material] : []) {
        m.needsUpdate = true;
      }
    });
    this.resize();
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
