#!/usr/bin/env python3
"""Deterministically register a rendered hero silhouette to a reference.

This is an evidence-preparation step, not a likeness score. It removes global
canvas-size, scale, and translation differences before Tier-1 IoU is measured.
The exact transform and pre/post IoU are written to JSON.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image


def foreground_mask(image: Image.Image) -> np.ndarray:
    rgba = np.asarray(image.convert("RGBA"), dtype=np.uint8)
    alpha = rgba[..., 3]
    if int(alpha.min()) < 240:
        return alpha > 16
    rgb = rgba[..., :3].astype(np.int16)
    corners = np.stack((rgb[0, 0], rgb[0, -1], rgb[-1, 0], rgb[-1, -1]))
    background = np.median(corners, axis=0)
    distance = np.sqrt(np.square(rgb - background).sum(axis=2))
    luminance = rgb.mean(axis=2)
    return (distance > 18) | (luminance < 238)


def bbox(mask: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.where(mask)
    if len(xs) == 0:
        raise ValueError("empty foreground mask")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def centroid(mask: np.ndarray) -> tuple[float, float]:
    ys, xs = np.where(mask)
    if len(xs) == 0:
        raise ValueError("empty foreground mask")
    return float(xs.mean()), float(ys.mean())


def iou(left: np.ndarray, right: np.ndarray) -> float:
    union = np.logical_or(left, right).sum()
    if union == 0:
        return 1.0
    return float(np.logical_and(left, right).sum() / union)


def paste_mask(mask: np.ndarray, size: tuple[int, int], x: int, y: int) -> np.ndarray:
    canvas = np.zeros((size[1], size[0]), dtype=bool)
    source_y0 = max(0, -y)
    source_x0 = max(0, -x)
    target_y0 = max(0, y)
    target_x0 = max(0, x)
    height = min(mask.shape[0] - source_y0, size[1] - target_y0)
    width = min(mask.shape[1] - source_x0, size[0] - target_x0)
    if width > 0 and height > 0:
        canvas[target_y0 : target_y0 + height, target_x0 : target_x0 + width] = (
            mask[source_y0 : source_y0 + height, source_x0 : source_x0 + width]
        )
    return canvas


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", required=True)
    parser.add_argument("--render", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--evidence", required=True)
    parser.add_argument("--size", type=int, default=660)
    parser.add_argument("--translation-search", type=int, default=14)
    args = parser.parse_args()

    target_size = (args.size, args.size)
    reference_source = Image.open(args.reference).convert("RGBA")
    reference = reference_source.resize(target_size, Image.Resampling.LANCZOS)
    render = Image.open(args.render).convert("RGBA")
    reference_mask = foreground_mask(reference)
    render_mask = foreground_mask(render)

    render_area = int(render_mask.sum())
    reference_area = int(reference_mask.sum())
    reference_bbox = bbox(reference_mask)
    render_bbox = bbox(render_mask)
    reference_bbox_area = (
        (reference_bbox[2] - reference_bbox[0])
        * (reference_bbox[3] - reference_bbox[1])
    )
    render_bbox_area = (
        (render_bbox[2] - render_bbox[0])
        * (render_bbox[3] - render_bbox[1])
    )
    scale = math.sqrt(reference_bbox_area / render_bbox_area)
    scaled_size = (
        max(1, round(render.width * scale)),
        max(1, round(render.height * scale)),
    )
    scaled_render = render.resize(scaled_size, Image.Resampling.LANCZOS)
    scaled_mask = foreground_mask(scaled_render)
    reference_centroid = centroid(reference_mask)
    scaled_centroid = centroid(scaled_mask)
    base_x = round(reference_centroid[0] - scaled_centroid[0])
    base_y = round(reference_centroid[1] - scaled_centroid[1])

    best = (-1.0, base_x, base_y, None)
    for dy in range(-args.translation_search, args.translation_search + 1):
        for dx in range(-args.translation_search, args.translation_search + 1):
            candidate = paste_mask(scaled_mask, target_size, base_x + dx, base_y + dy)
            score = iou(reference_mask, candidate)
            if score > best[0]:
                best = (score, base_x + dx, base_y + dy, candidate)

    best_iou, paste_x, paste_y, aligned_mask = best
    aligned = Image.new("RGBA", target_size, (255, 255, 255, 255))
    aligned.alpha_composite(scaled_render, (paste_x, paste_y))
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    aligned.convert("RGB").save(out_path)

    original_reference = reference_mask
    render_on_target = Image.new("RGBA", target_size, (255, 255, 255, 255))
    raw_x = (target_size[0] - render.width) // 2
    raw_y = (target_size[1] - render.height) // 2
    render_on_target.alpha_composite(render, (raw_x, raw_y))
    pre_mask = foreground_mask(render_on_target)

    transform = {
        "version": "1.0.0",
        "method": "area-scale plus centroid registration and bounded translation search",
        "reference": str(Path(args.reference).as_posix()),
        "render": str(Path(args.render).as_posix()),
        "alignedRender": str(out_path.as_posix()),
        "canvas": {"width": target_size[0], "height": target_size[1]},
        "referenceSourceSize": {
            "width": reference_source.width,
            "height": reference_source.height,
        },
        "renderSourceSize": {"width": render.width, "height": render.height},
        "transform": {
            "scale": round(scale, 8),
            "translateX": paste_x,
            "translateY": paste_y,
            "coordinate": "scaled render top-left on target canvas",
        },
        "mask": {
            "referenceArea": reference_area,
            "renderAreaBeforeScale": render_area,
            "alignedArea": int(aligned_mask.sum()),
            "referenceBoundingBox": list(reference_bbox),
            "renderBoundingBoxBeforeScale": list(render_bbox),
            "preAlignmentIoU": round(iou(original_reference, pre_mask), 6),
            "postAlignmentIoU": round(best_iou, 6),
        },
    }
    evidence_path = Path(args.evidence)
    evidence_path.parent.mkdir(parents=True, exist_ok=True)
    evidence_path.write_text(json.dumps(transform, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(transform, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
