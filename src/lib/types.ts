export type ServerStatus =
  | "created"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed";

export type CoreKind = "jar" | "installer";

export type CoreRef = {
  core_id?: string;
  loader?: string;
  minecraft_version?: string;
  build?: string;
  channel?: string;
  path?: string;
  url?: string;
};

export type CoreMetadata = {
  id: string;
  loader: string;
  minecraft_version: string;
  build?: string;
  channel?: string;
  provider: string;
  source: string;
  file_path: string;
  sha256: string;
  checksum_source: "provider" | "local";
  size: number;
  kind: CoreKind;
  launch?: {
    type: "jar" | "installer";
    main_file?: string;
    install_args?: string[];
  };
  downloaded_at: string;
};

export type MaterializedCore = {
  core_id: string;
  install_dir: string;
  launch: {
    command: "java" | "sh" | "cmd";
    args: string[];
    cwd: string;
  };
  links: Array<{
    source: string;
    target: string;
    strategy: "symlink" | "hardlink" | "copy";
  }>;
  prepared_at: string;
};

export type JavaRef = string | undefined;

export type JavaInfo = {
  id: string;
  ref: string;
  command: string;
  version?: number;
  version_string?: string;
  vendor?: string;
  source: "system" | "java_home" | "path" | "home" | "sdkman" | "configured";
  valid: boolean;
  error?: string;
};

export type ServerMetadata = {
  id: string;
  kind: "local";
  server_dir: string;
  base_dir: string;
  persistent: boolean;
  core_ref: CoreRef;
  core_id: string;
  minecraft_version: string;
  loader: string;
  host: string;
  port: number;
  rcon_port?: number;
  rcon_password?: string;
  java_ref?: string;
  java_command?: string;
  java_args: string[];
  memory: {
    xms: string;
    xmx: string;
  };
  pid?: number;
  debug_agent?: {
    token: string;
    mailbox_dir: string;
    agent_jar: string;
    agent_jars?: string[];
    installed_at: string;
  };
  status: ServerStatus;
  created_at: string;
  updated_at: string;
  events: ServerEvent[];
};

export type DebugEvalInput = {
  server_id: string;
  code: string;
  thread?: "main" | "async";
  timeout_ms?: number;
};

export type ServerEvent = {
  at: string;
  type: string;
  message: string;
  data?: Record<string, unknown>;
};

export type CreateServerInput = {
  id?: string;
  core_ref: CoreRef;
  base_dir?: string;
  persistent?: boolean;
  memory?: {
    xms?: string;
    xmx?: string;
  };
  java_ref?: string;
  java_args?: string[];
  server_properties?: Record<string, string | number | boolean>;
  host?: string;
  port?: number;
  rcon?: {
    enabled?: boolean;
    port?: number;
    password?: string;
  };
  accept_eula?: boolean;
  start?: boolean;
};

export type CraftRunnerConfig = {
  cache_dir: string;
  server_base_dir: string;
  state_dir: string;
  user_agent: string;
  ports: {
    minecraft_start: number;
    minecraft_end: number;
    rcon_start: number;
    rcon_end: number;
  };
  java: {
    default_ref: string;
    default_xms: string;
    default_xmx: string;
    prefer_sdkman: boolean;
  };
};
