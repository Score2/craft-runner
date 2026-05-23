package io.github.score2.craftrunner.agent;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.bukkit.plugin.java.JavaPlugin;

public final class CraftRunnerAgentPlugin extends JavaPlugin {
    private final Gson gson = new GsonBuilder().disableHtmlEscaping().setPrettyPrinting().create();
    private ScheduledExecutorService scheduler;

    @Override
    public void onEnable() {
        Path root = Path.of("").toAbsolutePath().resolve(".craft-runner-agent");
        try {
            Files.createDirectories(root);
            Path configFile = root.resolve("config.json");
            if (!Files.isRegularFile(configFile)) {
                getLogger().warning("Missing .craft-runner-agent/config.json; debug mailbox is disabled.");
                return;
            }
            AgentConfig config = gson.fromJson(Files.readString(configFile, StandardCharsets.UTF_8), AgentConfig.class);
            if (config == null || !config.isValid()) {
                getLogger().warning("Invalid craft-runner agent config; debug mailbox is disabled.");
                return;
            }

            scheduler = Executors.newScheduledThreadPool(2, runnable -> {
                Thread thread = new Thread(runnable, "craft-runner-agent");
                thread.setDaemon(true);
                return thread;
            });
            FileMailbox mailbox = new FileMailbox(this, config, root, scheduler);
            mailbox.ensureDirectories();
            scheduler.scheduleWithFixedDelay(mailbox, 0L, Math.max(50L, config.pollIntervalMs), TimeUnit.MILLISECONDS);
            getLogger().info("Craft Runner debug mailbox enabled at " + root);
        } catch (Exception error) {
            getLogger().severe("Failed to enable Craft Runner debug mailbox: " + error);
        }
    }

    @Override
    public void onDisable() {
        if (scheduler != null) {
            scheduler.shutdownNow();
        }
    }
}
