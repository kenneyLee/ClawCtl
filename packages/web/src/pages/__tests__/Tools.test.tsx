import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Tools } from "../Tools";

describe("Tools", () => {
  it("renders Tool Diagnostics heading", () => {
    render(<MemoryRouter><Tools /></MemoryRouter>);
    expect(screen.getByText("Tool Diagnostics")).toBeInTheDocument();
  });

  it("shows diagnostic wizard", () => {
    render(<MemoryRouter><Tools /></MemoryRouter>);
    expect(screen.getByText("Diagnostic Wizard")).toBeInTheDocument();
  });

  it("shows tool matrix after loading", async () => {
    render(<MemoryRouter><Tools /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText("Tool Availability Matrix")).toBeInTheDocument();
    });
  });

  it("shows instance selector in diagnostic wizard", async () => {
    render(<MemoryRouter><Tools /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText("Instance")).toBeInTheDocument();
      expect(screen.getByText("Agent")).toBeInTheDocument();
    });
  });
});
