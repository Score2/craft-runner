# craft-runner

Local Minecraft server plugin testing platform exposed as an MCP server.

This project is intended to be used through MCP. The CLI is only a debugging helper.

## Install

Install the published npm package globally:

```sh
npm install -g @score2/craft-runner
```

This installs three commands:

- `craft-runner-mcp`: stdio MCP server
- `craft-runner`: human-friendly CLI
- `craftr`: shorter CLI alias

Requirements:

- Node.js 20+
- Java matching the Minecraft version under test
- Gradle only when rebuilding the bundled debug agent from source

To work from a source checkout instead:

```sh
npm install
npm run build
npm install -g .
```

## MCP Command

After installation, MCP clients can start the stdio server with:

```sh
craft-runner-mcp
```

Example MCP config for macOS/Linux:

```json
{
  "mcpServers": {
    "craft-runner": {
      "command": "craft-runner-mcp"
    }
  }
}
```

On Windows, MCP clients that spawn commands without a shell should use the npm
`.cmd` shim through `cmd.exe`:

```json
{
  "mcpServers": {
    "craft-runner": {
      "command": "cmd.exe",
      "args": ["/d", "/s", "/c", "craft-runner-mcp.cmd"]
    }
  }
}
```

For Codex or Claude Code, use the same command shape in the MCP server config.
No extra daemon or port is required; the MCP server communicates over stdio.

## CLI

CLI output is human-readable by default. Add `--json` when a script needs the
raw structured response:

```sh
craftr --json server list
```

```sh
craft-runner java list
craft-runner java validate 1.21.4 --java sdk:21.0.10-oracle
craft-runner server create --id test-paper --loader paper --minecraft-version 1.21.4 --start
craft-runner server create --id local-custom --path ./server.jar --minecraft-version 1.20.4
craft-runner server create --id direct-custom --direct-path /opt/minecraft/server.jar --minecraft-version 1.20.4
craft-runner server list
craft-runner server info test-server
craft-runner server logs test-server --tail 120
craft-runner server files test-server
craft-runner stats
craft-runner core list
craft-runner core info paper-1.21.4-123
craft-runner core verify paper-1.21.4-123
craft-runner core remove paper-1.21.4-123
```

`--path` imports a custom jar into craft-runner's shared core cache. Use
`--direct-path` when the jar already exists on the execution host and should be
launched directly without copying it into the core cache. For remote MCP calls,
`core_ref.direct_path` is interpreted on the remote host.


The shorter alias `craftr` is also installed:

```sh
craftr server list
craftr stats
craftr core list
```

## Shell Completion

Generate zsh completion:

```sh
craft-runner completion zsh
```

Temporary use in the current shell:

```sh
source <(craft-runner completion zsh)
```

Persistent zsh install usually means writing the generated script to a directory
already present in `fpath`, for example Homebrew's site-functions directory:

```sh
craft-runner completion install zsh
autoload -Uz compinit && compinit
```

To choose a specific completion directory:

```sh
craft-runner completion install zsh --dir ~/.zsh/completions
```

If a server is stuck and a graceful stop cannot finish, use the force-kill
fallback:

```sh
craftr server kill test-paper
```

This bypasses normal Minecraft and plugin shutdown. Prefer `craftr server stop`
for routine shutdowns.

## Release Automation

GitHub Actions runs regression tests on pushes and pull requests. npm publishing
is intentionally gated: the publish workflow runs only when manually dispatched
or when the pushed commit message contains `[npm publish]`. The same workflow
also creates or updates the matching GitHub Release (`v<package version>`) and
attaches platform-specific `craft-runner-agent-*.jar` files for manual server
installation. MCP-managed servers select the matching agent jar automatically
from the server loader and Minecraft version. Bukkit-family servers share one
Java 17-compatible jar; Forge and NeoForge keep legacy/modern jars where loader
metadata and compile-time API boundaries differ.

For npm Trusted Publishing, configure npm to trust:

- repository: `Score2/craft-runner`
- workflow: `.github/workflows/publish.yml`
- branch: `master`

