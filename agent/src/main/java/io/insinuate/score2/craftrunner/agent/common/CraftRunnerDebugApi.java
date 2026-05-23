package io.insinuate.score2.craftrunner.agent.common;

import java.util.LinkedHashMap;
import java.util.Map;

public final class CraftRunnerDebugApi {
    public final CommonDebugApi common;
    public final Object platform;

    CraftRunnerDebugApi(AgentPlatform agentPlatform) {
        this.common = new CommonDebugApi(agentPlatform);
        this.platform = agentPlatform.debugPlatformApi();
    }

    public Map<String, Object> api() {
        Map<String, Object> api = new LinkedHashMap<>();
        api.put("namespace", "cr");
        api.put("common", common.api());
        if (platform instanceof PlatformDebugApi platformApi) {
            api.put("platform", platformApi.api());
        } else {
            api.put("platform", platform.getClass().getName());
        }
        return api;
    }

    public String help() {
        return "Use cr.common for cross-platform Java helpers and cr.platform for current-platform helpers. "
            + "Call cr.api() for method groups and capabilities.";
    }
}
