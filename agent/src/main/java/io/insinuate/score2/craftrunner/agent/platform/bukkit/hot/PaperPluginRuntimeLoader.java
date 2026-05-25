package io.insinuate.score2.craftrunner.agent.platform.bukkit.hot;

import java.io.IOException;
import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.jar.JarFile;
import org.bukkit.Bukkit;
import org.bukkit.plugin.Plugin;

final class PaperPluginRuntimeLoader {
    Plugin load(Path path, List<String> warnings) {
        try {
            PaperProviders providers = createProviders(path);
            String pluginName = providerPluginName(providers.pluginProvider());
            if (Bukkit.getPluginManager().getPlugin(pluginName) != null) {
                throw new IllegalStateException("Plugin is already loaded: " + pluginName);
            }
            if (providers.bootstrapProvider() != null) {
                runBootstrapProvider(providers.bootstrapProvider());
                registerEntrypoint("BOOTSTRAPPER", providers.bootstrapProvider());
                warnings.add("Ran Paper bootstrap provider.");
            }

            Object storage = createRuntimePluginStorage();
            addRuntimeProvider(storage, providers.pluginProvider());
            registerEntrypoint("PLUGIN", providers.pluginProvider());
            Method enter = storage.getClass().getMethod("enter");
            enter.setAccessible(true);
            enter.invoke(storage);

            Method getSingleLoaded = storage.getClass().getMethod("getSingleLoaded");
            getSingleLoaded.setAccessible(true);
            Object loaded = getSingleLoaded.invoke(storage);
            if (loaded instanceof Optional<?> optional && optional.isPresent() && optional.get() instanceof Plugin plugin) {
                return plugin;
            }
            throw new IllegalStateException("Paper runtime storage did not return a loaded plugin.");
        } catch (IOException | ReflectiveOperationException | LinkageError error) {
            throw new IllegalStateException("Failed to load paper-plugin.yml jar through Paper internals: " + path, error);
        }
    }

    private PaperProviders createProviders(Path path) throws ReflectiveOperationException, IOException {
        Class<?> entrypointHandlerClass = Class.forName("io.papermc.paper.plugin.entrypoint.EntrypointHandler");
        Class<?> pluginFileTypeClass = Class.forName("io.papermc.paper.plugin.provider.type.PluginFileType");
        Object paperType = BukkitReflection.fieldValue(pluginFileTypeClass, null, "PAPER");
        if (paperType == null) {
            throw new IllegalStateException("Paper PluginFileType.PAPER is not available.");
        }

        Map<String, Object> providers = new LinkedHashMap<>();
        InvocationHandler handler = (proxy, method, args) -> {
            if ("register".equals(method.getName()) && args != null && args.length == 2) {
                Method getDebugName = args[0].getClass().getMethod("getDebugName");
                providers.put(String.valueOf(getDebugName.invoke(args[0])).toLowerCase(Locale.ROOT), args[1]);
                return null;
            }
            if ("enter".equals(method.getName())) {
                return null;
            }
            if ("toString".equals(method.getName())) {
                return "CraftRunnerPaperEntrypointCollector" + providers.keySet();
            }
            return null;
        };
        Object entrypointCollector = Proxy.newProxyInstance(
            entrypointHandlerClass.getClassLoader(),
            new Class<?>[] {entrypointHandlerClass},
            handler
        );

        JarFile jarFile = new JarFile(path.toFile(), true, JarFile.OPEN_READ, Runtime.version());
        try {
            Method register = pluginFileTypeClass.getMethod("register", entrypointHandlerClass, JarFile.class, Path.class);
            register.invoke(paperType, entrypointCollector, jarFile, path);
        } catch (ReflectiveOperationException | LinkageError error) {
            try {
                jarFile.close();
            } catch (IOException ignored) {
            }
            throw error;
        }

        Object pluginProvider = providers.get("plugin");
        if (pluginProvider == null) {
            try {
                jarFile.close();
            } catch (IOException ignored) {
            }
            throw new IllegalStateException("paper-plugin.yml did not register a plugin provider.");
        }
        return new PaperProviders(providers.get("bootstrapper"), pluginProvider);
    }

