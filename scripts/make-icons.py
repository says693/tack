#!/usr/bin/env python3
"""tack 图标生成器（只用标准库，任何平台都能跑）。

    python scripts/make-icons.py

输出到 src-tauri/icons/：
  32x32.png  128x128.png  128x128@2x.png  icon.png  icon.ico
  nsis-header.bmp (150x57)  nsis-sidebar.bmp (164x314)

图形与 ui/icons/pin.svg 一致：纸面底、朱红钉头、深色杆与尖。
Windows 用户若想安装器上带文字，可改用 scripts/make-icons.ps1（System.Drawing）。
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src-tauri" / "icons"

PAPER = (243, 240, 232)
PIN = (181, 67, 42)
DEEP = (140, 51, 32)
INK = (30, 28, 25)
HILITE = (232, 210, 196)
HAIR = (196, 190, 173)

SS = 4  # 超采样倍数，用于抗锯齿


def _ellipse(x, y, cx, cy, rx, ry) -> bool:
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0


def _rect(x, y, x0, y0, x1, y1) -> bool:
    return x0 <= x <= x1 and y0 <= y <= y1


def _tri(x, y, p1, p2, p3) -> bool:
    def sign(a, b, c):
        return (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1])

    d1 = sign((x, y), p1, p2)
    d2 = sign((x, y), p2, p3)
    d3 = sign((x, y), p3, p1)
    neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
    pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (neg and pos)


def _pin_color(u, v):
    """u,v ∈ [0,1]；返回该点的颜色，或 None 表示透明。"""
    # 钉尖
    if _tri(u, v, (0.470, 0.822), (0.530, 0.822), (0.5, 0.905)):
        return INK
    # 钉杆
    if _rect(u, v, 0.470, 0.548, 0.530, 0.826):
        return DEEP
    # 颈部：窄梯形，从钉头底部收向杆
    if _tri(u, v, (0.378, 0.462), (0.622, 0.462), (0.530, 0.565)) or _tri(
        u, v, (0.378, 0.462), (0.530, 0.565), (0.470, 0.565)
    ):
        return DEEP
    # 钉头
    if _ellipse(u, v, 0.5, 0.302, 0.246, 0.176):
        if _ellipse(u, v, 0.418, 0.248, 0.072, 0.043):
            return HILITE
        return PIN
    return None


def render(size: int, scale: float = 1.0, center=(0.5, 0.5), bg=PAPER, vertical=(0.0, 0.0)):
    """返回 RGBA bytes。scale 缩放图案，center 为图案中心（单位坐标）。"""
    w = h = size
    hi = w * SS
    acc = [[[0, 0, 0, 0] for _ in range(w)] for _ in range(h)]
    for py in range(hi):
        v0 = py / hi
        for px in range(hi):
            u0 = px / hi
            # 反向映射到图案坐标
            u = (u0 - center[0]) / scale + 0.5 + vertical[0]
            v = (v0 - center[1]) / scale + 0.5 + vertical[1]
            c = _pin_color(u, v) if 0 <= u <= 1 and 0 <= v <= 1 else None
            if c is None:
                c = bg
                a = 255
            else:
                a = 255
            cell = acc[py // SS][px // SS]
            cell[0] += c[0]
            cell[1] += c[1]
            cell[2] += c[2]
            cell[3] += a
    n = SS * SS
    out = bytearray()
    for row in acc:
        for r, g, b, a in row:
            out += bytes((r // n, g // n, b // n, a // n))
    return bytes(out)


def _png(size: int, rgba: bytes) -> bytes:
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)
        raw += rgba[y * stride : (y + 1) * stride]

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def _bmp24(w: int, h: int, rgb_rows: list[list[tuple[int, int, int]]]) -> bytes:
    row_pad = (4 - (w * 3) % 4) % 4
    data = bytearray()
    for y in range(h - 1, -1, -1):
        for x in range(w):
            r, g, b = rgb_rows[y][x]
            data += bytes((b, g, r))
        data += b"\x00" * row_pad
    header = (
        b"BM"
        + struct.pack("<IHHI", 54 + len(data), 0, 0, 54)
        + struct.pack("<IiiHHIIiiII", 40, w, h, 1, 24, 0, len(data), 2835, 2835, 0, 0)
    )
    return header + bytes(data)


def _paint(bg, fn):
    w, h = len(fn(0, 0)) if False else None, None  # placeholder, filled below


def canvas(w: int, h: int, bg=PAPER):
    return [[bg for _ in range(w)] for _ in range(h)]


def paint_pin(img, cx, cy, height, scale=1.0):
    """把钉头图案画进 RGB 画布（不抗锯齿的小图也够用）。"""
    h = len(img)
    w = len(img[0])
    top = cy - height * 0.5
    size = height / 1.0
    # 图案坐标系映射：图案高 1.0 对应 height
    for y in range(max(0, int(top)), min(h, int(top + size))):
        for x in range(max(0, int(cx - size * 0.5)), min(w, int(cx + size * 0.5))):
            u = (x - (cx - size * 0.5)) / size
            v = (y - top) / size
            c = _pin_color(u, v)
            if c is not None:
                img[y][x] = c
    return img


def save_png(size: int, name: str, scale=1.0, center=(0.5, 0.5)) -> None:
    data = render(size, scale=scale, center=center)
    (OUT / name).write_bytes(_png(size, data))
    print(f"   wrote {name} ({size} px)")


# 位图字体：只画安装器上要用的 6 个字形，5x7 点阵，按需放大
GLYPHS = {
    "t": ["11111", "00100", "00100", "00100", "00100", "00100", "00011"],
    "a": ["01110", "10001", "11111", "10001", "10001", "10001", "01110"],
    "c": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    "k": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "i": ["00100", "00000", "01100", "00100", "00100", "00100", "01110"],
    "e": ["01110", "10001", "11111", "10000", "10000", "10001", "01110"],
}


def draw_text(img, text, x0, y0, px, color):
    cx = x0
    for ch in text:
        glyph = GLYPHS.get(ch)
        if not glyph:
            cx += 4 * px
            continue
        for gy, row in enumerate(glyph):
            for gx, bit in enumerate(row):
                if bit != "1":
                    continue
                for dy in range(px):
                    for dx in range(px):
                        x = cx + gx * px + dx
                        y = y0 + gy * px + dy
                        if 0 <= y < len(img) and 0 <= x < len(img[0]):
                            img[y][x] = color
        cx += 6 * px
    return cx


def draw_rule(img, y, x0, x1, color, thickness=2):
    for t in range(thickness):
        for x in range(x0, x1):
            if 0 <= y + t < len(img) and 0 <= x < len(img[0]):
                img[y + t][x] = color


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)

    # 主图标：图案略放大，四周留白
    save_png(32, "32x32.png", scale=1.18)
    save_png(128, "128x128.png", scale=1.18)
    save_png(256, "128x128@2x.png", scale=1.18)
    save_png(512, "icon.png", scale=1.18)

    # ICO：256 PNG 内嵌
    png256 = _png(256, render(256, scale=1.18))
    ico = (
        struct.pack("<HHH", 0, 1, 1)
        + bytes((0, 0, 0, 0))
        + struct.pack("<HHII", 1, 32, len(png256), 22)
        + png256
    )
    (OUT / "icon.ico").write_bytes(ico)
    print("   wrote icon.ico (256 px)")

    # NSIS 头图 150x57：左侧细线 + 小字 tack + 右侧钉头
    hw, hh = 150, 57
    hb = canvas(hw, hh)
    draw_rule(hb, 0, 16, 17, HAIR, thickness=hh)
    draw_text(hb, "tack", 26, 18, 2, INK)
    paint_pin(hb, 118, 28, 44)
    (OUT / "nsis-header.bmp").write_bytes(_bmp24(hw, hh, hb))
    print("   wrote nsis-header.bmp (150x57)")

    # NSIS 侧边图 164x314：大钉头 + 底部标题短句
    sw, sh = 164, 314
    sb = canvas(sw, sh)
    paint_pin(sb, 82, 132, 150)
    draw_rule(sb, 232, 44, 120, HAIR)
    draw_text(sb, "tack", 58, 244, 2, INK)
    draw_rule(sb, 268, 44, 120, HAIR, thickness=1)
    (OUT / "nsis-sidebar.bmp").write_bytes(_bmp24(sw, sh, sb))
    print("   wrote nsis-sidebar.bmp (164x314)")

    print("   done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
