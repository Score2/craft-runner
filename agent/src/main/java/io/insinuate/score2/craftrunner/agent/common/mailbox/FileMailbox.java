package io.insinuate.score2.craftrunner.agent.common.mailbox;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import io.insinuate.score2.craftrunner.agent.common.hot.HotPluginExecutor;
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
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.logging.Level;

public final class FileMailbox implements Runnable {
    private final AgentPlatform platform;
    private final AgentConfig config;
    private final Path root;
    private final Path requests;
    private final Path responses;
    private final Path tmp;
    private final ExecutorService asyncExecutor;
    private final JsDebugExecutor executor;
    private final HotPluginExecutor hotPluginExecutor;
    private final Gson gson = new GsonBuilder().disableHtmlEscaping().create();
    private final Set<String> seen = new HashSet<>();

    public FileMailbox(AgentPlatform platform, AgentConfig config, Path root, ExecutorService asyncExecutor) {
        this.platform = platform;
        this.config = config;
        this.root = root;
        this.requests = root.resolve("requests");
        this.responses = root.resolve("responses");
        this.tmp = root.resolve("tmp");
        this.asyncExecutor = asyncExecutor;
        this.executor = new JsDebugExecutor(platform);
        this.hotPluginExecutor = new HotPluginExecutor(platform);
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

        if (request == null || request.id() == null || request.id().isBlank()) {
            writeResponse(DebugResponse.failure("unknown", "request id is required"));
            return;
        }
        if (!config.token().equals(request.token())) {
            writeResponse(DebugResponse.failure(request.id(), "invalid token"));
            return;
        }
        if (!"js".equalsIgnoreCase(request.language()) && !"hot_plugin".equalsIgnoreCase(request.language())) {
            writeResponse(DebugResponse.failure(request.id(), "unsupported language: " + request.language()));
            return;
        }
        writeResponse(execute(request));
    }

    private DebugResponse execute(DebugRequest request) {
        long started = System.nanoTime();
        Future<Object> future = null;
        try {
            if ("async".equalsIgnoreCase(request.thread())) {
                future = asyncExecutor.submit(() -> executeRequest(request));
            } else {
                future = platform.callMainThread(() -> executeRequest(request), asyncExecutor);
            }
            Object result = future.get(timeoutMs(request), TimeUnit.MILLISECONDS);
            return DebugResponse.success(request.id(), result, elapsedMs(started));
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return DebugResponse.failure(request.id(), error, elapsedMs(started));
        } catch (TimeoutException error) {
            if (future != null) {
                future.cancel(true);
            }
            return DebugResponse.failure(request.id(), "execution timed out after " + timeoutMs(request) + "ms");
        } catch (ExecutionException error) {
            return DebugResponse.failure(request.id(), error.getCause() == null ? error : error.getCause(), elapsedMs(started));
        } catch (Exception error) {
            return DebugResponse.failure(request.id(), error, elapsedMs(started));
        }
    }

    private Object executeRequest(DebugRequest request) {
        if ("hot_plugin".equalsIgnoreCase(request.language())) {
            return hotPluginExecutor.execute(request);
        }
        return executor.execute(request.code());
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

    private long elapsedMs(long started) {
        return (System.nanoTime() - started) / 1_000_000L;
    }

    private long timeoutMs(DebugRequest request) {
        return Math.max(1L, request.timeoutMs() <= 0L ? 3000L : request.timeoutMs());
    }
}
