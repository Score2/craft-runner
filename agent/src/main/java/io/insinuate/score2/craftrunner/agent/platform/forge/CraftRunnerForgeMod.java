package io.insinuate.score2.craftrunner.agent.platform.forge;

import io.insinuate.score2.craftrunner.agent.common.runtime.AgentPlatform;
import io.insinuate.score2.craftrunner.agent.common.runtime.AgentRuntime;
import io.insinuate.score2.craftrunner.agent.common.command.BrigadierAgentCommand;
import java.util.logging.Logger;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.RegisterCommandsEvent;
import net.minecraftforge.event.server.ServerStartedEvent;
import net.minecraftforge.event.server.ServerStoppingEvent;
import net.minecraftforge.eventbus.api.EventPriority;
import net.minecraftforge.fml.common.Mod;

@Mod("craft_runner_agent")
public final class CraftRunnerForgeMod implements AgentPlatform {
    private final Logger logger = Logger.getLogger("CraftRunnerAgent");
    private AgentRuntime runtime;
    private Object server;

    public CraftRunnerForgeMod() {
        MinecraftForge.EVENT_BUS.addListener(EventPriority.NORMAL, false, RegisterCommandsEvent.class, this::onRegisterCommands);
        MinecraftForge.EVENT_BUS.addListener(this::onServerStarted);
        MinecraftForge.EVENT_BUS.addListener(this::onServerStopping);
    }

    private void onRegisterCommands(RegisterCommandsEvent event) {
        BrigadierAgentCommand.register(dispatcherFrom(event), this, () -> runtime);
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
        return "forge";
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
            logger.warning("Could not resolve Forge server instance: " + error);
            return null;
        }
    }

    private Object dispatcherFrom(Object event) {
        try {
            return event.getClass().getMethod("getDispatcher").invoke(event);
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException("Could not resolve Forge command dispatcher", error);
        }
    }
}
