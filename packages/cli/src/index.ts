#!/usr/bin/env node

const args = process.argv.slice(2);
const portArg = args.indexOf("--port");
const port = portArg !== -1 && args[portArg + 1] ? parseInt(args[portArg + 1]) : 7100;

process.env.CLAWCTL_PORT = String(port);

console.log(`
  ╭─────────────────────────────────╮
  │                                 │
  │   ClawCtl v0.1.0                │
  │   Multi-instance OpenClaw Mgmt  │
  │                                 │
  │   http://localhost:${String(port).padEnd(13)}│
  │                                 │
  ╰─────────────────────────────────╯
`);

// Start the server
import("@clawctl/server/src/index.js").catch(() => {
  // Fallback: run server directly
  import("../../server/src/index.js");
});

// Open browser after short delay
setTimeout(async () => {
  try {
    const open = await import("open");
    await open.default(`http://localhost:${port}`);
  } catch {
    // open is optional
  }
}, 1500);
