package io.insinuate.score2.craftrunner.agent.platform.velocity.command;

import com.velocitypowered.api.command.CommandSource;
import com.velocitypowered.api.plugin.PluginContainer;
import com.velocitypowered.api.proxy.ProxyServer;
import io.insinuate.score2.craftrunner.agent.common.command.CloudAgentCommandRegistrar;
import io.insinuate.score2.craftrunner.agent.common.runtime.AgentPlatform;
import io.insinuate.score2.craftrunner.agent.common.runtime.AgentRuntime;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.incendo.cloud.SenderMapper;
import org.incendo.cloud.execution.ExecutionCoordinator;
import org.incendo.cloud.velocity.VelocityCommandManager;

public final class CloudVelocityAgentCommand {
    private CloudVelocityAgentCommand() {
    }

    public static void register(PluginContainer container, ProxyServer proxy, AgentPlatform platform, AgentRuntime runtime) {
        LegacyComponentSerializer legacy = LegacyComponentSerializer.legacySection();
        VelocityCommandManager<CommandSource> commandManager = new VelocityCommandManager<>(
            container,
            proxy,
            ExecutionCoordinator.simpleCoordinator(),
            SenderMapper.identity()
        );
        new CloudAgentCommandRegistrar<>(
            commandManager,
            sender -> message -> sender.sendMessage(legacy.deserialize(message)),
            platform,
            runtime
        ).register();
    }
}
