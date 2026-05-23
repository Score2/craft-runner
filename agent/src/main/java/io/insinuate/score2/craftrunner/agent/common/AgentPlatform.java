package io.insinuate.score2.craftrunner.agent.common;

import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.logging.Logger;

public interface AgentPlatform {
    String platformName();

    Logger logger();

    Object pluginObject();

    Object serverObject();

    default Future<Object> callMainThread(Callable<Object> task, ExecutorService fallbackExecutor) {
        Object server = serverObject();
        if (server != null) {
            return ReflectiveServerExecutor.call(server, task, fallbackExecutor);
        }
        return fallbackExecutor.submit(task);
    }
}
