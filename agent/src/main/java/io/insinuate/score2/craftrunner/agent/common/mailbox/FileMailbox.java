package io.insinuate.score2.craftrunner.agent.common.mailbox;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import io.insinuate.score2.craftrunner.agent.common.js.JsDebugExecutor;
import io.insinuate.score2.craftrunner.agent.common.runtime.AgentConfig;
import io.insinuate.score2.craftrunner.agent.common.runtime.AgentPlatform;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.logging.Level;

public final class FileMailbox implements Runnable {
    private final AgentPlatform platform;
    private final Path root;
    private final Path requests;
    private final Path responses;
    private final Path tmp;
    private final DebugRequestHandler requestHandler;
    private final Gson gson = new GsonBuilder().disableHtmlEscaping().create();
    private final Set<String> seen = new HashSet<>();

    public FileMailbox(AgentPlatform platform, AgentConfig config, Path root, ExecutorService asyncExecutor, JsDebugExecutor jsExecutor) {
        this.platform = platform;
        this.root = root;
        this.requests = root.resolve("requests");
        this.responses = root.resolve("responses");
        this.tmp = root.resolve("tmp");
        this.requestHandler = new DebugRequestHandler(platform, config, asyncExecutor, jsExecutor);
    }

    public void ensureDirectories() throws IOException {
        Files.createDirectories(root);
        Files.createDirectories(requests);
        Files.createDirectories(responses);
        Files.createDirectories(tmp);
    }

    @Override
    public void run() {
        try {
            processOnce();
        } catch (Exception error) {
            platform.logger().log(Level.WARNING, "Failed to process craft-runner mailbox", error);
        }
    }

    private void processOnce() throws IOException {
        if (!Files.isDirectory(requests)) {
            return;
        }
        try (var stream = Files.list(requests)) {
            for (Path file : stream.filter(path -> path.getFileName().toString().endsWith(".json")).toList()) {
                String filename = file.getFileName().toString();
                if (seen.contains(filename)) {
                    continue;
                }
                seen.add(filename);
                processFile(file);
            }
        }
    }

    private void processFile(Path file) {
        DebugRequest request;
        try {
            request = gson.fromJson(Files.readString(file, StandardCharsets.UTF_8), DebugRequest.class);
        } catch (Exception error) {
            writeResponse(DebugResponse.failure(file.getFileName().toString(), error, 0L));
            return;
        }

        writeResponse(requestHandler.handle(request));
    }

    private void writeResponse(DebugResponse response) {
        try {
            Files.createDirectories(responses);
            Files.createDirectories(tmp);
            Path tmpFile = tmp.resolve(response.id() + "-" + UUID.randomUUID() + ".json.tmp");
            Path responseFile = responses.resolve(response.id() + ".json");
            Files.writeString(tmpFile, gson.toJson(response) + "\n", StandardCharsets.UTF_8);
            Files.move(tmpFile, responseFile, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (Exception error) {
            platform.logger().log(Level.WARNING, "Failed to write craft-runner debug response", error);
        }
    }

}
