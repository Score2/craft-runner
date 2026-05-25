package io.insinuate.score2.craftrunner.agent.platform.bungee.hot;

import io.insinuate.score2.craftrunner.agent.common.hot.AbstractHotPluginOperations;
import io.insinuate.score2.craftrunner.agent.common.reflect.HotReflection;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import net.md_5.bungee.api.plugin.Plugin;
import net.md_5.bungee.api.plugin.PluginDescription;
import net.md_5.bungee.api.plugin.PluginManager;

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
            "hotLoadPlugin", "best-effort",
            "hotUnloadPlugin", "best-effort",
            "hotReloadPlugin", "best-effort",
            "supportedPluginTypes", List.of("bungee.yml"),
            "listPlugins", true,
            "warnings", List.of(
                "BungeeCord does not expose a public single-plugin lifecycle API; craft-runner uses BungeeCord internals reflectively.",
                "Unload cancels Bungee tasks and unregisters commands/listeners, then removes the plugin from the registry and closes its classloader.",
                "Plugins with static state, external threads, or custom registries may still require a proxy restart."
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
        Path jarPath = path.toAbsolutePath().normalize();
        PluginDescription description = readDescription(jarPath);
        if (agentPlugin.getProxy().getPluginManager().getPlugin(description.getName()) != null) {
            throw new IllegalStateException("Plugin is already loaded: " + description.getName());
        }

        Plugin plugin = instantiate(description);
        putPlugin(description.getName(), plugin);
        addDependencyEdges(description);

        List<String> warnings = new ArrayList<>();
        try {
            plugin.onLoad();
            if (enable) {
                plugin.onEnable();
            }
        } catch (Throwable error) {
            removePlugin(description.getName(), plugin);
            closeClassLoader(plugin);
            throw new IllegalStateException("Failed to enable Bungee plugin: " + description.getName(), error);
        }

        return ordered(
            "action", "load",
            "loaded", true,
            "enabled", enable,
            "plugin", pluginInfo(plugin),
            "path", jarPath.toString(),
            "type", hasEntry(jarPath, "bungee.yml") ? "bungee.yml" : "plugin.yml",
            "warnings", warnings
        );
    }

    @Override
    public Map<String, Object> unload(String pluginName) {
        Plugin plugin = requiredPlugin(pluginName);
        List<String> warnings = new ArrayList<>();

        try {
            plugin.onDisable();
        } catch (Throwable error) {
            warnings.add("Plugin onDisable threw: " + error);
        }

        PluginManager manager = agentPlugin.getProxy().getPluginManager();
        manager.unregisterCommands(plugin);
        manager.unregisterListeners(plugin);
        int cancelledTasks = agentPlugin.getProxy().getScheduler().cancel(plugin);
        shutdownExecutor(plugin, warnings);
        removePlugin(plugin.getDescription().getName(), plugin);
        removeClassLoaderFromBungeeLookup(plugin, warnings);
        closeClassLoader(plugin);

        return ordered(
            "action", "unload",
            "unloaded", true,
            "plugin", pluginInfo(plugin),
            "cancelledTasks", cancelledTasks,
            "warnings", warnings
        );
    }

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

    private Map<String, Object> pluginInfo(Plugin plugin) {
        return ordered(
            "name", plugin.getDescription().getName(),
            "version", plugin.getDescription().getVersion(),
            "main", plugin.getDescription().getMain(),
            "author", plugin.getDescription().getAuthor(),
            "file", plugin.getFile() == null ? null : plugin.getFile().toPath().toString()
        );
    }

    private PluginDescription readDescription(Path jarPath) {
        Map<String, PluginDescription> previous = currentToLoad();
        Map<String, PluginDescription> temp = new LinkedHashMap<>();
        try {
            Path loadDir = Files.createTempDirectory("craft-runner-bungee-hot-");
            Path loadJar = loadDir.resolve(jarPath.getFileName());
            Files.copy(jarPath, loadJar, StandardCopyOption.REPLACE_EXISTING);
            HotReflection.setFieldValue(agentPlugin.getProxy().getPluginManager(), "toLoad", temp);
            agentPlugin.getProxy().getPluginManager().detectPlugins(loadDir.toFile());
            PluginDescription description = temp.values().stream()
                .filter(candidate -> candidate.getFile() != null && candidate.getFile().toPath().toAbsolutePath().normalize().equals(loadJar))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Plugin jar does not contain bungee.yml or plugin.yml: " + jarPath));
            validateDependencies(description);
            return description;
        } catch (IOException error) {
            throw new IllegalStateException("Failed to stage Bungee plugin jar: " + jarPath, error);
        } finally {
            HotReflection.setFieldValue(agentPlugin.getProxy().getPluginManager(), "toLoad", previous);
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, PluginDescription> currentToLoad() {
        Object value = HotReflection.fieldValue(agentPlugin.getProxy().getPluginManager(), "toLoad");
        if (value instanceof Map<?, ?> map) {
            return (Map<String, PluginDescription>) map;
        }
        return null;
    }

    private void validateDependencies(PluginDescription description) {
        for (String dependency : description.getDepends()) {
            if (agentPlugin.getProxy().getPluginManager().getPlugin(dependency) == null) {
                throw new IllegalStateException("Missing required dependency for " + description.getName() + ": " + dependency);
            }
        }
    }

    private Plugin instantiate(PluginDescription description) {
        try {
            Object libraryLoader = HotReflection.fieldValue(agentPlugin.getProxy().getPluginManager(), "libraryLoader");
            ClassLoader libraries = libraryLoader == null
                ? null
                : (ClassLoader) HotReflection.call(libraryLoader, "createLoader", new Class<?>[] { PluginDescription.class }, description);
            Object loader = HotReflection.construct(
                "net.md_5.bungee.api.plugin.PluginClassloader",
                new Class<?>[] { net.md_5.bungee.api.ProxyServer.class, PluginDescription.class, java.io.File.class, ClassLoader.class },
                agentPlugin.getProxy(),
                description,
                description.getFile(),
                libraries
            );
            Class<?> main = ((ClassLoader) loader).loadClass(description.getMain());
            return (Plugin) main.getDeclaredConstructor().newInstance();
        } catch (ReflectiveOperationException | RuntimeException error) {
            throw new IllegalStateException("Failed to instantiate Bungee plugin: " + description.getName(), error);
        }
    }

    @SuppressWarnings("unchecked")
    private void putPlugin(String name, Plugin plugin) {
        ((Map<String, Plugin>) HotReflection.fieldValue(agentPlugin.getProxy().getPluginManager(), "plugins")).put(name, plugin);
    }

    @SuppressWarnings("unchecked")
    private void removePlugin(String name, Plugin plugin) {
        Map<String, Plugin> plugins = (Map<String, Plugin>) HotReflection.fieldValue(agentPlugin.getProxy().getPluginManager(), "plugins");
        plugins.remove(name, plugin);
        removeDependencyNode(name);
    }

    private void addDependencyEdges(PluginDescription description) {
        Object graph = HotReflection.fieldValue(agentPlugin.getProxy().getPluginManager(), "dependencyGraph");
        HotReflection.call(graph, "addNode", new Class<?>[] { Object.class }, description.getName());
        for (String dependency : description.getDepends()) {
            HotReflection.call(graph, "putEdge", new Class<?>[] { Object.class, Object.class }, description.getName(), dependency);
        }
        for (String dependency : description.getSoftDepends()) {
            if (agentPlugin.getProxy().getPluginManager().getPlugin(dependency) != null) {
                HotReflection.call(graph, "putEdge", new Class<?>[] { Object.class, Object.class }, description.getName(), dependency);
            }
        }
    }

    private void removeDependencyNode(String name) {
        try {
            Object graph = HotReflection.fieldValue(agentPlugin.getProxy().getPluginManager(), "dependencyGraph");
            HotReflection.call(graph, "removeNode", new Class<?>[] { Object.class }, name);
        } catch (RuntimeException ignored) {
            // Older graph implementations may not expose mutation the same way; registry removal still proceeds.
        }
    }

    private Plugin requiredPlugin(String pluginName) {
        Plugin plugin = agentPlugin.getProxy().getPluginManager().getPlugin(pluginName);
        if (plugin == null) {
            throw new IllegalArgumentException("Plugin is not loaded: " + pluginName);
        }
        if (plugin == agentPlugin) {
            throw new IllegalArgumentException("Refusing to unload CraftRunnerAgent through itself.");
        }
        return plugin;
    }

    private void shutdownExecutor(Plugin plugin, List<String> warnings) {
        try {
            Object service = HotReflection.fieldValue(plugin, "service");
            if (service instanceof ExecutorService executor) {
                executor.shutdownNow();
            }
        } catch (RuntimeException error) {
            warnings.add("Could not inspect plugin executor: " + error.getMessage());
        }
    }

    private void closeClassLoader(Plugin plugin) {
        ClassLoader loader = plugin.getClass().getClassLoader();
        if (loader instanceof AutoCloseable closeable) {
            try {
                closeable.close();
            } catch (Exception ignored) {
                // Best-effort classloader release.
            }
        }
    }

    @SuppressWarnings("unchecked")
    private void removeClassLoaderFromBungeeLookup(Plugin plugin, List<String> warnings) {
        ClassLoader loader = plugin.getClass().getClassLoader();
        try {
            Object allLoaders = HotReflection.field(loader.getClass(), "allLoaders").get(null);
            if (allLoaders instanceof Set<?> set) {
                ((Set<Object>) set).remove(loader);
            }
        } catch (ReflectiveOperationException | RuntimeException error) {
            warnings.add("Could not remove plugin classloader from Bungee lookup set: " + error.getMessage());
        }
    }

    private boolean hasEntry(Path jarPath, String entryName) {
        try (JarFile jar = new JarFile(jarPath.toFile())) {
            JarEntry entry = jar.getJarEntry(entryName);
            return entry != null;
        } catch (IOException error) {
            return false;
        }
    }
}
