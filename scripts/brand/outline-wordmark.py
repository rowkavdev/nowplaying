#!/usr/bin/env python3
"""One-off: outline the nowplaying wordmark from Inter Bold (SIL OFL 1.1) so the
SVG masters render the same everywhere without the font installed.
Usage: outline-wordmark.py path/to/Inter-Bold.ttf  -> prints JSON {now, playing, width}"""
import json, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

font = TTFont(sys.argv[1])
cmap = font.getBestCmap(); gs = font.getGlyphSet(); upm = font["head"].unitsPerEm
SIZE = 100.0  # cap-height-ish scale: 1 em = 100 units
scale = SIZE / upm
TRACK = -2.0  # tight tracking, in output units

def outline(text, x0):
    pen = SVGPathPen(gs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
    x = x0
    for ch in text:
        g = cmap[ord(ch)]
        tp = TransformPen(pen, (scale, 0, 0, -scale, x, 0))
        gs[g].draw(tp)
        x += font["hmtx"][g][0] * scale + TRACK
    return pen.getCommands(), x

now, x1 = outline("now", 0)
playing, x2 = outline("playing", x1)
print(json.dumps({"now": now, "playing": playing, "width": round(x2 - TRACK, 2), "split": round(x1, 2)}))
