# Copyright (C) 2026 Stanislav Georgiev
# https://github.com/slaviboy
#
# This file is part of Air Hockey 3D.
#
# Air Hockey 3D is free software: you can redistribute it and/or modify it under the terms of the
# GNU General Public License as published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version. See the LICENSE file for the full terms.

"""The materials of the table, the mallet and the puck.

Each is a plain Principled BSDF (colour, roughness, metal, clear coat), which glTF carries as it
is; the game swaps them by name for its own (the playing surface's markings and air holes, the
lit acrylic, the cabinet's speckled finish and the black finish, each seat's mallet colour). Colours
are given in sRGB, as picked from the reference photographs, and converted to Blender's linear
values here.
"""

import bpy

# name: (sRGB colour, roughness, metallic, clear coat)
SPECS = {
    "surface": ((0.09, 0.33, 0.9), 0.2, 0.0, 0.6),
    "rail-top": ((0.83, 0.84, 0.85), 0.42, 0.25, 0.0),
    "rail-wall": ((0.30, 0.50, 0.98), 0.1, 0.0, 0.5),
    "slot": ((0.012, 0.012, 0.014), 0.9, 0.0, 0.0),
    "cabinet": ((0.80, 0.80, 0.80), 0.72, 0.12, 0.0),
    "cabinet-cap": ((0.035, 0.035, 0.038), 0.5, 0.1, 0.05),
    "panel": ((0.70, 0.70, 0.71), 0.62, 0.12, 0.0),
    "housing": ((0.04, 0.04, 0.045), 0.42, 0.0, 0.2),
    "leg": ((0.03, 0.03, 0.033), 0.5, 0.1, 0.1),
    "chrome": ((0.86, 0.87, 0.89), 0.16, 1.0, 0.0),
    "screw": ((0.55, 0.56, 0.58), 0.35, 1.0, 0.0),
    "button-red": ((0.86, 0.06, 0.06), 0.25, 0.0, 0.6),
    "button-black": ((0.03, 0.03, 0.03), 0.3, 0.0, 0.5),
    "display": ((0.03, 0.005, 0.005), 0.3, 0.0, 0.8),
    "mallet": ((0.80, 0.05, 0.06), 0.3, 0.0, 0.7),
    "mallet-felt": ((0.12, 0.12, 0.12), 0.95, 0.0, 0.0),
    "puck": ((0.98, 0.78, 0.10), 0.3, 0.0, 0.5),
}


def linear(c):
    """sRGB (0-1) to linear."""
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


def material(name):
    """The named material, created once."""
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    colour, roughness, metallic, coat = SPECS[name]
    mat = bpy.data.materials.new(name)
    if mat.node_tree is None:
        mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*linear(colour), 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Coat Weight"].default_value = coat
    bsdf.inputs["Coat Roughness"].default_value = 0.08
    mat.diffuse_color = (*linear(colour), 1.0)
    return mat
