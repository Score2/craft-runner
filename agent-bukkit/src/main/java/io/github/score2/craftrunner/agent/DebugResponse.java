package io.github.score2.craftrunner.agent;

final class DebugResponse {
    String id;
    boolean ok;
    Object result;
    String error;
    String stack;
    long durationMs;

    static DebugResponse success(String id, Object result, long durationMs) {
        DebugResponse response = new DebugResponse();
        response.id = id;
        response.ok = true;
        response.result = result;
        response.durationMs = durationMs;
        return response;
    }

    static DebugResponse failure(String id, Throwable error, long durationMs) {
        DebugResponse response = new DebugResponse();
        response.id = id;
        response.ok = false;
        response.error = error.toString();
        response.stack = stackTrace(error);
        response.durationMs = durationMs;
        return response;
    }

    static DebugResponse failure(String id, String error) {
        DebugResponse response = new DebugResponse();
        response.id = id;
        response.ok = false;
        response.error = error;
        response.durationMs = 0L;
        return response;
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
