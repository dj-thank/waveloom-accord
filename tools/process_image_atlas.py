#!/usr/bin/env python3
"""Create deterministic runtime WebP atlases and individually addressable frames."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path

from PIL import Image, ImageDraw


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def relative_posix(path: Path, root: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def save_webp(image: Image.Image, destination: Path, *, lossless: bool) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.{os.getpid()}.partial")
    image.save(
        temporary,
        "WEBP",
        lossless=lossless,
        quality=100 if lossless else 92,
        method=4,
        exact=True,
    )
    temporary.replace(destination)


def save_png(image: Image.Image, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.{os.getpid()}.partial")
    image.save(temporary, "PNG", compress_level=6, optimize=False)
    temporary.replace(destination)


def build_cache_key(source: Path, rows: int, cols: int, runtime_size: int) -> str:
    payload = {
        "sourceSha256": sha256(source),
        "processorSha256": sha256(Path(__file__).resolve()),
        "rows": rows,
        "cols": cols,
        "runtimeSize": runtime_size,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


def cached_result(cache_path: Path, cache_key: str, root: Path) -> dict | None:
    if not cache_path.is_file():
        return None
    try:
        cached = json.loads(cache_path.read_text(encoding="utf-8"))
        result = cached["result"]
        if cached.get("cacheKey") != cache_key:
            return None
        assets = [{
            "path": result["runtimePath"],
            "sha256": result["runtimeSha256"],
            "bytes": result["runtimeBytes"],
        }, *result["frames"]]
        for asset in assets:
            path = (root / asset["path"]).resolve()
            path.relative_to(root)
            if not path.is_file() or path.stat().st_size != asset["bytes"] or sha256(path) != asset["sha256"]:
                return None
        return result
    except (KeyError, OSError, ValueError, json.JSONDecodeError):
        return None


def write_cache(cache_path: Path, cache_key: str, result: dict) -> None:
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = cache_path.with_name(f".{cache_path.name}.{os.getpid()}.partial")
    temporary.write_text(
        json.dumps({"cacheKey": cache_key, "result": result}, ensure_ascii=False, sort_keys=True),
        encoding="utf-8",
    )
    temporary.replace(cache_path)


def clear_grid_gutters(image: Image.Image, rows: int, cols: int) -> Image.Image:
    """Remove prompt-requested separator gutters from the admitted runtime atlas.

    Image generators sometimes render the gutters white, black, or a darker green
    than the cell background. Chroma-keying the cell background alone would leave
    those separator pixels visible in-game. The subjects are requested with ample
    padding, so a narrow deterministic band at every grid edge is safe to clear.
    """

    cleaned = image.copy()
    alpha = cleaned.getchannel("A")
    draw = ImageDraw.Draw(alpha)
    width, height = cleaned.size
    cell_width = width / cols
    cell_height = height / rows
    half_band = max(2, round(min(cell_width, cell_height) * 0.02))

    draw.rectangle((0, 0, width - 1, half_band), fill=0)
    draw.rectangle((0, height - 1 - half_band, width - 1, height - 1), fill=0)
    draw.rectangle((0, 0, half_band, height - 1), fill=0)
    draw.rectangle((width - 1 - half_band, 0, width - 1, height - 1), fill=0)
    for col in range(1, cols):
        center = round(col * width / cols)
        draw.rectangle((center - half_band, 0, center + half_band, height - 1), fill=0)
    for row in range(1, rows):
        center = round(row * height / rows)
        draw.rectangle((0, center - half_band, width - 1, center + half_band), fill=0)

    cleaned.putalpha(alpha)
    return cleaned


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--asset-id", required=True)
    parser.add_argument("--rows", required=True, type=int)
    parser.add_argument("--cols", required=True, type=int)
    parser.add_argument("--runtime-dir", required=True, type=Path)
    parser.add_argument("--frames-dir", required=True, type=Path)
    parser.add_argument("--runtime-size", type=int, default=1024)
    args = parser.parse_args()

    if args.rows <= 0 or args.cols <= 0:
        raise SystemExit("rows and cols must be positive")
    if args.runtime_size < 256 or args.runtime_size > 2048:
        raise SystemExit("runtime-size must be between 256 and 2048")

    root = args.root.resolve()
    source = args.input.resolve()
    if not source.is_file():
        raise SystemExit(f"input not found: {source}")
    runtime_directory = args.runtime_dir.resolve()
    frames_directory = args.frames_dir.resolve()
    try:
        runtime_directory.relative_to(root)
        frames_directory.relative_to(root)
    except ValueError as error:
        raise SystemExit("runtime and frame outputs must stay within root") from error

    cache_path = frames_directory / ".atlas-cache.json"
    cache_key = build_cache_key(source, args.rows, args.cols, args.runtime_size)
    cached = cached_result(cache_path, cache_key, root)
    if cached:
        print(json.dumps(cached, ensure_ascii=False))
        return

    with Image.open(source) as opened:
        image = opened.convert("RGBA")

    image = clear_grid_gutters(image, args.rows, args.cols)

    width, height = image.size
    alpha = image.getchannel("A")
    histogram = alpha.histogram()
    transparent = sum(histogram[:9])
    partial = sum(histogram[9:247])
    opaque = sum(histogram[247:])
    total = max(1, width * height)
    corners = [alpha.getpixel(point) for point in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1))]
    if any(value > 16 for value in corners):
        raise SystemExit(f"alpha corners are not transparent: {corners}")
    if opaque / total < 0.01:
        raise SystemExit(f"opaque subject coverage too small: {opaque / total:.6f}")
    if transparent / total < 0.2:
        raise SystemExit(f"transparent coverage too small: {transparent / total:.6f}")

    normalized = image.resize((args.runtime_size, args.runtime_size), Image.Resampling.LANCZOS)
    staging = runtime_directory / f"{args.asset_id}-runtime.webp"
    save_webp(normalized, staging, lossless=False)
    runtime_hash = sha256(staging)
    runtime = staging.with_name(f"{args.asset_id}.{runtime_hash[:12]}.webp")
    if runtime.exists():
        if sha256(runtime) != runtime_hash:
            raise SystemExit(f"hash collision at {runtime}")
        staging.unlink()
    else:
        staging.replace(runtime)

    frame_size = args.runtime_size // max(args.rows, args.cols)
    frames = []
    frames_directory.mkdir(parents=True, exist_ok=True)
    for row in range(args.rows):
        y0 = round(row * height / args.rows)
        y1 = round((row + 1) * height / args.rows)
        for col in range(args.cols):
            x0 = round(col * width / args.cols)
            x1 = round((col + 1) * width / args.cols)
            index = row * args.cols + col
            frame = image.crop((x0, y0, x1, y1)).resize((frame_size, frame_size), Image.Resampling.LANCZOS)
            staging_frame = frames_directory / f"frame-{index:02d}-runtime.png"
            save_png(frame, staging_frame)
            frame_hash = sha256(staging_frame)
            final_frame = staging_frame.with_name(f"frame-{index:02d}-{frame_hash[:12]}.png")
            if final_frame.exists():
                if sha256(final_frame) != frame_hash:
                    raise SystemExit(f"hash collision at {final_frame}")
                staging_frame.unlink()
            else:
                staging_frame.replace(final_frame)
            frames.append({
                "index": index,
                "row": row,
                "col": col,
                "path": relative_posix(final_frame, root),
                "sha256": frame_hash,
                "bytes": final_frame.stat().st_size,
                "width": frame_size,
                "height": frame_size,
            })

    result = {
        "input": relative_posix(source, root),
        "inputSha256": sha256(source),
        "sourceWidth": width,
        "sourceHeight": height,
        "runtimePath": relative_posix(runtime, root),
        "runtimeUrl": f"/{relative_posix(runtime, root)}",
        "runtimeSha256": runtime_hash,
        "runtimeBytes": runtime.stat().st_size,
        "runtimeWidth": args.runtime_size,
        "runtimeHeight": args.runtime_size,
        "grid": {"rows": args.rows, "cols": args.cols},
        "transparentPixelFraction": round(transparent / total, 6),
        "partiallyTransparentPixelFraction": round(partial / total, 6),
        "opaquePixelFraction": round(opaque / total, 6),
        "frames": frames,
    }
    write_cache(cache_path, cache_key, result)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
