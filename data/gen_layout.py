"""Generates data/layout.png from the obstacle rectangles specified in WAYPOINT_PRD.md §2.1.
Run once: python3 gen_layout.py
"""
from PIL import Image, ImageDraw

W, H = 900, 560
BG = (245, 245, 242)
OBSTACLE = (148, 150, 156)
OBSTACLE_EDGE = (108, 110, 116)

# Must match packages/shared/src/obstacles.ts exactly.
RECTS = [
    (150, 80, 340, 140),
    (150, 220, 340, 280),
    (150, 360, 340, 420),
    (500, 60, 565, 460),
    (650, 150, 850, 210),
    (650, 335, 850, 395),
]

img = Image.new("RGB", (W, H), BG)
draw = ImageDraw.Draw(img)

# faint grid for scale reference
for gx in range(0, W, 50):
    draw.line([(gx, 0), (gx, H)], fill=(235, 235, 232), width=1)
for gy in range(0, H, 50):
    draw.line([(0, gy), (W, gy)], fill=(235, 235, 232), width=1)

for (x0, y0, x1, y1) in RECTS:
    draw.rectangle([x0, y0, x1, y1], fill=OBSTACLE, outline=OBSTACLE_EDGE, width=2)

img.save("layout.png")
print("wrote layout.png", img.size)
