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

    public DebugRequestHandler(AgentPlatform platform, AgentConfig config, ExecutorService asyncExecutor) {
        this.platform = platform;
        this.config = config;
        this.asyncExecutor = asyncExecutor;
        this.executor = new JsDebugExecutor(platform);
        this.hotPluginExecutor = new HotPluginExecutor(platform);
    }

    public DebugResponse handle(DebugRequest request) {
        if (request == null || request.id() == null || request.id().isBlank()) {
            return DebugResponse.failure("unknown", "request id is required");
        }
        if (!config.token().equals(request.token())) {
            return DebugResponse.failure(request.id(), "invalid token");
        }
        if (!"js".equalsIgnoreCase(request.language()) && !"hot_plugin".equalsIgnoreCase(request.language())) {
            return DebugResponse.failure(request.id(), "unsupported language: " + request.language());
        }
        return execute(request);
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

    private long elapsedMs(long started) {
        return (System.nanoTime() - started) / 1_000_000L;
    }

    private long timeoutMs(DebugRequest request) {
        return Math.max(1L, request.timeoutMs() <= 0L ? 3000L : request.timeoutMs());
    }
}
