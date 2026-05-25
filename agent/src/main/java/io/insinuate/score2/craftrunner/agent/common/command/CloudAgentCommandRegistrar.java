package io.insinuate.score2.craftrunner.agent.common.command;

import io.insinuate.score2.craftrunner.agent.common.runtime.AgentPlatform;
import io.insinuate.score2.craftrunner.agent.common.runtime.AgentRuntime;
import java.util.function.Function;
import org.incendo.cloud.Command;
import org.incendo.cloud.CommandManager;
import org.incendo.cloud.context.CommandContext;
import org.incendo.cloud.parser.standard.StringParser;
import org.incendo.cloud.suggestion.SuggestionProvider;

public final class CloudAgentCommandRegistrar<C> {
    private static final String PERMISSION = "craftrunner.agent";

    private final CommandManager<C> commandManager;
    private final Function<C, AgentCommandSender> senderMapper;
    private final AgentCommandController controller;

    public CloudAgentCommandRegistrar(
        CommandManager<C> commandManager,
        Function<C, AgentCommandSender> senderMapper,
        AgentPlatform platform,
        AgentRuntime runtime
    ) {
        this.commandManager = commandManager;
        this.senderMapper = senderMapper;
        this.controller = new AgentCommandController(platform, runtime);
    }

    public void register() {
        commandManager.command(base().handler(context -> controller.help(sender(context), "craftragent")));
        registerInfoCommands();
        registerHotCommands();
    }

    private void registerInfoCommands() {
        commandManager.command(base().literal("help").handler(context -> controller.help(sender(context), "craftragent")));
        commandManager.command(base().literal("status").handler(context -> controller.status(sender(context))));
        commandManager.command(base().literal("token").handler(context -> controller.token(sender(context))));
        commandManager.command(base().literal("connect").handler(context -> controller.connect(sender(context))));
        commandManager.command(base().literal("code").handler(context -> controller.connect(sender(context))));
    }

    private void registerHotCommands() {
        for (String literal : new String[] {"capabilities", "hot-capabilities"}) {
            commandManager.command(base().literal(literal).handler(context -> controller.capabilities(sender(context))));
        }
        for (String literal : new String[] {"list", "hot-list"}) {
            commandManager.command(base().literal(literal).handler(context -> controller.list(sender(context))));
        }
        for (String literal : new String[] {"load", "hot-load"}) {
            commandManager.command(base().literal(literal)
                .required("plugin", StringParser.stringParser(), loadSuggestions())
                .handler(context -> controller.load(sender(context), requireString(context, "plugin"), true)));
            commandManager.command(base().literal(literal)
                .required("plugin", StringParser.stringParser(), loadSuggestions())
                .literal("--no-enable")
                .handler(context -> controller.load(sender(context), requireString(context, "plugin"), false)));
        }
        for (String literal : new String[] {"unload", "hot-unload"}) {
            commandManager.command(base().literal(literal)
                .required("plugin", StringParser.stringParser(), loadedSuggestions())
                .handler(context -> controller.unload(sender(context), requireString(context, "plugin"))));
        }
        for (String literal : new String[] {"reload", "hot-reload"}) {
            commandManager.command(base().literal(literal)
                .required("plugin", StringParser.stringParser(), loadedSuggestions())
                .handler(context -> controller.reload(sender(context), requireString(context, "plugin"), null, true)));
            commandManager.command(base().literal(literal)
                .required("plugin", StringParser.stringParser(), loadedSuggestions())
                .literal("--no-enable")
                .handler(context -> controller.reload(sender(context), requireString(context, "plugin"), null, false)));
            commandManager.command(base().literal(literal)
                .required("plugin", StringParser.stringParser(), loadedSuggestions())
                .required("jar", StringParser.stringParser(), loadSuggestions())
                .handler(context -> controller.reload(sender(context), requireString(context, "plugin"), requireString(context, "jar"), true)));
            commandManager.command(base().literal(literal)
                .required("plugin", StringParser.stringParser(), loadedSuggestions())
                .required("jar", StringParser.stringParser(), loadSuggestions())
                .literal("--no-enable")
                .handler(context -> controller.reload(sender(context), requireString(context, "plugin"), requireString(context, "jar"), false)));
        }
    }

    private Command.Builder<C> base() {
        return commandManager.commandBuilder("craftragent", "cra").permission(PERMISSION);
    }

    private SuggestionProvider<C> loadSuggestions() {
        return SuggestionProvider.blockingStrings((context, input) -> controller.suggestLoad(input.input()));
    }

    private SuggestionProvider<C> loadedSuggestions() {
        return SuggestionProvider.blockingStrings((context, input) -> controller.suggestLoaded(input.input()));
    }

    private AgentCommandSender sender(CommandContext<C> context) {
        return senderMapper.apply(context.sender());
    }

    private String requireString(CommandContext<C> context, String key) {
        return context.<String>optional(key).orElseThrow(() -> new IllegalArgumentException(key + " is required"));
    }
}
