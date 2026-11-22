"""favicon.svg と同じ図形から、favicon.ico と apple-touch-icon.png を作る。

使い方（リポジトリの直下で）: python tools/make_favicons.py
Pillow が要る。図形を変えたときは、favicon.svg とこのファイルの SHAPES の両方を直す。
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SCALE = 16  # 拡大して描いてから縮め、輪郭をなめらかにする

BG = '#1a1f2b'
STAR = '#7aa7ff'
DOT = '#ffd166'

# favicon.svg と同じ、32×32 の座標
STAR_LINES = [((20, 6.5), (20, 19.5)), ((25.63, 9.75), (14.37, 16.25)), ((25.63, 16.25), (14.37, 9.75))]
STAR_WIDTH = 2.8
DOT_CENTER = (8.5, 23.5)
DOT_RADIUS = 3


def draw(size, rounded=True, padding=0.0):
    """size ピクセルの画像を描く。padding は図柄を縮める割合（apple-touch-icon で余白を取るため）。"""
    big = size * SCALE
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    unit = big / 32
    if rounded:
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=7 * unit, fill=BG)
    else:
        d.rectangle([0, 0, big - 1, big - 1], fill=BG)

    # 図柄を中心に向かって縮める
    k = 1 - padding

    def pt(x, y):
        return ((16 + (x - 16) * k) * unit, (16 + (y - 16) * k) * unit)

    w = STAR_WIDTH * k * unit
    for a, b in STAR_LINES:
        pa, pb = pt(*a), pt(*b)
        d.line([pa, pb], fill=STAR, width=round(w))
        for p in (pa, pb):  # 線の端を丸くする
            d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=STAR)
    c = pt(*DOT_CENTER)
    r = DOT_RADIUS * k * unit
    d.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], fill=DOT)
    return img.resize((size, size), Image.LANCZOS)


def main():
    icons = [draw(s) for s in (16, 32, 48)]
    icons[2].save(ROOT / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)], append_images=icons[:2])
    # iOS は角を自分で丸めるので、角は丸めずに地を全体に塗る
    draw(180, rounded=False, padding=0.12).convert('RGB').save(ROOT / 'apple-touch-icon.png')
    print('wrote favicon.ico, apple-touch-icon.png')


if __name__ == '__main__':
    main()
