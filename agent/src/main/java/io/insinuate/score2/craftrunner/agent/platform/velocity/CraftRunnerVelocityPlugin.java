package io.insinuate.score2.craftrunner.agent.platform.velocity;

import com.google.inject.Inject;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.event.proxy.ProxyShutdownEvent;
import com.velocitypowered.api.plugin.Plugin;
import com.velocitypowered.api.plugin.PluginContainer;
import com.velocitypowered.api.proxy.ProxyServer;
import io.insinuate.score2.craftrunner.agent.common.runtime.AgentPlatform;
import io.insinuate.score2.craftrunner.agent.common.runtime.AgentRuntime;
import io.insinuate.score2.craftrunner.agent.common.hot.HotPluginOperations;
import io.insinuate.score2.craftrunner.agent.platform.velocity.api.VelocityDebugApi;
import io.insinuate.score2.craftrunner.agent.platform.velocity.command.CloudVelocityAgentCommand;
import io.insinuate.score2.craftrunner.agent.platform.velocity.hot.VelocityHotPluginOperations;
import java.net.InetSocketAddress;
import java.util.logging.Level;
import java.util.logging.Logger;

@Plugin(
    id = "craft-runner-agent",
    name = "CraftRunnerAgent",
    version = "1.0.0",
    description = "Local craft-runner debug bridge for executing JavaScript through a file mailbox.",
    authors = {"Score2"}
)
public final class CraftRunnerVelocityPlugin implements AgentPlatform {
    private final ProxyServer proxy;
    private final org.slf4j.Logger slf4jLogger;
    private final Logger logger = Logger.getLogger("CraftRunnerAgent-Velocity");
    private AgentRuntime runtime;
    private VelocityHotPluginOperations hotPluginOperations;

    @Inject
    public CraftRunnerVelocityPlugin(ProxyServer proxy, org.slf4j.Logger logger) {
        this.proxy = proxy;
        this.slf4jLogger = logger;
    }

    @Subscribe
    public void onProxyInitialization(ProxyInitializeEvent event) {
        hotPluginOperations = new VelocityHotPluginOperations(proxy);
        runtime = new AgentRuntime(this);
        runtime.enable();
        try {
            PluginContainer container = proxy.getPluginManager().ensurePluginContainer(this);
            CloudVelocityAgentCommand.register(container, proxy, this, runtime);
        } catch (Exception error) {
            slf4jLogger.warn("Failed to register Craft Runner agent command", error);
            logger.log(Level.WARNING, "Failed to register Craft Runner agent command", error);
        }
    }

    @Subscribe
    public void onProxyShutdown(ProxyShutdownEvent event) {
        if (runtime != null) {
            runtime.disable();
        }
    }

    public ProxyServer proxy() {
        return proxy;
    }

    @Override
    public String platformName() {
        return "velocity";
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
        return proxy;
    }

    @Override
    public int serverPort() {
        InetSocketAddress address = proxy.getBoundAddress();
        return address == null ? -1 : address.getPort();
    }

    @Override
    public Object debugPlatformApi() {
        return new VelocityDebugApi(this);
    }

    @Override
    public HotPluginOperations hotPluginOperations() {
        if (hotPluginOperations == null) {
            hotPluginOperations = new VelocityHotPluginOperations(proxy);
        }
        return hotPluginOperations;
    }
}
