package io.insinuate.score2.craftrunner.agent.platform.velocity;

import com.velocitypowered.api.command.CommandSource;
import com.velocitypowered.api.plugin.PluginContainer;
import com.velocitypowered.api.proxy.ProxyServer;
import io.insinuate.score2.craftrunner.agent.common.AgentCommandController;
import io.insinuate.score2.craftrunner.agent.common.AgentPlatform;
import io.insinuate.score2.craftrunner.agent.common.AgentRuntime;
import net.kyori.adventure.text.Component;
import org.incendo.cloud.SenderMapper;
import org.incendo.cloud.execution.ExecutionCoordinator;
import org.incendo.cloud.parser.standard.StringParser;
import org.incendo.cloud.velocity.VelocityCommandManager;

final class CloudVelocityAgentCommand {
    private CloudVelocityAgentCommand() {
    }

    static void register(PluginContainer container, ProxyServer proxy, AgentPlatform platform, AgentRuntime runtime) {
        AgentCommandController controller = new AgentCommandController(platform, runtime);
        VelocityCommandManager<CommandSource> commandManager = new VelocityCommandManager<>(
            container,
            proxy,
            ExecutionCoordinator.simpleCoordinator(),
            SenderMapper.identity()
        );
        commandManager.command(commandManager.commandBuilder("craftragent", "cra")
            .permission("craftrunner.agent")
            .optional("args", StringParser.greedyStringParser())
            .handler(context -> controller.execute(
                message -> context.sender().sendMessage(Component.text(message)),
                "craftragent",
                context.<String>optional("args").orElse("")
            )));
    }
}
