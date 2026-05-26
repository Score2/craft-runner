package io.insinuate.score2.craftrunner.agent.common.command;

import java.util.Map;

final class AgentJsCommand {
    void status(AgentCommandContext context, AgentCommandSender sender) {
        sendStatus(context, sender, context.runtime().jsExecutor().status());
    }

    void load(AgentCommandContext context, AgentCommandSender sender) {
        context.send(sender, "Preparing JS engine libraries...");
        context.runtime().jsExecutor().prepare();
        sendStatus(context, sender, context.runtime().jsExecutor().status());
    }

    private void sendStatus(AgentCommandContext context, AgentCommandSender sender, Map<String, Object> status) {
        String state = String.valueOf(status.getOrDefault("state", "unknown"));
        boolean ready = Boolean.TRUE.equals(status.get("ready"));
        if (ready) {
            context.sendSuccess(sender, "JS engine ready: GraalJS " + status.get("version"));
            return;
        }
        if ("loading".equals(state)) {
            context.sendWarn(sender, "JS engine is still downloading/loading: GraalJS " + status.get("version"));
            return;
        }
        context.sendWarn(sender, "JS engine state: " + state + " (GraalJS " + status.get("version") + ")");
        Object error = status.get("error");
        if (error instanceof String string && !string.isBlank()) {
            context.sendError(sender, string);
        }
    }
}
