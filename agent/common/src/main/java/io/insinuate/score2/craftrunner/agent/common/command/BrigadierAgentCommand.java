package io.insinuate.score2.craftrunner.agent.common.command;

import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.builder.RequiredArgumentBuilder;
import com.mojang.brigadier.suggestion.SuggestionsBuilder;
import io.insinuate.score2.craftrunner.agent.common.runtime.AgentPlatform;
import io.insinuate.score2.craftrunner.agent.common.runtime.AgentRuntime;
import java.lang.reflect.Method;
import java.util.List;
import java.util.function.Supplier;

public final class BrigadierAgentCommand {
    private BrigadierAgentCommand() {
    }

    public static void register(Object dispatcher, AgentPlatform platform, Supplier<AgentRuntime> runtimeSupplier) {
        register(dispatcher, command("craftragent", platform, runtimeSupplier));
        register(dispatcher, command("cra", platform, runtimeSupplier));
    }

    private static LiteralArgumentBuilder<Object> command(String label, AgentPlatform platform, Supplier<AgentRuntime> runtimeSupplier) {
        return LiteralArgumentBuilder.<Object>literal(label)
            .executes(context -> {
                execute(context.getSource(), label, "", platform, runtimeSupplier);
                return 1;
            })
            .then(RequiredArgumentBuilder.<Object, String>argument("args", StringArgumentType.greedyString())
                .suggests((context, builder) -> suggest(builder, platform, runtimeSupplier))
                .executes(context -> {
                    execute(context.getSource(), label, StringArgumentType.getString(context, "args"), platform, runtimeSupplier);
                    return 1;
                }));
    }

    private static void execute(Object source, String label, String rawArgs, AgentPlatform platform, Supplier<AgentRuntime> runtimeSupplier) {
        AgentRuntime runtime = runtimeSupplier.get();
        if (runtime == null) {
            sendMessage(source, "CraftRunnerAgent is not enabled yet.");
            return;
        }
        AgentCommandController controller = new AgentCommandController(platform, runtime);
        controller.execute(message -> sendMessage(source, message), label, rawArgs);
    }

    private static void register(Object dispatcher, LiteralArgumentBuilder<Object> command) {
        try {
            Method register = dispatcher.getClass().getMethod("register", LiteralArgumentBuilder.class);
            register.invoke(dispatcher, command);
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException("Failed to register Brigadier command: " + command.getLiteral(), error);
        }
    }

    private static java.util.concurrent.CompletableFuture<com.mojang.brigadier.suggestion.Suggestions> suggest(
        SuggestionsBuilder builder,
        AgentPlatform platform,
        Supplier<AgentRuntime> runtimeSupplier
    ) {
        AgentRuntime runtime = runtimeSupplier.get();
        if (runtime == null) {
            return builder.buildFuture();
        }
        AgentCommandController controller = new AgentCommandController(platform, runtime);
        List<String> suggestions = controller.suggest(builder.getRemaining());
        for (String suggestion : suggestions) {
            builder.suggest(suggestion);
        }
        return builder.buildFuture();
    }

    private static void sendMessage(Object source, String message) {
        try {
            Class<?> component = Class.forName("net.minecraft.network.chat.Component");
            Object text = component.getMethod("literal", String.class).invoke(null, message);
            source.getClass().getMethod("sendSystemMessage", component).invoke(source, text);
        } catch (ReflectiveOperationException error) {
            try {
                source.getClass().getMethod("sendMessage", String.class).invoke(source, message);
            } catch (ReflectiveOperationException ignored) {
                // Console feedback is best-effort across Minecraft mod loaders.
            }
        }
    }
}
