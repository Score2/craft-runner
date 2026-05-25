package io.insinuate.score2.craftrunner.agent.common.hot;

import io.insinuate.score2.craftrunner.agent.common.AgentPlatform;
import io.insinuate.score2.craftrunner.agent.common.DebugRequest;
import java.nio.file.Path;
import java.util.Locale;

public final class HotPluginExecutor {
    private final AgentPlatform platform;

    public HotPluginExecutor(AgentPlatform platform) {
        this.platform = platform;
    }

    public Object execute(DebugRequest request) {
        HotPluginOperations operations = platform.hotPluginOperations();
        String action = request.action == null ? "" : request.action.toLowerCase(Locale.ROOT);
        return switch (action) {
            case "capabilities" -> operations.capabilities();
            case "list" -> operations.list();
            case "load" -> operations.load(requiredPath(request.path), request.enable);
            case "unload" -> operations.unload(required(request.pluginName, "pluginName"));
            case "reload" -> operations.reload(requiredPath(request.path), required(request.pluginName, "pluginName"), request.enable);
            default -> throw new IllegalArgumentException("unsupported hot plugin action: " + request.action);
        };
    }

    private Path requiredPath(String value) {
        return Path.of(required(value, "path")).toAbsolutePath().normalize();
    }

    private String required(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " is required");
        }
        return value;
    }
}
