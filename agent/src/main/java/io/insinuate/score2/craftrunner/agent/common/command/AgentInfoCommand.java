package io.insinuate.score2.craftrunner.agent.common.command;

import io.insinuate.score2.craftrunner.agent.common.runtime.AgentEndpointInfo;

final class AgentInfoCommand {
    void status(AgentCommandContext context, AgentCommandSender sender) {
        AgentEndpointInfo info = context.runtime().endpointInfo();
        context.send(sender, AgentCommandContext.GREEN + "CraftRunnerAgent");
        context.send(sender, "Platform: " + AgentCommandContext.YELLOW + context.platform().platformName());
        context.send(sender, "Endpoint: " + AgentCommandContext.YELLOW + info.endpoint());
        context.send(sender, "Endpoint name: " + AgentCommandContext.YELLOW + info.endpointName());
        context.send(sender, "Generated config: " + context.colorBoolean(info.generatedConfig()));
        context.send(sender, "Enabled: " + context.colorBoolean(info.enabled()));
        context.send(sender, "Token: " + AgentCommandContext.YELLOW + info.token());
    }

    void token(AgentCommandContext context, AgentCommandSender sender) {
        context.send(sender, "Token: " + AgentCommandContext.YELLOW + context.runtime().endpointInfo().token());
    }
}
