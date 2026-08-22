import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorldDiagnostics } from "@/components/world-diagnostics";
import type { WorldPulseDiagnostics } from "@/lib/types";

afterEach(() => vi.restoreAllMocks());

describe("world diagnostics", () => {
  it("shows freshness, coverage, payload, and provider health and can refresh", async () => {
    const health: WorldPulseDiagnostics = {
      status: "healthy",
      fresh: true,
      generatedAt: new Date().toISOString(),
      snapshotGeneratedAt: new Date().toISOString(),
      snapshotBytes: 420_000,
      totalCountries: 215,
      countriesWithNews: 212,
      inhabitedCountries: 212,
      inhabitedCountriesWithNews: 212,
      missingInhabitedCountries: [],
      expectedEmptyCountries: ["Fr. S. Antarctic Lands"],
      globalEventCount: 28,
      providerHealth: [{ name: "Africanews", status: "ok", articleCount: 12 }],
    };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(health));
    vi.stubGlobal("fetch", fetchMock);

    render(<WorldDiagnostics />);

    expect(await screen.findByText("212/212")).toBeInTheDocument();
    expect(screen.getByText("Direct D1")).toBeInTheDocument();
    expect(screen.getByText("Africanews")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Check now" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
