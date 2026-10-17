#!/usr/bin/env python3
"""Tile every step screenshot (mixed sizes, e.g. 1920x1080 TV + 430x932 phone) into one PNG.
usage: contact_sheet.py <shots_dir> <out.png> [cols]"""
import glob, os, sys
from PIL import Image
shots = sorted(glob.glob(os.path.join(sys.argv[1], '*.png')))
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 4
W, H, P = 480, 270, 6
rows = (len(shots) + cols - 1) // cols
sheet = Image.new('RGB', (cols * W + (cols + 1) * P, rows * H + (rows + 1) * P), (11, 15, 26))
for i, f in enumerate(shots):
    im = Image.open(f).convert('RGB'); im.thumbnail((W, H))
    x = P + (i % cols) * (W + P) + (W - im.width) // 2
    y = P + (i // cols) * (H + P) + (H - im.height) // 2
    sheet.paste(im, (x, y))
sheet.save(sys.argv[2]); print('contact sheet', sheet.size, len(shots), 'shots')
