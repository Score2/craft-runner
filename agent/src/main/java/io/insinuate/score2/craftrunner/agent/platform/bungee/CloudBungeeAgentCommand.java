package io.insinuate.score2.craftrunner.agent.platform.bungee;

import io.insinuate.score2.craftrunner.agent.common.AgentCommandController;
import io.insinuate.score2.craftrunner.agent.common.AgentPlatform;
import io.insinuate.score2.craftrunner.agent.common.AgentRuntime;
import net.md_5.bungee.api.CommandSender;
import net.md_5.bungee.api.plugin.Plugin;
import org.incendo.cloud.SenderMapper;
import org.incendo.cloud.bungee.BungeeCommandManager;
import org.incendo.cloud.execution.ExecutionCoordinator;
import org.incendo.cloud.parser.standard.StringParser;

final class CloudBungeeAgentCommand {
    private CloudBungeeAgentCommand() {
    }

    static void register(Plugin plugin, AgentPlatform platform, AgentRuntime runtime) {
        AgentCommandController controller = new AgentCommandController(platform, runtime);
        BungeeCommandManager<CommandSender> commandManager = new BungeeCommandManager<>(
            plugin,
            ExecutionCoordinator.simpleCoordinator(),
            SenderMapper.identity()
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
