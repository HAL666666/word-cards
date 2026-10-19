#!/usr/bin/env python3
"""アイコン生成（Pillow）。python3 tools/gen-icons.py"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"

def make(size, maskable=False):
    S = 1024
    img = Image.new("RGBA", (S, S), "#FFB703")
    d = ImageDraw.Draw(img)
    # sun-ish background circle
    d.ellipse([90, 90, 934, 934], fill="#FFC93C")
    sc = 0.78 if maskable else 1.0
    def box(x0, y0, x1, y1):
        c = S / 2
        return [c + (x0 - c) * sc, c + (y0 - c) * sc, c + (x1 - c) * sc, c + (y1 - c) * sc]
    # back card (tilted)
    back = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(back)
    bd.rounded_rectangle(box(330, 190, 830, 790), radius=int(70 * sc), fill="#2A9D8F")
    back = back.rotate(-12, center=(S / 2, S / 2), resample=Image.BICUBIC)
    img.alpha_composite(back)
    # front card
    front = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    fd = ImageDraw.Draw(front)
    fd.rounded_rectangle(box(200, 250, 700, 850), radius=int(70 * sc), fill="white", outline="#E76F51", width=int(18 * sc))
    f1 = ImageFont.truetype(FONT, int(300 * sc), index=0)
    f2 = ImageFont.truetype(FONT, int(190 * sc), index=0)
    cx = S / 2 + (450 - S / 2) * sc
    fd.text((cx, S / 2 + (450 - S / 2) * sc), "A", font=f1, fill="#E63946", anchor="mm")
    fd.text((cx, S / 2 + (700 - S / 2) * sc), "あ", font=f2, fill="#1D7FD8", anchor="mm")
    front = front.rotate(6, center=(S / 2, S / 2), resample=Image.BICUBIC)
    img.alpha_composite(front)
    # heart sticker
    hx, hy, r = S / 2 + (760 - S / 2) * sc, S / 2 + (780 - S / 2) * sc, 70 * sc
    d2 = ImageDraw.Draw(img)
    d2.ellipse([hx - r, hy - r, hx + r, hy + r], fill="#FF5C8A", outline="white", width=int(12 * sc))
    fh = ImageFont.truetype(FONT, int(90 * sc), index=0)
    d2.text((hx, hy + 4 * sc), "♪", font=fh, fill="white", anchor="mm")
    return img.convert("RGB").resize((size, size), Image.LANCZOS)

(ROOT / "icons").mkdir(exist_ok=True)
make(192).save(ROOT / "icons/icon-192.png")
make(512).save(ROOT / "icons/icon-512.png")
make(512, True).save(ROOT / "icons/icon-maskable-512.png")
make(180).save(ROOT / "icons/apple-touch-icon.png")
print("icons ok")
