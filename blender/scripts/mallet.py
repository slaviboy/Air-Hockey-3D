# Copyright (C) 2026 Stanislav Georgiev
# https://github.com/slaviboy
#
# This file is part of Air Hockey 3D.
#
# Air Hockey 3D is free software: you can redistribute it and/or modify it under the terms of the
# GNU General Public License as published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version. See the LICENSE file for the full terms.

"""Builds the mallet: a high-top mallet turned from its profile, the size the simulation uses.

A wide base whose rim is what the puck bounces off (blender/table-geometry.json: mallet.radius),
a shallow dish rising into a waisted stem, and a knob for the hand; a felt disc underneath. Its
base rests on Z = 0, centred on the axis, so the game places it at the mallet's centre.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common
import materials
from table import link


def build(collection_name="mallet"):
    with open(os.path.join(common.ROOT, "blender", "table-geometry.json")) as f:
        spec = json.load(f)["mallet"]
    R, H, K = spec["radius"], spec["height"], spec["knobRadius"]
    collection = common.ensure_collection(collection_name)
    # (radius, height, sharp): the rim, the dish, the stem's waist, the knob and its crown.
    profile = common.catmull_rom([
        (0.0, 0.0015, True), (R, 0.0015, True), (R, 0.011, True), (R - 0.0015, 0.0145),
        (R - 0.008, 0.0175), (R * 0.62, 0.021), (R * 0.46, 0.027), (K * 0.82, 0.038),
        (K * 0.78, 0.046), (K * 0.96, 0.054), (K, 0.06), (K * 0.9, H - 0.006),
        (K * 0.55, H - 0.0012), (0.0, H, True),
    ], samples=10)
    body = common.lathe("mallet", profile, steps=64)
    link(body, collection, ["mallet"])
    common.smooth_by_angle(body, 50.0)
    felt = common.lathe("mallet-felt", [(0.0, 0.0), (R - 0.002, 0.0), (R - 0.002, 0.0016), (0.0, 0.0016)],
                        steps=64)
    link(felt, collection, ["mallet-felt"])
    common.smooth_by_angle(felt, 50.0)
    for obj in collection.objects:
        print(obj.name, common.triangle_count(obj), "triangles", common.bounds(obj))
    return collection
