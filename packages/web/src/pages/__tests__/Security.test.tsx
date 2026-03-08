import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Security } from "../Security";

describe("Security", () => {
  it("renders Security Posture heading", () => {
    render(<MemoryRouter><Security /></MemoryRouter>);
    expect(screen.getByText("Security Posture")).toBeInTheDocument();
  });

  it("shows severity summary cards", async () => {
    render(<MemoryRouter><Security /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText("Critical")).toBeInTheDocument();
      expect(screen.getByText("Warnings")).toBeInTheDocument();
      expect(screen.getByText("Info")).toBeInTheDocument();
    });
  });

  it("shows agent permissions table", async () => {
    render(<MemoryRouter><Security /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText("Agent Permissions")).toBeInTheDocument();
      expect(screen.getByText("Instance")).toBeInTheDocument();
      expect(screen.getByText("Agent")).toBeInTheDocument();
      expect(screen.getByText("Risk")).toBeInTheDocument();
    });
  });
});
