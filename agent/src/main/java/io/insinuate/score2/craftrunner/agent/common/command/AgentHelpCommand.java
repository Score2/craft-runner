package io.insinuate.score2.craftrunner.agent.common.command;

final class AgentHelpCommand {
    void execute(AgentCommandContext context, AgentCommandSender sender, String label) {
        context.send(sender, AgentCommandContext.GREEN + "CraftRunnerAgent commands:");
        context.send(sender, "Aliases: " + AgentCommandContext.YELLOW + "/craftragent" + AgentCommandContext.GRAY + ", " + AgentCommandContext.YELLOW + "/cra");
        context.send(sender, AgentCommandContext.YELLOW + "/" + label + " status");
        context.send(sender, AgentCommandContext.YELLOW + "/" + label + " token");
        context.send(sender, AgentCommandContext.YELLOW + "/" + label + " connect");
        context.send(sender, AgentCommandContext.YELLOW + "/" + label + " list");
        context.send(sender, AgentCommandContext.YELLOW + "/" + label + " load <plugin.jar|plugin-name> [--no-enable]");
        context.send(sender, AgentCommandContext.YELLOW + "/" + label + " unload <plugin>");
        context.send(sender, AgentCommandContext.YELLOW + "/" + label + " reload <plugin> [plugin.jar|plugin-name] [--no-enable]");
    }
}
