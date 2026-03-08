import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Dashboard } from "../Dashboard";
import { AuthContext } from "../../hooks/useAuth";

const mockAuth = {
  user: { userId: 1, username: "admin", role: "admin" as const },
  loading: false,
  needsSetup: false,
  login: async () => {},
  setup: async () => {},
  logout: async () => {},
};

function renderDashboard() {
  return render(
    <AuthContext.Provider value={mockAuth}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </AuthContext.Provider>
  );
}

describe("Dashboard", () => {
  it("renders Dashboard heading", () => {
    renderDashboard();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });

  it("shows instance cards after loading", async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("Lark")).toBeInTheDocument();
      expect(screen.getByText("Feishu")).toBeInTheDocument();
    });
  });

  it("shows summary stats", async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("Instances")).toBeInTheDocument();
      expect(screen.getByText("Active Sessions")).toBeInTheDocument();
      expect(screen.getByText("Agents")).toBeInTheDocument();
      expect(screen.getByText("Critical Issues")).toBeInTheDocument();
    });
  });

  it("opens add instance dialog on button click", async () => {
    const user = userEvent.setup();
    renderDashboard();
    await waitFor(() => expect(screen.getByText("Lark")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Add Instance/i }));
    expect(screen.getByText("Remote Instance")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("ws://host:18789")).toBeInTheDocument();
  });

  it("shows channel badges on instance cards", async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getAllByText("feishu")).toHaveLength(2);
    });
  });
});
