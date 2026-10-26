# Copyright (C) 2026 Stanislav Georgiev
# https://github.com/slaviboy
#
# This file is part of Air Hockey 3D.
#
# Air Hockey 3D is free software: you can redistribute it and/or modify it under the terms of the
# GNU General Public License as published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version. See the LICENSE file for the full terms.

"""Shared helpers for the headless Blender scripts that build the table, the mallet and the puck.

Units: metres. The table frame of src/table/frame.ts, placed with its centre at the origin: Blender
(X, Y, Z) = (x - W/2, y - L/2, z), the playing surface at Z = 0; after glTF export (+Y up) this is
the scene frame.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
if HERE not in sys.path:
    sys.path.insert(0, HERE)


def save_blend(path):
    """Saves the .blend for publishing: without the folders the interface remembers.

    The file browsers kept in the workspaces remember a local folder (the home folder, with its
    user name), and the string buffers behind them still hold older paths after their end. Each
    is filled with spaces before it is cleared, so no stale bytes reach the saved file.
    """
    for screen in bpy.data.screens:
        for area in screen.areas:
            for space in area.spaces:
                if space.type != "FILE_BROWSER" or not space.params:
                    continue
                for field in ("directory", "filename", "filter_glob", "filter_search"):
                    if not hasattr(space.params, field):
                        continue
                    length = space.params.bl_rna.properties[field].length_max or 1024
                    blank = type(getattr(space.params, field))
                    filler = " " * (length - 1)
                    setattr(space.params, field, filler.encode() if blank is bytes else filler)
                    setattr(space.params, field, b"" if blank is bytes else "")
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)


def script_args():
    """Arguments given after `--` on the Blender command line."""
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def reset_scene():
    """An empty scene with metric units, independent of any startup file."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    return scene


def catmull_rom(points, samples=6):
    """Smooth a profile through its control points.

    `points` are (r, z, sharp) tuples. A sharp point is a corner: the curve passes through it with
    straight tangents on both sides. Returns a list of (r, z).
    """
    out = []
    n = len(points)
    for i in range(n - 1):
        p1 = Vector((points[i][0], points[i][1]))
        p2 = Vector((points[i + 1][0], points[i + 1][1]))
        sharp1 = points[i][2] if len(points[i]) > 2 else False
        sharp2 = points[i + 1][2] if len(points[i + 1]) > 2 else False
        p0 = Vector((points[i - 1][0], points[i - 1][1])) if i > 0 and not sharp1 else p1 * 2 - p2
        p3 = (
            Vector((points[i + 2][0], points[i + 2][1]))
            if i + 2 < n and not sharp2
            else p2 * 2 - p1
        )
        if sharp1 and sharp2:
            steps = 1
        else:
            # Roughly one sample per `0.12 / samples` units of curve, at least two per span.
            steps = max(2, min(samples * 2, int((p2 - p1).length * samples / 0.12) + 1))
        for s in range(steps):
            t = s / steps
            t2, t3 = t * t, t * t * t
            v = 0.5 * (
                (2 * p1)
                + (-p0 + p2) * t
                + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
            )
            out.append((max(0.0, v.x), v.y))
    out.append((points[-1][0], points[-1][1]))
    # Drop consecutive duplicates.
    clean = [out[0]]
    for p in out[1:]:
        if abs(p[0] - clean[-1][0]) > 1e-6 or abs(p[1] - clean[-1][1]) > 1e-6:
            clean.append(p)
    return clean


def lathe(name, profile, steps=64):
    """Spin a profile of (r, z) points around the Z axis into a closed mesh object.

    The profile must start and end on the axis (r = 0) so the solid is closed.
    """
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    verts = [bm.verts.new((r, 0.0, z)) for r, z in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(
        bm,
        geom=verts + edges,
        cent=(0, 0, 0),
        axis=(0, 0, 1),
        angle=2 * math.pi,
        steps=steps,
        use_merge=True,
        use_duplicate=False,
    )
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    # Faces collapsed onto the axis become degenerate; dissolve them.
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def box(name, size, location=(0, 0, 0), rotation=(0, 0, 0)):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    obj.rotation_euler = rotation
    bpy.context.scene.collection.objects.link(obj)
    return obj


def sphere(name, radius, location=(0, 0, 0), segments=24, rings=12):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    bpy.context.scene.collection.objects.link(obj)
    return obj


def cylinder(name, radius, depth, location=(0, 0, 0), rotation=(0, 0, 0), segments=24):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius, depth=depth
    )
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    obj.rotation_euler = rotation
    bpy.context.scene.collection.objects.link(obj)
    return obj


def select_only(obj):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def apply_modifiers(obj):
    select_only(obj)
    for mod in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def boolean(obj, cutter, operation="DIFFERENCE", solver="EXACT"):
    """Apply a boolean with `cutter` to `obj`, then delete the cutter."""
    mod = obj.modifiers.new("bool", "BOOLEAN")
    mod.operation = operation
    mod.solver = solver
    mod.object = cutter
    apply_modifiers(obj)
    remove(cutter)
    # The exact solver adds the cutter's (empty) material slot; parts get their materials afterwards.
    obj.data.materials.clear()
    for poly in obj.data.polygons:
        poly.material_index = 0


def remove(obj):
    mesh = obj.data if obj.type == "MESH" else None
    bpy.data.objects.remove(obj, do_unlink=True)
    if mesh is not None and mesh.users == 0:
        bpy.data.meshes.remove(mesh)


def join(target, others):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in others:
        o.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()
    return target


def apply_transforms(obj):
    select_only(obj)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def smooth_by_angle(obj, degrees=35.0):
    """Smooth shading with hard edges kept where faces meet at more than `degrees`."""
    select_only(obj)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(degrees), keep_sharp_edges=True)


def weld(obj, distance=1e-5):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=distance)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()


def ground(obj):
    """Move the mesh so its lowest point sits on z = 0, keeping it centred on the axis."""
    zs = [v.co.z for v in obj.data.vertices]
    low = min(zs)
    obj.data.transform(Matrix.Translation((0, 0, -low)))


def triangle_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def bounds(obj):
    xs = [v.co.x for v in obj.data.vertices]
    ys = [v.co.y for v in obj.data.vertices]
    zs = [v.co.z for v in obj.data.vertices]
    return {
        "min": [min(xs), min(ys), min(zs)],
        "max": [max(xs), max(ys), max(zs)],
    }


def is_manifold(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    ok = all(e.is_manifold for e in bm.edges)
    bm.free()
    return ok


def ensure_collection(name, parent=None):
    collection = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    parent = parent or bpy.context.scene.collection
    if collection.name not in parent.children:
        parent.children.link(collection)
    return collection


def move_to_collection(obj, collection):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    collection.objects.link(obj)
