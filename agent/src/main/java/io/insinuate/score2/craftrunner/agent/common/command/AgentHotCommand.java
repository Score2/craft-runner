package io.insinuate.score2.craftrunner.agent.common.command;

import java.nio.file.Path;

final class AgentHotCommand {
    void capabilities(AgentCommandContext context, AgentCommandSender sender) {
        context.sendJson(sender, context.hotPlugins().capabilities());
    }

    void list(AgentCommandContext context, AgentCommandSender sender) {
        context.sendJson(sender, context.hotPlugins().list());
    }

    void load(AgentCommandContext context, AgentCommandSender sender, String pluginJarOrName, boolean enable) {
        context.sendJson(sender, context.hotPlugins().load(context.resolvePluginPath(pluginJarOrName), enable));
    }

    void unload(AgentCommandContext context, AgentCommandSender sender, String pluginName) {
        context.sendJson(sender, context.hotPlugins().unload(pluginName));
    }

    void reload(AgentCommandContext context, AgentCommandSender sender, String pluginName, String pluginJarOrName, boolean enable) {
        Path pluginPath = pluginJarOrName == null || pluginJarOrName.isBlank()
            ? context.resolvePluginPath(pluginName)
            : context.resolvePluginPath(pluginJarOrName);
        context.sendJson(sender, context.hotPlugins().reload(pluginPath, pluginName, enable));
    }
}
