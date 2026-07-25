import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorldPulseApp } from "@/components/world-pulse-app";
import type { WorldMapProps } from "@/components/world-map";
import { countryPulses } from "@/lib/seed-data";

function TestMap({ onSelect }: WorldMapProps) {
  const japan = countryPulses.find((country) => country.iso2 === "JP");
  return (
    <>
      <button type="button" onClick={() => japan && onSelect(japan)}>
        Select Japan on map
      </button>
      <button
        type="button"
        onClick={() =>
          onSelect({ mapId: "country-184", name: "Spain", events: [] })
        }
      >
        Select Spain on map
      </button>
    </>
  );
}

describe("WorldPulse interactions", () => {
  it("opens the selected country's event panel", () => {
    render(<WorldPulseApp MapComponent={TestMap} liveUpdates={false} />);
    expect(screen.getByRole("heading", { name: "Canada" })).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Select Japan on map" }),
    );
    expect(screen.getByRole("heading", { name: "Japan" })).toBeInTheDocument();
  });

  it("filters the visible events by search", () => {
    render(<WorldPulseApp liveUpdates={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Global feed" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search news" }), {
      target: { value: "vaccine" },
    });
    expect(screen.getByText("No matching events")).toBeInTheDocument();
  });

  it("opens every mapped country even when no seed news is available", () => {
    render(<WorldPulseApp MapComponent={TestMap} liveUpdates={false} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Select Spain on map" }),
    );
    expect(screen.getByRole("heading", { name: "Spain" })).toBeInTheDocument();
    expect(
      screen.getByText("No indexed news for Spain"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Japan" }),
    ).not.toBeInTheDocument();
  });
});
