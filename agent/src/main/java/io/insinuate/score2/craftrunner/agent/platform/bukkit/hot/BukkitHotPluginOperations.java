package io.insinuate.score2.craftrunner.agent.platform.bukkit.hot;

import io.insinuate.score2.craftrunner.agent.common.hot.AbstractHotPluginOperations;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.bukkit.Bukkit;
import org.bukkit.plugin.Plugin;

public final class BukkitHotPluginOperations extends AbstractHotPluginOperations {
    private final BukkitPluginInspector inspector = new BukkitPluginInspector();
    private final PaperPluginRuntimeLoader paperLoader = new PaperPluginRuntimeLoader();
    private final BukkitPluginUnloader unloader;

    public BukkitHotPluginOperations(Plugin agentPlugin) {
        this.unloader = new BukkitPluginUnloader(agentPlugin, inspector);
    }

    @Override
    public Map<String, Object> capabilities() {
        List<String> warnings = new ArrayList<>();
        warnings.add("Unload is best-effort and may leave static state, threads, native resources, or third-party registries behind.");
        if (inspector.isPaperFamily()) {
            warnings.add("paper-plugin.yml runtime loading uses Paper internals reflectively because Paper's public runtime path rejects Paper plugin providers.");
        } else {
            warnings.add("paper-plugin.yml plugins require Paper/Folia internals and are not supported on this platform.");
        }
        if (inspector.isFolia()) {
            warnings.add("Folia lifecycle actions run on the global scheduler; plugin code with main-thread assumptions may still be unsafe.");
        }
        return ordered(
            "platform", inspector.platformName(),
            "family", "bukkit",
            "hotLoadPlugin", true,
            "hotUnloadPlugin", "best-effort",
            "hotReloadPlugin", "best-effort",
            "supportedPluginTypes", inspector.isPaperFamily() ? List.of("plugin.yml", "paper-plugin.yml") : List.of("plugin.yml"),
            "paperPluginYmlRuntimeLoad", inspector.isPaperFamily() ? "reflective-paper-internals" : false,
            "remapping", inspector.isPaperFamily() ? "delegated-to-server" : "not-applicable",
            "scheduler", inspector.isFolia() ? "folia-global" : "bukkit-sync",
            "warnings", warnings
        );
    }

    @Override
    public Map<String, Object> list() {
        List<Map<String, Object>> plugins = new ArrayList<>();
        for (Plugin plugin : Bukkit.getPluginManager().getPlugins()) {
            plugins.add(inspector.pluginInfo(plugin));
        }
        return ordered(
            "action", "list",
            "plugins", plugins,
            "count", plugins.size()
        );
    }

    @Override
    public Map<String, Object> load(Path path, boolean enable) {
        List<String> warnings = new ArrayList<>();
        BukkitPluginDescriptor descriptor = inspector.inspectJar(path);
        Plugin plugin;
        String type;

        if (descriptor.paperPluginYml()) {
            if (!inspector.isPaperFamily()) {
                throw new IllegalArgumentException("paper-plugin.yml plugins require Paper/Folia internals; this server is not Paper-family.");
            }
            warnings.add("Loaded paper-plugin.yml through reflective Paper internals; this is best-effort and may break across Paper versions.");
            plugin = paperLoader.load(path, warnings);
            type = "paper-plugin.yml";
        } else {
            if (!descriptor.pluginYml()) {
                throw new IllegalArgumentException("Plugin jar does not contain plugin.yml.");
            }
            if (descriptor.pluginName() != null && Bukkit.getPluginManager().getPlugin(descriptor.pluginName()) != null) {
                throw new IllegalStateException("Plugin is already loaded: " + descriptor.pluginName());
            }
            plugin = loadBukkitPlugin(path);
            type = "plugin.yml";
        }

        if (enable) {
            Bukkit.getPluginManager().enablePlugin(plugin);
            if (!plugin.isEnabled()) {
                warnings.add("Server accepted the plugin but it is not enabled; inspect the server log for plugin startup errors.");
            }
        }

        return ordered(
            "action", "load",
            "loaded", true,
            "enabled", plugin.isEnabled(),
            "plugin", inspector.pluginInfo(plugin),
            "path", path.toString(),
            "type", type,
            "warnings", warnings
        );
    }

    @Override
    public Map<String, Object> unload(String pluginName) {
        return unloader.unload(pluginName);
    }

    @Override
    public Map<String, Object> reload(Path path, String pluginName, boolean enable) {
        Map<String, Object> unloaded = unload(pluginName);
        Plugin remaining = Bukkit.getPluginManager().getPlugin(pluginName);
        if (remaining != null) {
            return ordered(
                "action", "reload",
                "reloaded", false,
                "unload", unloaded,
                "warnings", List.of("Plugin remained registered after unload; load step was skipped to avoid duplicate plugin state.")
            );
        }
        Map<String, Object> loaded = load(path, enable);
        return ordered(
            "action", "reload",
            "reloaded", true,
            "unload", unloaded,
            "load", loaded
        );
    }

    private Plugin loadBukkitPlugin(Path path) {
        try {
            Plugin plugin = Bukkit.getPluginManager().loadPlugin(path.toFile());
            if (plugin == null) {
                throw new IllegalStateException("Server returned null while loading plugin jar: " + path);
            }
            return plugin;
        } catch (Exception error) {
            throw new IllegalStateException("Failed to load plugin jar: " + path, error);
        }
    }
}