    private String providerPluginName(Object provider) throws ReflectiveOperationException {
        Method getMeta = provider.getClass().getMethod("getMeta");
        Object meta = getMeta.invoke(provider);
        Method getName = meta.getClass().getMethod("getName");
        return String.valueOf(getName.invoke(meta));
    }

    private void runBootstrapProvider(Object bootstrapProvider) throws ReflectiveOperationException {
        Class<?> storageClass = Class.forName("io.papermc.paper.plugin.storage.BootstrapProviderStorage");
        Object storage = storageClass.getConstructor().newInstance();
        Method register = storageClass.getMethod("register", Class.forName("io.papermc.paper.plugin.provider.PluginProvider"));
        register.invoke(storage, bootstrapProvider);
        Method enter = storageClass.getMethod("enter");
        enter.invoke(storage);
    }

    private Object createRuntimePluginStorage() throws ReflectiveOperationException {
        Object instanceManager = paperInstanceManager();
        if (instanceManager == null) {
            throw new IllegalStateException("Paper plugin instance manager is not available.");
        }
        Object dependencyTree = BukkitReflection.fieldValue(instanceManager, "dependencyTree");
        if (dependencyTree == null) {
            throw new IllegalStateException("Paper plugin dependency tree is not available.");
        }

        Class<?> storageClass = Class.forName("io.papermc.paper.plugin.manager.SingularRuntimePluginProviderStorage");
        Class<?> dependencyTreeClass = Class.forName("io.papermc.paper.plugin.entrypoint.dependency.MetaDependencyTree");
        Constructor<?> constructor = storageClass.getDeclaredConstructor(dependencyTreeClass);
        constructor.setAccessible(true);
        return constructor.newInstance(dependencyTree);
    }

    private void addRuntimeProvider(Object storage, Object pluginProvider) {
        Object providers = BukkitReflection.fieldValue(storage, "providers");
        if (!(providers instanceof List<?> list)) {
            throw new IllegalStateException("Paper runtime storage provider list is not available.");
        }
        @SuppressWarnings("unchecked")
        List<Object> writable = (List<Object>) list;
        writable.add(pluginProvider);
        BukkitReflection.setFieldValue(storage, "lastProvider", pluginProvider);
    }

    private void registerEntrypoint(String entrypointField, Object provider) throws ReflectiveOperationException {
        Class<?> entrypointClass = Class.forName("io.papermc.paper.plugin.entrypoint.Entrypoint");
        Object entrypoint = BukkitReflection.fieldValue(entrypointClass, null, entrypointField);
        Class<?> handlerClass = Class.forName("io.papermc.paper.plugin.entrypoint.LaunchEntryPointHandler");
        Object instance = BukkitReflection.fieldValue(handlerClass, null, "INSTANCE");
        if (entrypoint == null || instance == null) {
            throw new IllegalStateException("Paper launch entrypoint handler is not available.");
        }
        Method register = handlerClass.getMethod("register", entrypointClass, Class.forName("io.papermc.paper.plugin.provider.PluginProvider"));
        register.invoke(instance, entrypoint, provider);
    }

    private Object paperInstanceManager() {
        Object paperPluginManager = paperPluginManager(Bukkit.getPluginManager());
        return paperPluginManager == null ? null : BukkitReflection.fieldValue(paperPluginManager, "instanceManager");
    }

    private Object paperPluginManager(Object pluginManager) {
        Object paperPluginManager = BukkitReflection.fieldValue(pluginManager, "paperPluginManager");
        if (paperPluginManager != null) {
            return paperPluginManager;
        }
        try {
            Class<?> managerClass = Class.forName("io.papermc.paper.plugin.manager.PaperPluginManagerImpl");
            Method getInstance = managerClass.getMethod("getInstance");
            return getInstance.invoke(null);
        } catch (ReflectiveOperationException | LinkageError ignored) {
            return null;
        }
    }

    private record PaperProviders(Object bootstrapProvider, Object pluginProvider) {
    }
}
