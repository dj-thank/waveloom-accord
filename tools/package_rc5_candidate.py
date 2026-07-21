#!/usr/bin/env python3
"""Build a deterministic, explicit-allowlist rc.5 source candidate archive."""

from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
from pathlib import PurePosixPath
import re
import struct
import zipfile


ROOT = Path(__file__).resolve().parents[1]
OUTPUTS = ROOT / "outputs"
PACKAGE_PREFIX = "kagariai-1.0.0-rc.5-source"
FIXED_ZIP_TIME = (2026, 7, 20, 0, 0, 0)
ABILITY_SLOTS = ("secondary", "ability1", "ability2", "ultimate")
AUDIO_PROVIDER = "Kagariai Local DSP"
AUDIO_GENERATOR_VERSION = "1.0.0"
AUDIO_GENERATOR_PATH = "tools/generate_local_audio_assets.js"
AUDIO_LICENSE = "Project-authored; no third-party samples or model weights"
AUDIO_GENERATED_FOR = "kagariai-1.0.0-rc.5"
AUDIO_SAMPLE_RATE_HZ = 44_100
AUDIO_CHANNELS = 1
AUDIO_BIT_DEPTH = 16
AUDIO_CONTENT_TYPE = "audio/wav"
AUDIO_OUTPUT_FORMAT = "pcm_s16le"

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


def resolved_file(root: Path, relative: object, label: str) -> Path:
    if not isinstance(relative, str) or not relative or "\\" in relative:
        raise SystemExit(f"invalid {label} path")
    pure = PurePosixPath(relative)
    if pure.is_absolute() or ".." in pure.parts or "." in pure.parts:
        raise SystemExit(f"invalid {label} path: {relative}")
    root_resolved = root.resolve()
    candidate = root_resolved.joinpath(*pure.parts).resolve()
    try:
        candidate.relative_to(root_resolved)
    except ValueError as error:
        raise SystemExit(f"invalid {label} path: {relative}") from error
    if not candidate.is_file():
        raise SystemExit(f"missing {label}: {relative}")
    return candidate


