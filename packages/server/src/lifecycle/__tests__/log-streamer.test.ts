import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// LogStreamer — pending implementation (skipped)
// ---------------------------------------------------------------------------

describe.skip("LogStreamer (pending implementation)", () => {
  it("emits 'line' events for each line from a local tail -f process", () => {});
  it("emits 'line' events for data received from a remote SSH tail -f stream", () => {});
  it("stop() kills the spawned process and emits 'close'", () => {});
  it("filters lines when filter option is provided, emitting only matching lines", () => {});
});

// ---------------------------------------------------------------------------
// execStream for log tailing — tests the actual inline streaming implementation
// ---------------------------------------------------------------------------

describe("execStream for log tailing", () => {
  it("yields chunks from tail command", async () => {
    // Test that LocalExec.execStream works with a simple echo command
    const { LocalExec } = await import("../../executor/local.js");
    const exec = new LocalExec();
    const chunks: string[] = [];
    for await (const chunk of exec.execStream("echo line1; echo line2")) {
      chunks.push(chunk);
    }
    const combined = chunks.join("");
    expect(combined).toContain("line1");
    expect(combined).toContain("line2");
  });
});
