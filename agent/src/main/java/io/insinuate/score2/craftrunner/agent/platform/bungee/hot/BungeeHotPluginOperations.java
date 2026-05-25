package io.insinuate.score2.craftrunner.agent.platform.bungee.hot;

import io.insinuate.score2.craftrunner.agent.common.hot.AbstractHotPluginOperations;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import net.md_5.bungee.api.plugin.Plugin;

public final class BungeeHotPluginOperations extends AbstractHotPluginOperations {
    private final Plugin agentPlugin;

    public BungeeHotPluginOperations(Plugin agentPlugin) {
        this.agentPlugin = agentPlugin;
    }

    @Override
    public Map<String, Object> capabilities() {
        return ordered(
            "platform", "bungee",
            "family", "proxy",
            "hotLoadPlugin", false,
            "hotUnloadPlugin", false,
            "hotReloadPlugin", false,
            "supportedPluginTypes", List.of("bungee.yml"),
            "listPlugins", true,
            "warnings", List.of(
                "BungeeCord exposes plugin scanning and enable hooks, but not a clean single-plugin lifecycle API.",
                "Runtime load/unload is intentionally disabled until dependency handling and resource cleanup can be verified against a real proxy regression matrix."
            )
        );
    }

    @Override
    public Map<String, Object> list() {
        List<Map<String, Object>> plugins = new ArrayList<>();
        for (Plugin plugin : agentPlugin.getProxy().getPluginManager().getPlugins()) {
            plugins.add(pluginInfo(plugin));
        }
        return ordered(
            "action", "list",
            "platform", "bungee",
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

    private Map<String, Object> pluginInfo(Plugin plugin) {
        return ordered(
            "name", plugin.getDescription().getName(),
            "version", plugin.getDescription().getVersion(),
            "main", plugin.getDescription().getMain(),
            "author", plugin.getDescription().getAuthor(),
            "file", plugin.getFile() == null ? null : plugin.getFile().toPath().toString()
        );
    }

    private UnsupportedOperationException unsupported(String action) {
        return new UnsupportedOperationException("BungeeCord hot plugin " + action + " is not supported yet; restart the proxy for plugin lifecycle changes.");
    }
}
