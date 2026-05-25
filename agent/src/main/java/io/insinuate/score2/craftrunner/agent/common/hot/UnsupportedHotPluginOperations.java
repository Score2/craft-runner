package io.insinuate.score2.craftrunner.agent.common.hot;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

public final class UnsupportedHotPluginOperations implements HotPluginOperations {
    private final String platformName;

    public UnsupportedHotPluginOperations(String platformName) {
        this.platformName = platformName;
    }

    @Override
    public Map<String, Object> capabilities() {
        return Map.of(
            "platform", platformName,
            "hotLoadPlugin", false,
            "hotUnloadPlugin", false,
            "hotReloadPlugin", false,
            "supportedPluginTypes", List.of(),
            "warnings", List.of("Hot plugin lifecycle is currently implemented only for Bukkit-family and proxy platforms.")
        );
    }

    @Override
    public Map<String, Object> list() {
        throw unsupported();
    }

    @Override
    public Map<String, Object> load(Path path, boolean enable) {
        throw unsupported();
    }

    @Override
    public Map<String, Object> unload(String pluginName) {
        throw unsupported();
    }

    private UnsupportedOperationException unsupported() {
        return new UnsupportedOperationException("hot plugin lifecycle is not supported for platform: " + platformName);
    }
}
