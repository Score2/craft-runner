package io.insinuate.score2.craftrunner.agent.platform.bungee.command;

import io.insinuate.score2.craftrunner.agent.common.command.CloudAgentCommandRegistrar;
import io.insinuate.score2.craftrunner.agent.common.runtime.AgentPlatform;
import io.insinuate.score2.craftrunner.agent.common.runtime.AgentRuntime;
import net.md_5.bungee.api.CommandSender;
import net.md_5.bungee.api.plugin.Plugin;
import org.incendo.cloud.SenderMapper;
import org.incendo.cloud.bungee.BungeeCommandManager;
import org.incendo.cloud.execution.ExecutionCoordinator;

public final class CloudBungeeAgentCommand {
    private CloudBungeeAgentCommand() {
    }

    public static void register(Plugin plugin, AgentPlatform platform, AgentRuntime runtime) {
        BungeeCommandManager<CommandSender> commandManager = new BungeeCommandManager<>(
            plugin,
            ExecutionCoordinator.simpleCoordinator(),
            SenderMapper.identity()
        );
        new CloudAgentCommandRegistrar<>(commandManager, sender -> sender::sendMessage, platform, runtime).register();
    }
}
