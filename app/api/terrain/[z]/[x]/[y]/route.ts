const TERRAIN_TILE_ORIGIN =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const MAX_TERRAIN_LEVEL = 15;
const IMMUTABLE_YEAR_SECONDS = 31_536_000;

interface TerrainRouteContext {
  params: Promise<{ x: string; y: string; z: string }>;
}

function parseTileCoordinate(value: string) {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export async function GET(
  _request: Request,
  { params }: TerrainRouteContext,
) {
  const route = await params;
  const z = parseTileCoordinate(route.z);
  const x = parseTileCoordinate(route.x);
  const y = parseTileCoordinate(route.y);

  if (z == null || x == null || y == null || z > MAX_TERRAIN_LEVEL) {
    return new Response("Terrain tile not found", { status: 404 });
  }

  const tileCount = 2 ** z;
  if (x >= tileCount || y >= tileCount) {
    return new Response("Terrain tile not found", { status: 404 });
  }

  const upstream = await fetch(`${TERRAIN_TILE_ORIGIN}/${z}/${x}/${y}.png`);
  if (!upstream.ok || !upstream.body) {
    return new Response("Terrain tile unavailable", {
      status: upstream.status === 404 ? 404 : 502,
    });
  }

  return new Response(upstream.body, {
    headers: {
      "Cache-Control": `public, max-age=${IMMUTABLE_YEAR_SECONDS}, immutable`,
      "Content-Type": "image/png",
    },
  });
}
