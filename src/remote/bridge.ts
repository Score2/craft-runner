import fs from "node:fs/promises";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { BRIDGE_PROTOCOL, BridgeRequest, BridgeResponse, BridgeVersion } from "../bridge/protocol.js";

const execFileAsync = promisify(execFile);

export type RemoteBridgeResult = {
  remote: {
    host: string;
    craftr_version: string;
    bridge_protocol: BridgeVersion["bridge_protocol"];
  };
  result: unknown;
};

export class RemoteBridge {
  constructor(private readonly remoteHost: string) {}

  async request(tool: string, args: Record<string, any>): Promise<RemoteBridgeResult> {
    await this.assertSshReady();
    const version = await this.version();
    assertCompatible(version);
    const prepared = await this.prepareArguments(tool, args);
    const request: BridgeRequest = {
      schema: "craft-runner-bridge-request",
      version: 1,
      request_id: `remote-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      tool: prepared.tool,
      arguments: prepared.args
    };
    const response = await this.runBridgeRequest(request);
    if (!response.ok) {
      const error = response.error;
      throw new Error(`remote ${this.remoteHost} ${error?.code ?? "error"}: ${error?.message ?? "unknown bridge error"}`);
    }
    return {
      remote: {
        host: this.remoteHost,
        craftr_version: version.version,
        bridge_protocol: version.bridge_protocol
      },
      result: response.result
    };
  }

  async version(): Promise<BridgeVersion> {
    const output = await this.ssh(["craftr", "bridge", "version"]);
    try {
      return JSON.parse(output.stdout) as BridgeVersion;
    } catch (error) {
      throw new Error(`remote ${this.remoteHost} did not return valid craftr bridge version JSON. ${installHint(this.remoteHost)} ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async assertSshReady(): Promise<void> {
    try {
      await this.ssh(["echo", "craft-runner-ssh-ok"], undefined, 10000);
    } catch (error) {
      throw new Error(`remote ${this.remoteHost} is not reachable through non-interactive SSH. Ensure ~/.ssh/config or the target string works with key-based login and no password prompts. ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async runBridgeRequest(request: BridgeRequest): Promise<BridgeResponse> {
    const output = await this.ssh(["craftr", "bridge", "request"], `${JSON.stringify(request)}\n`, 120000);
    try {
      return JSON.parse(output.stdout) as BridgeResponse;
    } catch (error) {
      throw new Error(`remote ${this.remoteHost} bridge response was not valid JSON. stderr: ${output.stderr.trim()} ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async ssh(command: string[], stdin?: string, timeoutMs = 30000): Promise<{ stdout: string; stderr: string }> {
    return runSsh(this.remoteHost, command, stdin, timeoutMs);
  }

  private async prepareArguments(tool: string, args: Record<string, any>): Promise<{ tool: string; args: Record<string, any> }> {
    const clean = { ...args };
    delete clean.remote_host;

    if (tool === "put_server_file" && typeof clean.source_path === "string") {
      clean.content_base64 = await readBase64(clean.source_path);
      delete clean.source_path;
    }
    if (tool === "put_server_files" && Array.isArray(clean.files)) {
      clean.files = await Promise.all(clean.files.map(async (file: Record<string, any>) => {
        if (typeof file.source_path !== "string") {
          return file;
        }
        return {
          ...file,
          source_path: undefined,
          content_base64: await readBase64(file.source_path)
        };
      }));
    }
    if (tool === "add_plugin" && typeof clean.plugin_path === "string") {
      clean.plugin_content_base64 = await readBase64(clean.plugin_path);
      clean.plugin_name = clean.plugin_name ?? path.basename(clean.plugin_path);
    }
    if (tool === "import_core" && typeof clean.path === "string") {
      clean.file_content_base64 = await readBase64(clean.path);
      clean.file_name = path.basename(clean.path);
      delete clean.path;
    }
    if (tool === "debug_eval_js_file") {
      return {
        tool: "debug_eval_js",
        args: {
          ...clean,
          code: await fs.readFile(required(clean.file, "file"), "utf8")
        }
      };
    }
    if ((tool === "hot_load_plugin" || tool === "hot_reload_plugin") && typeof clean.plugin_path === "string") {
      clean.plugin_content_base64 = await readBase64(clean.plugin_path);
      clean.plugin_name = clean.plugin_name ?? path.basename(clean.plugin_path);
    }
    return { tool, args: clean };
  }
}

async function runSsh(remoteHost: string, command: string[], stdin?: string, timeoutMs = 30000): Promise<{ stdout: string; stderr: string }> {
  const args = [
    "-o", "BatchMode=yes",
    "-o", "NumberOfPasswordPrompts=0",
    ...sshTargetArgs(remoteHost),
    ...command
  ];
  const child = spawn("ssh", args, {
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  if (stdin !== undefined) {
    child.stdin.end(stdin);
  } else {
    child.stdin.end();
  }
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  }).finally(() => clearTimeout(timer));
  if (exitCode !== 0) {
    throw new Error(`ssh exited with ${exitCode}; stderr: ${stderr.trim()}. ${installHint(remoteHost)}`);
  }
  return { stdout, stderr };
}

function sshTargetArgs(remoteHost: string): string[] {
  const direct = remoteHost.match(/^([^@\s]+)@(\[[^\]]+]|[^:\s]+):(\d+)$/);
  if (direct) {
    return ["-p", direct[3], `${direct[1]}@${direct[2]}`];
  }
  return [remoteHost];
}

function assertCompatible(version: BridgeVersion): void {
  if (version.bridge_protocol?.major !== BRIDGE_PROTOCOL.major) {
    throw new Error(`remote bridge protocol major ${version.bridge_protocol?.major ?? "unknown"} is not compatible with local major ${BRIDGE_PROTOCOL.major}. Upgrade local or remote craftr.`);
  }
}

function installHint(remoteHost: string): string {
  return `If SSH works but craftr is missing, inspect the host with 'ssh ${remoteHost} command -v craftr' and install or upgrade it, for example 'ssh ${remoteHost} npm install -g @score2/craft-runner'.`;
}

async function readBase64(file: string): Promise<string> {
  return (await fs.readFile(file)).toString("base64");
}

function required(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}
