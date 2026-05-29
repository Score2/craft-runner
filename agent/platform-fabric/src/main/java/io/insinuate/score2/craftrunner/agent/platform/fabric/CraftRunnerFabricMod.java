package io.insinuate.score2.craftrunner.agent.platform.fabric;

import io.insinuate.score2.craftrunner.agent.common.runtime.AgentPlatform;
import io.insinuate.score2.craftrunner.agent.common.runtime.AgentRuntime;
import io.insinuate.score2.craftrunner.agent.platform.fabric.command.FabricAgentCommand;
import java.util.logging.Logger;
import net.fabricmc.api.DedicatedServerModInitializer;
import net.fabricmc.loader.api.FabricLoader;

public final class CraftRunnerFabricMod implements DedicatedServerModInitializer, AgentPlatform {
    private final Logger logger = Logger.getLogger("CraftRunnerAgent");
    private AgentRuntime runtime;

    @Override
    public void onInitializeServer() {
        runtime = new AgentRuntime(this);
        runtime.enable();
        FabricAgentCommand.register(this, () -> runtime, logger);
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            if (runtime != null) {
                runtime.disable();
            }
        }, "craft-runner-agent-fabric-shutdown"));
    }

    @Override
    public String platformName() {
        return "fabric";
    }

    @Override
    public Logger logger() {
        return logger;
    }

    @Override
    public Object pluginObject() {
        return this;
    }

    @Override
    public Object serverObject() {
        return FabricLoader.getInstance().getGameInstance();
    }
}
