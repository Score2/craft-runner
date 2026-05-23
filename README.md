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
craftr --json env list
```

```sh
craft-runner java list
craft-runner java validate 1.21.4 --java sdk:21.0.10-oracle
craft-runner server create --id test-paper --loader paper --minecraft-version 1.21.4 --start
craft-runner server create --id local-custom --path ./server.jar --minecraft-version 1.20.4
craft-runner server list
craft-runner server info test-env
craft-runner server logs test-env --tail 120
craft-runner server files test-env
craft-runner core list
craft-runner core info paper-1.21.4-123
craft-runner core verify paper-1.21.4-123
craft-runner core remove paper-1.21.4-123
```

`env` remains available as a backward-compatible alias for `server`.

The shorter alias `craftr` is also installed:

```sh
craftr env list
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

- `create_environment`
- `start_environment`
- `stop_environment`
- `destroy_environment`
- `put_environment_file`
- `add_plugin`
- `tail_environment_log`
- `read_environment_log`
- `download_core`
- `list_java_installations`
- `debug_install_agent`
- `debug_agent_status`
- `debug_eval_js`
- `debug_eval_js_file`

Remote and Docker runners are intentionally not implemented yet.

## JS Debug Agent

For Bukkit-family servers, craft-runner can install a local debug agent plugin.
The agent uses GraalJS and communicates through files in the server directory,
without opening another port.

```sh
craftr debug install-agent test-paper
craftr server restart test-paper
craftr debug status test-paper
craftr debug js test-paper --code "Bukkit.getOnlinePlayers().size()"
```

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

## Core Installation Cache

Downloaded cores are stored once under the user cache directory. Runtime assets that
are bound to a specific core, such as `libraries/`, Paper/Purpur cache output, and
Forge/NeoForge installer output, are prepared centrally under that core's
installation directory.

Each test environment keeps its own `plugins/`, config, worlds, and logs, while
shareable core-bound directories are linked from the central core installation.
