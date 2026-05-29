package io.insinuate.score2.craftrunner.agent.platform.bukkit.hot;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.bukkit.Bukkit;
import org.bukkit.Server;
import org.bukkit.command.Command;
import org.bukkit.command.CommandMap;
import org.bukkit.command.PluginIdentifiableCommand;
import org.bukkit.command.SimpleCommandMap;
import org.bukkit.plugin.Plugin;

final class BukkitPluginUnloader {
    private final Plugin agentPlugin;
    private final BukkitPluginInspector inspector;

    BukkitPluginUnloader(Plugin agentPlugin, BukkitPluginInspector inspector) {
        this.agentPlugin = agentPlugin;
        this.inspector = inspector;
    }

    Map<String, Object> unload(String pluginName) {
        Plugin plugin = Bukkit.getPluginManager().getPlugin(pluginName);
        if (plugin == null) {
            return Map.of(
                "action", "unload",
                "unloaded", false,
                "plugin", pluginName,
                "warnings", List.of("Plugin is not currently loaded.")
            );
        }
        if (plugin == agentPlugin) {
            throw new IllegalArgumentException("Refusing to unload the Craft Runner debug agent itself.");
        }

        List<String> warnings = new ArrayList<>();
        Map<String, Object> before = inspector.pluginInfo(plugin);
        if (plugin.isEnabled()) {
            Bukkit.getPluginManager().disablePlugin(plugin);
        }

        removeCommands(plugin, warnings);
        removeFromPluginManagers(plugin, warnings);
        removeFromPaperEntrypoints(plugin, warnings);

        Plugin remaining = Bukkit.getPluginManager().getPlugin(plugin.getDescription().getName());
        return Map.of(
            "action", "unload",
            "unloaded", remaining == null,
            "plugin", before,
            "remaining", remaining == null ? "" : inspector.pluginInfo(remaining),
            "warnings", warnings
        );
    }

    private void removeCommands(Plugin plugin, List<String> warnings) {
        CommandMap commandMap = commandMap(warnings);
        if (!(commandMap instanceof SimpleCommandMap simpleCommandMap)) {
            warnings.add("Could not access SimpleCommandMap; plugin commands may remain registered.");
            return;
        }
        try {
            Object knownValue = BukkitReflection.fieldValue(simpleCommandMap, "knownCommands");
            if (!(knownValue instanceof Map<?, ?> known)) {
                warnings.add("Could not access knownCommands; plugin commands may remain registered.");
                return;
            }
            List<Object> removeKeys = new ArrayList<>();
            for (Map.Entry<?, ?> entry : known.entrySet()) {
                Object value = entry.getValue();
                if (value instanceof Command command && ownsCommand(plugin, command)) {
                    command.unregister(simpleCommandMap);
                    removeKeys.add(entry.getKey());
                }
            }
            @SuppressWarnings("unchecked")
            Map<Object, Object> writable = (Map<Object, Object>) known;
            int removed = 0;
            for (Object key : removeKeys) {
                if (writable.remove(key) != null) {
                    removed++;
                }
            }
            if (removed > 0) {
                warnings.add("Removed " + removed + " command registration(s).");
            }
        } catch (Throwable error) {
            warnings.add("Failed to clean command map: " + error);
        }
    }

    private CommandMap commandMap(List<String> warnings) {
        Server server = Bukkit.getServer();
        try {
            Method method = server.getClass().getMethod("getCommandMap");
            Object result = method.invoke(server);
            return result instanceof CommandMap commandMap ? commandMap : null;
        } catch (ReflectiveOperationException | LinkageError ignored) {
            try {
                Field field = BukkitReflection.findField(server.getClass(), "commandMap");
                Object result = field.get(server);
                return result instanceof CommandMap commandMap ? commandMap : null;
            } catch (ReflectiveOperationException | LinkageError error) {
                warnings.add("Failed to access command map: " + error);
                return null;
            }
        }
    }

    private boolean ownsCommand(Plugin plugin, Command command) {
        if (command instanceof PluginIdentifiableCommand identifiable) {
            return identifiable.getPlugin() == plugin;
        }
        return command.getLabel().toLowerCase(Locale.ROOT).startsWith(plugin.getName().toLowerCase(Locale.ROOT) + ":");
    }

    private void removeFromPluginManagers(Plugin plugin, List<String> warnings) {
        Object pluginManager = Bukkit.getPluginManager();
        removeFromPluginManagerObject(pluginManager, plugin, warnings, "bukkit-plugin-manager");
        Object paperPluginManager = paperPluginManager(pluginManager);
        if (paperPluginManager == null) {
            return;
        }
        removeFromPluginManagerObject(paperPluginManager, plugin, warnings, "paper-plugin-manager");
        Object instanceManager = BukkitReflection.fieldValue(paperPluginManager, "instanceManager");
        if (instanceManager != null) {
            removeFromPluginManagerObject(instanceManager, plugin, warnings, "paper-instance-manager");
            removeFromDependencyTree(instanceManager, plugin, warnings);
        }
    }

