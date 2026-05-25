package io.insinuate.score2.craftrunner.agent.platform.bukkit;

import io.insinuate.score2.craftrunner.agent.common.AgentPlatform;
import io.insinuate.score2.craftrunner.agent.common.AgentRuntime;
import io.insinuate.score2.craftrunner.agent.common.hot.HotPluginOperations;
import io.insinuate.score2.craftrunner.agent.platform.bukkit.hot.BukkitHotPluginOperations;
import java.lang.reflect.Method;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.function.Consumer;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.java.JavaPlugin;

public final class CraftRunnerBukkitPlugin extends JavaPlugin implements AgentPlatform {
    private AgentRuntime runtime;
    private BukkitHotPluginOperations hotPluginOperations;

    @Override
    public void onEnable() {
        hotPluginOperations = new BukkitHotPluginOperations(this);
        runtime = new AgentRuntime(this);
        runtime.enable();
        try {
            CloudBukkitAgentCommand.register(this, this, runtime);
        } catch (Exception error) {
            getLogger().warning("Failed to register Craft Runner agent command: " + error);
        }
    }

    @Override
    public void onDisable() {
        if (runtime != null) {
            runtime.disable();
        }
    }

    @Override
    public String platformName() {
        return "bukkit";
    }

    @Override
    public Logger logger() {
        return getLogger();
    }

    @Override
    public Object pluginObject() {
        return this;
    }

    @Override
    public Object serverObject() {
        return getServer();
    }

    @Override
    public int serverPort() {
        return getServer().getPort();
    }

    @Override
    public Object debugPlatformApi() {
        return new BukkitDebugApi(this);
    }

    @Override
    public HotPluginOperations hotPluginOperations() {
        if (hotPluginOperations == null) {
            hotPluginOperations = new BukkitHotPluginOperations(this);
        }
        return hotPluginOperations;
    }

    @Override
    public Future<Object> callMainThread(Callable<Object> task, ExecutorService fallbackExecutor) {
        Future<Object> foliaFuture = callFoliaGlobalScheduler(task);
        if (foliaFuture != null) {
            return foliaFuture;
        }
        return Bukkit.getScheduler().callSyncMethod(this, task);
    }

    private Future<Object> callFoliaGlobalScheduler(Callable<Object> task) {
        try {
            Class.forName("io.papermc.paper.threadedregions.RegionizedServer");
            Method schedulerMethod = Bukkit.class.getMethod("getGlobalRegionScheduler");
            Object scheduler = schedulerMethod.invoke(null);
            Method runMethod = scheduler.getClass().getMethod("run", Plugin.class, Consumer.class);
            CompletableFuture<Object> future = new CompletableFuture<>();
            runMethod.invoke(scheduler, this, (Consumer<Object>) ignored -> {
                try {
                    future.complete(task.call());
                } catch (Throwable error) {
                    future.completeExceptionally(error);
                }
            });
            return future;
        } catch (ReflectiveOperationException | LinkageError error) {
            return null;
        }
    }
}
