# Copyright (C) 2026 Stanislav Georgiev
# https://github.com/slaviboy
#
# This file is part of Air Hockey 3D.
#
# Air Hockey 3D is free software: you can redistribute it and/or modify it under the terms of the
# GNU General Public License as published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version. See the LICENSE file for the full terms.

"""Exports the models of air-hockey.blend for the game:

    public/models/table.glb    the table, its parts as named nodes
    public/models/mallet.glb   a mallet, its base's centre at the origin
    public/models/puck.glb     the puck, its base's centre at the origin

+Y up (glTF), so the scene frame of src/table/frame.ts; plain materials named as in materials.py
(the game swaps them for its own); texture coordinates only on the surface and the score display.

Run: blender -b blender/air-hockey.blend --python-exit-code 1 -P blender/scripts/export_glb.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy

import common


def export(objects, path):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objects:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_normals=True,
        export_texcoords=True,
        export_tangents=False,
        export_vertex_color="NONE",
        export_draco_mesh_compression_enable=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        check_existing=False,
    )
    print("exported", path, os.path.getsize(path), "bytes")


def main():
    out = os.path.join(common.ROOT, "public", "models")
    os.makedirs(out, exist_ok=True)
    for name in ("table", "mallet", "puck"):
        export(list(bpy.data.collections[name].objects), os.path.join(out, f"{name}.glb"))


main()
