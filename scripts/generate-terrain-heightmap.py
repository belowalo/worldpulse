"""Build local WorldPulse terrain maps from free Mapzen/AWS tiles."""

from __future__ import annotations

import io
import math
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image


ZOOM = 3
TILE_SIZE = 256
TILE_COUNT = 1 << ZOOM
OUTPUT_WIDTH = TILE_COUNT * TILE_SIZE
OUTPUT_HEIGHT = OUTPUT_WIDTH // 2
MAX_ELEVATION_METERS = 9000.0
TILE_URL = (
    "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/"
    "{z}/{x}/{y}.png"
)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = PROJECT_ROOT / "public" / "terrain-height.png"
NORMAL_OUTPUT_PATH = PROJECT_ROOT / "public" / "terrain-normal.png"
NORMAL_WIDTH = OUTPUT_WIDTH // 2
NORMAL_HEIGHT = OUTPUT_HEIGHT // 2
NORMAL_STRENGTH = 90.0


def fetch_tile(x: int, y: int) -> tuple[int, int, np.ndarray]:
    url = TILE_URL.format(z=ZOOM, x=x, y=y)
    request = Request(url, headers={"User-Agent": "WorldPulse terrain builder"})
    with urlopen(request, timeout=30) as response:
        data = response.read()
    image = Image.open(io.BytesIO(data)).convert("RGB")
    return x, y, np.asarray(image, dtype=np.uint8)


def build_heightmap() -> None:
    mosaic = np.empty(
        (TILE_COUNT * TILE_SIZE, TILE_COUNT * TILE_SIZE, 3),
        dtype=np.uint8,
    )
    coordinates = [
        (x, y) for y in range(TILE_COUNT) for x in range(TILE_COUNT)
    ]
    with ThreadPoolExecutor(max_workers=8) as executor:
        for x, y, tile in executor.map(lambda pair: fetch_tile(*pair), coordinates):
            top = y * TILE_SIZE
            left = x * TILE_SIZE
            mosaic[top : top + TILE_SIZE, left : left + TILE_SIZE] = tile

    red = mosaic[:, :, 0].astype(np.float32)
    green = mosaic[:, :, 1].astype(np.float32)
    blue = mosaic[:, :, 2].astype(np.float32)
    mercator_elevation = red * 256.0 + green + blue / 256.0 - 32768.0

    latitudes = 90.0 - (
        (np.arange(OUTPUT_HEIGHT, dtype=np.float64) + 0.5)
        / OUTPUT_HEIGHT
        * 180.0
    )
    clamped_latitudes = np.clip(latitudes, -85.05112878, 85.05112878)
    radians = np.radians(clamped_latitudes)
    mercator_y = (
        0.5
        - np.log((1.0 + np.sin(radians)) / (1.0 - np.sin(radians)))
        / (4.0 * math.pi)
    )
    source_y = np.clip(
        mercator_y * mercator_elevation.shape[0] - 0.5,
        0,
        mercator_elevation.shape[0] - 1,
    )
    row_before = np.floor(source_y).astype(np.int32)
    row_after = np.minimum(row_before + 1, mercator_elevation.shape[0] - 1)
    blend = (source_y - row_before).astype(np.float32)[:, None]
    elevation = (
        mercator_elevation[row_before] * (1.0 - blend)
        + mercator_elevation[row_after] * blend
    )
    elevation[np.abs(latitudes) > 85.05112878] = 0

    land_elevation = np.clip(elevation, 0, MAX_ELEVATION_METERS)
    encoded = np.rint(land_elevation / MAX_ELEVATION_METERS * 255.0).astype(
        np.uint8
    )
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(encoded, mode="L").save(OUTPUT_PATH, optimize=True)

    normal_height = Image.fromarray(
        land_elevation.astype(np.float32),
        mode="F",
    ).resize(
        (NORMAL_WIDTH, NORMAL_HEIGHT),
        Image.Resampling.BILINEAR,
    )
    normalized_height = np.asarray(normal_height) / MAX_ELEVATION_METERS
    gradient_y, gradient_x = np.gradient(normalized_height)
    normal_latitudes = 90.0 - (
        (np.arange(NORMAL_HEIGHT, dtype=np.float64) + 0.5)
        / NORMAL_HEIGHT
        * 180.0
    )
    latitude_scale = np.maximum(
        np.cos(np.radians(normal_latitudes)).astype(np.float32),
        0.2,
    )[:, None]
    normal_x = -(gradient_x / latitude_scale) * NORMAL_STRENGTH
    normal_y = -gradient_y * NORMAL_STRENGTH
    normal_z = np.ones_like(normal_x)
    normal_length = np.sqrt(
        normal_x * normal_x + normal_y * normal_y + normal_z * normal_z
    )
    normal_map = np.stack(
        (
            normal_x / normal_length,
            normal_y / normal_length,
            normal_z / normal_length,
        ),
        axis=-1,
    )
    normal_encoded = np.rint((normal_map * 0.5 + 0.5) * 255.0).astype(
        np.uint8
    )
    Image.fromarray(normal_encoded, mode="RGB").save(
        NORMAL_OUTPUT_PATH,
        optimize=True,
    )
    print(
        f"Wrote {OUTPUT_PATH} ({OUTPUT_WIDTH}x{OUTPUT_HEIGHT}, "
        f"{os.path.getsize(OUTPUT_PATH):,} bytes)"
    )
    print(
        f"Wrote {NORMAL_OUTPUT_PATH} ({NORMAL_WIDTH}x{NORMAL_HEIGHT}, "
        f"{os.path.getsize(NORMAL_OUTPUT_PATH):,} bytes)"
    )


if __name__ == "__main__":
    build_heightmap()
