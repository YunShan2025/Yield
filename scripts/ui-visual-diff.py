#!/usr/bin/env python3
"""视觉回归比对：两张 PNG 的差异像素占比 + 差异热区。
用法: python scripts/ui-visual-diff.py <beforeDir> <afterDir> [outDir]
"""
import sys, os
from PIL import Image
import numpy as np

before_dir, after_dir = sys.argv[1], sys.argv[2]
out_dir = sys.argv[3] if len(sys.argv) > 3 else None
if out_dir:
    os.makedirs(out_dir, exist_ok=True)

TOL = 8  # 单通道色差容差
names = sorted(f for f in os.listdir(before_dir) if f.endswith(".png"))
worst = 0.0
print(f"{'shot':<22}{'diff px':>12}{'ratio':>10}   verdict")
print("-" * 62)
for n in names:
    a_path = os.path.join(before_dir, n)
    b_path = os.path.join(after_dir, n)
    if not os.path.exists(b_path):
        print(f"{n:<22}{'—':>12}{'—':>10}   MISSING in after")
        continue
    a = np.asarray(Image.open(a_path).convert("RGB"), dtype=np.int16)
    b = np.asarray(Image.open(b_path).convert("RGB"), dtype=np.int16)
    if a.shape != b.shape:
        print(f"{n:<22}{'—':>12}{'—':>10}   SIZE CHANGED {a.shape} -> {b.shape}")
        continue
    d = np.abs(a - b).max(axis=2)
    mask = d > TOL
    cnt = int(mask.sum())
    ratio = cnt / mask.size
    worst = max(worst, ratio)
    verdict = "identical" if cnt == 0 else ("minor" if ratio < 0.002 else "REVIEW")
    print(f"{n:<22}{cnt:>12}{ratio * 100:>9.3f}%   {verdict}")
    if out_dir and cnt:
        heat = np.zeros(a.shape[:2] + (3,), dtype=np.uint8)
        heat[..., 0] = np.where(mask, 255, 0)
        heat[..., 1] = np.where(mask, (255 - d.clip(0, 255)).astype(np.uint8) // 3, 0)
        heat[..., 2] = np.where(mask, 40, 0)
        Image.fromarray(heat).save(os.path.join(out_dir, f"diff-{n}"))
print("-" * 62)
print(f"worst ratio: {worst * 100:.3f}%")
