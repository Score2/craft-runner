package io.insinuate.score2.craftrunner.agent.common.js;

import io.insinuate.score2.craftrunner.agent.common.api.CraftRunnerDebugApi;
import io.insinuate.score2.craftrunner.agent.common.runtime.AgentPlatform;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Predicate;
import java.util.logging.Logger;

public final class JsDebugExecutor {
    private final AgentPlatform platform;
    private final Logger logger;
    private final GraalJsLibraries libraries;

    public JsDebugExecutor(AgentPlatform platform) {
        this.platform = platform;
        this.logger = platform.logger();
        this.libraries = new GraalJsLibraries(logger);
    }

    public Object execute(String code) {
        CraftRunnerDebugApi debugApi = new CraftRunnerDebugApi(platform);
        ClassLoader graalClassLoader = libraries.classLoader();
        Thread thread = Thread.currentThread();
        ClassLoader previousContextLoader = thread.getContextClassLoader();
        thread.setContextClassLoader(graalClassLoader);
        Object context = null;
        try {
            context = newContext(graalClassLoader);
            Object bindings = invoke(context, "getBindings", new Class<?>[] { String.class }, "js");
            putMember(bindings, "cr", debugApi);
            putMember(bindings, "craftRunner", debugApi);
            putClass(bindings, "Bukkit", "org.bukkit.Bukkit");
            putClass(bindings, "MinecraftServer", "net.minecraft.server.MinecraftServer");
            putMember(bindings, "platform", platform.platformName());
            putMember(bindings, "server", platform.serverObject());
            putMember(bindings, "logger", logger);
            putMember(bindings, "plugin", platform.pluginObject());
            putMember(bindings, "agent", this);
            Object value = invoke(context, "eval", new Class<?>[] { String.class, CharSequence.class }, "js", code);
            return serializeValue(value);
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException("Failed to execute GraalJS through downloaded libraries", error);
        } finally {
            closeContext(context);
            thread.setContextClassLoader(previousContextLoader);
        }
    }

    public String inspect(Object value) {
        if (value == null) {
            return "null";
        }
        return value.getClass().getName() + ": " + value;
    }

    private Object newContext(ClassLoader graalClassLoader) throws ReflectiveOperationException {
        Class<?> contextClass = Class.forName("org.graalvm.polyglot.Context", true, graalClassLoader);
        Class<?> hostAccessClass = Class.forName("org.graalvm.polyglot.HostAccess", true, graalClassLoader);
        Object builder = contextClass.getMethod("newBuilder", String[].class).invoke(null, (Object) new String[] { "js" });
        invoke(builder, "option", new Class<?>[] { String.class, String.class }, "engine.WarnInterpreterOnly", "false");
        invoke(builder, "allowHostAccess", new Class<?>[] { hostAccessClass }, hostAccessClass.getField("ALL").get(null));
        invoke(builder, "allowHostClassLookup", new Class<?>[] { Predicate.class }, (Predicate<String>) className -> true);
        return invoke(builder, "build", new Class<?>[0]);
    }

    private void closeContext(Object context) {
        if (context instanceof AutoCloseable closeable) {
            try {
                closeable.close();
            } catch (Exception ignored) {
                // Best-effort context cleanup.
            }
        }
    }

    private void putClass(Object bindings, String name, String className) {
        try {
            putMember(bindings, name, Class.forName(className));
        } catch (ClassNotFoundException ignored) {
            // Platform-specific convenience binding is unavailable.
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException("Failed to bind class: " + className, error);
        }
    }

    private void putMember(Object bindings, String name, Object value) throws ReflectiveOperationException {
        invoke(bindings, "putMember", new Class<?>[] { String.class, Object.class }, name, value);
    }