## Main MCP Tools

- `create_server`
- `list_servers`
- `get_server`
- `get_stats`
- `start_server`
- `stop_server`
- `kill_server`
- `restart_server`
- `destroy_server`
- `put_server_file`
- `put_server_files`
- `add_plugin`
- `remove_server_file`
- `list_server_files`
- `tail_server_log`
- `read_server_log`
- `wait_server_ready`
- `send_server_command`
- `get_server_events`
- `list_core_providers`
- `search_cores`
- `download_core`
- `import_core`
- `list_cores`
- `remove_core`
- `verify_core`
- `list_java_installations`
- `get_java_info`
- `validate_java_for_core`
- `debug_install_agent`
- `debug_agent_status`
- `debug_agent_api`
- `debug_eval_js`
- `debug_eval_js_file`
- `hot_plugin_capabilities`
- `hot_list_plugins`
- `hot_load_plugin`
- `hot_unload_plugin`
- `hot_reload_plugin`

`send_server_command` is the supported path for Minecraft/proxy console
commands. It uses the debug agent socket on Unix-like systems, the file mailbox
fallback on Windows, and only falls back to legacy RCON or managed stdin for
older/agentless servers. MCP clients should not interact with tmux directly and
should not use `debug_eval_js` just to dispatch a command.

## JS Debug Agent

For plugin/mod capable servers, craft-runner can install a local debug agent.
The agent uses GraalJS and communicates through a local endpoint under
`~/.craft-runner/agents/<server-port>/`, without opening another TCP port.
On Linux/macOS it prefers a Unix domain socket and falls back to file mailbox
requests; on Windows it uses the file mailbox transport. The same agent jar contains entrypoints for
Bukkit-family servers, BungeeCord/Waterfall, Velocity, Fabric, Forge, and
NeoForge. Vanilla servers do not have a plugin/mod loading mechanism, so they
cannot load this agent directly.

```sh
craftr debug install-agent test-paper
craftr server restart test-paper
craftr debug status test-paper
craftr debug discover-agents
craftr debug register-agent 25565 --id manual-test-paper
craftr debug js test-paper --code "cr.platform.onlinePlayerNames()"
craftr debug hot-capabilities test-paper
craftr debug hot-load test-paper ./build/libs/MyPlugin.jar
craftr debug hot-reload test-paper MyPlugin ./build/libs/MyPlugin.jar
craftr debug hot-unload test-paper MyPlugin
```

The installer places the jar under `plugins/` for Bukkit-family and proxy
loaders, and under `mods/` for Fabric, Forge, and NeoForge. For `custom`
loaders it writes both locations because the platform cannot be inferred from
metadata alone.
The agent jar is bundled in the npm package, so normal use does not require
Gradle. `debug_install_agent` with `rebuild: true` requires Gradle on `PATH`.

Mailbox path:

```text
~/.craft-runner/agents/
  <server-port>/
    config.json
    endpoint.json
    agent.sock
    requests/
    responses/
    tmp/
  current.json
```

The endpoint directory is named after the Minecraft server port so MCP, local
tools, and future remote runners can identify a manually installed agent without
craft-runner metadata. Each endpoint gets a unique token in `config.json`; the
agent ignores requests with a mismatched token.

Users may also install `craft-runner-agent.jar` manually. On Bukkit-family,
BungeeCord/Waterfall, and Velocity servers, `/craftragent status` shows the
endpoint and `/craftragent token` prints the local token. The command is
registered through Incendo Cloud so the command behavior is shared across those
platforms. `/cra` is available as the short in-server alias. `list`,
`hot-load`, `hot-unload`, and `hot-reload` are available from the same command,
but hot plugin operations currently only perform real load/unload work on
Bukkit-family, BungeeCord/Waterfall, and Velocity servers.

To let MCP use a manually installed agent, scan the local endpoints and register
the matching port. Discovered/manual agents are treated as temporary external
servers: craft-runner can use their debug endpoint, but cannot destroy or own
their lifecycle.

```sh
craftr debug discover-agents
craftr debug register-agent 25565 --id manual-test-paper
```

