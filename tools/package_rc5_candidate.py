#!/usr/bin/env python3
"""Build a deterministic, explicit-allowlist rc.5 source candidate archive."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import zipfile


ROOT = Path(__file__).resolve().parents[1]
OUTPUTS = ROOT / "outputs"
PACKAGE_PREFIX = "kagariai-1.0.0-rc.5-INCOMPLETE-AUDIO-source"
FIXED_ZIP_TIME = (2026, 7, 20, 0, 0, 0)

ROOT_FILES = (
    ".dockerignore",
    ".gitignore",
    "compose.production.yml",
    "Dockerfile",
    "package-lock.json",
    "package.json",
    "README.md",
)

ROOT_DIRECTORIES = (
    "assets-src",
    "client",
    "deploy",
    "docs",
    "server",
    "shared",
    "tests",
    "tools",
)

EVIDENCE_DIRECTORIES = (
    "outputs/rc5-visual-evidence",
)

EXCLUDED_NAMES = {
    ".atlas-cache.json",
    ".DS_Store",
}

EXCLUDED_SUFFIXES = {
    ".log",
    ".pyc",
}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def admitted(path: Path) -> bool:
    if not path.is_file():
        return False
    if path.name in EXCLUDED_NAMES or path.suffix.lower() in EXCLUDED_SUFFIXES:
        return False
    return "__pycache__" not in path.parts


def selected_files() -> list[Path]:
    selected: set[Path] = set()
    for relative in ROOT_FILES:
        path = ROOT / relative
        if not admitted(path):
            raise SystemExit(f"required package file missing: {relative}")
        selected.add(path)

    for relative in (*ROOT_DIRECTORIES, *EVIDENCE_DIRECTORIES):
        directory = ROOT / relative
        if not directory.is_dir():
            raise SystemExit(f"required package directory missing: {relative}")
        selected.update(path for path in directory.rglob("*") if admitted(path))

    return sorted(selected, key=lambda path: path.relative_to(ROOT).as_posix())


def zip_info(relative: str) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(relative, FIXED_ZIP_TIME)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    info.create_system = 3
    return info


def canonical_json(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def main() -> None:
    files = selected_files()
    entries = []
    for path in files:
        relative = path.relative_to(ROOT).as_posix()
        entries.append({
            "path": relative,
            "bytes": path.stat().st_size,
            "sha256": sha256_file(path),
        })

    release_status = {
        "version": "1.0.0-rc.5",
        "releaseStatus": "BLOCKED",
        "candidateStatus": "INCOMPLETE_AUDIO",
        "authoritative": True,
        "complete": False,
        "expectedAudio": 90,
        "presentAudio": 2,
        "missingAudio": 88,
        "heroAssetContentSha256": "e62cad2a166deb901b2ec9da5e4852a985720fe6f56d6daa0ae129048945f2f6",
        "dockerImageDigest": "sha256:8e0c8ab998b614779d2b6ae1526c388db4a4b3ee29b9491e536221454b064b28",
    }
    manifest = {
        "format": "kagariai-source-manifest-v1",
        "package": PACKAGE_PREFIX,
        "fileCount": len(entries),
        "totalBytes": sum(entry["bytes"] for entry in entries),
        "files": entries,
    }
    manifest_bytes = canonical_json(manifest)
    status_bytes = canonical_json(release_status)
    tree_hash = sha256_bytes(manifest_bytes)
    basename = f"{PACKAGE_PREFIX}-{tree_hash[:12]}"

    OUTPUTS.mkdir(parents=True, exist_ok=True)
    archive_path = OUTPUTS / f"{basename}.zip"
    manifest_path = OUTPUTS / f"{basename}.manifest.json"
    checksum_path = OUTPUTS / f"{basename}.zip.sha256"

    if archive_path.exists() or manifest_path.exists() or checksum_path.exists():
        raise SystemExit(f"refusing to overwrite existing candidate: {basename}")

    temporary_path = OUTPUTS / f".{basename}.zip.part"
    if temporary_path.exists():
        raise SystemExit(f"refusing to overwrite interrupted archive: {temporary_path.name}")

    try:
        with zipfile.ZipFile(temporary_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
            archive.writestr(zip_info("RELEASE_MANIFEST.json"), manifest_bytes)
            archive.writestr(zip_info("RELEASE_STATUS.json"), status_bytes)
            for path in files:
                relative = path.relative_to(ROOT).as_posix()
                archive.writestr(zip_info(relative), path.read_bytes())
        temporary_path.replace(archive_path)
    except BaseException:
        if temporary_path.exists():
            temporary_path.unlink()
        raise

    archive_hash = sha256_file(archive_path)
    manifest_path.write_bytes(manifest_bytes)
    checksum_path.write_text(f"{archive_hash}  {archive_path.name}\n", encoding="ascii", newline="\n")

    print(json.dumps({
        "archive": str(archive_path),
        "archiveBytes": archive_path.stat().st_size,
        "archiveSha256": archive_hash,
        "manifest": str(manifest_path),
        "manifestSha256": tree_hash,
        "fileCount": len(entries),
        "sourceBytes": manifest["totalBytes"],
        "status": release_status["candidateStatus"],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()

