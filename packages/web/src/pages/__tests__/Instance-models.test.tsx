import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { Instance } from "../Instance";

function renderInstance() {
  return render(
    <MemoryRouter initialEntries={["/instance/inst-1?tab=llm"]}>
      <Routes>
        <Route path="/instance/:id" element={<Instance />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("Instance Models Tab — Key Management", () => {
  it("renders provider cards with names", async () => {
    renderInstance();
    await waitFor(() => {
      expect(screen.getByText("OpenAI")).toBeInTheDocument();
    });
  });

  it("displays masked keys", async () => {
    renderInstance();
    await waitFor(() => {
      expect(screen.getByText("sk-t...1234")).toBeInTheDocument();
      expect(screen.getByText("sk-n...5678")).toBeInTheDocument();
      expect(screen.getByText("sk-a...abcd")).toBeInTheDocument();
    });
  });

  it("shows valid/invalid status badges", async () => {
    renderInstance();
    await waitFor(() => {
      const validBadges = screen.getAllByText("Valid");
      expect(validBadges.length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText("Invalid")).toBeInTheDocument();
    });
  });

  it("shows email for valid keys", async () => {
    renderInstance();
    await waitFor(() => {
      expect(screen.getByText("kris@example.com")).toBeInTheDocument();
      expect(screen.getByText("team@company.com")).toBeInTheDocument();
    });
  });

  it("shows error message for invalid keys", async () => {
    renderInstance();
    await waitFor(() => {
      expect(screen.getByText("HTTP 401: unauthorized")).toBeInTheDocument();
    });
  });

  it("renders add key button for each provider", async () => {
    renderInstance();
    await waitFor(() => {
      const addButtons = screen.getAllByText(/Add Key/i);
      expect(addButtons.length).toBeGreaterThanOrEqual(2);
    });
  });
});