Debug scripts should prefer the `cr` DSL over raw Java globals:

- `cr.common` is cross-platform and contains Java reflection, construction,
  collection, inspection, and raw server/plugin/logger access helpers.
- `cr.platform` is platform-specific. Bukkit-family servers expose helpers for
  players, worlds, plugins, commands, materials, item stacks, and Folia
  detection. BungeeCord/Waterfall and Velocity expose proxy player/server
  helpers. Fabric, Forge, and NeoForge currently expose generic platform
  metadata plus raw server/plugin objects, so use `cr.common` reflection there.

Useful examples:

```js
cr.common.platformName()
cr.common.inspect(cr.common.server())
cr.common.callStatic("org.bukkit.Bukkit", "getOnlinePlayers").size()
cr.platform.capabilities()
cr.platform.onlinePlayerNames()
cr.platform.dispatchCommand("say hello from craft-runner")
```

MCP clients can call `debug_agent_api` to retrieve the current DSL reference
before generating `debug_eval_js` code.

## Bukkit Hot Plugin Debugging

Bukkit-family servers can use the debug agent to load, unload, and reload plugin
jars without restarting the server:

```sh
craftr debug hot-capabilities test-paper
craftr debug hot-list test-paper
craftr debug hot-load test-paper ./plugins/MyPlugin.jar
craftr debug hot-reload test-paper MyPlugin ./plugins/MyPlugin.jar
craftr debug hot-unload test-paper MyPlugin
```

Equivalent MCP tools are `hot_plugin_capabilities`, `hot_list_plugins`,
`hot_load_plugin`, `hot_unload_plugin`, and `hot_reload_plugin`.

Important notes:

- Hot load/unload/reload is intended for quick debugging loops, fast iteration,
  and small visual or text tuning. For ordinary plugin changes, prefer a normal
  server restart unless the user explicitly asks to avoid one.
- If hot reload/unload leads to strange behavior, stale state, missing commands,
  classloader issues, scheduler issues, or dependency inconsistencies, try a
  full server restart first unless the user has clearly requested no restart.
- Bukkit-style `plugin.yml` jars are supported on Bukkit, Spigot, Paper, and
  Folia.
- Pure Paper `paper-plugin.yml` jars are supported on Paper/Folia through
  reflective Paper internals. Paper's public runtime path intentionally rejects
  Paper plugin providers, so this path is best-effort and may need updates when
  Paper internals change.
- On Paper 1.20.5+, plugin remapping is delegated to the running server.
- On Folia, the plugin jar must satisfy Folia's own compatibility rules, such as
  declaring `folia-supported: true` when required.
- Unload/reload is best-effort. Plugin-owned static state, custom threads,
  native resources, and third-party registries can still require a server
  restart.
- BungeeCord/Waterfall and Velocity currently report hot plugin operations as
  unsupported. Velocity has no public unload API, and runtime loading cannot
  safely replay initialization for only the newly loaded plugin without touching
  existing plugins.

## Core Installation Cache

Downloaded cores are stored once under the user cache directory. Runtime assets that
are bound to a specific core, such as `libraries/`, Paper/Purpur cache output, and
Forge/NeoForge installer output, are prepared centrally under that core's
installation directory.

Each test server keeps its own `plugins/`, config, worlds, and logs, while
shareable core-bound directories are linked from the central core installation.

## Runtime Directories

By default, temporary test servers are placed under the system temp directory and
may be cleaned by the OS. Cached server cores and shared core installation data
are stored under the user cache directory to avoid repeated downloads.

Useful environment variables:

- `CRAFT_RUNNER_CACHE_DIR`: override the core/cache directory
- `CRAFT_RUNNER_SERVER_BASE_DIR`: override where test servers are created
- `CRAFT_RUNNER_STATE_DIR`: override metadata and lock storage
- `CRAFT_RUNNER_JAVA_REF`: default Java reference, such as `system`, `home:/path`, or `path:/path/to/java`

Remote and Docker runners are intentionally not implemented yet.
