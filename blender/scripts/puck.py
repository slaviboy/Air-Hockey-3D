# Copyright (C) 2026 Stanislav Georgiev
# https://github.com/slaviboy
#
# This file is part of Air Hockey 3D.
#
# Air Hockey 3D is free software: you can redistribute it and/or modify it under the terms of the
# GNU General Public License as published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version. See the LICENSE file for the full terms.

"""Builds the puck: a thin disc of the simulation's radius with softened edges, resting on Z = 0
and centred on the axis, so the game places it at the puck's centre."""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common
from table import link


def build(collection_name="puck"):
    with open(os.path.join(common.ROOT, "blender", "table-geometry.json")) as f:
        spec = json.load(f)["puck"]
    R, T = spec["radius"], spec["thickness"]
    collection = common.ensure_collection(collection_name)
    e = 0.0008
    profile = [
        (0.0, 0.0), (R - e, 0.0), (R - e * 0.3, e * 0.3), (R, e), (R, T - e), (R - e * 0.3, T - e * 0.3),
        (R - e, T), (R * 0.62, T), (R * 0.6, T - 0.0004), (R * 0.42, T - 0.0004), (R * 0.4, T), (0.0, T),
    ]
    puck = common.lathe("puck", profile, steps=72)
    link(puck, collection, ["puck"])
    common.smooth_by_angle(puck, 40.0)
    print("puck", common.triangle_count(puck), "triangles", common.bounds(puck))
    return collection