def inspect_pcm16_mono_wav(payload: bytes, identity: str) -> dict[str, float | int]:
    if len(payload) < 44:
        raise SystemExit(f"invalid WAV payload for {identity}: shorter than canonical header")
    if payload[0:4] != b"RIFF" or payload[8:12] != b"WAVE":
        raise SystemExit(f"invalid WAV payload for {identity}: missing RIFF/WAVE signature")
    if struct.unpack_from("<I", payload, 4)[0] != len(payload) - 8:
        raise SystemExit(f"invalid WAV payload for {identity}: RIFF length mismatch")
    if payload[12:16] != b"fmt " or struct.unpack_from("<I", payload, 16)[0] != 16:
        raise SystemExit(f"invalid WAV payload for {identity}: non-canonical fmt chunk")
    audio_format, channels, sample_rate, byte_rate, block_align, bit_depth = struct.unpack_from("<HHIIHH", payload, 20)
    if (
        audio_format != 1
        or channels != AUDIO_CHANNELS
        or sample_rate != AUDIO_SAMPLE_RATE_HZ
        or byte_rate != AUDIO_SAMPLE_RATE_HZ * AUDIO_CHANNELS * (AUDIO_BIT_DEPTH // 8)
        or block_align != AUDIO_CHANNELS * (AUDIO_BIT_DEPTH // 8)
        or bit_depth != AUDIO_BIT_DEPTH
    ):
        raise SystemExit(f"invalid WAV format for {identity}: expected PCM16 mono 44.1 kHz")
    if payload[36:40] != b"data":
        raise SystemExit(f"invalid WAV payload for {identity}: missing canonical data chunk")
    data_bytes = struct.unpack_from("<I", payload, 40)[0]
    if data_bytes != len(payload) - 44 or data_bytes <= 0 or data_bytes % 2:
        raise SystemExit(f"invalid WAV payload for {identity}: data length mismatch")

    sample_count = data_bytes // 2
    early_samples = min(sample_count, round(0.12 * AUDIO_SAMPLE_RATE_HZ))
    tail_samples = min(sample_count, round(0.05 * AUDIO_SAMPLE_RATE_HZ))
    peak = 0
    early_peak = 0
    squared = 0
    tail_squared = 0
    zeros = 0
    first_nonzero = -1
    last_sample = 0
    for index, (sample,) in enumerate(struct.iter_unpack("<h", payload[44:])):
        absolute = abs(sample)
        peak = max(peak, absolute)
        if index < early_samples:
            early_peak = max(early_peak, absolute)
        squared += sample * sample
        if index >= sample_count - tail_samples:
            tail_squared += sample * sample
        if sample == 0:
            zeros += 1
        elif first_nonzero < 0:
            first_nonzero = index
        last_sample = sample

    normalized_peak = peak / 32_767
    normalized_early_peak = early_peak / 32_767
    rms = math.sqrt(squared / sample_count) / 32_767
    tail_rms = math.sqrt(tail_squared / tail_samples) / 32_767
    zero_fraction = zeros / sample_count
    if not 0.88 <= normalized_peak <= 0.92:
        raise SystemExit(f"invalid WAV signal for {identity}: peak outside generator contract")
    if normalized_early_peak < 0.28 or not 0.025 <= rms <= 0.40:
        raise SystemExit(f"invalid WAV signal for {identity}: attack or RMS outside generator contract")
    if tail_rms > rms * 0.30 or zero_fraction >= 0.10:
        raise SystemExit(f"invalid WAV signal for {identity}: fade or silence ratio outside generator contract")
    if first_nonzero < 0 or first_nonzero >= 32 or abs(last_sample) > 1:
        raise SystemExit(f"invalid WAV signal for {identity}: leading or trailing sample contract failed")
    return {
        "bytes": len(payload),
        "sampleCount": sample_count,
        "durationSec": sample_count / AUDIO_SAMPLE_RATE_HZ,
        "peak": normalized_peak,
        "rms": rms,
    }


def validate_audio_manifest_files(root: Path, audio_manifest: dict[str, object]) -> dict[str, dict[str, object]]:
    required_metadata = {
        "schemaVersion": "1.0.0",
        "authoritative": True,
        "provider": AUDIO_PROVIDER,
        "generatorVersion": AUDIO_GENERATOR_VERSION,
        "generatorPath": AUDIO_GENERATOR_PATH,
        "sampleRateHz": AUDIO_SAMPLE_RATE_HZ,
        "channels": AUDIO_CHANNELS,
        "bitDepth": AUDIO_BIT_DEPTH,
        "contentType": AUDIO_CONTENT_TYPE,
        "license": AUDIO_LICENSE,
        "generatedFor": AUDIO_GENERATED_FOR,
    }
    for field, expected in required_metadata.items():
        if audio_manifest.get(field) != expected:
            raise SystemExit(f"authoritative local audio manifest has invalid {field}")
    if audio_manifest.get("outputFormat", AUDIO_OUTPUT_FORMAT) != AUDIO_OUTPUT_FORMAT:
        raise SystemExit("authoritative local audio manifest has invalid outputFormat")

    generator_hash = audio_manifest.get("generatorSha256")
    if not isinstance(generator_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", generator_hash):
        raise SystemExit("local audio manifest has an invalid generator hash")
    generator_file = resolved_file(root, AUDIO_GENERATOR_PATH, "local audio generator")
    if sha256_file(generator_file) != generator_hash:
        raise SystemExit("local audio generator hash does not match its manifest")

    assets = audio_manifest.get("assets")
    if not isinstance(assets, list) or len(assets) != 90:
        raise SystemExit("authoritative local audio manifest must contain exactly 90 assets")

    records: dict[str, dict[str, object]] = {}
    hashes: set[str] = set()
    profiles: set[str] = set()
    expected_sources: set[str] = set()
    expected_runtimes: set[str] = set()
    kind_counts = {"weapon": 0, "ability": 0}
    slot_counts = {slot: 0 for slot in ABILITY_SLOTS}
    for raw_asset in assets:
        if not isinstance(raw_asset, dict):
            raise SystemExit("local audio manifest contains a non-object asset")
        asset = raw_asset
        kind = asset.get("kind")
        asset_id = asset.get("id")
        hero_id = asset.get("heroId")
        if kind not in kind_counts or not isinstance(asset_id, str) or not re.fullmatch(r"[a-z0-9_]+", asset_id):
            raise SystemExit("local audio manifest contains an invalid asset identity")
        if not isinstance(hero_id, str) or not re.fullmatch(r"[a-z0-9_]+", hero_id):
            raise SystemExit(f"invalid audio heroId for {kind}:{asset_id}")
        identity = f"{kind}:{asset_id}"
        if identity in records:
            raise SystemExit(f"duplicate audio identity: {identity}")

        slot = asset.get("slot")
        if kind == "weapon":
            if slot is not None:
                raise SystemExit(f"weapon audio must have a null slot: {identity}")
        elif slot not in slot_counts:
            raise SystemExit(f"invalid ability audio slot: {identity}")
        if not isinstance(asset.get("behavior"), str) or not asset["behavior"]:
            raise SystemExit(f"invalid audio behavior: {identity}")
        seed = asset.get("seed")
        if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= 0xFFFF_FFFF:
            raise SystemExit(f"invalid audio seed: {identity}")
        profile = asset.get("profile")
        if not isinstance(profile, str) or not re.fullmatch(r"[a-z0-9_.:-]+", profile, flags=re.IGNORECASE):
            raise SystemExit(f"invalid audio profile: {identity}")
        if profile in profiles:
            raise SystemExit(f"duplicate audio profile: {identity}")
        profiles.add(profile)
        generated_at = asset.get("generatedAt")
        if not isinstance(generated_at, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", generated_at):
            raise SystemExit(f"invalid audio generatedAt: {identity}")
        if asset.get("contentType") != AUDIO_CONTENT_TYPE:
            raise SystemExit(f"invalid audio contentType: {identity}")

        expected_hash = asset.get("sha256")
        if not isinstance(expected_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_hash):
            raise SystemExit(f"invalid audio hash: {identity}")
        if expected_hash in hashes:
            raise SystemExit(f"duplicate audio bytes: {identity}")
        hashes.add(expected_hash)

        expected_source = f"assets-src/local-audio/raw/{kind}/{asset_id}.wav"
        runtime_group = "weapons" if kind == "weapon" else "abilities"
        expected_runtime = f"client/assets/generated/audio/{runtime_group}/{asset_id}.{expected_hash[:12]}.wav"
        if asset.get("sourcePath") != expected_source:
            raise SystemExit(f"invalid audio sourcePath: {identity}")
        if asset.get("runtimePath") != expected_runtime or asset.get("runtimeUrl") != f"/{expected_runtime}":
            raise SystemExit(f"invalid content-addressed audio runtime path: {identity}")

        source_file = resolved_file(root, expected_source, f"audio source for {identity}")
        runtime_file = resolved_file(root, expected_runtime, f"audio runtime for {identity}")
        source_payload = source_file.read_bytes()
        runtime_payload = runtime_file.read_bytes()
        if source_payload != runtime_payload:
            raise SystemExit(f"audio source/runtime bytes differ: {identity}")
        if sha256_bytes(source_payload) != expected_hash:
            raise SystemExit(f"audio hash mismatch: {identity}")
        declared_bytes = asset.get("bytes")
        if isinstance(declared_bytes, bool) or not isinstance(declared_bytes, int) or declared_bytes != len(source_payload):
            raise SystemExit(f"audio byte count mismatch: {identity}")
        wav = inspect_pcm16_mono_wav(source_payload, identity)
        declared_duration = asset.get("durationSec")
        if isinstance(declared_duration, bool) or not isinstance(declared_duration, (int, float)) or not math.isfinite(declared_duration):
            raise SystemExit(f"invalid audio duration: {identity}")
        if abs(float(declared_duration) - float(wav["durationSec"])) > 1 / AUDIO_SAMPLE_RATE_HZ:
            raise SystemExit(f"audio duration mismatch: {identity}")
        minimum, maximum = (1.70, 1.81) if slot == "ultimate" else (0.85, 1.21)
        if not minimum <= float(wav["durationSec"]) <= maximum:
            raise SystemExit(f"audio duration outside generator contract: {identity}")

        kind_counts[kind] += 1
        if kind == "ability":
            slot_counts[str(slot)] += 1
        expected_sources.add(expected_source)
        expected_runtimes.add(expected_runtime)
        records[identity] = asset

    if kind_counts != {"weapon": 18, "ability": 72} or any(count != 18 for count in slot_counts.values()):
        raise SystemExit("local audio manifest must contain 18 weapons and 18 abilities in each canonical slot")

    actual_sources = {
        path.relative_to(root).as_posix()
        for path in (root / "assets-src" / "local-audio" / "raw").rglob("*.wav")
    }
    actual_runtimes = {
        path.relative_to(root).as_posix()
        for path in (root / "client" / "assets" / "generated" / "audio").rglob("*.wav")
    }
    if actual_sources != expected_sources:
        raise SystemExit("local audio source inventory contains missing or orphan WAV files")
    if actual_runtimes != expected_runtimes:
        raise SystemExit("local audio runtime inventory contains missing or orphan WAV files")
    return records


def canonical_audio_catalog(root: Path) -> dict[str, dict[str, object]]:
    source = resolved_file(root, "shared/data/heroes.js", "canonical hero roster").read_text(encoding="utf-8")
    blocks = re.findall(r"^  hero\(\{\s*$([\s\S]*?)^  \}\),\s*$", source, flags=re.MULTILINE)
    catalog: dict[str, dict[str, object]] = {}
    hero_ids: set[str] = set()
    for block in blocks:
        hero_match = re.search(r"^    id:\s*'([a-z0-9_]+)'", block, flags=re.MULTILINE)
        weapon_match = re.search(r"^    weapon:\s*weapon\('([a-z0-9_]+)'.*?,\s*\{(.*)\}\),\s*$", block, flags=re.MULTILINE)
        if not hero_match or not weapon_match:
            raise SystemExit("could not parse canonical hero audio catalog")
        hero_id = hero_match.group(1)
        if hero_id in hero_ids:
            raise SystemExit(f"duplicate canonical hero id: {hero_id}")
        hero_ids.add(hero_id)
        weapon_id, weapon_values = weapon_match.groups()
        type_match = re.search(r"\btype:\s*'([a-z0-9_]+)'", weapon_values)
        catalog[f"weapon:{weapon_id}"] = {
            "heroId": hero_id,
            "kind": "weapon",
            "id": weapon_id,
            "slot": None,
            "behavior": type_match.group(1) if type_match else "hitscan",
        }
        actions = re.findall(
            r"^      (secondary|ability1|ability2|ultimate):\s*action\(\s*'\1'\s*,\s*'([a-z0-9_]+)'\s*,\s*'(?:[^'\\]|\\.)*'\s*,\s*'([a-z0-9_]+)'",
            block,
            flags=re.MULTILINE,
        )
        if len(actions) != 4 or {slot for slot, _, _ in actions} != set(ABILITY_SLOTS):
            raise SystemExit(f"could not parse four canonical abilities for hero {hero_id}")
        for slot, action_id, behavior in actions:
            catalog[f"ability:{action_id}"] = {
                "heroId": hero_id,
                "kind": "ability",
                "id": action_id,
                "slot": slot,
                "behavior": behavior,
            }
    if len(hero_ids) != 18 or len(catalog) != 90:
        raise SystemExit(f"canonical hero audio catalog has unexpected size: heroes={len(hero_ids)} audio={len(catalog)}")
    return catalog


def parse_hero_asset_manifest(root: Path) -> dict[str, object]:
    source = resolved_file(root, "shared/data/hero_assets.js", "integrated hero asset SSOT").read_text(encoding="utf-8")
    prefix = "export const HERO_ASSET_MANIFEST = deepFreeze("
    suffix = "\n});\n\nexport const HERO_ASSET_BY_ID"
    start = source.find(prefix)
    end = source.find(suffix, start + len(prefix))
    if start < 0 or end < 0:
        raise SystemExit("integrated hero asset SSOT has an invalid module envelope")
    try:
        manifest = json.loads(source[start + len(prefix):end + 2])
    except json.JSONDecodeError as error:
        raise SystemExit("integrated hero asset SSOT does not contain valid JSON") from error
    if not isinstance(manifest, dict):
        raise SystemExit("integrated hero asset SSOT manifest is not an object")
    return manifest


def expected_ssot_audio_descriptor(audio_manifest: dict[str, object], asset: dict[str, object]) -> dict[str, object]:
    return {
        "provider": audio_manifest["provider"],
        "generatorVersion": audio_manifest["generatorVersion"],
        "generatorPath": audio_manifest["generatorPath"],
        "generatorSha256": audio_manifest["generatorSha256"],
        "outputFormat": audio_manifest.get("outputFormat", AUDIO_OUTPUT_FORMAT),
        "sampleRateHz": audio_manifest["sampleRateHz"],
        "channels": audio_manifest["channels"],
        "bitDepth": audio_manifest["bitDepth"],
        "license": audio_manifest["license"],
        "seed": asset["seed"],
        "profile": asset["profile"],
        "durationSec": asset["durationSec"],
        "sourcePath": asset["sourcePath"],
        "sourceSha256": asset["sha256"],
        "runtimeUrl": asset["runtimeUrl"],
        "sha256": asset["sha256"],
        "bytes": asset["bytes"],
        "contentType": asset["contentType"],
        "generatedAt": asset["generatedAt"],
    }


def validate_integrated_audio_ssot(
    root: Path,
    audio_manifest_path: Path,
    audio_manifest: dict[str, object],
    audio_records: dict[str, dict[str, object]],
    canonical: dict[str, dict[str, object]],
) -> str:
    if set(audio_records) != set(canonical):
        raise SystemExit("local audio manifest identities do not match the canonical hero roster")
    for identity, expected in canonical.items():
        actual = audio_records[identity]
        for field in ("heroId", "kind", "id", "slot", "behavior"):
            if actual.get(field) != expected[field]:
                raise SystemExit(f"local audio canonical {field} mismatch: {identity}")

    hero_manifest = parse_hero_asset_manifest(root)
    if (
        hero_manifest.get("schemaVersion") != "1.0.0"
        or hero_manifest.get("authoritative") is not True
        or hero_manifest.get("complete") is not True
        or hero_manifest.get("missingAudio") != []
        or hero_manifest.get("generatedFor") != AUDIO_GENERATED_FOR
    ):
        raise SystemExit("integrated hero asset SSOT is not complete")
    content_sha = hero_manifest.get("contentSha256")
    if not isinstance(content_sha, str) or not re.fullmatch(r"[0-9a-f]{64}", content_sha):
        raise SystemExit("integrated hero asset SSOT has an invalid content hash")
    unhashed = dict(hero_manifest)
    unhashed.pop("contentSha256", None)
    recalculated_content_sha = sha256_bytes(
        json.dumps(unhashed, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    )
    if recalculated_content_sha != content_sha:
        raise SystemExit("integrated hero asset SSOT content hash does not match its structure")

    input_hashes = hero_manifest.get("inputHashes")
    if not isinstance(input_hashes, list):
        raise SystemExit("integrated hero asset SSOT has invalid input hashes")
    audio_inputs = [entry for entry in input_hashes if isinstance(entry, dict) and entry.get("path") == "assets-src/local-audio/manifest.json"]
    if len(audio_inputs) != 1 or audio_inputs[0].get("sha256") != sha256_file(audio_manifest_path):
        raise SystemExit("integrated hero asset SSOT does not bind the admitted audio manifest")

    heroes = hero_manifest.get("heroes")
    if not isinstance(heroes, list) or len(heroes) != 18:
        raise SystemExit("integrated hero asset SSOT must contain 18 heroes")
    canonical_heroes = {str(record["heroId"]) for record in canonical.values()}
    seen_heroes: set[str] = set()
    seen_audio: set[str] = set()
    for hero in heroes:
        if not isinstance(hero, dict) or not isinstance(hero.get("heroId"), str):
            raise SystemExit("integrated hero asset SSOT contains an invalid hero")
        hero_id = hero["heroId"]
        if hero_id in seen_heroes:
            raise SystemExit(f"integrated hero asset SSOT has a duplicate hero: {hero_id}")
        seen_heroes.add(hero_id)
        canonical_weapon = [record for record in canonical.values() if record["heroId"] == hero_id and record["kind"] == "weapon"]
        if len(canonical_weapon) != 1:
            raise SystemExit(f"integrated hero asset SSOT has an unknown hero: {hero_id}")
        weapon = hero.get("weapon")
        expected_weapon = canonical_weapon[0]
        weapon_identity = f"weapon:{expected_weapon['id']}"
        if not isinstance(weapon, dict) or weapon.get("id") != expected_weapon["id"]:
            raise SystemExit(f"integrated hero weapon mismatch: {hero_id}")
        if weapon.get("audio") != expected_ssot_audio_descriptor(audio_manifest, audio_records[weapon_identity]):
            raise SystemExit(f"integrated hero weapon audio mismatch: {hero_id}")
        seen_audio.add(weapon_identity)

        abilities = hero.get("abilities")
        if not isinstance(abilities, dict) or set(abilities) != set(ABILITY_SLOTS):
            raise SystemExit(f"integrated hero ability slots mismatch: {hero_id}")
        for slot in ABILITY_SLOTS:
            expected_actions = [
                record for record in canonical.values()
                if record["heroId"] == hero_id and record["kind"] == "ability" and record["slot"] == slot
            ]
            if len(expected_actions) != 1:
                raise SystemExit(f"canonical ability slot mismatch: {hero_id}:{slot}")
            expected_action = expected_actions[0]
            action = abilities[slot]
            identity = f"ability:{expected_action['id']}"
            if (
                not isinstance(action, dict)
                or action.get("id") != expected_action["id"]
                or action.get("slot") != slot
                or action.get("behavior") != expected_action["behavior"]
            ):
                raise SystemExit(f"integrated hero ability identity mismatch: {hero_id}:{slot}")
            if action.get("audio") != expected_ssot_audio_descriptor(audio_manifest, audio_records[identity]):
                raise SystemExit(f"integrated hero ability audio mismatch: {hero_id}:{slot}")
            seen_audio.add(identity)
    if seen_heroes != canonical_heroes or seen_audio != set(canonical):
        raise SystemExit("integrated hero asset SSOT audio coverage is incomplete")
    return content_sha


def release_status(root: Path = ROOT) -> dict[str, object]:
    audio_manifest_path = resolved_file(root, "assets-src/local-audio/manifest.json", "local audio manifest")
    try:
        audio_manifest = json.loads(audio_manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise SystemExit("local audio manifest is not valid JSON") from error
    if not isinstance(audio_manifest, dict):
        raise SystemExit("local audio manifest is not an object")
    audio_records = validate_audio_manifest_files(root, audio_manifest)
    canonical = canonical_audio_catalog(root)
    content_sha = validate_integrated_audio_ssot(
        root,
        audio_manifest_path,
        audio_manifest,
        audio_records,
        canonical,
    )

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
        "presentAudio": len(audio_records),
        "missingAudio": 0,
        "audioProvider": audio_manifest["provider"],
        "audioGeneratorVersion": audio_manifest["generatorVersion"],
        "heroAssetContentSha256": content_sha,
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
