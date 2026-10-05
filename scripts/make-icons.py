"""Generate the placeholder extension icons (orange rounded square with a white card).

Pure standard library so it runs anywhere: python3 scripts/make-icons.py
"""

import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "static" / "icons"
ORANGE = (219, 125, 48, 255)
WHITE = (255, 255, 255, 255)
CLEAR = (0, 0, 0, 0)


def inside_rounded(x: float, y: float, x0: float, y0: float, x1: float, y1: float, r: float) -> bool:
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def pixel(x: float, y: float) -> tuple[int, int, int, int]:
    # Coordinates are in a 0..1 unit square.
    if inside_rounded(x, y, 0.33, 0.2, 0.67, 0.8, 0.05):
        return WHITE
    if inside_rounded(x, y, 0.0, 0.0, 1.0, 1.0, 0.22):
        return ORANGE
    return CLEAR


def png(size: int) -> bytes:
    rows = bytearray()
    for py in range(size):
        rows.append(0)
        for px in range(size):
            rows.extend(pixel((px + 0.5) / size, (py + 0.5) / size))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(rows), 9))
        + chunk(b"IEND", b"")
    )


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (48, 96, 128, 256, 512):
        (OUT / f"icon-{size}.png").write_bytes(png(size))
    for size in (16, 32):
        (OUT / f"toolbar-{size}.png").write_bytes(png(size))
    print(f"wrote icons to {OUT}")
