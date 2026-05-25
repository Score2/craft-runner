package io.insinuate.score2.craftrunner.agent.common.reflect;

import java.lang.reflect.Method;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;

public final class ReflectiveServerExecutor {
    private ReflectiveServerExecutor() {
    }

    public static Future<Object> call(Object server, Callable<Object> task, ExecutorService fallbackExecutor) {
        Future<Object> future = tryExecute(server, task);
        if (future != null) {
            return future;
        }
        return fallbackExecutor.submit(task);
    }

    private static Future<Object> tryExecute(Object server, Callable<Object> task) {
        try {
            Method execute = findMethod(server.getClass(), "execute", Runnable.class);
            if (execute == null) {
                return null;
            }
            CompletableFuture<Object> future = new CompletableFuture<>();
            execute.invoke(server, (Runnable) () -> {
                try {
                    future.complete(task.call());
                } catch (Throwable error) {
                    future.completeExceptionally(error);
                }
            });
            return future;
        } catch (ReflectiveOperationException | RuntimeException error) {
            return null;
        }
    }

    private static Method findMethod(Class<?> type, String name, Class<?>... parameterTypes) {
        Class<?> current = type;
        while (current != null) {
            try {
                Method method = current.getDeclaredMethod(name, parameterTypes);
                method.setAccessible(true);
                return method;
            } catch (NoSuchMethodException ignored) {
                current = current.getSuperclass();
            }
        }
        return null;
    }
}
