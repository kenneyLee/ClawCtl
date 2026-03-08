import type { CommandExecutor } from "../executor/types.js";

const MIN_NODE_MAJOR = 22;

export interface NodeVersionInfo {
  installed: boolean;
  version?: string;
  sufficient: boolean;
}

export async function checkNodeVersion(exec: CommandExecutor): Promise<NodeVersionInfo> {
  const r = await exec.exec("node --version 2>/dev/null");
  if (r.exitCode !== 0 || !r.stdout.trim()) return { installed: false, sufficient: false };
  const version = r.stdout.trim().replace(/^v/, "");
  const major = parseInt(version.split(".")[0]);
  return { installed: true, version, sufficient: major >= MIN_NODE_MAJOR };
}

export interface VersionInfo {
  installed?: string;
  latest?: string;
  updateAvailable: boolean;
  distTags?: Record<string, string>;
}

export async function getVersions(exec: CommandExecutor): Promise<VersionInfo> {
  const [installedR, tagsR] = await Promise.all([
    exec.exec("openclaw --version 2>/dev/null"),
    exec.exec("npm view openclaw dist-tags --json 2>/dev/null"),
  ]);
  const installed = installedR.exitCode === 0 ? installedR.stdout.trim() : undefined;
  let distTags: Record<string, string> | undefined;
  let latest: string | undefined;
  if (tagsR.exitCode === 0 && tagsR.stdout.trim()) {
    try {
      distTags = JSON.parse(tagsR.stdout.trim());
      latest = distTags?.latest;
    } catch { /* ignore parse error */ }
  }
  return {
    installed,
    latest,
    updateAvailable: !!(installed && latest && installed !== latest),
    distTags,
  };
}

export interface InstallResult {
  success: boolean;
  output: string;
}

export async function installOpenClaw(exec: CommandExecutor, version?: string): Promise<InstallResult> {
  const pkg = version ? `openclaw@${version}` : "openclaw@latest";
  const r = await exec.exec(`npm i -g ${pkg}`, { timeout: 120_000 });
  return { success: r.exitCode === 0, output: r.stdout + r.stderr };
}

// --- Streaming multi-step install with auto Node.js setup ---

export interface InstallStep {
  step: string;
  status: "running" | "done" | "error" | "skipped";
  detail?: string;
}

type EmitFn = (event: InstallStep) => Promise<void>;

async function ensureNodeJs(exec: CommandExecutor, emit: EmitFn): Promise<boolean> {
  await emit({ step: "Check Node.js", status: "running" });
  const node = await checkNodeVersion(exec);

  if (node.installed && node.sufficient) {
    await emit({ step: "Check Node.js", status: "done", detail: `v${node.version}` });
    return true;
  }

  if (node.installed && !node.sufficient) {
    await emit({ step: "Check Node.js", status: "running", detail: `v${node.version} too old (need ≥${MIN_NODE_MAJOR}), upgrading...` });
  } else {
    await emit({ step: "Check Node.js", status: "running", detail: "Not found, installing..." });
  }

  // Detect OS and package manager
  const osR = await exec.exec("cat /etc/os-release 2>/dev/null | grep ^ID= | cut -d= -f2 | tr -d '\"'");
  const osId = osR.stdout.trim().toLowerCase();

  let installCmd: string;
  if (["ubuntu", "debian"].includes(osId)) {
    // NodeSource for Debian/Ubuntu
    installCmd = [
      "apt-get update -qq",
      "apt-get install -y -qq curl ca-certificates gnupg",
      `curl -fsSL https://deb.nodesource.com/setup_${MIN_NODE_MAJOR}.x | bash -`,
      "apt-get install -y -qq nodejs",
    ].join(" && ");
  } else if (["centos", "rhel", "fedora", "rocky", "almalinux", "amzn"].includes(osId)) {
    installCmd = [
      `curl -fsSL https://rpm.nodesource.com/setup_${MIN_NODE_MAJOR}.x | bash -`,
      "yum install -y nodejs",
    ].join(" && ");
  } else if (["alpine"].includes(osId)) {
    installCmd = `apk add --no-cache nodejs npm`;
  } else {
    // Fallback: try nvm-style install
    installCmd = [
      `curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash`,
      `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm install ${MIN_NODE_MAJOR}`,
    ].join(" && ");
  }

  await emit({ step: "Install Node.js", status: "running", detail: `OS: ${osId || "unknown"}` });

  // Try with sudo first, fall back to direct if no sudo
  const hasSudo = (await exec.exec("command -v sudo >/dev/null 2>&1 && echo yes")).stdout.trim() === "yes";
  const prefix = hasSudo ? "sudo " : "";
  const r = await exec.exec(`${prefix}bash -c '${installCmd.replace(/'/g, "'\\''")}'`, { timeout: 180_000 });

  if (r.exitCode !== 0) {
    await emit({ step: "Install Node.js", status: "error", detail: (r.stderr || r.stdout).slice(0, 200) });
    return false;
  }

  // Verify
  const verify = await checkNodeVersion(exec);
  if (!verify.installed || !verify.sufficient) {
    await emit({ step: "Install Node.js", status: "error", detail: "Installed but version check failed" });
    return false;
  }

  await emit({ step: "Install Node.js", status: "done", detail: `v${verify.version}` });
  return true;
}

