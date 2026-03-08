import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Login } from "../Login";
import { AuthContext } from "../../hooks/useAuth";

function renderLogin(overrides: Partial<{
  needsSetup: boolean;
  login: (...args: any[]) => Promise<void>;
  setup: (...args: any[]) => Promise<void>;
}> = {}) {
  const auth = {
    user: null,
    loading: false,
    needsSetup: overrides.needsSetup ?? false,
    login: overrides.login ?? vi.fn(),
    setup: overrides.setup ?? vi.fn(),
    logout: vi.fn(),
  };
  return render(
    <AuthContext.Provider value={auth}>
      <Login />
    </AuthContext.Provider>
  );
}

describe("Login page", () => {
  it("shows setup message when needsSetup is true", () => {
    renderLogin({ needsSetup: true });
    expect(screen.getByText("Create your admin account to get started")).toBeInTheDocument();
  });

  it("shows sign in message when needsSetup is false", () => {
    renderLogin({ needsSetup: false });
    expect(screen.getByText("Sign in to continue")).toBeInTheDocument();
  });

  it("renders username and password inputs", () => {
    renderLogin();
    expect(screen.getByText("Username")).toBeInTheDocument();
    expect(screen.getByText("Password")).toBeInTheDocument();
  });

  it("shows 'Create Admin Account' button in setup mode", () => {
    renderLogin({ needsSetup: true });
    expect(screen.getByRole("button", { name: "Create Admin Account" })).toBeInTheDocument();
  });

  it("shows 'Sign In' button in login mode", () => {
    renderLogin({ needsSetup: false });
    expect(screen.getByRole("button", { name: "Sign In" })).toBeInTheDocument();
  });

  it("submit button is disabled when fields are empty", () => {
    renderLogin();
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
  });

  it("shows password hint in setup mode", () => {
    renderLogin({ needsSetup: true });
    expect(screen.getByText("Minimum 6 characters")).toBeInTheDocument();
  });

  it("shows ClawCtl heading", () => {
    renderLogin();
    expect(screen.getByRole("heading", { name: "ClawCtl" })).toBeInTheDocument();
  });
});
