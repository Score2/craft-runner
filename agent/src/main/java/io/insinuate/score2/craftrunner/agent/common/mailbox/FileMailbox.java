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
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.logging.Level;

public final class FileMailbox implements Runnable {
    private static final long STALE_REQUEST_GRACE_MS = 5000L;
    private static final long MIN_STALE_REQUEST_MS = 15000L;

    private final AgentPlatform platform;
    private final Path root;
    private final Path requests;
    private final Path responses;
    private final Path processed;
    private final Path rejected;
    private final Path tmp;
    private final DebugRequestHandler requestHandler;
    private final Gson gson = new GsonBuilder().disableHtmlEscaping().create();

    public FileMailbox(AgentPlatform platform, AgentConfig config, Path root, ExecutorService asyncExecutor, JsDebugExecutor jsExecutor) {
        this.platform = platform;
        this.root = root;
        this.requests = root.resolve("requests");
        this.responses = root.resolve("responses");
        this.processed = root.resolve("processed");
        this.rejected = root.resolve("rejected");
        this.tmp = root.resolve("tmp");
        this.requestHandler = new DebugRequestHandler(platform, config, asyncExecutor, jsExecutor);
    }

    public void ensureDirectories() throws IOException {
        Files.createDirectories(root);
        Files.createDirectories(requests);
        Files.createDirectories(responses);
        Files.createDirectories(processed);
        Files.createDirectories(rejected);
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
            for (Path file : stream
                .filter(path -> path.getFileName().toString().endsWith(".json"))
                .sorted()
                .toList()) {
                processFile(file);
            }
        }
    }

    private void processFile(Path file) {
        String filename = file.getFileName().toString();
        if (Files.exists(responses.resolve(filename))) {
            moveRequest(file, processed);
            return;
        }

        DebugRequest request;
        try {
            request = gson.fromJson(Files.readString(file, StandardCharsets.UTF_8), DebugRequest.class);
        } catch (Exception error) {
            writeResponse(DebugResponse.failure(filename, error, 0L));
            moveRequest(file, rejected);
            return;
        }

        if (Files.exists(responses.resolve(request.id() + ".json"))) {
            moveRequest(file, processed);
            return;
        }
        if (isStale(file, request)) {
            writeResponse(DebugResponse.failure(request.id(), "stale debug request ignored by craft-runner agent"));
            moveRequest(file, rejected);
            return;
        }

        writeResponse(requestHandler.handle(request));
        moveRequest(file, processed);
    }

    private boolean isStale(Path file, DebugRequest request) {
        try {
            long ageMs = System.currentTimeMillis() - Files.getLastModifiedTime(file).toMillis();
            long staleAfterMs = Math.max(MIN_STALE_REQUEST_MS, request.timeoutMs() + STALE_REQUEST_GRACE_MS);
            return ageMs > staleAfterMs;
        } catch (Exception error) {
            return false;
        }
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

    private void moveRequest(Path file, Path targetDirectory) {
        try {
            Files.createDirectories(targetDirectory);
            Files.move(file, uniqueTarget(targetDirectory, file.getFileName().toString()), StandardCopyOption.ATOMIC_MOVE);
        } catch (Exception error) {
            try {
                Files.deleteIfExists(file);
            } catch (Exception deleteError) {
                platform.logger().log(Level.WARNING, "Failed to archive processed craft-runner request: " + file, error);
            }
        }
    }

    private Path uniqueTarget(Path directory, String filename) {
        Path target = directory.resolve(filename);
        if (!Files.exists(target)) {
            return target;
        }
        String suffix = "-" + UUID.randomUUID();
        if (filename.endsWith(".json")) {
            return directory.resolve(filename.substring(0, filename.length() - 5) + suffix + ".json");
        }
        return directory.resolve(filename + suffix);
    }

}
