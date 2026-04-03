import fs from "fs";
import path from "path";
import os from "os";
import type { GatewayConnection } from "../gateway/types.js";

export function discoverLocalInstances(): GatewayConnection[] {
  const home = os.homedir();
  const results: GatewayConnection[] = [];

  try {
    const entries = fs.readdirSync(home);
    for (const entry of entries) {
      if (!entry.startsWith(".openclaw")) continue;
      const configPath = path.join(home, entry, "openclaw.json");
      if (!fs.existsSync(configPath)) continue;

      try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        const port = config?.gateway?.port || 18789;
        const profileName = entry === ".openclaw" ? "default" : entry.replace(".openclaw-", "");

        results.push({
          id: `local-${profileName}`,
          url: `ws://127.0.0.1:${port}`,
          token: config?.gateway?.auth?.token,
          label: profileName,
          configDir: path.join(home, entry),
          status: "disconnected",
        });
      } catch { /* skip malformed config */ }
    }
  } catch { /* skip if home not readable */ }

  return results;
}
