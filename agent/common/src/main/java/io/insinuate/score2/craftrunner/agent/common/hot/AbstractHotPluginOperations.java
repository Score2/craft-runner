package io.insinuate.score2.craftrunner.agent.common.hot;

import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

public abstract class AbstractHotPluginOperations implements HotPluginOperations {
    @Override
    public Map<String, Object> reload(Path path, String pluginName, boolean enable) {
        Map<String, Object> unloaded = unload(pluginName);
        Map<String, Object> loaded = load(path, enable);
        return ordered(
            "action", "reload",
            "reloaded", true,
            "unload", unloaded,
            "load", loaded
        );
    }

    protected Map<String, Object> ordered(Object... pairs) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (int index = 0; index + 1 < pairs.length; index += 2) {
            result.put(String.valueOf(pairs[index]), pairs[index + 1]);
        }
        return result;
    }
}
