package io.insinuate.score2.craftrunner.agent.platform.bungee;

import io.insinuate.score2.craftrunner.agent.common.AgentPlatform;
import io.insinuate.score2.craftrunner.agent.common.PlatformDebugApi;
import java.util.List;
import net.md_5.bungee.api.ProxyServer;

public final class BungeeDebugApi extends PlatformDebugApi {
    private final ProxyServer proxy;

    BungeeDebugApi(CraftRunnerBungeePlugin plugin) {
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
