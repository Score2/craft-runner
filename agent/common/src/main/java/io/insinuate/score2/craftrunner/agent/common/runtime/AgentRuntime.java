package io.insinuate.score2.craftrunner.agent.common.runtime;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import io.insinuate.score2.craftrunner.agent.common.js.JsDebugExecutor;
import io.insinuate.score2.craftrunner.agent.common.mailbox.FileMailbox;
import io.insinuate.score2.craftrunner.agent.common.mailbox.UnixSocketMailbox;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public final class AgentRuntime {
    private final AgentPlatform platform;
    private final Gson gson = new GsonBuilder().disableHtmlEscaping().setPrettyPrinting().create();
    private ScheduledExecutorService scheduler;
    private AgentEndpointInfo endpointInfo;
    private UnixSocketMailbox unixSocketMailbox;
    private JsDebugExecutor jsExecutor;

    public AgentRuntime(AgentPlatform platform) {
        this.platform = platform;
    }

    public void enable() {
        Path root = agentsRoot();
        try {
            Files.createDirectories(root);
            LoadedConfig loaded = loadOrCreateConfig(root);
            AgentConfig config = loaded.config();
            Path endpoint = loaded.endpoint();
            String endpointName = loaded.endpointName();
            Path socket = UnixSocketMailbox.supported() ? endpoint.resolve("agent.sock") : null;

            scheduler = Executors.newScheduledThreadPool(3, runnable -> {
                Thread thread = new Thread(runnable, "craft-runner-agent-" + platform.platformName());
                thread.setDaemon(true);
                return thread;
            });
            jsExecutor = new JsDebugExecutor(platform);
            FileMailbox mailbox = new FileMailbox(platform, config, endpoint, scheduler, jsExecutor);
            mailbox.ensureDirectories();
            scheduler.scheduleWithFixedDelay(mailbox, 0L, Math.max(50L, config.pollIntervalMs()), TimeUnit.MILLISECONDS);
            if (socket != null) {
                unixSocketMailbox = new UnixSocketMailbox(platform, config, socket, scheduler, jsExecutor);
                scheduler.submit(unixSocketMailbox);
            }
            scheduler.submit(this::prepareJsQuietly);
            endpointInfo = new AgentEndpointInfo(root, endpoint, socket, endpointName, platform.platformName(), platform.serverPort(), Path.of("").toAbsolutePath(), config.token(), loaded.generated(), true);
            writeEndpointInfo(root, endpoint, endpointInfo);
            scheduler.scheduleWithFixedDelay(() -> writeEndpointInfoQuietly(root, endpoint, endpointInfo), 2L, 2L, TimeUnit.SECONDS);
            platform.logger().info("Craft Runner debug endpoint enabled for " + platform.platformName() + " at " + endpoint);
        } catch (Exception error) {
            platform.logger().severe("Failed to enable Craft Runner debug endpoint: " + error);
        }
    }

    public JsDebugExecutor jsExecutor() {
        if (jsExecutor == null) {
            jsExecutor = new JsDebugExecutor(platform);
        }
        return jsExecutor;
    }

    public void disable() {
        if (unixSocketMailbox != null) {
            unixSocketMailbox.stop();
            unixSocketMailbox = null;
        }
        if (scheduler != null) {
            scheduler.shutdownNow();
            scheduler = null;
        }
    }

    public AgentEndpointInfo endpointInfo() {
        if (endpointInfo != null) {
            return endpointInfo;
        }
        Path root = agentsRoot();
        String endpointName = defaultEndpointName();
        Path endpoint = root.resolve(endpointName);
        Path socket = UnixSocketMailbox.supported() ? endpoint.resolve("agent.sock") : null;
        return new AgentEndpointInfo(root, endpoint, socket, endpointName, platform.platformName(), platform.serverPort(), Path.of("").toAbsolutePath(), "", false, false);
    }

    private LoadedConfig loadOrCreateConfig(Path root) throws Exception {
        String endpointName = defaultEndpointName();
        Path endpoint = root.resolve(endpointName);
        Path endpointConfigFile = endpoint.resolve("config.json");

        if (Files.isRegularFile(endpointConfigFile)) {
            AgentConfig config = readConfig(endpointConfigFile);
            config.endpointName(endpointName);
            return new LoadedConfig(endpoint, endpointName, config, false);
        }

        Files.createDirectories(endpoint);
        AgentConfig config = AgentConfig.generated(endpointName, configuredToken());
        Files.writeString(endpointConfigFile, gson.toJson(config) + "\n", StandardCharsets.UTF_8);
        return new LoadedConfig(endpoint, endpointName, config, true);
    }

    private AgentConfig readConfig(Path configFile) throws Exception {
        AgentConfig config = gson.fromJson(Files.readString(configFile, StandardCharsets.UTF_8), AgentConfig.class);
        if (config == null || !config.isValid()) {
            throw new IllegalArgumentException("invalid craft-runner agent config: " + configFile);
        }
        return config;
    }

    private String defaultEndpointName() {
        int port = platform.serverPort();
        if (port <= 0 || port > 65535) {
            throw new IllegalStateException("Could not determine server port for craft-runner agent endpoint");
        }
        return String.valueOf(port);
    }

    private String configuredToken() {
        String configuredToken = System.getenv("CRAFT_RUNNER_AGENT_TOKEN");
        if (configuredToken != null && !configuredToken.isBlank()) {
            return configuredToken;
        }
        return "local-" + UUID.randomUUID();
    }

    private Path agentsRoot() {
        String explicitAgents = System.getenv("CRAFT_RUNNER_AGENTS_DIR");
        if (explicitAgents != null && !explicitAgents.isBlank()) {
            return Path.of(explicitAgents);
        }
        String home = System.getenv("CRAFT_RUNNER_HOME");
        if (home != null && !home.isBlank()) {
            return Path.of(home, "agents");
        }
        return Path.of(System.getProperty("user.home"), ".craft-runner", "agents");
    }

    private void prepareJsQuietly() {
        try {
            jsExecutor().prepare();
            platform.logger().info("Craft Runner JS engine is ready.");
        } catch (Throwable error) {
            platform.logger().warning("Craft Runner JS engine preload failed; run /cra js-load to retry: " + error.getMessage());
        }
    }

    private void writeEndpointInfo(Path root, Path endpoint, AgentEndpointInfo info) throws Exception {
        Files.createDirectories(root);
        Files.createDirectories(endpoint);
        String body = gson.toJson(info.asMap()) + "\n";
        Files.writeString(endpoint.resolve("endpoint.json"), body, StandardCharsets.UTF_8);
        Files.writeString(root.resolve("current.json"), body, StandardCharsets.UTF_8);
    }

    private void writeEndpointInfoQuietly(Path root, Path endpoint, AgentEndpointInfo info) {
        try {
            writeEndpointInfo(root, endpoint, info);
        } catch (Exception ignored) {
        }
    }

    private record LoadedConfig(Path endpoint, String endpointName, AgentConfig config, boolean generated) {
    }
}
