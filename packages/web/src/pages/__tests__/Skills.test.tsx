import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Skills } from "../Skills";

function renderSkills() {
  return render(
    <MemoryRouter>
      <Skills />
    </MemoryRouter>
  );
}

describe("Skills", () => {
  it("renders the page title", async () => {
    renderSkills();
    expect(screen.getByText("Skill Market")).toBeInTheDocument();
  });

  it("renders search input", () => {
    renderSkills();
    expect(screen.getByPlaceholderText("Search skills...")).toBeInTheDocument();
  });

  it("renders category filter dropdown", () => {
    renderSkills();
    expect(screen.getByText("All Categories")).toBeInTheDocument();
  });

  it("renders Scene Templates section after data loads", async () => {
    renderSkills();
    await waitFor(() => {
      expect(screen.getByText("Scene Templates")).toBeInTheDocument();
    });
  });

  it("renders template cards from API", async () => {
    renderSkills();
    await waitFor(() => {
      expect(screen.getByText("Engineering")).toBeInTheDocument();
    });
  });

  it("renders skills grid after data loads", async () => {
    renderSkills();
    await waitFor(() => {
      expect(screen.getByText("github")).toBeInTheDocument();
      expect(screen.getByText("notion")).toBeInTheDocument();
    });
  });

  it("shows skill count in All Skills heading", async () => {
    renderSkills();
    await waitFor(() => {
      expect(screen.getByText("All Skills (2)")).toBeInTheDocument();
    });
  });

  it("renders category labels from API data", async () => {
    renderSkills();
    await waitFor(() => {
      // Category appears in both the dropdown and skill card badges
      expect(screen.getAllByText("Development").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Productivity").length).toBeGreaterThanOrEqual(1);
    });
  });
});
