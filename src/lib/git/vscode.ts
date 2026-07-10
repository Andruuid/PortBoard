import "server-only";

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let cachedInstallDirectory: string | null | undefined;

async function findVSCodeInstallDirectory(): Promise<string | null> {
  if (cachedInstallDirectory !== undefined) {
    return cachedInstallDirectory;
  }

  try {
    const { stdout } = await execFileAsync("where.exe", ["code.cmd"], {
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    });
    for (const commandPath of stdout.split(/\r?\n/).filter(Boolean)) {
      const installDirectory = commandPath
        .trim()
        .replace(/[\\/]bin[\\/]code\.cmd$/i, "");
      if (installDirectory !== commandPath.trim()) {
        cachedInstallDirectory = installDirectory;
        return installDirectory;
      }
    }
  } catch {
    // Standard install locations remain available as fallbacks.
  }

  if (process.env.LOCALAPPDATA) {
    cachedInstallDirectory = `${process.env.LOCALAPPDATA}\\Programs\\Microsoft VS Code`;
    return cachedInstallDirectory;
  }

  const programFiles = process.env.ProgramFiles || process.env["ProgramFiles(x86)"];
  if (programFiles) {
    cachedInstallDirectory = `${programFiles}\\Microsoft VS Code`;
    return cachedInstallDirectory;
  }

  cachedInstallDirectory = null;
  return null;
}

export async function openDirectoryInVSCode(directory: string): Promise<void> {
  const installDirectory = await findVSCodeInstallDirectory();
  if (!installDirectory) {
    throw new Error("Visual Studio Code could not be found on this PC.");
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn("Code.exe", [directory], {
      cwd: installDirectory,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
