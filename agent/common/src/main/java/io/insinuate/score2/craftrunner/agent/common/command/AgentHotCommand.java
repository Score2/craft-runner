package io.insinuate.score2.craftrunner.agent.common.command;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

final class AgentHotCommand {
    void list(AgentCommandContext context, AgentCommandSender sender) {
        Map<String, Object> result = context.hotPlugins().list();
        Object plugins = result.get("plugins");
        if (!(plugins instanceof Iterable<?> iterable)) {
            context.sendWarn(sender, "Plugin list is unavailable on this platform.");
            return;
        }
        int count = number(result.get("count"), countIterable(iterable));
        context.send(sender, AgentCommandContext.GREEN + "Loaded plugins (" + count + "):");
        for (Object item : iterable) {
            if (item instanceof Map<?, ?> plugin) {
                context.send(sender, "- " + AgentCommandContext.YELLOW + pluginName(plugin)
                    + AgentCommandContext.GRAY + versionSuffix(plugin)
                    + enabledSuffix(plugin)
                    + sourceSuffix(plugin));
            } else {
                context.send(sender, "- " + AgentCommandContext.YELLOW + item);
            }
        }
    }

    void load(AgentCommandContext context, AgentCommandSender sender, String pluginJarOrName, boolean enable) {
        sendActionResult(context, sender, context.hotPlugins().load(context.resolvePluginPath(pluginJarOrName), enable));
    }

    void unload(AgentCommandContext context, AgentCommandSender sender, String pluginName) {
        sendActionResult(context, sender, context.hotPlugins().unload(pluginName));
    }

    void reload(AgentCommandContext context, AgentCommandSender sender, String pluginName, String pluginJarOrName, boolean enable) {
        Path pluginPath = pluginJarOrName == null || pluginJarOrName.isBlank()
            ? context.resolvePluginPath(pluginName)
            : context.resolvePluginPath(pluginJarOrName);
        sendActionResult(context, sender, context.hotPlugins().reload(pluginPath, pluginName, enable));
    }

    private void sendActionResult(AgentCommandContext context, AgentCommandSender sender, Map<String, Object> result) {
        String action = String.valueOf(result.getOrDefault("action", "hot plugin"));
        String plugin = pluginNameFromResult(result);
        context.sendSuccess(sender, action + " completed" + (plugin.isBlank() ? "" : ": " + AgentCommandContext.YELLOW + plugin));
        Object path = result.get("path");
        if (path != null) {
            context.send(sender, "Path: " + AgentCommandContext.YELLOW + path);
        }
        sendWarnings(context, sender, result);
    }

    private void sendWarnings(AgentCommandContext context, AgentCommandSender sender, Map<String, Object> result) {
        Object warnings = result.get("warnings");
        if (warnings instanceof Iterable<?> iterable) {
            for (Object warning : iterable) {
                context.sendWarn(sender, "Warning: " + warning);
            }
        }
    }

    private String pluginNameFromResult(Map<String, Object> result) {
        Object plugin = result.get("plugin");
        if (plugin instanceof Map<?, ?> map) {
            return pluginName(map);
        }
        Object load = result.get("load");
        if (load instanceof Map<?, ?> loadMap) {
            Object loadedPlugin = loadMap.get("plugin");
            if (loadedPlugin instanceof Map<?, ?> pluginMap) {
                return pluginName(pluginMap);
            }
        }
        return "";
    }

    private String pluginName(Map<?, ?> plugin) {
        for (String key : List.of("name", "id")) {
            Object value = plugin.get(key);
            if (value instanceof String string && !string.isBlank()) {
                return string;
            }
        }
        return "unknown";
    }

    private String versionSuffix(Map<?, ?> plugin) {
        Object value = plugin.get("version");
        return value instanceof String string && !string.isBlank() ? " " + string : "";
    }

    private String enabledSuffix(Map<?, ?> plugin) {
        Object value = plugin.get("enabled");
        return value instanceof Boolean bool ? (bool ? AgentCommandContext.GREEN + " enabled" : AgentCommandContext.RED + " disabled") : "";
    }

    private String sourceSuffix(Map<?, ?> plugin) {
        Object value = plugin.get("file");
        if (value == null) {
            value = plugin.get("source");
        }
        return value == null ? "" : AgentCommandContext.GRAY + " (" + value + ")";
    }

    private int number(Object value, int fallback) {
        return value instanceof Number number ? number.intValue() : fallback;
    }

    private int countIterable(Iterable<?> iterable) {
        int count = 0;
        for (Object ignored : iterable) {
            count++;
        }
        return count;
    }

}
