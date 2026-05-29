package io.insinuate.score2.craftrunner.agent.common.command;

import io.insinuate.score2.craftrunner.agent.common.runtime.AgentEndpointInfo;
import java.util.List;
import java.util.Map;

final class AgentInfoCommand {
    void info(AgentCommandContext context, AgentCommandSender sender, String pluginName) {
        if (pluginName != null && !pluginName.isBlank()) {
            pluginInfo(context, sender, pluginName);
            return;
        }
        overview(context, sender);
    }

    private void overview(AgentCommandContext context, AgentCommandSender sender) {
        AgentEndpointInfo info = context.runtime().endpointInfo();
        context.send(sender, AgentCommandContext.GREEN + "CraftRunnerAgent");
        context.send(sender, "Platform: " + AgentCommandContext.YELLOW + context.platform().platformName());
        context.send(sender, "Endpoint: " + AgentCommandContext.YELLOW + info.endpoint());
        context.send(sender, "Endpoint name: " + AgentCommandContext.YELLOW + info.endpointName());
        context.send(sender, "Generated config: " + context.colorBoolean(info.generatedConfig()));
        context.send(sender, "Enabled: " + context.colorBoolean(info.enabled()));
        Map<String, Object> capabilities = context.hotPlugins().capabilities();
        context.send(sender, AgentCommandContext.GREEN + "Hot plugin support");
        context.send(sender, "Platform: " + AgentCommandContext.YELLOW + value(capabilities, "platform")
            + AgentCommandContext.GRAY + " / " + AgentCommandContext.YELLOW + value(capabilities, "family"));
        context.send(sender, "Load: " + support(capabilities.get("hotLoadPlugin"))
            + AgentCommandContext.GRAY + ", unload: " + support(capabilities.get("hotUnloadPlugin"))
            + AgentCommandContext.GRAY + ", reload: " + support(capabilities.get("hotReloadPlugin")));
        Object types = capabilities.get("supportedPluginTypes");
        if (types != null) {
            context.send(sender, "Plugin types: " + AgentCommandContext.YELLOW + types);
        }
        sendWarnings(context, sender, capabilities);
    }

    private void pluginInfo(AgentCommandContext context, AgentCommandSender sender, String pluginName) {
        Map<String, Object> result = context.hotPlugins().list();
        Object plugins = result.get("plugins");
        if (!(plugins instanceof Iterable<?> iterable)) {
            context.sendWarn(sender, "Plugin info is unavailable on this platform.");
            return;
        }
        for (Object item : iterable) {
            if (item instanceof Map<?, ?> plugin && matches(plugin, pluginName)) {
                context.send(sender, AgentCommandContext.GREEN + "Plugin: " + AgentCommandContext.YELLOW + displayName(plugin));
                for (Map.Entry<?, ?> entry : plugin.entrySet()) {
                    context.send(sender, String.valueOf(entry.getKey()) + ": " + AgentCommandContext.YELLOW + entry.getValue());
                }
                return;
            }
        }
        context.sendError(sender, "Plugin not found: " + pluginName);
    }

    void token(AgentCommandContext context, AgentCommandSender sender) {
        context.send(sender, "Token: " + AgentCommandContext.YELLOW + context.runtime().endpointInfo().token());
    }

    private boolean matches(Map<?, ?> plugin, String name) {
        String normalized = name.toLowerCase(java.util.Locale.ROOT);
        for (String key : List.of("name", "id")) {
            Object value = plugin.get(key);
            if (value instanceof String string && string.equalsIgnoreCase(name)) {
                return true;
            }
        }
        Object file = plugin.get("file");
        if (file == null) {
            file = plugin.get("source");
        }
        return file instanceof String string && java.nio.file.Path.of(string).getFileName().toString().toLowerCase(java.util.Locale.ROOT).equals(normalized);
    }

    private String displayName(Map<?, ?> plugin) {
        for (String key : List.of("name", "id")) {
            Object value = plugin.get(key);
            if (value instanceof String string && !string.isBlank()) {
                return string;
            }
        }
        return "unknown";
    }

    private String value(Map<String, Object> map, String key) {
        return String.valueOf(map.getOrDefault(key, "unknown"));
    }

    private String support(Object value) {
        if (value instanceof Boolean bool) {
            return bool ? AgentCommandContext.GREEN + "true" : AgentCommandContext.RED + "false";
        }
        String string = String.valueOf(value);
        return "best-effort".equalsIgnoreCase(string) ? AgentCommandContext.YELLOW + string : AgentCommandContext.GRAY + string;
    }

    private void sendWarnings(AgentCommandContext context, AgentCommandSender sender, Map<String, Object> result) {
        Object warnings = result.get("warnings");
        if (warnings instanceof Iterable<?> iterable) {
            for (Object warning : iterable) {
                context.sendWarn(sender, "Warning: " + warning);
            }
        }
    }
}
