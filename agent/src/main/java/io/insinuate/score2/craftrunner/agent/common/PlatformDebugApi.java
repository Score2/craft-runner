package io.insinuate.score2.craftrunner.agent.common;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class PlatformDebugApi {
    protected final AgentPlatform platform;

    public PlatformDebugApi(AgentPlatform platform) {
        this.platform = platform;
    }

    public Map<String, Object> api() {
        Map<String, Object> api = new LinkedHashMap<>();
        api.put("scope", "platform");
        api.put("platform", name());
        api.put("capabilities", capabilities());
        api.put("methods", List.of(
            "name()", "server()", "plugin()", "serverClassName()",
            "isBukkit()", "isFabric()", "isForge()", "isNeoForge()",
            "capabilities()", "supports(capability)"
        ));
        return api;
    }

    public String name() {
        return platform.platformName();
    }

    public Object server() {
        return platform.serverObject();
    }

    public Object plugin() {
        return platform.pluginObject();
    }

    public String serverClassName() {
        Object server = server();
        return server == null ? null : server.getClass().getName();
    }

    public boolean isBukkit() {
        return "bukkit".equals(name());
    }

    public boolean isFabric() {
        return "fabric".equals(name());
    }

    public boolean isForge() {
        return "forge".equals(name());
    }

    public boolean isNeoForge() {
        return "neoforge".equals(name());
    }

    public List<String> capabilities() {
        return List.of("platform-info", "raw-server-object", "raw-plugin-object");
    }

    public boolean supports(String capability) {
        return capabilities().contains(capability);
    }
}
