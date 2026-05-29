package io.insinuate.score2.craftrunner.agent.platform.velocity.hot;

import com.velocitypowered.api.command.CommandMeta;
import com.velocitypowered.api.event.Continuation;
import com.velocitypowered.api.event.EventTask;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.event.proxy.ProxyShutdownEvent;
import com.velocitypowered.api.plugin.PluginContainer;
import com.velocitypowered.api.proxy.ProxyServer;
import io.insinuate.score2.craftrunner.agent.common.hot.AbstractHotPluginOperations;
import io.insinuate.score2.craftrunner.agent.common.reflect.HotReflection;
import java.io.IOException;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;

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
            "hotLoadPlugin", "best-effort",
            "hotUnloadPlugin", "best-effort",
            "hotReloadPlugin", "best-effort",
            "supportedPluginTypes", List.of("velocity-plugin.json"),
            "listPlugins", true,
            "warnings", List.of(
                "Velocity has no public unload API; craft-runner uses Velocity internals reflectively.",
                "Load registers the new plugin main listener and invokes only that plugin's ProxyInitializeEvent handlers.",
                "Unload invokes only that plugin's ProxyShutdownEvent handlers, unregisters listeners, cancels scheduler tasks, removes owned command metadata when detectable, removes registry entries, and closes the plugin classloader."
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
        Path jarPath = path.toAbsolutePath().normalize();
        Set<String> before = pluginIds();
        Path loadDir = stageJar(jarPath);

        HotReflection.call(proxy.getPluginManager(), "loadPlugins", new Class<?>[] { Path.class }, loadDir);

        PluginContainer plugin = findNewPlugin(before, loadDir);
        Object instance = plugin.getInstance()
            .orElseThrow(() -> new IllegalStateException("Velocity loaded plugin without creating an instance: " + plugin.getDescription().getId()));

        List<String> warnings = new ArrayList<>();
        if (enable) {
            invokeLifecycle(instance, new ProxyInitializeEvent(), warnings);
            HotReflection.call(proxy.getEventManager(), "registerInternally", new Class<?>[] { PluginContainer.class, Object.class }, plugin, instance);
        } else {
            warnings.add("Velocity creates plugin instances during load; --no-enable skipped ProxyInitializeEvent and listener registration only.");
        }

        return ordered(
            "action", "load",
            "loaded", true,
            "enabled", enable,
            "plugin", pluginInfo(plugin),
            "path", jarPath.toString(),
            "type", "velocity-plugin.json",
            "warnings", warnings
        );
    }

    @Override
    public Map<String, Object> unload(String pluginName) {
        PluginContainer plugin = findPlugin(pluginName);
        Object instance = plugin.getInstance()
            .orElseThrow(() -> new IllegalStateException("Velocity plugin has no instance: " + pluginName));
        if (plugin.getDescription().getId().equals("craft-runner-agent")) {
            throw new IllegalArgumentException("Refusing to unload CraftRunnerAgent through itself.");
        }

        List<String> warnings = new ArrayList<>();
        invokeLifecycle(instance, new ProxyShutdownEvent(), warnings);
        proxy.getEventManager().unregisterListeners(instance);
        int cancelledTasks = cancelTasks(instance);
        int removedCommands = unregisterCommands(instance, plugin);
        shutdownExecutor(plugin, warnings);
        removePlugin(plugin, instance);
        closeClassLoader(instance);

        return ordered(
            "action", "unload",
            "unloaded", true,
            "plugin", pluginInfo(plugin),
            "cancelledTasks", cancelledTasks,
            "removedCommands", removedCommands,
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

    private Set<String> pluginIds() {
        Set<String> ids = new HashSet<>();
        for (PluginContainer plugin : proxy.getPluginManager().getPlugins()) {
            ids.add(plugin.getDescription().getId());
        }
        return ids;
    }

    private Path stageJar(Path jarPath) {
        try {
            Path loadDir = Files.createTempDirectory("craft-runner-velocity-hot-");
            Files.copy(jarPath, loadDir.resolve(jarPath.getFileName()), StandardCopyOption.REPLACE_EXISTING);
            return loadDir;
        } catch (IOException error) {
            throw new IllegalStateException("Failed to stage Velocity plugin jar: " + jarPath, error);
        }
    }

    private PluginContainer findNewPlugin(Set<String> before, Path loadDir) {
        List<PluginContainer> candidates = new ArrayList<>();
        for (PluginContainer plugin : proxy.getPluginManager().getPlugins()) {
            if (!before.contains(plugin.getDescription().getId())
                && plugin.getDescription().getSource().map(source -> source.startsWith(loadDir)).orElse(false)) {
                candidates.add(plugin);
            }
        }
        if (candidates.size() != 1) {
            throw new IllegalStateException("Expected one new Velocity plugin from " + loadDir + " but found " + candidates.size());
        }
        return candidates.get(0);
    }

    private PluginContainer findPlugin(String pluginName) {
        return proxy.getPluginManager().getPlugin(pluginName).orElseGet(() -> {
            List<PluginContainer> matches = proxy.getPluginManager().getPlugins().stream()
                .filter(plugin -> plugin.getDescription().getName().map(name -> name.equalsIgnoreCase(pluginName)).orElse(false))
                .toList();
            if (matches.size() == 1) {
                return matches.get(0);
            }
            if (matches.size() > 1) {
                throw new IllegalArgumentException("Plugin name is ambiguous, use the Velocity plugin id instead: " + pluginName);
            }
            throw new IllegalArgumentException("Plugin is not loaded: " + pluginName);
        });
    }

    private void invokeLifecycle(Object instance, Object event, List<String> warnings) {
        Class<?> current = instance.getClass();
        while (current != null) {
            for (Method method : current.getDeclaredMethods()) {
                Subscribe subscribe = method.getAnnotation(Subscribe.class);
                if (subscribe == null || method.getParameterCount() != 1 || !method.getParameterTypes()[0].isAssignableFrom(event.getClass())) {
                    continue;
                }
                try {
                    method.setAccessible(true);
                    Object result = method.invoke(instance, event);
                    if (result instanceof EventTask task) {
                        runEventTask(task);
                    }
                } catch (ReflectiveOperationException | RuntimeException error) {
                    warnings.add("Lifecycle method failed: " + method.getName() + ": " + error);
                }
            }
            current = current.getSuperclass();
        }
    }

    private void runEventTask(EventTask task) {
        CountDownLatch latch = new CountDownLatch(1);
        final Throwable[] failure = new Throwable[1];
        task.execute(new Continuation() {
            @Override
            public void resume() {
                latch.countDown();
            }

            @Override
            public void resumeWithException(Throwable exception) {
                failure[0] = exception;
                latch.countDown();
            }
        });
        try {
            if (!latch.await(10, TimeUnit.SECONDS)) {
                throw new IllegalStateException("Velocity lifecycle EventTask timed out.");
            }
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while waiting for Velocity lifecycle EventTask.", error);
        }
        if (failure[0] != null) {
            throw new IllegalStateException("Velocity lifecycle EventTask failed.", failure[0]);
        }
    }

    private int cancelTasks(Object instance) {
        Collection<com.velocitypowered.api.scheduler.ScheduledTask> tasks = new ArrayList<>(proxy.getScheduler().tasksByPlugin(instance));
        for (com.velocitypowered.api.scheduler.ScheduledTask task : tasks) {
            task.cancel();
        }
        return tasks.size();
    }

    @SuppressWarnings("unchecked")
    private int unregisterCommands(Object instance, PluginContainer plugin) {
        Object commandManager = proxy.getCommandManager();
        Map<String, CommandMeta> commandMetas = (Map<String, CommandMeta>) HotReflection.fieldValue(commandManager, "commandMetas");
        Set<CommandMeta> owned = new HashSet<>();
        for (CommandMeta meta : commandMetas.values()) {
            Object owner = meta.getPlugin();
            if (owner == instance || owner == plugin) {
                owned.add(meta);
            }
        }
        for (CommandMeta meta : owned) {
            proxy.getCommandManager().unregister(meta);
        }
        return owned.size();
    }

    private void shutdownExecutor(PluginContainer plugin, List<String> warnings) {
        try {
            Object hasExecutor = HotReflection.call(plugin, "hasExecutorService", new Class<?>[0]);
            if (Boolean.TRUE.equals(hasExecutor)) {
                Object service = HotReflection.fieldValue(plugin, "service");
                if (service instanceof ExecutorService executor) {
                    executor.shutdownNow();
                }
            }
        } catch (RuntimeException error) {
            warnings.add("Could not inspect plugin executor: " + error.getMessage());
        }
    }

    @SuppressWarnings("unchecked")
    private void removePlugin(PluginContainer plugin, Object instance) {
        Object pluginManager = proxy.getPluginManager();
        ((Map<String, PluginContainer>) HotReflection.fieldValue(pluginManager, "pluginsById")).remove(plugin.getDescription().getId());
        ((Map<Object, PluginContainer>) HotReflection.fieldValue(pluginManager, "pluginInstances")).remove(instance);
    }

    private void closeClassLoader(Object instance) {
        ClassLoader loader = instance.getClass().getClassLoader();
        if (loader instanceof AutoCloseable closeable) {
            try {
                closeable.close();
            } catch (Exception ignored) {
                // Best-effort classloader release.
            }
        }
    }
}
