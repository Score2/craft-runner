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

```sh
craft-runner java list
craft-runner env list
craft-runner core list
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

Remote and Docker runners are intentionally not implemented yet.

## Core Installation Cache

Downloaded cores are stored once under the user cache directory. Runtime assets that
are bound to a specific core, such as `libraries/`, Paper/Purpur cache output, and
Forge/NeoForge installer output, are prepared centrally under that core's
installation directory.

Each test environment keeps its own `plugins/`, config, worlds, and logs, while
shareable core-bound directories are linked from the central core installation.
