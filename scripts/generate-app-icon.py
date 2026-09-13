# -*- coding: utf-8 -*-
"""Draw the 有秋 wheat-ear mark onto a light rounded plate for OS icons.

`npx tauri icon` writes PNG-compressed frames for every ICO size. Windows
Explorer shortcuts and NSIS installer chrome only decode PNG inside 256x256
entries, so smaller sizes fall back to opaque RGB and show a black square.
This script keeps those sizes as 32-bit BMP + AND mask.

Usage:
  python scripts/generate-app-icon.py             # redraw source + rewrite icon.ico
  npx tauri icon src-tauri/icons/app-icon-source.png   # regenerate all platform PNG/icns
  python scripts/generate-app-icon.py --ico-only  # after tauri icon, fix icon.ico frames
"""
from __future__ import annotations

import argparse
import io
import math
import struct
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src-tauri" / "icons" / "app-icon-source.png"
ICO = ROOT / "src-tauri" / "icons" / "icon.ico"
SIZE = 1024
SS = 4  # supersampling factor; PIL draws are aliased, so render large then downscale
PAD = 52
RADIUS = 226
FILL = "#F8FBFF"
FILL_RGB = (248, 251, 255)
STROKE = "#DCE8F7"
STROKE_W = 20
BLUE = "#2F6FED"
GOLD = "#F4B942"
GOLD_TOP = "#F7C65B"
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)


def rotated_ellipse(cx: float, cy: float, rx: float, ry: float, angle_deg: float, steps=96):
    """Points of an ellipse whose rx axis points along `angle_deg`
    (screen coords, y down, degrees clockwise from +x)."""
    a = math.radians(angle_deg)
    ux, uy = math.cos(a), math.sin(a)
    vx, vy = -uy, ux
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        ct, st = math.cos(t), math.sin(t)
        pts.append((cx + rx * ct * ux + ry * st * vx, cy + rx * ct * uy + ry * st * vy))
    return pts


def draw_wheat_ear(draw: ImageDraw.ImageDraw) -> None:
    """麦穗:金色穗粒 + 蓝色茎叶。坐标以 1024 画布为准,由调用方放大 SS 倍。"""
    s = SS
    # 左侧蓝叶(先画,垫在穗下)
    draw.polygon(rotated_ellipse(372 * s, 706 * s, 150 * s, 44 * s, 30), fill=BLUE)
    # 茎 + 圆头
    draw.line([(512 * s, 830 * s), (512 * s, 400 * s)], fill=BLUE, width=52 * s)
    r = 26 * s
    for x, y in ((512, 830), (512, 400)):
        draw.ellipse([x * s - r, y * s - r, x * s + r, y * s + r], fill=BLUE)
    # 穗粒:三对,自下而上渐小
    for cy, off, rx, ry in ((478, 122, 150, 74), (598, 112, 140, 70), (712, 100, 128, 64)):
        draw.polygon(rotated_ellipse((512 - off) * s, cy * s, rx * s, ry * s, 52), fill=GOLD)
        draw.polygon(rotated_ellipse((512 + off) * s, cy * s, rx * s, ry * s, -52), fill=GOLD)
    # 顶粒
    draw.ellipse(
        [(512 - 86) * s, (330 - 138) * s, (512 + 86) * s, (330 + 138) * s], fill=GOLD_TOP
    )


def compose() -> Image.Image:
    big = Image.new("RGBA", (SIZE * SS, SIZE * SS), (0, 0, 0, 0))
    draw = ImageDraw.Draw(big)
    pad, radius, stroke_w = PAD * SS, RADIUS * SS, STROKE_W * SS
    box = [pad, pad, SIZE * SS - pad, SIZE * SS - pad]
    draw.rounded_rectangle(box, radius=radius, fill=FILL)
    inner = [pad + 10 * SS, pad + 10 * SS, SIZE * SS - pad - 10 * SS, SIZE * SS - pad - 10 * SS]
    draw.rounded_rectangle(inner, radius=radius - 10 * SS, outline=STROKE, width=stroke_w)
    draw_wheat_ear(draw)
    return big.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def _png_bytes(im: Image.Image) -> bytes:
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def _bmp_icon_bytes(im: Image.Image) -> bytes:
    """32-bit ICO DIB: BGRA XOR bitmap plus 1-bit AND mask, both bottom-up."""
    w, h = im.size
    pixels = im.load()
    xor = bytearray()
    for y in range(h - 1, -1, -1):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            xor.extend((b, g, r, a))

    row_bytes = ((w + 31) // 32) * 4
    mask = bytearray()
    for y in range(h - 1, -1, -1):
        row = bytearray(row_bytes)
        for x in range(w):
            if pixels[x, y][3] == 0:
                row[x // 8] |= 0x80 >> (x % 8)
        mask.extend(row)

    header = struct.pack(
        "<IiiHHIIiiII",
        40,
        w,
        h * 2,
        1,
        32,
        0,
        len(xor) + len(mask),
        0,
        0,
        0,
        0,
    )
    return header + bytes(xor) + bytes(mask)


def bleed_transparent(im: Image.Image, rgb: tuple[int, int, int]) -> Image.Image:
    """Keep alpha, but stop downscales from blending plate edges into black RGB."""
    out = im.copy()
    pixels = out.load()
    r, g, b = rgb
    width, height = out.size
    for y in range(height):
        for x in range(width):
            if pixels[x, y][3] == 0:
                pixels[x, y] = (r, g, b, 0)
    return out


def write_windows_ico(source: Image.Image, dest: Path) -> None:
    frames: list[bytes] = []
    bled = bleed_transparent(source, FILL_RGB)
    for size in ICO_SIZES:
        frame = bled.resize((size, size), Image.Resampling.LANCZOS)
        if size == 256:
            frames.append(_png_bytes(frame))
        else:
            frames.append(_bmp_icon_bytes(frame))

    offset = 6 + 16 * len(frames)
    directory = bytearray()
    payload = bytearray()
    for size, data in zip(ICO_SIZES, frames):
        directory.extend(
            struct.pack(
                "<BBBBHHII",
                0 if size == 256 else size,
                0 if size == 256 else size,
                0,
                0,
                1,
                32,
                len(data),
                offset + len(payload),
            )
        )
        payload.extend(data)

    dest.write_bytes(b"\x00\x00\x01\x00" + struct.pack("<H", len(frames)) + directory + payload)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ico-only", action="store_true", help="rewrite icon.ico from the existing source PNG")
    args = parser.parse_args()

    if args.ico_only:
        canvas = Image.open(OUT).convert("RGBA")
    else:
        canvas = compose()
        canvas.save(OUT, "PNG")
        print(f"wrote {OUT} {OUT.stat().st_size} bytes mode={canvas.mode}")

    write_windows_ico(canvas, ICO)
    print(f"wrote {ICO} {ICO.stat().st_size} bytes")


if __name__ == "__main__":
    main()