    private Object serializeValue(Object value) throws ReflectiveOperationException {
        Map<String, Object> result = new LinkedHashMap<>();
        if (value == null || (Boolean) invoke(value, "isNull", new Class<?>[0])) {
            result.put("type", "null");
            result.put("value", null);
        } else if ((Boolean) invoke(value, "isBoolean", new Class<?>[0])) {
            result.put("type", "boolean");
            result.put("value", invoke(value, "asBoolean", new Class<?>[0]));
        } else if ((Boolean) invoke(value, "isNumber", new Class<?>[0])) {
            result.put("type", "number");
            result.put("value", invoke(value, "asDouble", new Class<?>[0]));
        } else if ((Boolean) invoke(value, "isString", new Class<?>[0])) {
            result.put("type", "string");
            result.put("value", invoke(value, "asString", new Class<?>[0]));
        } else if ((Boolean) invoke(value, "hasArrayElements", new Class<?>[0])) {
            result.put("type", "array");
            result.put("size", invoke(value, "getArraySize", new Class<?>[0]));
            result.put("value", serializeArrayValue(value));
        } else if ((Boolean) invoke(value, "isHostObject", new Class<?>[0])) {
            Object object = invoke(value, "asHostObject", new Class<?>[0]);
            result.put("type", object == null ? "host:null" : object.getClass().getName());
            result.put("value", serializeHostObject(object, 0));
        } else {
            Object meta = invoke(value, "getMetaObject", new Class<?>[0]);
            result.put("type", meta == null ? "object" : meta.toString());
            result.put("value", value.toString());
        }
        return result;
    }

    private Object serializeArrayValue(Object value) throws ReflectiveOperationException {
        long size = (Long) invoke(value, "getArraySize", new Class<?>[0]);
        int limit = (int) Math.min(size, 100);
        List<Object> items = new java.util.ArrayList<>(limit);
        for (int index = 0; index < limit; index++) {
            Object item = invoke(value, "getArrayElement", new Class<?>[] { long.class }, (long) index);
            if (item == null || (Boolean) invoke(item, "isNull", new Class<?>[0])) {
                items.add(null);
            } else if ((Boolean) invoke(item, "isBoolean", new Class<?>[0])) {
                items.add(invoke(item, "asBoolean", new Class<?>[0]));
            } else if ((Boolean) invoke(item, "isNumber", new Class<?>[0])) {
                items.add(invoke(item, "asDouble", new Class<?>[0]));
            } else if ((Boolean) invoke(item, "isString", new Class<?>[0])) {
                items.add(invoke(item, "asString", new Class<?>[0]));
            } else if ((Boolean) invoke(item, "isHostObject", new Class<?>[0])) {
                items.add(serializeHostObject(invoke(item, "asHostObject", new Class<?>[0]), 1));
            } else {
                items.add(item.toString());
            }
        }
        if (size > limit) {
            items.add("... truncated " + (size - limit) + " item(s)");
        }
        return items;
    }

    private Object serializeHostObject(Object object, int depth) {
        if (object == null) {
            return null;
        }
        if (object instanceof String || object instanceof Number || object instanceof Boolean) {
            return object;
        }
        if (object instanceof Map<?, ?> map && depth < 2) {
            Map<String, Object> result = new LinkedHashMap<>();
            int count = 0;
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (count++ >= 100) {
                    result.put("...", "truncated " + (map.size() - 100) + " entry(s)");
                    break;
                }
                result.put(String.valueOf(entry.getKey()), serializeHostObject(entry.getValue(), depth + 1));
            }
            return result;
        }
        if (object instanceof Iterable<?> iterable && depth < 2) {
            List<Object> result = new java.util.ArrayList<>();
            int count = 0;
            for (Object item : iterable) {
                if (count++ >= 100) {
                    result.add("... truncated");
                    break;
                }
                result.add(serializeHostObject(item, depth + 1));
            }
            return result;
        }
        Class<?> type = object.getClass();
        if (type.isArray() && depth < 2) {
            int length = java.lang.reflect.Array.getLength(object);
            int limit = Math.min(length, 100);
            List<Object> result = new java.util.ArrayList<>(limit);
            for (int index = 0; index < limit; index++) {
                result.add(serializeHostObject(java.lang.reflect.Array.get(object, index), depth + 1));
            }
            if (length > limit) {
                result.add("... truncated " + (length - limit) + " item(s)");
            }
            return result;
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("class", type.getName());
        result.put("string", String.valueOf(object));
        return result;
    }

    private Object invoke(Object target, String method, Class<?>[] types, Object... args) throws ReflectiveOperationException {
        return target.getClass().getMethod(method, types).invoke(target, args);
    }
}
