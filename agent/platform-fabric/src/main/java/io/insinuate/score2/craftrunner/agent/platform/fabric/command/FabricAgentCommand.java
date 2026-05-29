package io.insinuate.score2.craftrunner.agent.platform.fabric.command;

import io.insinuate.score2.craftrunner.agent.common.runtime.AgentRuntime;
import io.insinuate.score2.craftrunner.agent.common.command.BrigadierAgentCommand;
import io.insinuate.score2.craftrunner.agent.platform.fabric.CraftRunnerFabricMod;
import java.lang.reflect.Proxy;
import java.util.function.Supplier;
import java.util.logging.Logger;

public final class FabricAgentCommand {
    private FabricAgentCommand() {
    }

    public static void register(CraftRunnerFabricMod platform, Supplier<AgentRuntime> runtimeSupplier, Logger logger) {
        try {
            Class<?> callbackType = Class.forName("net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback");
            Object event = callbackType.getField("EVENT").get(null);
            Object callback = Proxy.newProxyInstance(
                FabricAgentCommand.class.getClassLoader(),
                new Class<?>[] { callbackType },
                (proxy, method, args) -> {
                    if ("register".equals(method.getName()) && args != null && args.length > 0) {
                        BrigadierAgentCommand.register(args[0], platform, runtimeSupplier);
                    }
                    return null;
                }
            );
            event.getClass().getMethod("register", Object.class).invoke(event, callback);
        } catch (ClassNotFoundException error) {
            logger.info("Fabric API command callback is not present; /craftragent command is unavailable on Fabric.");
        } catch (ReflectiveOperationException | RuntimeException error) {
            logger.warning("Failed to register Craft Runner Fabric command: " + error);
        }
    }
}
