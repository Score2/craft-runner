package io.insinuate.score2.craftrunner.agent.platform.bukkit.command;

import io.insinuate.score2.craftrunner.agent.common.command.CloudAgentCommandRegistrar;
import io.insinuate.score2.craftrunner.agent.common.runtime.AgentRuntime;
import io.insinuate.score2.craftrunner.agent.common.runtime.AgentPlatform;
import org.bukkit.command.CommandSender;
import org.bukkit.plugin.Plugin;
import org.incendo.cloud.execution.ExecutionCoordinator;
import org.incendo.cloud.paper.LegacyPaperCommandManager;

public final class CloudBukkitAgentCommand {
    private CloudBukkitAgentCommand() {
    }

    public static void register(Plugin plugin, AgentPlatform platform, AgentRuntime runtime) throws Exception {
        LegacyPaperCommandManager<CommandSender> commandManager = LegacyPaperCommandManager.createNative(
            plugin,
            ExecutionCoordinator.simpleCoordinator()
        );
        new CloudAgentCommandRegistrar<>(commandManager, sender -> sender::sendMessage, platform, runtime).register();
    }
}
