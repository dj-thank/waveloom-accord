#!/usr/bin/env python3
"""Build a deterministic, explicit-allowlist rc.5 source candidate archive."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import zipfile


ROOT = Path(__file__).resolve().parents[1]
OUTPUTS = ROOT / "outputs"
PACKAGE_PREFIX = "kagariai-1.0.0-rc.5-source"
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
    ".part",
    ".partial",
    ".pyc",
    ".tmp",
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
    relative = path.relative_to(ROOT).as_posix()
    if relative.startswith("assets-src/elevenlabs/"):
        return False
    if relative.startswith("client/assets/generated/audio/") and path.suffix.lower() == ".mp3":
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


def release_status() -> dict[str, object]:
    audio_manifest_path = ROOT / "assets-src" / "local-audio" / "manifest.json"
    audio_manifest = json.loads(audio_manifest_path.read_text(encoding="utf-8"))
    assets = audio_manifest.get("assets", [])
    if (
        audio_manifest.get("authoritative") is not True
        or audio_manifest.get("provider") != "Kagariai Local DSP"
        or audio_manifest.get("contentType") != "audio/wav"
        or len(assets) != 90
    ):
        raise SystemExit("authoritative local audio manifest is not complete")

    generator_path = audio_manifest.get("generatorPath")
    generator_hash = audio_manifest.get("generatorSha256")
    if generator_path != "tools/generate_local_audio_assets.js":
        raise SystemExit("unexpected local audio generator path")
    if sha256_file(ROOT / generator_path) != generator_hash:
        raise SystemExit("local audio generator hash does not match its manifest")

    identities: set[str] = set()
    hashes: set[str] = set()
    expected_sources: set[str] = set()
    expected_runtimes: set[str] = set()
    for asset in assets:
        identity = f"{asset.get('kind')}:{asset.get('id')}"
        if identity in identities:
            raise SystemExit(f"duplicate audio identity: {identity}")
        identities.add(identity)
        expected_hash = asset.get("sha256")
        if not isinstance(expected_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_hash):
            raise SystemExit(f"invalid audio hash: {identity}")
        if expected_hash in hashes:
            raise SystemExit(f"duplicate audio bytes: {identity}")
        hashes.add(expected_hash)
        expected_sources.add(asset["sourcePath"])
        expected_runtimes.add(asset["runtimePath"])
        for field in ("sourcePath", "runtimePath"):
            candidate = (ROOT / asset[field]).resolve()
            if ROOT.resolve() not in candidate.parents or not candidate.is_file():
                raise SystemExit(f"invalid audio {field}: {identity}")
            if sha256_file(candidate) != expected_hash:
                raise SystemExit(f"audio hash mismatch: {identity} {field}")

    actual_sources = {
        path.relative_to(ROOT).as_posix()
        for path in (ROOT / "assets-src" / "local-audio" / "raw").rglob("*.wav")
    }
    actual_runtimes = {
        path.relative_to(ROOT).as_posix()
        for path in (ROOT / "client" / "assets" / "generated" / "audio").rglob("*.wav")
    }
    if actual_sources != expected_sources:
        raise SystemExit("local audio source inventory contains missing or orphan WAV files")
    if actual_runtimes != expected_runtimes:
        raise SystemExit("local audio runtime inventory contains missing or orphan WAV files")

    hero_asset_source = (ROOT / "shared" / "data" / "hero_assets.js").read_text(encoding="utf-8")
    content_match = re.search(r'"contentSha256":\s*"([0-9a-f]{64})"', hero_asset_source)
    if not content_match or '"complete": true' not in hero_asset_source or '"missingAudio": []' not in hero_asset_source:
        raise SystemExit("integrated hero asset SSOT is not complete")

    docker_digest = os.environ.get("KAGARIAI_DOCKER_IMAGE_DIGEST")
    if docker_digest and not re.fullmatch(r"sha256:[0-9a-f]{64}", docker_digest):
        raise SystemExit("KAGARIAI_DOCKER_IMAGE_DIGEST must be a sha256 digest")

    return {
        "version": "1.0.0-rc.5",
        "releaseStatus": "PRODUCTION_CANDIDATE",
        "candidateStatus": "COMPLETE_AUDIO",
        "authoritative": True,
        "complete": True,
        "expectedAudio": 90,
        "presentAudio": len(assets),
        "missingAudio": 0,
        "audioProvider": audio_manifest["provider"],
        "audioGeneratorVersion": audio_manifest["generatorVersion"],
        "heroAssetContentSha256": content_match.group(1),
        "dockerImageDigest": docker_digest,
        "unverifiedBoundaries": [
            "human listening QA for all 90 sounds",
            "public DNS/TLS/WSS",
            "real-network loss, latency, and soak",
            "ten-human-player end-to-end match",
        ],
    }


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

    status = release_status()
    manifest = {
        "format": "kagariai-source-manifest-v1",
        "package": PACKAGE_PREFIX,
        "fileCount": len(entries),
        "totalBytes": sum(entry["bytes"] for entry in entries),
        "files": entries,
    }
    manifest_bytes = canonical_json(manifest)
    status_bytes = canonical_json(status)
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
        "status": status["candidateStatus"],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
