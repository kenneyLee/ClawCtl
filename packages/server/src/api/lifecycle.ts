import { Hono } from "hono";
import { stream } from "hono/streaming";
import type Database from "better-sqlite3";
import type { HostStore } from "../hosts/store.js";
import type { InstanceManager } from "../instances/manager.js";
import { requireWrite } from "../auth/middleware.js";
import { auditLog } from "../audit.js";
import { getExecutor, getHostExecutor } from "../executor/factory.js";
import { getProcessStatus, stopProcess, startProcess, restartProcess } from "../lifecycle/service.js";
import { checkNodeVersion, getVersions, streamInstall } from "../lifecycle/install.js";
import { readRemoteConfig, writeRemoteConfig, getConfigDir, profileFromInstanceId } from "../lifecycle/config.js";
import { SnapshotStore } from "../lifecycle/snapshot.js";
import { extractModels, mergeAgentConfig, removeAgent } from "../lifecycle/agent-config.js";

const VERSION_CACHE_TTL = 60_000; // 60s
const versionCache = new Map<string, { data: any; time: number }>();

export function lifecycleRoutes(hostStore: HostStore, manager: InstanceManager, db: Database.Database) {
  const app = new Hono();
  const snapshots = new SnapshotStore(db);
  snapshots.init();

  // All lifecycle writes require "lifecycle" permission (admin + operator, not auditor)
  app.use("*", requireWrite("lifecycle"));

  // --- Service control ---

  app.get("/:id/status", async (c) => {
    const id = c.req.param("id");
    const inst = manager.get(id);
    if (!inst) return c.json({ error: "instance not found" }, 404);

    // WebSocket connection is the most reliable signal
    if (inst.connection.status === "connected") {
      return c.json({ running: true, source: "websocket" });
    }

    // Fallback: try SSH lsof (only useful for local instances or when WS is down)
    try {
      const port = parsePortFromInstance(inst);
      const exec = getExecutor(id, hostStore);
      const status = await getProcessStatus(exec, port);
      return c.json(status);
    } catch {
      return c.json({ running: false });
    }
  });

  app.post("/:id/stop", async (c) => {
    const id = c.req.param("id");
    const inst = manager.get(id);
    if (!inst) return c.json({ error: "instance not found" }, 404);
    const port = parsePortFromInstance(inst);
    const exec = getExecutor(id, hostStore);
    const status = await getProcessStatus(exec, port);
    if (!status.running || !status.pid) return c.json({ error: "not running" }, 400);
    try {
      await stopProcess(exec, status.pid);
      auditLog(db, c, "lifecycle.stop", `Stopped PID ${status.pid}`, id);
      return c.json({ ok: true });
    } catch (err: any) {
      auditLog(db, c, "lifecycle.stop", `FAILED to stop PID ${status.pid}: ${err.message}`, id);
      return c.json({ error: err.message }, 500);
    }
  });

  app.post("/:id/start", async (c) => {
    const id = c.req.param("id");
    const inst = manager.get(id);
    if (!inst) return c.json({ error: "instance not found" }, 404);
    const port = parsePortFromInstance(inst);
    const profile = profileFromInstanceId(id);
    const configDir = getConfigDir(profile);
    const exec = getExecutor(id, hostStore);
    try {
      await startProcess(exec, configDir, port);
      auditLog(db, c, "lifecycle.start", `Started on port ${port}`, id);
      return c.json({ ok: true });
    } catch (err: any) {
      auditLog(db, c, "lifecycle.start", `FAILED to start on port ${port}: ${err.message}`, id);
      return c.json({ error: err.message }, 500);
    }
  });

  app.post("/:id/restart", async (c) => {
    const id = c.req.param("id");
    const inst = manager.get(id);
    if (!inst) return c.json({ error: "instance not found" }, 404);
    const port = parsePortFromInstance(inst);
    const profile = profileFromInstanceId(id);
    const configDir = getConfigDir(profile);
    const exec = getExecutor(id, hostStore);
    try {
      await restartProcess(exec, configDir, port, profile);
      auditLog(db, c, "lifecycle.restart", `Restarted on port ${port}`, id);
      return c.json({ ok: true });
    } catch (err: any) {
      auditLog(db, c, "lifecycle.restart", `FAILED to restart on port ${port}: ${err.message}`, id);
      return c.json({ error: err.message }, 500);
    }
  });

  // --- Config ---

  app.get("/:id/config-file", async (c) => {
    const id = c.req.param("id");
    if (!manager.get(id)) return c.json({ error: "instance not found" }, 404);
    const profile = profileFromInstanceId(id);
    const configDir = getConfigDir(profile);
    const exec = getExecutor(id, hostStore);
    try {
      const config = await readRemoteConfig(exec, configDir);
      return c.json(config);
    } catch (err: any) {
      return c.json({ error: `Failed to read config: ${err.message}` }, 500);
    }
  });

  app.put("/:id/config-file", async (c) => {
    const id = c.req.param("id");
    if (!manager.get(id)) return c.json({ error: "instance not found" }, 404);
    const profile = profileFromInstanceId(id);
    const configDir = getConfigDir(profile);
    const exec = getExecutor(id, hostStore);
    const body = await c.req.json();
    try {
      await writeRemoteConfig(exec, configDir, body);
      auditLog(db, c, "lifecycle.config-write", "Config updated", id);
      return c.json({ ok: true });
    } catch (err: any) {
      auditLog(db, c, "lifecycle.config-write", `FAILED: ${err.message}`, id);
      return c.json({ error: err.message }, 500);
    }
  });

  // --- Agent config (structured) ---

  app.get("/:id/models", async (c) => {
    const id = c.req.param("id");
    if (!manager.get(id)) return c.json({ error: "instance not found" }, 404);
    const profile = profileFromInstanceId(id);
    const configDir = getConfigDir(profile);
    const exec = getExecutor(id, hostStore);
    const config = await readRemoteConfig(exec, configDir);
    return c.json(extractModels(config));
  });

  app.put("/:id/agents", async (c) => {
    const id = c.req.param("id");
    if (!manager.get(id)) return c.json({ error: "instance not found" }, 404);
    const profile = profileFromInstanceId(id);
    const configDir = getConfigDir(profile);
    const exec = getExecutor(id, hostStore);
    const payload = await c.req.json();
    try {
      const config = await readRemoteConfig(exec, configDir);
      const merged = mergeAgentConfig(config, payload);
      await writeRemoteConfig(exec, configDir, merged);
      try { snapshots.create(id, JSON.stringify(merged), "agent config update"); } catch { /* snapshot is best-effort */ }
      auditLog(db, c, "lifecycle.agent-config", "Agent config updated", id);
      return c.json({ ok: true });
    } catch (err: any) {
      auditLog(db, c, "lifecycle.agent-config", `FAILED: ${err.message}`, id);
      return c.json({ error: err.message }, 500);
    }
  });

  app.delete("/:id/agents/:agentId", async (c) => {
    const id = c.req.param("id");
    if (!manager.get(id)) return c.json({ error: "instance not found" }, 404);
    const profile = profileFromInstanceId(id);
    const configDir = getConfigDir(profile);
    const exec = getExecutor(id, hostStore);
    const config = await readRemoteConfig(exec, configDir);
    const agentId = c.req.param("agentId");
    try {
      const updated = removeAgent(config, agentId);
      await writeRemoteConfig(exec, configDir, updated);
      snapshots.create(id, JSON.stringify(updated), "agent config update");
      auditLog(db, c, "lifecycle.agent-delete", `Deleted agent ${agentId}`, id);
      return c.json({ ok: true });
    } catch (err: any) {
      if (err.message.includes("not found")) {
        return c.json({ error: err.message }, 404);
      }
      return c.json({ error: err.message }, 500);
    }
  });

  // --- Available versions (fetched locally, not from remote host) ---

  const availableVersionsCache: { data: any; time: number } = { data: null, time: 0 };

  app.get("/available-versions", async (c) => {
    if (availableVersionsCache.data && Date.now() - availableVersionsCache.time < VERSION_CACHE_TTL) {
      return c.json(availableVersionsCache.data);
    }
    try {
      const res = await fetch("https://registry.npmjs.org/openclaw");
      if (res.ok) {
        const pkg = await res.json() as any;
        const distTags = pkg["dist-tags"] || {};
        // Get all versions, filter to recent stable releases (no pre-release tags)
        const allVersions: string[] = Object.keys(pkg.versions || {});
        const stableVersions = allVersions
          .filter((v) => !v.includes("-"))
          .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
          .slice(0, 10);
        const data = { distTags, versions: stableVersions };
        availableVersionsCache.data = data;
        availableVersionsCache.time = Date.now();
        return c.json(data);
      }
    } catch { /* fallback */ }
    // Fallback: use local npm
    const { LocalExec } = await import("../executor/local.js");
    const local = new LocalExec();
    const [tagsR, versR] = await Promise.all([
      local.exec("npm view openclaw dist-tags --json 2>/dev/null"),
      local.exec("npm view openclaw versions --json 2>/dev/null"),
    ]);
    const distTags = tagsR.exitCode === 0 ? JSON.parse(tagsR.stdout.trim()) : {};
    let versions: string[] = [];
    if (versR.exitCode === 0) {
      try {
        const all: string[] = JSON.parse(versR.stdout.trim());
        versions = all.filter((v) => !v.includes("-")).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).slice(0, 10);
      } catch { /* ignore */ }
    }
    const data = { distTags, versions };
    availableVersionsCache.data = data;
    availableVersionsCache.time = Date.now();
    return c.json(data);
  });

  // --- Install/Upgrade (host-level) ---

  app.get("/host/:hostId/versions", async (c) => {
    const hostId = c.req.param("hostId") === "local" ? "local" as const : parseInt(c.req.param("hostId"));
    const cacheKey = String(hostId);
    const cached = versionCache.get(cacheKey);
    if (cached && Date.now() - cached.time < VERSION_CACHE_TTL) {
      return c.json(cached.data);
    }
    const exec = getHostExecutor(hostId, hostStore);
    const [node, versions] = await Promise.all([checkNodeVersion(exec), getVersions(exec)]);
    const data = { node, openclaw: versions };
    versionCache.set(cacheKey, { data, time: Date.now() });
    return c.json(data);
  });

  app.post("/host/:hostId/install", async (c) => {
    const hostId = c.req.param("hostId") === "local" ? "local" as const : parseInt(c.req.param("hostId"));
    const { version } = await c.req.json().catch(() => ({ version: undefined }));
    const exec = getHostExecutor(hostId, hostStore);

    return stream(c, async (s) => {
      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");

      const emit = async (step: { step: string; status: string; detail?: string }) => {
        await s.write(`data: ${JSON.stringify(step)}\n\n`);
      };

      const success = await streamInstall(exec, emit, version);
      auditLog(db, c, "lifecycle.install", `${success ? "Installed" : "Install failed"} openclaw${version ? `@${version}` : ""}`, String(hostId));
      await s.write(`data: ${JSON.stringify({ done: true, success })}\n\n`);
    });
  });

  // --- Logs (SSE stream) ---

  app.get("/:id/logs", async (c) => {
    const id = c.req.param("id");
    if (!manager.get(id)) return c.json({ error: "instance not found" }, 404);
    const profile = profileFromInstanceId(id);
    const configDir = getConfigDir(profile);
    const exec = getExecutor(id, hostStore);
    const lines = c.req.query("lines") || "100";

    // Detect the best log source: file first, then journalctl
    const probe = await exec.exec(
      `test -f "${configDir}/gateway.log" && echo "file" || (command -v journalctl >/dev/null 2>&1 && echo "journal" || echo "none")`
    );
    const source = probe.stdout.trim();

    let cmd: string;
    if (source === "file") {
      cmd = `tail -n ${lines} -f "${configDir}/gateway.log"`;
    } else if (source === "journal") {
      // Discover the actual systemd unit name — try both system and user level
      const profileSuffix = profile === "default" ? "" : `-${profile}`;
      const svcName = `openclaw-gateway${profileSuffix}`;
      // Check user-level first (more common for openclaw), then system-level
      const probeJ = await exec.exec(
        `journalctl --user -u ${svcName}.service -n 1 -q --no-pager 2>/dev/null | grep -c .`
      );
      const isUserUnit = parseInt(probeJ.stdout.trim()) > 0;
      if (isUserUnit) {
        cmd = `journalctl --user -u ${svcName}.service -n ${lines} -f -q --no-pager`;
      } else {
        // Try system-level
        const probeS = await exec.exec(
          `journalctl -u ${svcName}.service -n 1 -q --no-pager 2>/dev/null | grep -c .`
        );
        if (parseInt(probeS.stdout.trim()) > 0) {
          cmd = `journalctl -u ${svcName}.service -n ${lines} -f -q --no-pager`;
        } else {
          return c.json({ error: `No journal entries for ${svcName}.service. Try: systemctl --user list-units 'openclaw*'` }, 404);
        }
      }
    } else {
      return c.json({ error: "No log source found (no gateway.log and no journalctl)" }, 404);
    }

    return stream(c, async (s) => {
      await s.write(`data: ${JSON.stringify(`[source: ${source}]`)}\n\n`);
      for await (const chunk of exec.execStream(cmd)) {
        await s.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
    });
  });

  // --- Snapshots ---

  app.get("/:id/snapshots", (c) => {
    const id = c.req.param("id");
    if (!manager.get(id)) return c.json({ error: "instance not found" }, 404);
    return c.json(snapshots.list(id));
  });

  app.post("/:id/snapshots", async (c) => {
    const id = c.req.param("id");
    if (!manager.get(id)) return c.json({ error: "instance not found" }, 404);
    const body = await c.req.json<{ configJson: string; reason?: string }>().catch(() => null);
    if (!body?.configJson) return c.json({ error: "configJson is required" }, 400);
    const snapId = snapshots.create(id, body.configJson, body.reason);
    auditLog(db, c, "lifecycle.snapshot-create", `Created config snapshot #${snapId}${body.reason ? `: ${body.reason}` : ""}`, id);
    return c.json({ id: snapId }, 201);
  });

  app.get("/snapshots/:snapId", (c) => {
    const snap = snapshots.get(parseInt(c.req.param("snapId")));
    if (!snap) return c.json({ error: "snapshot not found" }, 404);
    return c.json(snap);
  });

  app.post("/snapshots/diff", async (c) => {
    const { id1, id2 } = await c.req.json<{ id1: number; id2: number }>();
    if (!id1 || !id2) return c.json({ error: "id1 and id2 are required" }, 400);
    try {
      return c.json(snapshots.diff(id1, id2));
    } catch (err: any) {
      return c.json({ error: err.message }, 404);
    }
  });

  app.post("/:id/snapshots/:snapId/restore", async (c) => {
    const id = c.req.param("id");
    if (!manager.get(id)) return c.json({ error: "instance not found" }, 404);
    const snap = snapshots.get(parseInt(c.req.param("snapId")));
    if (!snap) return c.json({ error: "snapshot not found" }, 404);
    if (snap.instance_id !== id) return c.json({ error: "snapshot does not belong to this instance" }, 403);
    const profile = profileFromInstanceId(id);
    const configDir = getConfigDir(profile);
    const exec = getExecutor(id, hostStore);
    try {
      const config = JSON.parse(snap.config_json);
      await writeRemoteConfig(exec, configDir, config);
      // Create a new snapshot recording the restore action
      snapshots.create(id, snap.config_json, `restored from snapshot #${snap.id}`);
      auditLog(db, c, "lifecycle.snapshot-restore", `Restored config from snapshot #${snap.id}`, id);
      return c.json({ ok: true });
    } catch (err: any) {
      auditLog(db, c, "lifecycle.snapshot-restore", `FAILED: ${err.message}`, id);
      return c.json({ error: err.message }, 500);
    }
  });

  app.post("/:id/snapshots/cleanup", async (c) => {
    const id = c.req.param("id");
    if (!manager.get(id)) return c.json({ error: "instance not found" }, 404);
    const body = await c.req.json<{ keepCount?: number }>().catch(() => ({}));
    const deleted = snapshots.cleanup(id, body.keepCount);
    auditLog(db, c, "lifecycle.snapshot-cleanup", `Cleaned up ${deleted} old snapshots`, id);
    return c.json({ deleted });
  });

  // --- Diagnose ---

  app.post("/host/:hostId/diagnose", async (c) => {
    const hostId = c.req.param("hostId") === "local" ? "local" as const : parseInt(c.req.param("hostId"));
    const exec = getHostExecutor(hostId, hostStore);
    const [node, versions, disk] = await Promise.all([
      checkNodeVersion(exec),
      getVersions(exec),
      exec.exec("df -h / 2>/dev/null | tail -1"),
    ]);
    return c.json({ node, openclaw: versions, disk: disk.stdout.trim() });
  });

  return app;
}

function parsePortFromInstance(inst: any): number {
  try {
    const url = new URL(inst.connection.url.replace("ws://", "http://"));
    return parseInt(url.port) || 18789;
  } catch { return 18789; }
}

