package io.insinuate.score2.craftrunner.agent.common.mailbox;

import io.insinuate.score2.craftrunner.agent.common.hot.HotPluginExecutor;
import io.insinuate.score2.craftrunner.agent.common.js.JsDebugExecutor;
import io.insinuate.score2.craftrunner.agent.common.runtime.AgentConfig;
import io.insinuate.score2.craftrunner.agent.common.runtime.AgentPlatform;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

public final class DebugRequestHandler {
    private final AgentPlatform platform;
    private final AgentConfig config;
    private final ExecutorService asyncExecutor;
    private final JsDebugExecutor executor;
    private final HotPluginExecutor hotPluginExecutor;
    private static final String REMOTE_PREFIX = "§8[§6CR§e§lA§6-REMOTE§8] §7";

    public DebugRequestHandler(AgentPlatform platform, AgentConfig config, ExecutorService asyncExecutor, JsDebugExecutor executor) {
        this.platform = platform;
        this.config = config;
        this.asyncExecutor = asyncExecutor;
        this.executor = executor;
        this.hotPluginExecutor = new HotPluginExecutor(platform);
    }

    public DebugResponse handle(DebugRequest request) {
        if (request == null || request.id() == null || request.id().isBlank()) {
            return DebugResponse.failure("unknown", "request id is required");
        }
        if (!config.token().equals(request.token())) {
            return DebugResponse.failure(request.id(), "invalid token");
        }
        if (!"js".equalsIgnoreCase(request.language())
            && !"hot_plugin".equalsIgnoreCase(request.language())
            && !"command".equalsIgnoreCase(request.language())) {
            return DebugResponse.failure(request.id(), "unsupported language: " + request.language());
        }
        platform.remoteMessage(REMOTE_PREFIX + "Executing " + describe(request) + " request " + request.id());
        DebugResponse response = execute(request);
        if (response.ok()) {
            platform.remoteMessage(REMOTE_PREFIX + "§aCompleted §7" + describe(request) + " request " + request.id() + " in " + response.durationMs() + "ms");
        } else {
            platform.remoteMessage(REMOTE_PREFIX + "§cFailed §7" + describe(request) + " request " + request.id() + ": " + response.error());
        }
        return response;
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
        if ("command".equalsIgnoreCase(request.language())) {
            return platform.dispatchConsoleCommand(normalizeCommand(request.command()));
        }
        return executor.execute(request.code());
    }

    private String describe(DebugRequest request) {
        if ("hot_plugin".equalsIgnoreCase(request.language())) {
            String action = request.action() == null || request.action().isBlank() ? "hot_plugin" : "hot_plugin " + request.action();
            String plugin = request.pluginName() == null || request.pluginName().isBlank() ? "" : " " + request.pluginName();
            return action + plugin;
        }
        if ("command".equalsIgnoreCase(request.language())) {
            return "command";
        }
        return "js";
    }

    private String normalizeCommand(String command) {
        String normalized = command == null ? "" : command.trim();
        if (normalized.startsWith("/")) {
            normalized = normalized.substring(1).trim();
        }
        if (normalized.isBlank()) {
            throw new IllegalArgumentException("command is required");
        }
        return normalized;
    }

    private long elapsedMs(long started) {
        return (System.nanoTime() - started) / 1_000_000L;
    }

    private long timeoutMs(DebugRequest request) {
        return Math.max(1L, request.timeoutMs() <= 0L ? 3000L : request.timeoutMs());
    }
}
