package io.insinuate.score2.craftrunner.agent.common;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.logging.Logger;
import org.graalvm.polyglot.Context;
import org.graalvm.polyglot.HostAccess;
import org.graalvm.polyglot.Value;

final class JsDebugExecutor {
    private final AgentPlatform platform;
    private final Logger logger;

    JsDebugExecutor(AgentPlatform platform) {
        this.platform = platform;
        this.logger = platform.logger();
    }

    Object execute(String code) {
        CraftRunnerDebugApi debugApi = new CraftRunnerDebugApi(platform);
        try (Context context = Context.newBuilder("js")
                .option("engine.WarnInterpreterOnly", "false")
                .allowHostAccess(HostAccess.ALL)
                .allowHostClassLookup(className -> true)
                .build()) {
            Value bindings = context.getBindings("js");
            bindings.putMember("cr", debugApi);
            bindings.putMember("craftRunner", debugApi);
            putClass(bindings, "Bukkit", "org.bukkit.Bukkit");
            putClass(bindings, "MinecraftServer", "net.minecraft.server.MinecraftServer");
            bindings.putMember("platform", platform.platformName());
            bindings.putMember("server", platform.serverObject());
            bindings.putMember("logger", logger);
            bindings.putMember("plugin", platform.pluginObject());
            bindings.putMember("agent", this);
            Value value = context.eval("js", code);
            return serializeValue(value);
        }
    }

    public String inspect(Object value) {
        if (value == null) {
            return "null";
        }
        return value.getClass().getName() + ": " + value;
    }

    private void putClass(Value bindings, String name, String className) {
        try {
            bindings.putMember(name, Class.forName(className));
        } catch (ClassNotFoundException ignored) {
            // Platform-specific convenience binding is unavailable.
        }
    }

    private Object serializeValue(Value value) {
        Map<String, Object> result = new LinkedHashMap<>();
        if (value == null || value.isNull()) {
            result.put("type", "null");
            result.put("value", null);
        } else if (value.isBoolean()) {
            result.put("type", "boolean");
            result.put("value", value.asBoolean());
        } else if (value.isNumber()) {
            result.put("type", "number");
            result.put("value", value.asDouble());
        } else if (value.isString()) {
            result.put("type", "string");
            result.put("value", value.asString());
        } else if (value.hasArrayElements()) {
            result.put("type", "array");
            result.put("size", value.getArraySize());
            result.put("value", serializeArrayValue(value));
        } else if (value.isHostObject()) {
            Object object = value.asHostObject();
            result.put("type", object == null ? "host:null" : object.getClass().getName());
            result.put("value", serializeHostObject(object, 0));
        } else {
            result.put("type", value.getMetaObject() == null ? "object" : value.getMetaObject().toString());
            result.put("value", value.toString());
        }
        return result;
    }

    private Object serializeArrayValue(Value value) {
        long size = value.getArraySize();
        int limit = (int) Math.min(size, 100);
        List<Object> items = new java.util.ArrayList<>(limit);
        for (int index = 0; index < limit; index++) {
            Value item = value.getArrayElement(index);
            if (item == null || item.isNull()) {
                items.add(null);
            } else if (item.isBoolean()) {
                items.add(item.asBoolean());
            } else if (item.isNumber()) {
                items.add(item.asDouble());
            } else if (item.isString()) {
                items.add(item.asString());
            } else if (item.isHostObject()) {
                items.add(serializeHostObject(item.asHostObject(), 1));
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
}
