import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Config } from "../Config";

describe("Config", () => {
  it("renders Config Management heading", () => {
    render(<MemoryRouter><Config /></MemoryRouter>);
    expect(screen.getByText("Config Management")).toBeInTheDocument();
  });

  it("shows instance selectors for diff", async () => {
    render(<MemoryRouter><Config /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText("Instance A")).toBeInTheDocument();
      expect(screen.getByText("Instance B")).toBeInTheDocument();
    });
  });

  it("shows skill comparison table after loading", async () => {
    render(<MemoryRouter><Config /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText("Skill Comparison")).toBeInTheDocument();
    });
  });
});
