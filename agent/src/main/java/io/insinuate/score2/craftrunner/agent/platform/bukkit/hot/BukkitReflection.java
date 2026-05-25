package io.insinuate.score2.craftrunner.agent.platform.bukkit.hot;

import java.lang.reflect.Field;

final class BukkitReflection {
    private BukkitReflection() {
    }

    static boolean classExists(String name) {
        try {
            Class.forName(name, false, BukkitReflection.class.getClassLoader());
            return true;
        } catch (ClassNotFoundException | LinkageError error) {
            return false;
        }
    }

    static Object fieldValue(Object target, String name) {
        return target == null ? null : fieldValue(target.getClass(), target, name);
    }

    static Object fieldValue(Class<?> type, Object target, String name) {
        try {
            Field field = findField(type, name);
            return field.get(target);
        } catch (ReflectiveOperationException | LinkageError error) {
            return null;
        }
    }

    static void setFieldValue(Object target, String name, Object value) {
        try {
            Field field = findField(target.getClass(), name);
            field.set(target, value);
        } catch (ReflectiveOperationException | LinkageError error) {
            throw new IllegalStateException("Failed to set field " + name + " on " + target.getClass().getName(), error);
        }
    }

    static Field findField(Class<?> type, String name) throws NoSuchFieldException {
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
        throw new NoSuchFieldException(name);
    }
}
