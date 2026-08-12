import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/terrain/[z]/[x]/[y]/route";

describe("terrain tile route", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("proxies an immutable Mapzen terrain tile", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { "Content-Type": "image/png" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("https://worldpulse.test"), {
      params: Promise.resolve({ z: "3", x: "4", y: "2" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toContain("immutable");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/3/4/2.png",
    );
  });

  it("rejects invalid tile coordinates without contacting the upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("https://worldpulse.test"), {
      params: Promise.resolve({ z: "16", x: "0", y: "0" }),
    });

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
