package io.insinuate.score2.craftrunner.agent.common.hot;

import java.nio.file.Path;
import java.util.Map;

public interface HotPluginOperations {
    Map<String, Object> capabilities();

    Map<String, Object> list();

    Map<String, Object> load(Path path, boolean enable);

    Map<String, Object> unload(String pluginName);

    default Map<String, Object> reload(Path path, String pluginName, boolean enable) {
        Map<String, Object> unloaded = unload(pluginName);
        Map<String, Object> loaded = load(path, enable);
        return Map.of(
            "action", "reload",
            "unload", unloaded,
            "load", loaded
        );
    }
}
