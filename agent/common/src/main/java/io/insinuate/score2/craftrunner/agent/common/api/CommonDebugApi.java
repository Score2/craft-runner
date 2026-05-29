package io.insinuate.score2.craftrunner.agent.common.api;

import io.insinuate.score2.craftrunner.agent.common.reflect.ReflectiveAccess;
import io.insinuate.score2.craftrunner.agent.common.runtime.AgentPlatform;
import java.lang.reflect.Array;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.logging.Logger;

public final class CommonDebugApi {
    private final AgentPlatform platform;

    CommonDebugApi(AgentPlatform platform) {
        this.platform = platform;
    }

    public Map<String, Object> api() {
        Map<String, Object> api = new LinkedHashMap<>();
        api.put("scope", "common");
        api.put("platform", platform.platformName());
        api.put("methods", List.of(
            "platformName()", "server()", "plugin()", "logger()",
            "type(className)", "classExists(className)", "newInstance(className, ...args)",
            "call(target, methodName, ...args)", "callStatic(className, methodName, ...args)",
            "get(target, fieldName)", "set(target, fieldName, value)",
            "getStatic(className, fieldName)", "setStatic(className, fieldName, value)",
            "enumValue(className, name)", "list(...items)", "setOf(...items)",
            "mapOf(key, value, ...)", "array(componentClassName, ...items)",
            "className(value)", "inspect(value)", "methods(valueOrClassName)", "fields(valueOrClassName)"
        ));
        return api;
    }

    public String platformName() {
        return platform.platformName();
    }

    public Object server() {
        return platform.serverObject();
    }

    public Object plugin() {
        return platform.pluginObject();
    }

    public Logger logger() {
        return platform.logger();
    }

    public Class<?> type(String className) {
        return ReflectiveAccess.type(className);
    }

    public boolean classExists(String className) {
        return ReflectiveAccess.classExists(className);
    }

    public Object newInstance(String className, Object... args) {
        return ReflectiveAccess.newInstance(type(className), args);
    }

    public Object call(Object target, String methodName, Object... args) {
        return ReflectiveAccess.call(target, methodName, args);
    }

    public Object callStatic(String className, String methodName, Object... args) {
        return ReflectiveAccess.callStatic(type(className), methodName, args);
    }

    public Object get(Object target, String fieldName) {
        return ReflectiveAccess.get(target, fieldName);
    }

    public void set(Object target, String fieldName, Object value) {
        ReflectiveAccess.set(target, fieldName, value);
    }

    public Object getStatic(String className, String fieldName) {
        return ReflectiveAccess.getStatic(type(className), fieldName);
    }

    public void setStatic(String className, String fieldName, Object value) {
        ReflectiveAccess.setStatic(type(className), fieldName, value);
    }

    @SuppressWarnings({ "rawtypes", "unchecked" })
    public Object enumValue(String className, String name) {
        Class<?> type = type(className);
        if (!type.isEnum()) {
            throw new IllegalArgumentException(className + " is not an enum");
        }
        return Enum.valueOf((Class<Enum>) type.asSubclass(Enum.class), name);
    }

    public List<Object> list(Object... items) {
        return new ArrayList<>(Arrays.asList(items));
    }

    public Set<Object> setOf(Object... items) {
        return new LinkedHashSet<>(Arrays.asList(items));
    }

    public Map<String, Object> mapOf(Object... entries) {
        if (entries.length % 2 != 0) {
            throw new IllegalArgumentException("mapOf requires key/value pairs");
        }
        Map<String, Object> result = new LinkedHashMap<>();
        for (int index = 0; index < entries.length; index += 2) {
            result.put(String.valueOf(entries[index]), entries[index + 1]);
        }
        return result;
    }

    public Object array(String componentClassName, Object... items) {
        Class<?> componentType = type(componentClassName);
        Object array = Array.newInstance(componentType, items.length);
        for (int index = 0; index < items.length; index++) {
            Array.set(array, index, ReflectiveAccess.coerce(items[index], componentType));
        }
        return array;
    }

    public String className(Object value) {
        if (value == null) {
            return "null";
        }
        if (value instanceof Class<?> type) {
            return type.getName();
        }
        return value.getClass().getName();
    }

    public String inspect(Object value) {
        if (value == null) {
            return "null";
        }
        return className(value) + ": " + value;
    }

    public List<String> methods(Object targetOrClassName) {
        return ReflectiveAccess.methodNames(targetOrClassName);
    }

    public List<String> fields(Object targetOrClassName) {
        return ReflectiveAccess.fieldNames(targetOrClassName);
    }
}
