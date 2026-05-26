package io.insinuate.score2.craftrunner.agent.platform.bungee;

import io.insinuate.score2.craftrunner.agent.common.runtime.AgentPlatform;
import io.insinuate.score2.craftrunner.agent.common.runtime.AgentRuntime;
import io.insinuate.score2.craftrunner.agent.common.hot.HotPluginOperations;
import io.insinuate.score2.craftrunner.agent.platform.bungee.api.BungeeDebugApi;
import io.insinuate.score2.craftrunner.agent.platform.bungee.command.CloudBungeeAgentCommand;
import io.insinuate.score2.craftrunner.agent.platform.bungee.hot.BungeeHotPluginOperations;
import java.net.SocketAddress;
import java.util.logging.Logger;
import net.md_5.bungee.api.config.ListenerInfo;
import net.md_5.bungee.api.chat.TextComponent;
import net.md_5.bungee.api.plugin.Plugin;

public final class CraftRunnerBungeePlugin extends Plugin implements AgentPlatform {
    private AgentRuntime runtime;
    private BungeeHotPluginOperations hotPluginOperations;

    @Override
    public void onEnable() {
        // Bungee's plugin class loader does not expose multi-release entries the way Truffle checks expect.
        System.setProperty("polyglotimpl.DisableMultiReleaseCheck", System.getProperty("polyglotimpl.DisableMultiReleaseCheck", "true"));
        hotPluginOperations = new BungeeHotPluginOperations(this);
        runtime = new AgentRuntime(this);
        runtime.enable();
        try {
            CloudBungeeAgentCommand.register(this, this, runtime);
        } catch (Exception error) {
            getLogger().warning("Failed to register Craft Runner agent command: " + error);
        }
    }

    @Override
    public void onDisable() {
        if (runtime != null) {
            runtime.disable();
        }
    }

    @Override
    public String platformName() {
        return "bungee";
    }

    @Override
    public Logger logger() {
        return getLogger();
    }

    @Override
    public Object pluginObject() {
        return this;
    }

    @Override
    public Object serverObject() {
        return getProxy();
    }

    @Override
    public void remoteMessage(String message) {
        getProxy().getConsole().sendMessage(TextComponent.fromLegacyText(message));
    }

    @Override
    public int serverPort() {
        try {
            ListenerInfo listener = getProxy().getConfig().getListeners().iterator().next();
            SocketAddress address = listener.getSocketAddress();
            if (address instanceof java.net.InetSocketAddress inetSocketAddress) {
                return inetSocketAddress.getPort();
            }
            return listener.getHost().getPort();
        } catch (Exception ignored) {
            return -1;
        }
    }

    @Override
    public Object debugPlatformApi() {
        return new BungeeDebugApi(this);
    }

    @Override
    public HotPluginOperations hotPluginOperations() {
        if (hotPluginOperations == null) {
            hotPluginOperations = new BungeeHotPluginOperations(this);
        }
        return hotPluginOperations;
    }
}
