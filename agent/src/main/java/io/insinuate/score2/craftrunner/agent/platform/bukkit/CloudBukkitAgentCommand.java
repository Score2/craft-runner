package io.insinuate.score2.craftrunner.agent.platform.bukkit;

import io.insinuate.score2.craftrunner.agent.common.AgentCommandController;
import io.insinuate.score2.craftrunner.agent.common.AgentRuntime;
import io.insinuate.score2.craftrunner.agent.common.AgentPlatform;
import org.bukkit.command.CommandSender;
import org.bukkit.plugin.Plugin;
import org.incendo.cloud.execution.ExecutionCoordinator;
import org.incendo.cloud.paper.LegacyPaperCommandManager;
import org.incendo.cloud.parser.standard.StringParser;

final class CloudBukkitAgentCommand {
    private CloudBukkitAgentCommand() {
    }

    static void register(Plugin plugin, AgentPlatform platform, AgentRuntime runtime) throws Exception {
        AgentCommandController controller = new AgentCommandController(platform, runtime);
        LegacyPaperCommandManager<CommandSender> commandManager = LegacyPaperCommandManager.createNative(
            plugin,
            ExecutionCoordinator.simpleCoordinator()
        );
        commandManager.command(commandManager.commandBuilder("craftragent", "cra")
            .permission("craftrunner.agent")
            .optional("args", StringParser.greedyStringParser())
            .handler(context -> controller.execute(
                context.sender()::sendMessage,
                "craftragent",
                context.<String>optional("args").orElse("")
            )));
    }
}
