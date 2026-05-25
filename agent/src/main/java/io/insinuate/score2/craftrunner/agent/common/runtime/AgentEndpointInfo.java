package io.insinuate.score2.craftrunner.agent.common.runtime;

import java.nio.file.Path;
import java.util.Map;

public record AgentEndpointInfo(
    Path root,
    Path endpoint,
    String endpointName,
    String token,
    boolean generatedConfig,
    boolean enabled
) {
    public Map<String, Object> asMap() {
        return Map.of(
            "enabled", enabled,
            "root", root.toString(),
            "endpoint", endpoint.toString(),
            "endpointName", endpointName,
            "token", token,
            "generatedConfig", generatedConfig
        );
    }
}
