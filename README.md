# craft-runner

Local Minecraft server plugin testing platform exposed as an MCP server.

This project is intended to be used through MCP. The CLI is only a debugging helper.
It is not published to npm yet.

## Install Locally

```sh
npm install
npm run build
npm install -g .
```

## MCP Command

After local installation, MCP clients can start the stdio server with:

```sh
craft-runner-mcp
```

Example MCP config:

```json
{
  "mcpServers": {
    "craft-runner": {
      "command": "craft-runner-mcp"
    }
  }
}
```

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


The shorter alias `craftr` is also installed:

```sh
craftr server list
craftr server list
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

## Main MCP Tools

- `create_server`
- `get_stats`
- `start_server`
- `stop_server`
- `destroy_server`
- `put_server_file`
- `add_plugin`
- `tail_server_log`
- `read_server_log`
- `download_core`
- `list_java_installations`
- `debug_install_agent`
- `debug_agent_status`
- `debug_agent_api`
- `debug_eval_js`
- `debug_eval_js_file`

Remote and Docker runners are intentionally not implemented yet.

## JS Debug Agent

For plugin/mod capable servers, craft-runner can install a local debug agent.
The agent uses GraalJS and communicates through files in the server directory,
without opening another port. The same agent jar contains entrypoints for
Bukkit-family servers, Fabric, Forge, and NeoForge. Vanilla servers do not have
a plugin/mod loading mechanism, so they cannot load this agent directly.

```sh
craftr debug install-agent test-paper
craftr server restart test-paper
craftr debug status test-paper
craftr debug js test-paper --code "cr.platform.onlinePlayerNames()"
```

The installer places the jar under `plugins/` for Bukkit-family loaders and
under `mods/` for Fabric, Forge, and NeoForge. For `custom` loaders it writes
both locations because the platform cannot be inferred from metadata alone.

Mailbox path:

```text
<server_dir>/.craft-runner-agent/
  config.json
  requests/
  responses/
  tmp/
```

Each server gets a unique token in `.craft-runner-agent/config.json`; the agent
ignores requests with a mismatched token.

Debug scripts should prefer the `cr` DSL over raw Java globals:

- `cr.common` is cross-platform and contains Java reflection, construction,
  collection, inspection, and raw server/plugin/logger access helpers.
- `cr.platform` is platform-specific. Bukkit-family servers expose helpers for
  players, worlds, plugins, commands, materials, item stacks, and Folia
  detection. Fabric, Forge, and NeoForge currently expose generic platform
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

## Core Installation Cache

Downloaded cores are stored once under the user cache directory. Runtime assets that
are bound to a specific core, such as `libraries/`, Paper/Purpur cache output, and
Forge/NeoForge installer output, are prepared centrally under that core's
installation directory.

Each test server keeps its own `plugins/`, config, worlds, and logs, while
shareable core-bound directories are linked from the central core installation.
