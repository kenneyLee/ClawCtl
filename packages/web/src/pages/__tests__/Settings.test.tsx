import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Settings } from "../Settings";
import { AuthContext } from "../../hooks/useAuth";

const mockAuth = {
  user: { userId: 1, username: "admin", role: "admin" as const },
  loading: false,
  needsSetup: false,
  login: vi.fn(),
  setup: vi.fn(),
  logout: vi.fn(),
};

function renderSettings() {
  return render(
    <AuthContext.Provider value={mockAuth}>
      <MemoryRouter><Settings /></MemoryRouter>
    </AuthContext.Provider>
  );
}

describe("Settings", () => {
  it("renders Settings heading", () => {
    renderSettings();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("shows LLM Configuration section", () => {
    renderSettings();
    expect(screen.getByText("LLM Configuration")).toBeInTheDocument();
  });

  it("shows provider selector with 3 options", () => {
    renderSettings();
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByText("Anthropic")).toBeInTheDocument();
    expect(screen.getByText("Ollama (local)")).toBeInTheDocument();
  });

  it("hides API key field when Ollama selected", async () => {
    const user = userEvent.setup();
    renderSettings();
    const select = screen.getByDisplayValue("OpenAI");
    await user.selectOptions(select, "ollama");
    expect(screen.queryByText("API Key")).not.toBeInTheDocument();
  });

  it("shows save button", () => {
    renderSettings();
    expect(screen.getByText("Save")).toBeInTheDocument();
  });
});
