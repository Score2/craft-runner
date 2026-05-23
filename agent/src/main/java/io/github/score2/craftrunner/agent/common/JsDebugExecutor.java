package io.github.score2.craftrunner.agent.common;

import java.util.LinkedHashMap;
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
        try (Context context = Context.newBuilder("js")
                .allowHostAccess(HostAccess.ALL)
                .allowHostClassLookup(className -> true)
                .build()) {
            Value bindings = context.getBindings("js");
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
            result.put("value", value.toString());
        } else if (value.isHostObject()) {
            Object object = value.asHostObject();
            result.put("type", object == null ? "host:null" : object.getClass().getName());
            result.put("value", String.valueOf(object));
        } else {
            result.put("type", value.getMetaObject() == null ? "object" : value.getMetaObject().toString());
            result.put("value", value.toString());
        }
        return result;
    }
}
