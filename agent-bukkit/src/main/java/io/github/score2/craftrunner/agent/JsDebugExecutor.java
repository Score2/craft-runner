package io.github.score2.craftrunner.agent;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.graalvm.polyglot.Context;
import org.graalvm.polyglot.HostAccess;
import org.graalvm.polyglot.Value;

final class JsDebugExecutor {
    private final CraftRunnerAgentPlugin plugin;
    private final Logger logger;

    JsDebugExecutor(CraftRunnerAgentPlugin plugin) {
        this.plugin = plugin;
        this.logger = plugin.getLogger();
    }

    Object execute(String code) {
        try (Context context = Context.newBuilder("js")
                .allowHostAccess(HostAccess.ALL)
                .allowHostClassLookup(className -> true)
                .build()) {
            Value bindings = context.getBindings("js");
            bindings.putMember("Bukkit", Bukkit.class);
            bindings.putMember("server", Bukkit.getServer());
            bindings.putMember("logger", logger);
            bindings.putMember("plugin", plugin);
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
