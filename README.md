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