    private Object paperPluginManager(Object pluginManager) {
        Object paperPluginManager = BukkitReflection.fieldValue(pluginManager, "paperPluginManager");
        if (paperPluginManager != null) {
            return paperPluginManager;
        }
        try {
            Class<?> managerClass = Class.forName("io.papermc.paper.plugin.manager.PaperPluginManagerImpl");
            Method getInstance = managerClass.getMethod("getInstance");
            return getInstance.invoke(null);
        } catch (ReflectiveOperationException | LinkageError ignored) {
            return null;
        }
    }

    private void removeFromPluginManagerObject(Object target, Plugin plugin, List<String> warnings, String label) {
        int removed = 0;
        removed += removeFromListField(target, "plugins", plugin, warnings, label);
        removed += removeFromLookupField(target, "lookupNames", plugin, warnings, label);
        if (removed > 0) {
            warnings.add("Removed plugin from " + label + " registry (" + removed + " entry/entries).");
        }
    }

    private int removeFromListField(Object target, String fieldName, Plugin plugin, List<String> warnings, String label) {
        Object value = BukkitReflection.fieldValue(target, fieldName);
        if (!(value instanceof List<?> list)) {
            return 0;
        }
        try {
            int before = list.size();
            list.removeIf(item -> item == plugin);
            return before - list.size();
        } catch (Throwable error) {
            warnings.add("Failed to clean " + label + "." + fieldName + ": " + error);
            return 0;
        }
    }

    private int removeFromLookupField(Object target, String fieldName, Plugin plugin, List<String> warnings, String label) {
        Object value = BukkitReflection.fieldValue(target, fieldName);
        if (!(value instanceof Map<?, ?> map)) {
            return 0;
        }
        try {
            int removed = 0;
            Iterator<? extends Map.Entry<?, ?>> iterator = map.entrySet().iterator();
            while (iterator.hasNext()) {
                Map.Entry<?, ?> entry = iterator.next();
                if (entry.getValue() == plugin) {
                    iterator.remove();
                    removed++;
                }
            }
            return removed;
        } catch (Throwable error) {
            warnings.add("Failed to clean " + label + "." + fieldName + ": " + error);
            return 0;
        }
    }

    private void removeFromDependencyTree(Object instanceManager, Plugin plugin, List<String> warnings) {
        Object dependencyTree = BukkitReflection.fieldValue(instanceManager, "dependencyTree");
        if (dependencyTree == null) {
            return;
        }
        try {
            Method remove = dependencyTree.getClass().getMethod("remove", Class.forName("io.papermc.paper.plugin.configuration.PluginMeta"));
            remove.invoke(dependencyTree, plugin.getDescription());
            warnings.add("Removed plugin from Paper dependency tree.");
        } catch (ClassNotFoundException ignored) {
            // Not Paper.
        } catch (Throwable error) {
            warnings.add("Failed to clean Paper dependency tree: " + error);
        }
    }

    private void removeFromPaperEntrypoints(Plugin plugin, List<String> warnings) {
        try {
            Class<?> handlerClass = Class.forName("io.papermc.paper.plugin.entrypoint.LaunchEntryPointHandler");
            Object instance = BukkitReflection.fieldValue(handlerClass, null, "INSTANCE");
            if (instance == null) {
                return;
            }
            Method getStorage = handlerClass.getMethod("getStorage");
            Object storage = getStorage.invoke(instance);
            if (!(storage instanceof Map<?, ?> map)) {
                return;
            }
            int removed = 0;
            for (Object providerStorage : map.values()) {
                Object providers = BukkitReflection.fieldValue(providerStorage, "providers");
                if (providers instanceof List<?> list) {
                    int before = list.size();
                    list.removeIf(provider -> providerMatchesPlugin(provider, plugin));
                    removed += before - list.size();
                }
            }
            if (removed > 0) {
                warnings.add("Removed " + removed + " Paper entrypoint provider registration(s).");
            }
        } catch (ClassNotFoundException ignored) {
            // Not Paper.
        } catch (Throwable error) {
            warnings.add("Failed to clean Paper entrypoint provider storage: " + error);
        }
    }

    private boolean providerMatchesPlugin(Object provider, Plugin plugin) {
        try {
            Method getMeta = provider.getClass().getMethod("getMeta");
            Object meta = getMeta.invoke(provider);
            Method getName = meta.getClass().getMethod("getName");
            return plugin.getDescription().getName().equalsIgnoreCase(String.valueOf(getName.invoke(meta)));
        } catch (Throwable ignored) {
            return false;
        }
    }
}
