package io.insinuate.score2.craftrunner.agent.common;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import io.insinuate.score2.craftrunner.agent.common.hot.HotPluginOperations;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public final class AgentCommandController {
    private static final List<String> SUBCOMMANDS = List.of(
        "status",
        "token",
        "connect",
        "capabilities",
        "list",
        "hot-load",
        "hot-unload",
        "hot-reload"
    );

    private final AgentPlatform platform;
    private final AgentRuntime runtime;
    private final HotPluginOperations hotPlugins;
    private final Gson gson = new GsonBuilder().disableHtmlEscaping().setPrettyPrinting().create();

    public AgentCommandController(AgentPlatform platform, AgentRuntime runtime) {
        this.platform = platform;
        this.runtime = runtime;
        this.hotPlugins = platform.hotPluginOperations();
    }

    public void execute(AgentCommandSender sender, String label, String rawArgs) {
        execute(sender, label, splitArgs(rawArgs));
    }

    public void execute(AgentCommandSender sender, String label, String[] args) {
        if (args.length == 0 || "help".equalsIgnoreCase(args[0])) {
            sendHelp(sender, label);
            return;
        }
        try {
            switch (args[0].toLowerCase(Locale.ROOT)) {
                case "status" -> sendStatus(sender);
                case "token" -> sender.sendMessage("Token: " + runtime.endpointInfo().token());
                case "connect", "code" -> sendConnectCode(sender);
                case "capabilities", "hot-capabilities" -> sendJson(sender, hotPlugins.capabilities());
                case "list", "hot-list" -> sendJson(sender, hotPlugins.list());
                case "hot-load", "load" -> sendJson(sender, hotPlugins.load(requiredPath(args, 1), !contains(args, "--no-enable")));
                case "hot-unload", "unload" -> sendJson(sender, hotPlugins.unload(required(args, 1, "plugin name")));
                case "hot-reload", "reload" -> sendJson(sender, hotPlugins.reload(requiredPath(args, 2), required(args, 1, "plugin name"), !contains(args, "--no-enable")));
                default -> sendHelp(sender, label);
            }
        } catch (Throwable error) {
            sender.sendMessage("CraftRunnerAgent error: " + error.getMessage());
            platform.logger().warning("Command failed: " + error);
        }
    }

    public List<String> suggest(String rawArgs) {
        String[] args = splitArgs(rawArgs);
        if (args.length <= 1 && !rawArgs.endsWith(" ")) {
            String prefix = args.length == 0 ? "" : args[0].toLowerCase(Locale.ROOT);
            return prefix(prefix, SUBCOMMANDS);
        }
        return List.of();
    }

    private void sendStatus(AgentCommandSender sender) {
        AgentEndpointInfo info = runtime.endpointInfo();
        sender.sendMessage("CraftRunnerAgent");
        sender.sendMessage("  Platform: " + platform.platformName());
        sender.sendMessage("  Endpoint: " + info.endpoint());
        sender.sendMessage("  Endpoint name: " + info.endpointName());
        sender.sendMessage("  Generated config: " + info.generatedConfig());
        sender.sendMessage("  Enabled: " + info.enabled());
        sender.sendMessage("  Token: " + info.token());
    }

    private void sendHelp(AgentCommandSender sender, String label) {
        sender.sendMessage("CraftRunnerAgent commands:");
        sender.sendMessage("Aliases: /craftragent, /cra");
        sender.sendMessage("/" + label + " status");
        sender.sendMessage("/" + label + " token");
        sender.sendMessage("/" + label + " connect");
        sender.sendMessage("/" + label + " list");
        sender.sendMessage("/" + label + " hot-load <plugin.jar> [--no-enable]");
        sender.sendMessage("/" + label + " hot-unload <plugin>");
        sender.sendMessage("/" + label + " hot-reload <plugin> <plugin.jar> [--no-enable]");
    }

    private void sendConnectCode(AgentCommandSender sender) {
        sender.sendMessage("CraftRunnerAgent connect code:");
        sender.sendMessage(AgentConnectPayload.encode(platform, runtime.endpointInfo()));
    }

    private void sendJson(AgentCommandSender sender, Map<String, Object> result) {
        for (String line : gson.toJson(result).split("\n")) {
            sender.sendMessage(line);
        }
    }

    private Path requiredPath(String[] args, int index) {
        return Path.of(required(args, index, "plugin jar")).toAbsolutePath().normalize();
    }

    private String required(String[] args, int index, String name) {
        if (args.length <= index || args[index].isBlank()) {
            throw new IllegalArgumentException(name + " is required");
        }
        return args[index];
    }

    private boolean contains(String[] args, String value) {
        for (String arg : args) {
            if (value.equalsIgnoreCase(arg)) {
                return true;
            }
        }
        return false;
    }

    private List<String> prefix(String prefix, List<String> values) {
        List<String> result = new ArrayList<>();
        for (String value : values) {
            if (value.startsWith(prefix)) {
                result.add(value);
            }
        }
        return result;
    }

    public static String[] splitArgs(String input) {
        if (input == null || input.isBlank()) {
            return new String[0];
        }
        List<String> args = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        boolean quoted = false;
        boolean escaped = false;
        for (int i = 0; i < input.length(); i++) {
            char ch = input.charAt(i);
            if (escaped) {
                current.append(ch);
                escaped = false;
                continue;
            }
            if (ch == '\\') {
                escaped = true;
                continue;
            }
            if (ch == '"') {
                quoted = !quoted;
                continue;
            }
            if (Character.isWhitespace(ch) && !quoted) {
                if (current.length() > 0) {
                    args.add(current.toString());
                    current.setLength(0);
                }
                continue;
            }
            current.append(ch);
        }
        if (current.length() > 0) {
            args.add(current.toString());
        }
        return args.toArray(String[]::new);
    }
}
