package io.insinuate.score2.craftrunner.agent.common;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public final class AgentRuntime {
    private final AgentPlatform platform;
    private final Gson gson = new GsonBuilder().disableHtmlEscaping().setPrettyPrinting().create();
    private ScheduledExecutorService scheduler;

    public AgentRuntime(AgentPlatform platform) {
        this.platform = platform;
    }

    public void enable() {
        Path root = Path.of("").toAbsolutePath().resolve(".craft-runner-agent");
        try {
            Files.createDirectories(root);
            Path configFile = root.resolve("config.json");
            if (!Files.isRegularFile(configFile)) {
                platform.logger().warning("Missing .craft-runner-agent/config.json; debug mailbox is disabled.");
                return;
            }
            AgentConfig config = gson.fromJson(Files.readString(configFile, StandardCharsets.UTF_8), AgentConfig.class);
            if (config == null || !config.isValid()) {
                platform.logger().warning("Invalid craft-runner agent config; debug mailbox is disabled.");
                return;
            }

            scheduler = Executors.newScheduledThreadPool(2, runnable -> {
                Thread thread = new Thread(runnable, "craft-runner-agent-" + platform.platformName());
                thread.setDaemon(true);
                return thread;
            });
            FileMailbox mailbox = new FileMailbox(platform, config, root, scheduler);
            mailbox.ensureDirectories();
            scheduler.scheduleWithFixedDelay(mailbox, 0L, Math.max(50L, config.pollIntervalMs()), TimeUnit.MILLISECONDS);
            platform.logger().info("Craft Runner debug mailbox enabled for " + platform.platformName() + " at " + root);
        } catch (Exception error) {
            platform.logger().severe("Failed to enable Craft Runner debug mailbox: " + error);
        }
    }

    public void disable() {
        if (scheduler != null) {
            scheduler.shutdownNow();
            scheduler = null;
        }
    }
}
