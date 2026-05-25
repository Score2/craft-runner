package io.insinuate.score2.craftrunner.agent.platform.velocity.api;

import com.velocitypowered.api.proxy.ProxyServer;
import io.insinuate.score2.craftrunner.agent.common.runtime.AgentPlatform;
import io.insinuate.score2.craftrunner.agent.common.api.PlatformDebugApi;
import io.insinuate.score2.craftrunner.agent.platform.velocity.CraftRunnerVelocityPlugin;
import java.util.List;

public final class VelocityDebugApi extends PlatformDebugApi {
    private final ProxyServer proxy;

    public VelocityDebugApi(CraftRunnerVelocityPlugin plugin) {
        super((AgentPlatform) plugin);
        this.proxy = plugin.proxy();
    }

    public List<String> onlinePlayerNames() {
        return proxy.getAllPlayers().stream().map(player -> player.getUsername()).toList();
    }

    public List<String> serverNames() {
        return proxy.getAllServers().stream().map(server -> server.getServerInfo().getName()).sorted().toList();
    }

    public int onlineCount() {
        return proxy.getPlayerCount();
    }
}
