# Copyright (C) 2026 Stanislav Georgiev
# https://github.com/slaviboy
#
# This file is part of Air Hockey 3D.
#
# Air Hockey 3D is free software: you can redistribute it and/or modify it under the terms of the
# GNU General Public License as published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version. See the LICENSE file for the full terms.

"""Builds the air hockey table from blender/table-geometry.json (written from src/table/).

After the reference (docs/visual-research.md). The playing surface, the acrylic walls round it and
the linings of the goal slots follow the exact outline the simulation uses (the rails' faces), so
the puck bounces where the wall is drawn. Around them: the flat top rail with its screws, bridging
the slots; the cabinet, which flares out toward the top, its black end caps wrapping each corner
and narrowing toward the floor; the goal housings over each slot, running down the end face to the
puck return; the score unit on the left rail; the coin door and buttons on the right side; the
legs, splayed out, on chrome levelling feet.

Objects are named by part ("rail", "cabinet", ...), each at the origin with no transform.
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh
import bpy

import common
import materials

# The rail: its plate's thickness at the field, and how far its outer skirt hangs down.
PLATE = 0.014
SKIRT = 0.03
# The acrylic wall's thickness behind the rails' faces.
WALL = 0.006
# The cabinet: how far in from the rail's edge it starts under the rail and ends at its foot, and
# where its foot is (the surface at 0).
CABINET_TOP_INSET = 0.012
CABINET_BOTTOM_INSET = 0.1
CABINET_BOTTOM = -0.47
CABINET_RINGS = 16
# The rounding of the cabinet's corners, under the rail and at the foot.
CABINET_CORNER_TOP = 0.14
CABINET_CORNER_BOTTOM = 0.05
# The black end caps: how far they reach along the sides from each end, under the rail and at
# the foot. They narrow toward the floor in a curve, square to the rail at the top.
CAP_TOP = 0.26
CAP_BOTTOM = 0.07
# The goal housings and their chutes down the end faces.
HOUSING_WIDTH = 0.42
HOUSING_HEIGHT = 0.05
HOUSING_OUT = 0.075
CHUTE_WIDTH = 0.26
CHUTE_BOTTOM = -0.3
# The legs: where they meet the cabinet, from its foot's corners, and how far they splay out.
LEG_IN_X = 0.09
LEG_IN_Y = 0.17
LEG_SPLAY = 0.035
LEG_TOP_SIZE = (0.11, 0.135)
LEG_BOTTOM_SIZE = (0.075, 0.09)
FOOT = 0.035


def load():
    with open(os.path.join(common.ROOT, "blender", "table-geometry.json")) as f:
        return json.load(f)


def link(obj, collection, material_names):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    collection.objects.link(obj)
    obj.data.materials.clear()
    for name in material_names:
        obj.data.materials.append(materials.material(name))
    return obj


def mesh_object(name, verts, faces):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def recalc(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def loft_ring(name, sections):
    """A closed solid from closed cross-sections (each the same number of points, in order round
    it) taken in order round a loop (after Pool's table builder)."""
    n = len(sections[0])
    m = len(sections)
    verts = [p for section in sections for p in section]
    faces = []
    for i in range(m):
        i2 = (i + 1) % m
        for j in range(n):
            j2 = (j + 1) % n
            faces.append((i * n + j, i * n + j2, i2 * n + j2, i2 * n + j))
    return recalc(mesh_object(name, verts, faces))


def stacked_rings(name, rings):
    """A solid from rings of points stacked top to bottom, capped at both ends (after Pool's)."""
    n = len(rings[0])
    verts = [p for ring in rings for p in ring]
    faces = []
    for i in range(len(rings) - 1):
        for j in range(n):
            k = (j + 1) % n
            faces.append((i * n + j, i * n + k, (i + 1) * n + k, (i + 1) * n + j))
    for ring, base in ((rings[0], 0), (rings[-1], (len(rings) - 1) * n)):
        cx = sum(p[0] for p in ring) / n
        cy = sum(p[1] for p in ring) / n
        verts.append((cx, cy, ring[0][2]))
        centre = len(verts) - 1
        faces.extend((base + j, centre, base + (j + 1) % n) for j in range(n))
    return recalc(mesh_object(name, verts, faces))


def prism(name, polygon, z0, z1, centre):
    """A vertical prism over a polygon that every ray from `centre` crosses once (after Pool's)."""
    n = len(polygon)
    verts = [(x, y, z0) for x, y in polygon] + [(x, y, z1) for x, y in polygon]
    verts += [(centre[0], centre[1], z0), (centre[0], centre[1], z1)]
    faces = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    faces += [((i + 1) % n, i, 2 * n) for i in range(n)]
    faces += [(n + i, n + (i + 1) % n, 2 * n + 1) for i in range(n)]
    return recalc(mesh_object(name, verts, faces))


def bevelled_box(name, x0, y0, z0, x1, y1, z1, bevel=0.005):
    obj = common.box(name, (x1 - x0, y1 - y0, z1 - z0), location=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    common.apply_transforms(obj)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect="EDGES", profile=0.5)
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def outward_normals(points):
    """Each point of a counter-clockwise outline with the outward direction there, mitred at the
    corners so that an offset along it keeps its distance from both neighbouring sides."""
    n = len(points)
    out = []
    for i in range(n):
        px, py = points[i - 1]
        x, y = points[i]
        nx_, ny_ = points[(i + 1) % n]
        normals = []
        for ax, ay, bx, by in ((px, py, x, y), (x, y, nx_, ny_)):
            tx, ty = bx - ax, by - ay
            d = math.hypot(tx, ty)
            normals.append((ty / d, -tx / d))
        mx, my = normals[0][0] + normals[1][0], normals[0][1] + normals[1][1]
        m = math.hypot(mx, my)
        mx, my = mx / m, my / m
        scale = 1.0 / max(0.3, mx * normals[0][0] + my * normals[0][1])
        out.append((x, y, mx * scale, my * scale))
    return out


def rounded_rect(hx, hy, r, arc=10):
    """A rounded rectangle centred on the origin, counter-clockwise from (hx, -hy + r), each point
    with its outward unit normal."""
    points = []
    for cx, cy, start in ((hx - r, hy - r, 0.0), (-hx + r, hy - r, 90.0), (-hx + r, -hy + r, 180.0),
                          (hx - r, -hy + r, 270.0)):
        for k in range(arc + 1):
            a = math.radians(start + 90.0 * k / arc)
            ca, sa = math.cos(a), math.sin(a)
            points.append((cx + r * ca, cy + r * sa, ca, sa))
    return points


def build(collection_name="table"):
    geo = load()
    W, L = geo["W"], geo["L"]
    rw, top = geo["railWidth"], geo["railHeight"]
    floor = -geo["surfaceHeight"]
    collection = common.ensure_collection(collection_name)
    outline = [(x - W / 2, y - L / 2) for x, y in geo["outline"]]

    # The playing surface over the field and into the slots, with texture coordinates for the
    # game's markings: (x / W, y / L).
    surface = prism("surface", outline, -0.02, 0.0, (0.0, 0.0))
    uv = surface.data.uv_layers.new(name="uv")
    for loop in surface.data.loops:
        co = surface.data.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = ((co.x + W / 2) / W, (co.y + L / 2) / L)
    link(surface, collection, ["surface"])

    # The acrylic walls behind the rails' faces, up to the rail's plate; in the slots, past the
    # end rails' faces, the lining is dark.
    sections = []
    for x, y, nx, ny in outward_normals(outline):
        sections.append([
            (x, y, 0.0), (x, y, top - PLATE), (x + nx * WALL, y + ny * WALL, top - PLATE),
            (x + nx * WALL, y + ny * WALL, 0.0),
        ])
    walls = loft_ring("rail-wall", sections)
    link(walls, collection, ["rail-wall", "slot"])
    for poly in walls.data.polygons:
        c = poly.center
        poly.material_index = 1 if abs(c.y) > L / 2 + 1e-4 else 0

    # The top rail: the flat plate round the field, its inner edge on the rails' faces (bridging
    # the slots), a rounded outer edge and a skirt down to the cabinet.
    profile = [
        (0.0, top - SKIRT), (0.0, top - 0.004), (0.0012, top - 0.0012), (0.004, top),
        (rw - 0.003, top), (rw, top - 0.003), (rw, top - PLATE),
        (CABINET_TOP_INSET, top - PLATE), (CABINET_TOP_INSET, top - SKIRT),
    ]
    edge = rounded_rect(W / 2 + rw, L / 2 + rw, geo["outerCornerRadius"], 16)
    rail = loft_ring("rail", [[(x - o * nx, y - o * ny, z) for o, z in profile] for x, y, nx, ny in edge])
    link(rail, collection, ["rail-top"])
    common.smooth_by_angle(rail, 40.0)

    # Screws along the middle of the rail, clear of the housings and the score unit.
    screws = []
    mid = rw / 2
    spots = [(sx * (W / 2 + mid), y) for sx in (-1, 1) for y in (-1.1, -0.8, -0.48, -0.16, 0.16, 0.48, 0.8, 1.1)]
    spots += [(0.0 + W / 2 + mid, 0.0)]
    spots += [(x, sy * (L / 2 + mid)) for sy in (-1, 1) for x in (-0.47, -0.31, 0.31, 0.47)]
    for i, (x, y) in enumerate(spots):
        head = common.lathe(f"screw-{i}", [(0.0, 0.0), (0.0045, 0.0), (0.0042, 0.0007), (0.003, 0.0013),
                                            (0.0, 0.0016)], steps=16)
        head.location = (x, y, top - 0.0002)
        common.apply_transforms(head)
        screws.append(head)
    screw_set = common.join(screws[0], screws[1:])
    screw_set.name = "screws"
    link(screw_set, collection, ["screw"])

    # The cabinet: rings from under the rail to its foot, each a rounded rectangle, flaring out
    # toward the top. Every ring has a point exactly where the end caps meet the side panel, so
    # the black caps' curved edge is crisp.
    def ring(t):
        inset = CABINET_TOP_INSET + (CABINET_BOTTOM_INSET - CABINET_TOP_INSET) * t
        hx, hy = W / 2 + rw - inset, L / 2 + rw - inset
        r = CABINET_CORNER_TOP + (CABINET_CORNER_BOTTOM - CABINET_CORNER_TOP) * t
        cap = CAP_BOTTOM + (CAP_TOP - CAP_BOTTOM) * (1 - t * t)
        z = top - SKIRT + (CABINET_BOTTOM - (top - SKIRT)) * t
        return hx, hy, r, cap, z

    def ring_points(t, arc=10, middle=8, end=6):
        hx, hy, r, cap, z = ring(t)
        pts = []

        def side(x, y0, y1):
            ys = [y0, math.copysign(hy - cap, y0)]
            ys += [ys[1] + (math.copysign(hy - cap, y1) - ys[1]) * k / (middle + 1) for k in range(1, middle + 1)]
            ys += [math.copysign(hy - cap, y1), y1]
            pts.extend((x, y, z) for y in ys)

        def across(y, x0, x1):
            pts.extend((x0 + (x1 - x0) * k / (end + 1), y, z) for k in range(1, end + 1))

        def corner(cx, cy, start):
            for k in range(1, arc):
                a = math.radians(start + 90.0 * k / arc)
                pts.append((cx + r * math.cos(a), cy + r * math.sin(a), z))

        side(hx, -hy + r, hy - r)
        corner(hx - r, hy - r, 0.0)
        pts.append((hx - r, hy, z))
        across(hy, hx - r, -hx + r)
        pts.append((-hx + r, hy, z))
        corner(-hx + r, hy - r, 90.0)
        side(-hx, hy - r, -hy + r)
        corner(-hx + r, -hy + r, 180.0)
        pts.append((-hx + r, -hy, z))
        across(-hy, -hx + r, hx - r)
        pts.append((hx - r, -hy, z))
        corner(hx - r, -hy + r, 270.0)
        return pts

    rings = [ring_points(i / (CABINET_RINGS - 1)) for i in range(CABINET_RINGS)]
    cabinet = stacked_rings("cabinet", rings)
    link(cabinet, collection, ["cabinet", "cabinet-cap"])
    z_top, z_bottom = top - SKIRT, CABINET_BOTTOM
    for poly in cabinet.data.polygons:
        c = poly.center
        t = min(1.0, max(0.0, (z_top - c.z) / (z_top - z_bottom)))
        hx, hy, r, cap, z = ring(t)
        on_side = abs(abs(c.x) - hx) < 0.02 and abs(c.y) < hy - cap + 1e-5
        poly.material_index = 0 if on_side and abs(poly.normal.z) < 0.9 else 1
    common.smooth_by_angle(cabinet, 30.0)

    # The coin door and the start buttons on the right side, on the flared panel.
    hx_top, _, _, _, _ = ring(0.0)
    hx_bottom, _, _, _, _ = ring(1.0)
    slope = (hx_top - hx_bottom) / (z_top - z_bottom)

    def panel_x(z, out):
        return hx_bottom + slope * (z - z_bottom) + out

    # The door in its dark frame: two slabs on the panel, the frame a little larger and flatter.
    verts, faces = [], []
    for (y0, y1), (z0, z1), out in (((-0.465, -0.055), (-0.345, -0.105), 0.0012), ((-0.45, -0.07), (-0.33, -0.12), 0.0024)):
        base = len(verts)
        for o in (out, -0.004):
            for y, z in ((y0, z0), (y1, z0), (y1, z1), (y0, z1)):
                verts.append((panel_x(z, o), y, z))
        faces += [tuple(base + i for i in face) for face in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2),
                                                             (2, 6, 7, 3), (3, 7, 4, 0))]
    door = recalc(mesh_object("panel", verts, faces))
    link(door, collection, ["panel", "housing"])
    for i, poly in enumerate(door.data.polygons):
        poly.material_index = 1 if i < 6 else 0
    tilt = math.atan2(1.0, -slope)
    buttons = []
    for i, (y, z, r) in enumerate(((-0.78, -0.08, 0.014), (-0.78, -0.15, 0.016))):
        b = common.cylinder(f"button-{i}", r, 0.012, location=(panel_x(z, 0.002), y, z), rotation=(0.0, tilt, 0.0),
                            segments=28)
        common.apply_transforms(b)
        buttons.append(b)
    knobs = common.join(buttons[0], buttons[1:])
    knobs.name = "buttons"
    link(knobs, collection, ["button-red", "button-black"])
    for poly in knobs.data.polygons:
        poly.material_index = 0 if poly.center.z > -0.115 else 1

    # The goal housings: a box over each end rail's slot, out past the cabinet's end, and a chute
    # down the end face to the puck return, whose opening is dark.
    returns = []
    for seat, sy in ((0, -1), (1, 1)):
        y_in = sy * (L / 2 + 0.004)
        y_out = sy * (L / 2 + rw + HOUSING_OUT)
        box = bevelled_box(f"housing-{seat}", -HOUSING_WIDTH / 2, min(y_in, y_out), top - 0.004,
                           HOUSING_WIDTH / 2, max(y_in, y_out), top + HOUSING_HEIGHT, 0.006)
        y_chute_in = sy * (L / 2 + rw - CABINET_BOTTOM_INSET)
        chute = bevelled_box(f"chute-{seat}", -CHUTE_WIDTH / 2, min(y_chute_in, y_out), CHUTE_BOTTOM,
                             CHUTE_WIDTH / 2, max(y_chute_in, y_out), top - 0.002, 0.006)
        housing = common.join(box, [chute])
        housing.name = f"housing-{seat}"
        link(housing, collection, ["housing"])
        common.smooth_by_angle(housing, 40.0)
        y_face = y_out + sy * 0.0008
        opening = common.box(f"return-{seat}", (0.12, 0.004, 0.036),
                             location=(0.0, y_face - sy * 0.0015, CHUTE_BOTTOM + 0.07))
        common.apply_transforms(opening)
        returns.append(opening)
    hole = common.join(returns[0], returns[1:])
    hole.name = "returns"
    link(hole, collection, ["slot"])

    # The score unit on the left rail at the centre line, its display facing across the table:
    # texture coordinates run from seat 0's end (u = 0) to seat 1's, so seat 0's score is on the
    # left as the players see it.
    x_in = -(W / 2 + rw - 0.072)
    x_out = -(W / 2 + rw + 0.01)
    unit = bevelled_box("score-unit", x_out, -0.09, top - 0.002, x_in, 0.09, top + 0.072, 0.006)
    link(unit, collection, ["housing"])
    common.smooth_by_angle(unit, 40.0)
    dx = x_in + 0.0006
    display = mesh_object("score-display", [(dx, -0.068, top + 0.016), (dx, 0.068, top + 0.016),
                                            (dx, 0.068, top + 0.058), (dx, -0.068, top + 0.058)],
                          [(0, 1, 2, 3)])
    recalc(display)
    if display.data.polygons[0].normal.x < 0:
        display.data.polygons[0].flip()
    duv = display.data.uv_layers.new(name="uv")
    for loop in display.data.loops:
        co = display.data.vertices[loop.vertex_index].co
        duv.data[loop.index].uv = ((co.y + 0.068) / 0.136, (co.z - (top + 0.016)) / 0.042)
    link(display, collection, ["display"])

    # The legs: tapered, a little splayed out, from the cabinet's foot to the feet.
    hx_b, hy_b = hx_bottom, L / 2 + rw - CABINET_BOTTOM_INSET
    legs, feet = [], []
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx, cy = sx * (hx_b - LEG_IN_X), sy * (hy_b - LEG_IN_Y)
            low = floor + FOOT
            rings = []
            for k in range(5):
                t = k / 4
                w = LEG_TOP_SIZE[0] + (LEG_BOTTOM_SIZE[0] - LEG_TOP_SIZE[0]) * t
                h = LEG_TOP_SIZE[1] + (LEG_BOTTOM_SIZE[1] - LEG_TOP_SIZE[1]) * t
                z = CABINET_BOTTOM + 0.01 + (low - CABINET_BOTTOM - 0.01) * t
                ox, oy = cx + sx * LEG_SPLAY * t, cy + sy * LEG_SPLAY * t
                rr = min(w, h) * 0.22
                rings.append([(ox + x, oy + y, z) for x, y, _, _ in rounded_rect(w / 2, h / 2, rr, 4)])
            legs.append(stacked_rings(f"leg-{sx}-{sy}", rings))
            fx, fy = cx + sx * LEG_SPLAY, cy + sy * LEG_SPLAY
            foot = common.lathe(f"foot-{sx}-{sy}", [
                (0.0, floor), (0.05, floor), (0.052, floor + 0.004), (0.05, floor + 0.012),
                (0.016, floor + 0.015), (0.013, floor + 0.017), (0.013, low + 0.004), (0.0, low + 0.004),
            ], steps=32)
            foot.location = (fx, fy, 0.0)
            common.apply_transforms(foot)
            feet.append(foot)
    leg_set = common.join(legs[0], legs[1:])
    leg_set.name = "legs"
    link(leg_set, collection, ["leg"])
    common.smooth_by_angle(leg_set, 35.0)
    foot_set = common.join(feet[0], feet[1:])
    foot_set.name = "feet"
    link(foot_set, collection, ["chrome"])
    common.smooth_by_angle(foot_set, 35.0)

    for obj in collection.objects:
        if obj.type != "MESH":
            continue
        obj.data.name = obj.name
        assert all(abs(v) < 1e-9 for v in obj.location), obj.name
        print(obj.name, common.triangle_count(obj), "triangles")
    return collection
