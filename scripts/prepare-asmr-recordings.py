"""Verify pinned original recordings and prepare bounded FLAC assets in CI."""

import argparse
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import io
import json
import math
import os
from pathlib import Path
import platform
import sys
import urllib.request
import zipfile

import numpy as np
import scipy
from scipy.signal import resample_poly
import soundfile as sf


SOURCE_URL = "https://opengameart.org/content/sound-effects-pack"
ARCHIVE_URL = "https://opengameart.org/sites/default/files/Owlish%20Media%20Sound%20Effects.zip"
ARCHIVE_BYTES = 142384346
ARCHIVE_SHA256 = "57d7059fe2c0ea5f47c7554ace22a538ea22ab40bfc0906b71aa259afffd3d18"
LICENSE_URL = "https://creativecommons.org/publicdomain/zero/1.0/"
AUTHOR_URL = "https://opengameart.org/users/owlishmedia"
CLIPS = [
    ("blanket-movement", "Blanket movement", "Cloth, Rustle/320137__owlstorm__blanket-movement-1.wav",
     1770198, "681391cdd2422eeebc5c230492ea3c6d2e045fafcb993b0854dc6a182db92b1a",
     "Movement of a blanket."),
    ("zipper-slide", "Bag zipper", "Cloth, Rustle/212180__owlstorm__bag-zipper.wav",
     1293230, "d5a18e4610d72aece2c77afc400ee70d48f42820acde2008ca375f0d3c862272",
     "A bag zipper being moved."),
    ("sketchbook-pages", "Sketchbook page flips", "Paper/paper-sketchbook-page-flips-1.wav",
     1607366, "880a7342ca3e4e6e12260e0f64b1846e3e74618e4a10e2315b89243a505bbcdc",
     "Pages of a paper sketchbook being flipped."),
    ("pencil-sketching", "Pencil scratch", "Paper/pencil-scratch-1.wav",
     5405104, "391d6c6bd63d4b0de754278993eca2bf0b2ece366c10d22cdcb22480b2ea2ad4",
     "Pencil scratching on paper."),
    ("bottle-mist", "Spray bottle original recording", "Water/spray-bottle.wav",
     1330486, "acd9700d1352e85dc39c63d24b93832672e4f69d79ff6681e761087a47ee692b",
     "A spray bottle being pumped."),
    ("running-water", "Tap water", "Water/tap-water-1.wav",
     2066086, "9656a41a1d67bf224f5754596b19ed6156b524028dc8e2b0c6f9455836b333e9",
     "Water running from a tap."),
]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def fetch(url, maximum):
    request = urllib.request.Request(url, headers={"User-Agent": "Binaural-recording-preparation/1"})
    with urllib.request.urlopen(request, timeout=120) as response:
        data = response.read(maximum + 1)
        if response.status != 200 or len(data) > maximum:
            raise ValueError(f"Invalid or oversized source response: {url}")
    return data


class EvidenceParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.words = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.links.extend(value for key, value in attrs if key == "href")

    def handle_data(self, data):
        self.words.append(data)


def license_evidence(output):
    html = fetch(SOURCE_URL, 2_000_000)
    (output / "source-page.html").write_bytes(html)
    parser = EvidenceParser()
    parser.feed(html.decode("utf-8"))
    text = " ".join(" ".join(parser.words).split())
    links = [link.replace("http://", "https://").rstrip("/").lower() for link in parser.links]
    if (LICENSE_URL.rstrip("/").lower() not in links
            or not any(link.endswith("/users/owlishmedia") for link in links)
            or "sound effects I've recorded over the years" not in text
            or "Sound Effects Pack" not in text):
        raise ValueError("Publisher's CC0/original-recording evidence changed; manual review required")
    return {"url": SOURCE_URL, "sha256": digest(html), "license": "CC0-1.0",
            "licenseUrl": LICENSE_URL, "author": "OwlishMedia", "authorUrl": AUTHOR_URL,
            "basis": "Author's submission identifies the pack as their recordings and links CC0 1.0.",
            "archiveHasLicenseFile": False}


def archive_data(cache):
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / "owlish-original.zip"
    data = path.read_bytes() if path.exists() else fetch(ARCHIVE_URL, ARCHIVE_BYTES)
    if len(data) != ARCHIVE_BYTES or digest(data) != ARCHIVE_SHA256:
        raise ValueError("Pinned archive size or SHA256 mismatch")
    if not path.exists():
        path.write_bytes(data)
    return data


