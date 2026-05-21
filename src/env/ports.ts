import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, pathExists } from "../lib/fsx.js";

export type PortRange = { start: number; end: number };

export async function allocatePort(
  range: PortRange,
  locksDir: string,
  preferred?: number
): Promise<number> {
  await ensureDir(locksDir);
  const candidates = preferred ? [preferred] : shuffledRange(range.start, range.end);
  for (const port of candidates) {
    if (port < range.start || port > range.end) {
      continue;
    }
    const lockFile = path.join(locksDir, `${port}.lock`);
    if (await pathExists(lockFile)) {
      continue;
    }
    if (!(await isPortAvailable(port))) {
      continue;
    }
    try {
      await fs.writeFile(lockFile, String(process.pid), { flag: "wx" });
      return port;
    } catch {
      continue;
    }
  }
  throw new Error(`no available port in range ${range.start}-${range.end}`);
}

export async function releasePort(locksDir: string, port: number | undefined): Promise<void> {
  if (!port) return;
  await fs.rm(path.join(locksDir, `${port}.lock`), { force: true });
}

export async function isPortAvailable(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

function shuffledRange(start: number, end: number): number[] {
  const values: number[] = [];
  for (let port = start; port <= end; port += 1) values.push(port);
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}
