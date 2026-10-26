# Copyright (C) 2026 Stanislav Georgiev
# https://github.com/slaviboy
#
# This file is part of Air Hockey 3D.
#
# Air Hockey 3D is free software: you can redistribute it and/or modify it under the terms of the
# GNU General Public License as published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version. See the LICENSE file for the full terms.

"""Builds blender/air-hockey.blend: the table, the mallet and the puck.

Run (or `npm run models`, which first writes the geometry file this reads):
    blender --background --factory-startup --python-exit-code 1 --python blender/scripts/build.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common
import mallet
import puck
import table


def main():
    common.reset_scene()
    path = os.path.join(common.ROOT, "blender", "air-hockey.blend")
    common.save_blend(path)
    table.build()
    mallet.build()
    puck.build()
    common.save_blend(path)
    print("saved", path)


main()