def statistics(pcm, rate):
    if pcm.ndim != 2 or not pcm.size or not np.isfinite(pcm).all():
        raise ValueError("Empty, malformed or non-finite PCM")
    peak = np.max(np.abs(pcm), axis=0)
    dc = np.mean(pcm, axis=0)
    rms = np.sqrt(np.mean(pcm * pcm, axis=0))
    window = min(len(pcm), max(1, round(rate * 0.05)))
    return {
        "frames": len(pcm), "durationSeconds": len(pcm) / rate,
        "peak": peak.tolist(), "dc": dc.tolist(), "rms": rms.tolist(),
        "saturatedFraction": np.mean(np.abs(pcm) >= 0.9999, axis=0).tolist(),
        "nearSilentFraction": np.mean(np.abs(pcm) < 1e-5, axis=0).tolist(),
        "firstSample": pcm[0].tolist(), "lastSample": pcm[-1].tolist(),
        "loopBoundaryJump": np.abs(pcm[0] - pcm[-1]).tolist(),
        "first50msRms": np.sqrt(np.mean(pcm[:window] ** 2, axis=0)).tolist(),
        "last50msRms": np.sqrt(np.mean(pcm[-window:] ** 2, axis=0)).tolist(),
    }


def check_source(stats):
    if max(stats["peak"]) > 1.000001:
        raise ValueError(f"Source exceeds PCM full scale: {stats['peak']}")
    if max(stats["saturatedFraction"]) > 0.002:
        raise ValueError(f"Source contains excessive full-scale samples: {stats['saturatedFraction']}")
    if max(abs(value) for value in stats["dc"]) > 0.02:
        raise ValueError(f"Source DC exceeds 0.02 full scale: {stats['dc']}")
    if min(stats["rms"]) < 1e-5 or max(stats["nearSilentFraction"]) > 0.995:
        raise ValueError(f"Source contains an empty or nearly silent channel: {stats['rms']}")