async function ensureNpm(exec: CommandExecutor, emit: EmitFn): Promise<boolean> {
  await emit({ step: "Check npm", status: "running" });
  const r = await exec.exec("npm --version 2>/dev/null");
  if (r.exitCode === 0 && r.stdout.trim()) {
    await emit({ step: "Check npm", status: "done", detail: `v${r.stdout.trim()}` });
    return true;
  }

  await emit({ step: "Check npm", status: "running", detail: "Not found, installing..." });
  const hasSudo = (await exec.exec("command -v sudo >/dev/null 2>&1 && echo yes")).stdout.trim() === "yes";
  const prefix = hasSudo ? "sudo " : "";
  // Try corepack or direct install
  const install = await exec.exec(`${prefix}corepack enable 2>/dev/null || ${prefix}apt-get install -y -qq npm 2>/dev/null || ${prefix}yum install -y npm 2>/dev/null`, { timeout: 60_000 });

  const verify = await exec.exec("npm --version 2>/dev/null");
  if (verify.exitCode === 0 && verify.stdout.trim()) {
    await emit({ step: "Check npm", status: "done", detail: `v${verify.stdout.trim()}` });
    return true;
  }

  await emit({ step: "Check npm", status: "error", detail: "Could not install npm" });
  return false;
}

export async function streamInstall(
  exec: CommandExecutor,
  emit: EmitFn,
  version?: string,
): Promise<boolean> {
  // Step 1: Node.js
  if (!(await ensureNodeJs(exec, emit))) return false;

  // Step 2: npm
  if (!(await ensureNpm(exec, emit))) return false;

  // Step 3: Install OpenClaw
  const pkg = version ? `openclaw@${version}` : "openclaw@latest";
  await emit({ step: `Install ${pkg}`, status: "running" });
  const r = await exec.exec(`npm i -g ${pkg}`, { timeout: 120_000 });
  if (r.exitCode !== 0) {
    await emit({ step: `Install ${pkg}`, status: "error", detail: (r.stderr || r.stdout).slice(0, 200) });
    return false;
  }
  await emit({ step: `Install ${pkg}`, status: "done" });

  // Step 4: Verify
  await emit({ step: "Verify installation", status: "running" });
  const verify = await exec.exec("openclaw --version 2>/dev/null");
  if (verify.exitCode === 0 && verify.stdout.trim()) {
    await emit({ step: "Verify installation", status: "done", detail: `v${verify.stdout.trim()}` });
    return true;
  }

  await emit({ step: "Verify installation", status: "error", detail: "openclaw command not found after install" });
  return false;
}
