package io.insinuate.score2.craftrunner.agent.common.reflect;

import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;

public final class HotReflection {
    private HotReflection() {
    }

    public static Field field(Class<?> type, String name) {
        Class<?> current = type;
        while (current != null) {
            try {
                Field field = current.getDeclaredField(name);
                field.setAccessible(true);
                return field;
            } catch (NoSuchFieldException ignored) {
                current = current.getSuperclass();
            }
        }
        throw new IllegalArgumentException("field not found: " + type.getName() + "." + name);
    }

    public static Object fieldValue(Object target, String name) {
        try {
            return field(target.getClass(), name).get(target);
        } catch (ReflectiveOperationException error) {
            throw new IllegalArgumentException("cannot read field: " + target.getClass().getName() + "." + name, error);
        }
    }

    public static void setFieldValue(Object target, String name, Object value) {
        try {
            field(target.getClass(), name).set(target, value);
        } catch (ReflectiveOperationException error) {
            throw new IllegalArgumentException("cannot write field: " + target.getClass().getName() + "." + name, error);
        }
    }

    public static Method method(Class<?> type, String name, Class<?>... parameterTypes) {
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
        throw new IllegalArgumentException("method not found: " + type.getName() + "." + name);
    }

    public static Object call(Object target, String name, Class<?>[] parameterTypes, Object... args) {
        try {
            return method(target.getClass(), name, parameterTypes).invoke(target, args);
        } catch (ReflectiveOperationException error) {
            throw new IllegalArgumentException("cannot call method: " + target.getClass().getName() + "." + name, error);
        }
    }

    public static Object construct(String className, Class<?>[] parameterTypes, Object... args) {
        try {
            Class<?> type = Class.forName(className);
            Constructor<?> constructor = type.getDeclaredConstructor(parameterTypes);
            constructor.setAccessible(true);
            return constructor.newInstance(args);
        } catch (ReflectiveOperationException error) {
            throw new IllegalArgumentException("cannot construct: " + className, error);
        }
    }
}