def prepare(data, spec, output, inspect_only):
    clip_id, title, entry, size, sha256, recording = spec
    if len(data) != size or digest(data) != sha256:
        raise ValueError(f"Pinned WAV size or SHA256 mismatch: {entry}")
    with sf.SoundFile(io.BytesIO(data)) as source:
        metadata = {"format": "WAV", "containerFormat": source.format, "subtype": source.subtype,
                    "encoding": source.subtype,
                    "bitDepth": {"PCM_16": 16, "PCM_24": 24, "PCM_32": 32,
                                 "FLOAT": 32, "DOUBLE": 64}.get(source.subtype),
                    "channels": source.channels, "sampleRate": source.samplerate,
                    "frames": source.frames, "durationSeconds": source.frames / source.samplerate}
        if (source.format not in {"WAV", "WAVEX"} or source.channels not in {1, 2}
                or not 8000 <= source.samplerate <= 192000
                or source.subtype not in {"PCM_16", "PCM_24", "PCM_32", "FLOAT", "DOUBLE"}
                or not 0.25 <= metadata["durationSeconds"] <= 600):
            raise ValueError(f"Unsupported original WAV metadata: {metadata}")
        pcm = source.read(dtype="float64", always_2d=True)
    original = statistics(pcm, metadata["sampleRate"])
    audit = {"id": clip_id, "archiveEntry": entry, "sourceBytes": size,
             "sourceSha256": sha256, "originalMetadata": metadata, "originalSignal": original}
    write_json(output / f"{clip_id}-original-audit.json", audit)
    check_source(original)
    if inspect_only:
        return audit, None
    rate = min(48000, metadata["sampleRate"])
    subtype = "PCM_16" if metadata["subtype"] == "PCM_16" else "PCM_24"
    bytes_per_sample = 2 if subtype == "PCM_16" else 3
    # Bound the uncompressed payload too, so compressibility never controls selection.
    max_frames = min(round(rate * (30 if pcm.shape[1] == 1 else 18)),
                     1_850_000 // (pcm.shape[1] * bytes_per_sample))
    source_frames = min(len(pcm), math.floor(max_frames * metadata["sampleRate"] / rate))
    pcm = pcm[:source_frames].copy()
    if rate != metadata["sampleRate"]:
        divisor = math.gcd(rate, metadata["sampleRate"])
        pcm = resample_poly(pcm, rate // divisor, metadata["sampleRate"] // divisor, axis=0)
    peak = float(np.max(np.abs(pcm)))
    gain = min(1.0, 0.6 / peak)
    pcm *= gain
    fade_frames = min(round(rate * 0.05), len(pcm) // 4)
    fade = np.linspace(0.0, 1.0, fade_frames)
    pcm[:fade_frames] *= fade[:, None]
    pcm[-fade_frames:] *= fade[::-1, None]
    path = output / f"{clip_id}.flac"
    sf.write(path, pcm, rate, format="FLAC", subtype=subtype)
    encoded = path.read_bytes()
    decoded, decoded_rate = sf.read(path, dtype="float64", always_2d=True)
    quantization = 1 / (32768 if subtype == "PCM_16" else 8388608)
    if (len(encoded) >= 2_000_000 or len(pcm) / rate >= 60
            or decoded_rate != rate or decoded.shape != pcm.shape
            or np.max(np.abs(decoded - pcm)) > quantization * 1.01):
        raise ValueError("FLAC size, duration, channels or PCM round-trip guard failed")
    prepared = statistics(decoded, rate)
    check_source(prepared)
    if (max(prepared["peak"]) > 0.60004
            or max(prepared["loopBoundaryJump"]) > quantization
            or max(abs(value) for value in prepared["firstSample"] + prepared["lastSample"]) > quantization):
        raise ValueError("Prepared peak or fade boundary guard failed")
    gain_db = 20 * math.log10(gain)
    resampling = (f"resampled from {metadata['sampleRate']} to {rate} Hz with scipy resample_poly; "
                  if rate != metadata["sampleRate"] else "native sample rate retained; ")
    changes = (f"Excerpt from 0 to {len(pcm) / rate:.6f} seconds; constant gain {gain_db:.6f} dB "
               f"(attenuation only); 50 ms linear fade-in/out; {resampling}native channel count retained; "
               f"source metadata removed; encoded once as FLAC {subtype}.")
    credit = {"id": clip_id, "file": path.name, "title": title, "author": "OwlishMedia",
              "sourceUrl": SOURCE_URL, "license": "CC0-1.0", "licenseUrl": LICENSE_URL,
              "recording": recording, "downloadUrl": ARCHIVE_URL,
              "downloadKind": "Author's publicly downloadable original WAV archive",
              "downloadSha256": ARCHIVE_SHA256, "downloadBytes": ARCHIVE_BYTES,
              "downloadDurationSeconds": metadata["durationSeconds"],
              "archiveSha256": ARCHIVE_SHA256, "originalSha256": sha256,
              "originalFilename": entry, "authorUrl": AUTHOR_URL,
              "licenseEvidenceUrl": SOURCE_URL,
              "archiveEntry": entry, "sourceSha256": sha256, "sourceBytes": size,
              "originalMetadata": metadata, "format": "FLAC", "durationSeconds": len(pcm) / rate,
              "channels": pcm.shape[1], "sampleRate": rate, "bytes": len(encoded),
              "sha256": digest(encoded), "changes": changes}
    audit.update({"preparedSignal": prepared, "gainDb": gain_db, "outputSubtype": subtype,
                  "resampled": rate != metadata["sampleRate"], "output": credit})
    return audit, credit


def main():
    if os.environ.get("CI") != "true" or os.environ.get("GITHUB_ACTIONS") != "true":
        raise SystemExit("Recording decoding and preparation are restricted to GitHub Actions CI")
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("asmr-prepared"))
    parser.add_argument("--cache", type=Path, default=Path(".asmr-source-cache"))
    parser.add_argument("--inspect-only", action="store_true")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    report = {"version": 1, "verifiedAt": datetime.now(timezone.utc).isoformat(),
              "mode": "inspect" if args.inspect_only else "prepare", "clips": [], "errors": [],
              "tools": {"python": platform.python_version(), "numpy": np.__version__,
                        "scipy": scipy.__version__, "soundfile": sf.__version__,
                        "libsndfile": sf.__libsndfile_version__},
              "limits": {"maximumBytesExclusive": 2_000_000, "maximumSecondsExclusive": 60,
                         "channels": [1, 2], "maximumPeak": 0.60004, "maximumAbsoluteDc": 0.02},
              "scope": "Signal and provenance checks only; no subjective audition or quality claim."}
    credits = []
    try:
        report["licenseEvidence"] = license_evidence(args.output)
        raw = archive_data(args.cache)
        report["archive"] = {"url": ARCHIVE_URL, "bytes": len(raw), "sha256": digest(raw)}
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            names = [item.filename for item in archive.infolist()]
            if len(set(names)) != len(names):
                raise ValueError("Archive has ambiguous duplicate entries")
            report["inventory"] = [{"entry": item.filename, "bytes": item.file_size}
                                   for item in archive.infolist()]
            for spec in CLIPS:
                try:
                    info = archive.getinfo(spec[2])
                    if info.file_size != spec[3] or info.flag_bits & 1:
                        raise ValueError("Invalid pinned ZIP entry")
                    audit, credit = prepare(archive.read(info), spec, args.output, args.inspect_only)
                    report["clips"].append(audit)
                    if credit:
                        credits.append(credit)
                    print(json.dumps({"id": spec[0], "metadata": audit["originalMetadata"],
                                      "output": credit}, allow_nan=False), flush=True)
                except Exception as error:
                    report["errors"].append({"id": spec[0], "error": str(error)})
    except Exception as error:
        report["errors"].append({"error": str(error)})
    report["outputBytes"] = sum(credit["bytes"] for credit in credits)
    if report["outputBytes"] > 6 * 1024 * 1024:
        report["errors"].append({"error": "Prepared assets exceed the combined 6 MiB budget"})
    report["passed"] = not report["errors"] and len(report["clips"]) == len(CLIPS)
    write_json(args.output / "source-audit.json", report)
    if report["passed"] and not args.inspect_only:
        write_json(args.output / "credits-additions.json", {
            "version": 1, "verifiedAt": report["verifiedAt"][:10],
            "notes": "Original WAV recordings from OwlishMedia's CC0 pack. No creator endorsement is implied.",
            "clips": credits})
    if not report["passed"]:
        print(json.dumps(report["errors"], indent=2), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
