import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "../Sidebar";

function renderSidebar(collapsed = false) {
  return render(
    <MemoryRouter>
      <Sidebar collapsed={collapsed} onToggle={() => {}} />
    </MemoryRouter>
  );
}

describe("Sidebar", () => {
  it("renders all 7 nav items plus Settings", () => {
    renderSidebar();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Sessions")).toBeInTheDocument();
    expect(screen.getByText("Usage")).toBeInTheDocument();
    expect(screen.getByText("Security")).toBeInTheDocument();
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("Tools")).toBeInTheDocument();
    expect(screen.getByText("Operations")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("hides labels when collapsed", () => {
    renderSidebar(true);
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
  });

  it("shows ClawCtl brand when expanded", () => {
    renderSidebar();
    expect(screen.getByText("Claw")).toBeInTheDocument();
    expect(screen.getByText("Ctl")).toBeInTheDocument();
  });
});
