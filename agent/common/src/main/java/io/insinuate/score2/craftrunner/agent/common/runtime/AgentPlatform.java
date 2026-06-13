package io.insinuate.score2.craftrunner.agent.common.runtime;

import io.insinuate.score2.craftrunner.agent.common.api.PlatformDebugApi;
import io.insinuate.score2.craftrunner.agent.common.hot.HotPluginOperations;
import io.insinuate.score2.craftrunner.agent.common.hot.UnsupportedHotPluginOperations;
import io.insinuate.score2.craftrunner.agent.common.reflect.ReflectiveServerExecutor;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.logging.Logger;

public interface AgentPlatform {
    String platformName();

    Logger logger();

    Object pluginObject();

    Object serverObject();

    default void remoteMessage(String message) {
        logger().info(message);
    }

    default int serverPort() {
        return AgentPortResolver.resolve(serverObject());
    }

    default Object debugPlatformApi() {
        return new PlatformDebugApi(this);
    }

    default HotPluginOperations hotPluginOperations() {
        return new UnsupportedHotPluginOperations(platformName());
    }

    default Future<Object> callMainThread(Callable<Object> task, ExecutorService fallbackExecutor) {
        Object server = serverObject();
        if (server != null) {
            return ReflectiveServerExecutor.call(server, task, fallbackExecutor);
        }
        return fallbackExecutor.submit(task);
    }
}
