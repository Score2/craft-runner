import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type PackageJson = {
  name?: string;
  version?: string;
};

export function packageInfo(): Required<PackageJson> {
  try {
    const packageJson = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    const parsed = JSON.parse(fs.readFileSync(packageJson, "utf8")) as PackageJson;
    return {
      name: parsed.name ?? "@score2/craft-runner",
      version: parsed.version ?? "unknown"
    };
  } catch {
    return {
      name: "@score2/craft-runner",
      version: "unknown"
    };
  }
}

