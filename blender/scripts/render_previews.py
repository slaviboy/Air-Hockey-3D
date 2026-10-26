# Copyright (C) 2026 Stanislav Georgiev
# https://github.com/slaviboy
#
# This file is part of Air Hockey 3D.
#
# Air Hockey 3D is free software: you can redistribute it and/or modify it under the terms of the
# GNU General Public License as published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version. See the LICENSE file for the full terms.

"""Renders the reference views of air-hockey.blend into blender/renders/, to check the model
against the reference (docs/visual-research.md) before it goes into the game:

    three-quarter-silver.jpg  the silver finish from the coin door's side, low, as the first view
    top-black.jpg             the black finish from high above the coin door's side
    three-quarter-black.jpg   the black finish from a corner, the goal housing nearest
    mallet-puck.jpg           a mallet and the puck on the surface, close

Lit like a product photograph: a white studio, a soft key light above and a fill. The surface's
centre line and the game's mark, which the game draws in its own shader, are added here as thin
white shapes for the renders only; the exported model is not touched.

Run: blender -b blender/air-hockey.blend --python-exit-code 1 -P blender/scripts/render_previews.py
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
from mathutils import Vector

import common
import materials

STAMP_FIELDS = (
    "camera", "date", "filename", "frame", "frame_range", "hostname", "lens", "marker", "memory",
    "note", "render_time", "scene", "sequencer_strip", "time",
)


def flat(name, colour, emission=0.0):
    mat = bpy.data.materials.new(name)
    if mat.node_tree is None:
        mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*materials.linear(colour), 1.0)
    bsdf.inputs["Roughness"].default_value = 0.3
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*materials.linear(colour), 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission
    return mat


def setup(scene, geo):
    scene.render.engine = "BLENDER_EEVEE"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.eevee.taa_render_samples = 64
    world = bpy.data.worlds.get("studio") or bpy.data.worlds.new("studio")
    scene.world = world
    if world.node_tree is None:
        world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    background.inputs["Strength"].default_value = 0.55

    key = bpy.data.lights.new("key", "AREA")
    key.shape = "RECTANGLE"
    key.size, key.size_y = 3.0, 2.0
    key.energy = 650.0
    obj = bpy.data.objects.new("key", key)
    obj.location = (0.6, -0.4, 2.6)
    scene.collection.objects.link(obj)
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 1.6
    sun.data.angle = math.radians(12)
    sun.rotation_euler = (math.radians(30), math.radians(10), math.radians(60))
    scene.collection.objects.link(sun)

    floor_z = -geo["surfaceHeight"]
    floor = bpy.data.objects.new("floor", bpy.data.meshes.new("floor"))
    floor.data.from_pydata(
        [(-12, -12, floor_z), (12, -12, floor_z), (12, 12, floor_z), (-12, 12, floor_z)], [], [(0, 1, 2, 3)]
    )
    floor.data.materials.append(flat("floor", (0.97, 0.97, 0.97)))
    scene.collection.objects.link(floor)

    # The surface's markings, for the renders: the centre line across the width and the mark's ring.
    white = flat("marking", (0.97, 0.97, 1.0), 0.6)
    W = geo["W"]
    line = common.box("centre-line", (W, 0.012, 0.0004), location=(0.0, 0.0, 0.0002))
    line.data.materials.append(white)
    ring = bpy.data.objects.new("mark", bpy.data.meshes.new("mark"))
    verts, faces = [], []
    steps = 64
    for k in range(steps):
        a = 2 * math.pi * k / steps
        for r in (0.1, 0.112):
            verts.append((r * math.cos(a), r * math.sin(a), 0.0004))
    for k in range(steps):
        a, b = 2 * k, 2 * ((k + 1) % steps)
        faces.append((a, b, b + 1, a + 1))
    ring.data.from_pydata(verts, [], faces)
    ring.data.materials.append(white)
    scene.collection.objects.link(ring)

    # The lit surface and acrylic of the reference glow a little.
    for name, strength in (("surface", 0.1), ("rail-wall", 0.45)):
        bsdf = bpy.data.materials[name].node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Emission Color"].default_value = bsdf.inputs["Base Color"].default_value
        bsdf.inputs["Emission Strength"].default_value = strength

    camera = bpy.data.objects.new("preview-camera", bpy.data.cameras.new("preview-camera"))
    camera.data.clip_start = 0.01
    camera.data.clip_end = 40
    scene.collection.objects.link(camera)
    scene.camera = camera
    return camera


def look(camera, location, target, lens=50):
    camera.location = location
    direction = Vector(target) - Vector(location)
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "PERSP"
    camera.data.lens = lens


def render(scene, path, width=1600, height=900):
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 90
    scene.render.use_stamp = False
    for field in STAMP_FIELDS:
        setattr(scene.render, f"use_stamp_{field}", False)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("rendered", path)


def black_finish():
    bsdf = bpy.data.materials["cabinet"].node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*materials.linear((0.04, 0.04, 0.045)), 1.0)
    bsdf.inputs["Roughness"].default_value = 0.5


def main():
    scene = bpy.context.scene
    with open(os.path.join(common.ROOT, "blender", "table-geometry.json")) as f:
        geo = json.load(f)
    camera = setup(scene, geo)
    for name in ("mallet", "puck"):
        for obj in bpy.data.collections[name].objects:
            obj.hide_render = True
    out = os.path.join(common.ROOT, "blender", "renders")
    os.makedirs(out, exist_ok=True)

    look(camera, (2.9, -1.35, 1.05), (0.0, 0.05, -0.32), 42)
    render(scene, os.path.join(out, "three-quarter-silver.jpg"))

    black_finish()
    look(camera, (2.75, 0.0, 2.9), (0.0, 0.0, -0.25), 38)
    render(scene, os.path.join(out, "top-black.jpg"))
    look(camera, (2.6, -2.7, 1.6), (0.0, 0.0, -0.3), 40)
    render(scene, os.path.join(out, "three-quarter-black.jpg"))

    # A mallet and the puck on the surface, close.
    L = geo["L"]
    for name, (x, y) in (("mallet", (0.12, -L / 4)), ("puck", (-0.05, -L / 4 + 0.2))):
        for obj in bpy.data.collections[name].objects:
            obj.hide_render = False
            obj.location = (x, y, 0.0)
    look(camera, (0.55, -L / 4 - 0.55, 0.32), (0.03, -L / 4 + 0.08, 0.0), 50)
    render(scene, os.path.join(out, "mallet-puck.jpg"), 1200, 800)


main()
