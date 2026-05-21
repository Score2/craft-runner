import fs from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(tmp, file);
}

export function assertSafeRelativePath(relativePath: string): void {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error("target_path must be a non-empty relative path");
  }
  const normalized = path.normalize(relativePath);
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new Error("target_path must stay inside the server directory");
  }
}

export function resolveInside(base: string, relativePath: string): string {
  assertSafeRelativePath(relativePath);
  const resolved = path.resolve(base, relativePath);
  const normalizedBase = path.resolve(base);
  if (resolved !== normalizedBase && !resolved.startsWith(`${normalizedBase}${path.sep}`)) {
    throw new Error("resolved path escapes the server directory");
  }
  return resolved;
}

export function sanitizeIdPart(input: string): string {
  return input.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function validateEnvironmentId(id: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new Error("environment id may only contain letters, digits, dots, underscores, and dashes");
  }
}
