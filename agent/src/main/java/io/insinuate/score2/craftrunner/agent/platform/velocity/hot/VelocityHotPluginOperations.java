package io.insinuate.score2.craftrunner.agent.platform.velocity.hot;

import com.velocitypowered.api.plugin.PluginContainer;
import com.velocitypowered.api.proxy.ProxyServer;
import io.insinuate.score2.craftrunner.agent.common.hot.AbstractHotPluginOperations;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public final class VelocityHotPluginOperations extends AbstractHotPluginOperations {
    private final ProxyServer proxy;

    public VelocityHotPluginOperations(ProxyServer proxy) {
        this.proxy = proxy;
    }

    @Override
    public Map<String, Object> capabilities() {
        return ordered(
            "platform", "velocity",
            "family", "proxy",
            "hotLoadPlugin", false,
            "hotUnloadPlugin", false,
            "hotReloadPlugin", false,
            "supportedPluginTypes", List.of("velocity-plugin.json"),
            "listPlugins", true,
            "warnings", List.of(
                "Velocity has no public unload API.",
                "Velocity runtime loading is not enabled because ProxyInitializeEvent cannot be safely replayed only for a newly loaded plugin without affecting existing plugins."
            )
        );
    }

    @Override
    public Map<String, Object> list() {
        List<Map<String, Object>> plugins = new ArrayList<>();
        for (PluginContainer plugin : proxy.getPluginManager().getPlugins()) {
            plugins.add(pluginInfo(plugin));
        }
        return ordered(
            "action", "list",
            "platform", "velocity",
            "plugins", plugins,
            "count", plugins.size()
        );
    }

    @Override
    public Map<String, Object> load(Path path, boolean enable) {
        throw unsupported("load");
    }

    @Override
    public Map<String, Object> unload(String pluginName) {
        throw unsupported("unload");
    }

    @Override
    public Map<String, Object> reload(Path path, String pluginName, boolean enable) {
        throw unsupported("reload");
    }

    private Map<String, Object> pluginInfo(PluginContainer plugin) {
        return ordered(
            "id", plugin.getDescription().getId(),
            "name", plugin.getDescription().getName().orElse(null),
            "version", plugin.getDescription().getVersion().orElse(null),
            "authors", plugin.getDescription().getAuthors(),
            "source", plugin.getDescription().getSource().map(Path::toString).orElse(null),
            "instance", plugin.getInstance().map(instance -> instance.getClass().getName()).orElse(null)
        );
    }

    private UnsupportedOperationException unsupported(String action) {
        return new UnsupportedOperationException("Velocity hot plugin " + action + " is not supported yet; restart the proxy for plugin lifecycle changes.");
    }
}
