import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const nextBinary = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
      windowsHide: false,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code ?? "unknown"}.`));
    });
  });
}

function newestModifiedTime(target) {
  if (!existsSync(target)) return 0;
  const stats = statSync(target);
  if (!stats.isDirectory()) return stats.mtimeMs;

  return readdirSync(target, { withFileTypes: true }).reduce((latest, entry) => {
    const entryPath = path.join(target, entry.name);
    return Math.max(latest, newestModifiedTime(entryPath));
  }, stats.mtimeMs);
}

function buildIsStale() {
  const buildId = path.join(projectRoot, ".next", "BUILD_ID");
  if (!existsSync(buildId)) return true;

  const buildTime = statSync(buildId).mtimeMs;
  const sources = [
    path.join(projectRoot, "src"),
    path.join(projectRoot, "scripts", "scan-listeners.ps1"),
    path.join(projectRoot, "next.config.ts"),
    path.join(projectRoot, "package.json"),
    path.join(projectRoot, "package-lock.json"),
  ];
  return sources.some((source) => newestModifiedTime(source) > buildTime);
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findPort() {
  for (let port = 43110; port <= 43119; port += 1) {
    if (await portIsFree(port)) return port;
  }
  throw new Error("Every Portboard port from 43110 through 43119 is already in use.");
}

function healthCheck(port) {
  return new Promise((resolve) => {
    const request = http.get(
      { host: "127.0.0.1", port, path: "/api/health", timeout: 700 },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );
    request.once("timeout", () => request.destroy());
    request.once("error", () => resolve(false));
  });
}

async function waitUntilReady(port, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error("Portboard exited before its health check passed.");
    }
    if (await healthCheck(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Portboard did not become ready within 30 seconds.");
}

async function main() {
  if (!existsSync(nextBinary)) {
    console.log("Installing Portboard dependencies...");
    await run(npmCommand, ["install"]);
  }

  if (buildIsStale()) {
    console.log("Building Portboard...");
    await run(npmCommand, ["run", "build"]);
  }

  const port = await findPort();
  const url = `http://127.0.0.1:${port}`;
  console.log(`Starting Portboard at ${url}`);

  const child = spawn(process.execPath, [nextBinary, "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORTBOARD_SESSION_SECRET: randomBytes(32).toString("base64url"),
    },
    stdio: "inherit",
    windowsHide: false,
  });

  let stopping = false;
  const stopChild = () => {
    if (stopping || !child.pid) return;
    stopping = true;
    spawn("taskkill.exe", ["/PID", String(child.pid), "/T"], {
      stdio: "ignore",
      windowsHide: true,
    }).once("exit", () => process.exit(0));
  };

  process.once("SIGINT", stopChild);
  process.once("SIGTERM", stopChild);
  child.once("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });

  await waitUntilReady(port, child);
  console.log("Portboard is ready. Opening your browser...");
  const browser = spawn("explorer.exe", [url], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  browser.unref();

  const exitCode = await new Promise((resolve) => child.once("exit", resolve));
  process.exitCode = typeof exitCode === "number" ? exitCode : 0;
}

main().catch((error) => {
  console.error(`Portboard could not start: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
