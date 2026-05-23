package io.insinuate.score2.craftrunner.agent.platform.neoforge;

import io.insinuate.score2.craftrunner.agent.common.AgentPlatform;
import io.insinuate.score2.craftrunner.agent.common.AgentRuntime;
import java.util.logging.Logger;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;

@Mod("craft_runner_agent")
public final class CraftRunnerNeoForgeMod implements AgentPlatform {
    private final Logger logger = Logger.getLogger("CraftRunnerAgent");
    private AgentRuntime runtime;
    private Object server;

    public CraftRunnerNeoForgeMod() {
        NeoForge.EVENT_BUS.addListener(this::onServerStarted);
        NeoForge.EVENT_BUS.addListener(this::onServerStopping);
    }

    private void onServerStarted(ServerStartedEvent event) {
        server = serverFrom(event);
        runtime = new AgentRuntime(this);
        runtime.enable();
    }

    private void onServerStopping(ServerStoppingEvent event) {
        if (runtime != null) {
            runtime.disable();
            runtime = null;
        }
        server = null;
    }

    @Override
    public String platformName() {
        return "neoforge";
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
        return server;
    }

    private Object serverFrom(Object event) {
        try {
            return event.getClass().getMethod("getServer").invoke(event);
        } catch (ReflectiveOperationException error) {
            logger.warning("Could not resolve NeoForge server instance: " + error);
            return null;
        }
    }
}
