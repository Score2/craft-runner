package io.insinuate.score2.craftrunner.agent.common.mailbox;

import lombok.Value;
import lombok.experimental.Accessors;

@Value
@Accessors(fluent = true)
final class DebugResponse {
    String id;
    boolean ok;
    Object result;
    String error;
    String stack;
    long durationMs;

    static DebugResponse success(String id, Object result, long durationMs) {
        return new DebugResponse(id, true, result, null, null, durationMs);
    }

    static DebugResponse failure(String id, Throwable error, long durationMs) {
        return new DebugResponse(id, false, null, error.toString(), stackTrace(error), durationMs);
    }

    static DebugResponse failure(String id, String error) {
        return new DebugResponse(id, false, null, error, null, 0L);
    }

    private static String stackTrace(Throwable error) {
        StringBuilder builder = new StringBuilder();
        builder.append(error).append('\n');
        for (StackTraceElement element : error.getStackTrace()) {
            builder.append("  at ").append(element).append('\n');
        }
        Throwable cause = error.getCause();
        if (cause != null) {
            builder.append("Caused by: ").append(stackTrace(cause));
        }
        return builder.toString();
    }
}
