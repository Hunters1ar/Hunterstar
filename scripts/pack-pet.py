"""Build the web companion assets. Requires Pillow: python -m pip install Pillow."""

import hashlib
import json
import math
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "frames"
OUTPUT = ROOT / "assets" / "pet"
WIDTH, HEIGHT = 384, 448
HEAD_WIDTH = 200
PADDING = 8
STATES = {
    "idle": ("idle", 1000),
    "walk": ("Walking", 150),
    "drag": ("Dragging", 180),
    "fall": ("falling", 160),
    "land": ("landed", 180),
    "jump": ("jumping", 160),
    "sit": ("Sitting", 1200),
    "think": ("Thinking", 1100),
    "dizzy": ("Dizzy", 220),
}


def save_versioned(image, name):
    # Hash the encoded bytes so changed frames get a new immutable URL.
    import io

    data = io.BytesIO()
    image.save(data, format="WEBP", quality=82, method=6)
    encoded = data.getvalue()
    filename = f"{name}.{hashlib.sha256(encoded).hexdigest()[:12]}.webp"
    (OUTPUT / filename).write_bytes(encoded)
    return {"src": f"/assets/pet/{filename}", "bytes": len(encoded)}


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    # Measured hair/head widths in source pixels, excluding limbs and effects.
    # Body bounding boxes change with a pose; head size tracks character scale.
    heads = json.loads((ROOT / "scripts" / "pet-heads.json").read_text(encoding="utf-8"))
    contacts = json.loads((ROOT / "scripts" / "pet-contacts.json").read_text(encoding="utf-8"))
    manifest = {"frameWidth": WIDTH, "frameHeight": HEIGHT, "animations": {}}
    original_bytes = 0
    for state, (folder, duration) in STATES.items():
        files = sorted((SOURCE / folder / "frames").glob("*.webp"))
        if not files:
            raise ValueError(f"Missing frames: {folder}")
        frames = []
        for path in files:
            original_bytes += path.stat().st_size
            with Image.open(path) as source:
                frame = source.convert("RGBA")
                bounds = frame.getchannel("A").getbbox()
                if not bounds:
                    raise ValueError(f"Empty frame: {path}")
                head_width = heads[state].get(path.stem)
                if not head_width:
                    raise ValueError(f"Measure head width for {path} in scripts/pet-heads.json")
                frames.append((frame.crop(bounds), HEAD_WIDTH / head_width))
        columns = min(4, len(frames))
        atlas = Image.new("RGBA", (columns * WIDTH, math.ceil(len(frames) / columns) * HEIGHT))
        tiles = []
        for index, (frame, scale) in enumerate(frames):
            resized = frame.resize((round(frame.width * scale), round(frame.height * scale)),
                                   Image.Resampling.LANCZOS)
            if resized.width > WIDTH - 2 * PADDING or resized.height > HEIGHT - 2 * PADDING:
                # Never silently shrink an individual pose and recreate size jumps.
                raise ValueError(f"{files[index]} exceeds the cell; increase the shared cell size")
            tile = Image.new("RGBA", (WIDTH, HEIGHT))
            tile.alpha_composite(resized, ((WIDTH - resized.width) // 2, HEIGHT - PADDING - resized.height))
            atlas.alpha_composite(tile, ((index % columns) * WIDTH, (index // columns) * HEIGHT))
            tiles.append(tile)
        entry = save_versioned(atlas, state)
        entry.update({"frames": len(frames), "columns": columns, "frameMs": duration})
        if len(contacts[state]) != len(tiles):
            raise ValueError(f"Measure a contact point for each {state} frame")
        entry["geometry"] = []
        for tile, (foot_x, foot_y) in zip(tiles, contacts[state]):
            # Opaque sprite bounds exclude the transparent cell padding.
            box = tile.getchannel("A").point(lambda alpha: 255 if alpha >= 32 else 0).getbbox()
            entry["geometry"].append({"footX": foot_x / WIDTH, "footY": foot_y / HEIGHT,
                                      "body": [box[0] / WIDTH, box[1] / HEIGHT,
                                               box[2] / WIDTH, box[3] / HEIGHT]})
        manifest["animations"][state] = entry
        if state == "idle":
            manifest["boot"] = save_versioned(tiles[0], "boot")
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    total = sum(item["bytes"] for item in manifest["animations"].values()) + manifest["boot"]["bytes"]
    initial = manifest["boot"]["bytes"] + manifest["animations"]["idle"]["bytes"]
    print(f"Source: {original_bytes / 1024:.1f} KiB; packed: {total / 1024:.1f} KiB; boot + idle: {initial / 1024:.1f} KiB")


if __name__ == "__main__":
    main()
