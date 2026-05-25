package io.insinuate.score2.craftrunner.agent.platform.bungee.api;

import io.insinuate.score2.craftrunner.agent.common.runtime.AgentPlatform;
import io.insinuate.score2.craftrunner.agent.common.api.PlatformDebugApi;
import io.insinuate.score2.craftrunner.agent.platform.bungee.CraftRunnerBungeePlugin;
import java.util.List;
import net.md_5.bungee.api.ProxyServer;

public final class BungeeDebugApi extends PlatformDebugApi {
    private final ProxyServer proxy;

    public BungeeDebugApi(CraftRunnerBungeePlugin plugin) {
        super((AgentPlatform) plugin);
        this.proxy = plugin.getProxy();
    }

    public List<String> onlinePlayerNames() {
        return proxy.getPlayers().stream().map(player -> player.getName()).toList();
    }

    public List<String> serverNames() {
        return proxy.getServers().keySet().stream().sorted().toList();
    }

    public int onlineCount() {
        return proxy.getOnlineCount();
    }
}
