import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorldPulseApp } from "@/components/world-pulse-app";

describe("WorldPulse interactions", () => {
  it("opens the selected country's event panel", () => {
    render(<WorldPulseApp />);
    expect(screen.getByRole("heading", { name: "Canada" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Japan" }));
    expect(screen.getByRole("heading", { name: "Japan" })).toBeInTheDocument();
    expect(
      screen.getByText("Deep-ocean sensor network begins public data release"),
    ).toBeInTheDocument();
  });

  it("filters the visible events by search", () => {
    render(<WorldPulseApp />);
    fireEvent.click(screen.getByRole("button", { name: "Global feed" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search news" }), {
      target: { value: "vaccine" },
    });
    expect(
      screen.getByText("West African vaccine facility completes validation run"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Pacific nations agree accelerated coastal resilience plan",
      ),
    ).not.toBeInTheDocument();
  });
});
