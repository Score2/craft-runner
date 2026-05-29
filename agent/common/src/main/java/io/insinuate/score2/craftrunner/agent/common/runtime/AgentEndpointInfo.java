package io.insinuate.score2.craftrunner.agent.common.runtime;

import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public record AgentEndpointInfo(
    Path root,
    Path endpoint,
    Path socket,
    String endpointName,
    String platform,
    int serverPort,
    Path serverDir,
    String token,
    boolean generatedConfig,
    boolean enabled
) {
    public Map<String, Object> asMap() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("schema", "craft-runner-agent-endpoint");
        result.put("version", 1);
        result.put("enabled", enabled);
        result.put("root", root.toString());
        result.put("endpoint", endpoint.toString());
        result.put("endpointName", endpointName);
        result.put("platform", platform);
        result.put("serverPort", serverPort);
        result.put("serverDir", serverDir.toString());
        result.put("token", token);
        result.put("generatedConfig", generatedConfig);
        result.put("lastSeenAt", java.time.Instant.now().toString());
        if (socket != null) {
            result.put("socket", socket.toString());
            result.put("transports", List.of(
                Map.of("type", "unix-socket", "path", socket.toString()),
                Map.of("type", "file-mailbox", "path", endpoint.toString())
            ));
        } else {
            result.put("transports", List.of(Map.of("type", "file-mailbox", "path", endpoint.toString())));
        }
        return result;
    }
}
