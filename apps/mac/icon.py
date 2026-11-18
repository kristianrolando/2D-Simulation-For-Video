#!/usr/bin/env python3
"""Draw the Sim Studio app icon (1024x1024 PNG) with the Python standard library only: no Pillow, no downloads.
Look = the studio's default style: deep navy square, a glowing cyan octagon (the Hammer smash container), a gold ball
and two small ones inside. Anti-aliased with signed distance fields.
Usage: python3 icon.py <out.png>"""
import math, struct, sys, zlib

S = 1024
PAD, RAD = 100, 185                         # macOS icon grid: the artwork sits inside ~824 px
CX = CY = S / 2
NAVY_TOP, NAVY_BOT = (10, 16, 64), (1, 3, 18)
CYAN, GLOW, GOLD = (156, 243, 255), (63, 201, 255), (255, 210, 63)
BALLS = [(CX + 10, CY + 4, 74, GOLD), (CX - 128, CY - 96, 30, (255, 122, 192)), (CX + 120, CY + 126, 26, (139, 224, 122))]

def octagon(R=262):
    return [(CX + R * math.cos(math.pi / 8 + k * math.pi / 4), CY + R * math.sin(math.pi / 8 + k * math.pi / 4)) for k in range(8)]
OCT = octagon()

def seg_dist(px, py, ax, ay, bx, by):
    ex, ey = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey)))
    return math.hypot(px - (ax + t * ex), py - (ay + t * ey))

def cover(d):                               # signed distance (px, negative inside) -> coverage 0..1
    return max(0.0, min(1.0, 0.5 - d))

def over(dst, src, a):                      # src colour with alpha a over dst (r, g, b, a) in 0..1
    ra = a + dst[3] * (1 - a)
    if ra <= 0: return (0, 0, 0, 0)
    return tuple((src[i] * a + dst[i] * dst[3] * (1 - a)) / ra for i in range(3)) + (ra,)

def pixel(x, y):
    px, py = x + 0.5, y + 0.5
    # rounded square
    qx, qy = abs(px - CX) - (S / 2 - PAD - RAD), abs(py - CY) - (S / 2 - PAD - RAD)
    d = math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - RAD
    a = cover(d)
    if a <= 0: return (0, 0, 0, 0)
    u = (py - PAD) / (S - 2 * PAD)
    c = (*(tuple((NAVY_TOP[i] + (NAVY_BOT[i] - NAVY_TOP[i]) * u) / 255 for i in range(3))), a)
    # octagon: glow, then core line
    dist = min(seg_dist(px, py, *OCT[k], *OCT[(k + 1) % 8]) for k in range(8))
    g = math.exp(-dist / 26) * 0.55
    c = over(c, tuple(v / 255 for v in GLOW), g * a)
    c = over(c, tuple(v / 255 for v in CYAN), cover(dist - 11) * a)
    c = over(c, (1, 1, 1), cover(dist - 4) * 0.8 * a)
    # balls: halo, body, highlight
    for bx, by, r, col in BALLS:
        dd = math.hypot(px - bx, py - by)
        if dd < r * 3.2:
            c = over(c, tuple(v / 255 for v in col), math.exp(-max(0, dd - r) / (r * 0.9)) * 0.35 * a)
        if dd < r + 2:
            shade = 0.72 + 0.28 * max(0.0, 1 - math.hypot(px - (bx - r * 0.3), py - (by - r * 0.3)) / (r * 1.4))
            c = over(c, tuple(min(1.0, v / 255 * shade + (0.35 * shade if shade > 0.97 else 0)) for v in col), cover(dd - r) * a)
    return c

def png(path, w, h, rows):
    raw = b"".join(b"\x00" + bytes(r) for r in rows)
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))

if __name__ == "__main__":
    if len(sys.argv) != 2: sys.exit("usage: icon.py <out.png>")
    rows = []
    for y in range(S):
        row = bytearray()
        for x in range(S):
            r, g, b, a = pixel(x, y)
            row += bytes((round(r * 255), round(g * 255), round(b * 255), round(a * 255)))
        rows.append(row)
    png(sys.argv[1], S, S, rows)
