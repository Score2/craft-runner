package io.insinuate.score2.craftrunner.agent.common.command;

import io.insinuate.score2.craftrunner.agent.common.runtime.AgentPlatform;
import io.insinuate.score2.craftrunner.agent.common.runtime.AgentRuntime;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class AgentCommandController {
    private static final List<String> SUBCOMMANDS = List.of(
        "help",
        "info",
        "token",
        "js-status",
        "js-load",
        "list",
        "load",
        "unload",
        "reload",
        "hot-info",
        "hot-list",
        "hot-load",
        "hot-unload",
        "hot-reload"
    );

    private final AgentCommandContext context;
    private final AgentHelpCommand helpCommand = new AgentHelpCommand();
    private final AgentInfoCommand infoCommand = new AgentInfoCommand();
    private final AgentHotCommand hotCommand = new AgentHotCommand();
    private final AgentJsCommand jsCommand = new AgentJsCommand();

    public AgentCommandController(AgentPlatform platform, AgentRuntime runtime) {
        this.context = new AgentCommandContext(platform, runtime);
    }

    public void execute(AgentCommandSender sender, String label, String rawArgs) {
        execute(sender, label, splitArgs(rawArgs));
    }

    public void execute(AgentCommandSender sender, String label, String[] args) {
        if (args.length == 0 || "help".equalsIgnoreCase(args[0])) {
            help(sender, label);
            return;
        }
        switch (args[0].toLowerCase(Locale.ROOT)) {
            case "info", "hot-info" -> info(sender, args.length > 1 ? args[1] : null);
            case "token" -> token(sender);
            case "js-status" -> jsStatus(sender);
            case "js-load" -> jsLoad(sender);
            case "list", "hot-list" -> list(sender);
            case "hot-load", "load" -> load(sender, required(args, 1, "plugin jar or plugin name"), !context.contains(args, "--no-enable"));
            case "hot-unload", "unload" -> unload(sender, required(args, 1, "plugin name"));
            case "hot-reload", "reload" -> {
                String pluginName = required(args, 1, "plugin name");
                String pluginJarOrName = args.length > 2 && !args[2].startsWith("--") ? args[2] : null;
                reload(sender, pluginName, pluginJarOrName, !context.contains(args, "--no-enable"));
            }
            default -> help(sender, label);
        }
    }

    public void help(AgentCommandSender sender, String label) {
        run(sender, () -> helpCommand.execute(context, sender, label));
    }

    public void info(AgentCommandSender sender, String pluginName) {
        run(sender, () -> infoCommand.info(context, sender, pluginName));
    }

    public void token(AgentCommandSender sender) {
        run(sender, () -> infoCommand.token(context, sender));
    }

    public void jsStatus(AgentCommandSender sender) {
        run(sender, () -> jsCommand.status(context, sender));
    }

    public void jsLoad(AgentCommandSender sender) {
        run(sender, () -> jsCommand.load(context, sender));
    }

    public void list(AgentCommandSender sender) {
        run(sender, () -> hotCommand.list(context, sender));
    }

    public void load(AgentCommandSender sender, String pluginJarOrName, boolean enable) {
        run(sender, () -> hotCommand.load(context, sender, pluginJarOrName, enable));
    }

    public void unload(AgentCommandSender sender, String pluginName) {
        run(sender, () -> hotCommand.unload(context, sender, pluginName));
    }

    public void reload(AgentCommandSender sender, String pluginName, String pluginJarOrName, boolean enable) {
        run(sender, () -> hotCommand.reload(context, sender, pluginName, pluginJarOrName, enable));
    }

    public List<String> suggest(String rawArgs) {
        String[] args = splitArgs(rawArgs);
        boolean trailingSpace = rawArgs != null && rawArgs.endsWith(" ");
        if (args.length == 0 || (args.length == 1 && !trailingSpace)) {
            String prefix = args.length == 0 ? "" : args[0].toLowerCase(Locale.ROOT);
            return suggestRoot(prefix);
        }
        String command = args[0].toLowerCase(Locale.ROOT);
        int argumentIndex = trailingSpace ? args.length : args.length - 1;
        String current = trailingSpace ? "" : args[args.length - 1];
        if (argumentIndex == 1 && ("hot-load".equals(command) || "load".equals(command))) {
            return suggestLoad(current);
        }
        if (argumentIndex == 1 && ("hot-info".equals(command) || "info".equals(command))) {
            return suggestLoaded(current);
        }
        if (argumentIndex == 1 && ("hot-unload".equals(command) || "unload".equals(command))) {
            return suggestLoaded(current);
        }
        if (argumentIndex == 1 && ("hot-reload".equals(command) || "reload".equals(command))) {
            return suggestLoaded(current);
        }
        if (argumentIndex == 2 && ("hot-reload".equals(command) || "reload".equals(command))) {
            return suggestLoad(current);
        }
        return List.of();
    }

    public List<String> suggestRoot(String prefix) {
        return context.prefix(prefix, SUBCOMMANDS);
    }

    public List<String> suggestLoad(String prefix) {
        return context.prefix(prefix, context.loadSuggestions());
    }

    public List<String> suggestLoaded(String prefix) {
        return context.prefix(prefix, context.loadedPluginNames());
    }

    private void run(AgentCommandSender sender, Runnable command) {
        try {
            command.run();
        } catch (Throwable error) {
            context.sendError(sender, "CraftRunnerAgent error: " + error.getMessage());
            context.platform().logger().warning("Command failed: " + error);
        }
    }

    private String required(String[] args, int index, String name) {
        if (args.length <= index || args[index].isBlank()) {
            throw new IllegalArgumentException(name + " is required");
        }
        return args[index];
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
                if (!current.isEmpty()) {
                    args.add(current.toString());
                    current.setLength(0);
                }
                continue;
            }
            current.append(ch);
        }
        if (!current.isEmpty()) {
            args.add(current.toString());
        }
        return args.toArray(String[]::new);
    }
}
