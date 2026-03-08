import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sessions } from "../Sessions";

function renderSessions() {
  return render(
    <MemoryRouter>
      <Sessions />
    </MemoryRouter>
  );
}

describe("Sessions", () => {
  it("renders Sessions heading", () => {
    renderSessions();
    expect(screen.getByText("Sessions")).toBeInTheDocument();
  });

  it("shows session list after loading", async () => {
    renderSessions();
    await waitFor(() => {
      expect(screen.getByText("session-1")).toBeInTheDocument();
    });
  });

  it("shows filter input", () => {
    renderSessions();
    expect(screen.getByPlaceholderText("Filter by name, channel...")).toBeInTheDocument();
  });

  it("shows placeholder when no session selected", () => {
    renderSessions();
    expect(screen.getByText("Select a session to view details")).toBeInTheDocument();
  });
});
