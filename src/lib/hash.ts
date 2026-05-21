import crypto from "node:crypto";
import fs from "node:fs";

export async function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export function randomId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(5).toString("hex")}`;
}
