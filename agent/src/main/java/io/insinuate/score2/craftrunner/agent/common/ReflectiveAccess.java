package io.insinuate.score2.craftrunner.agent.common;

import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

final class ReflectiveAccess {
    private ReflectiveAccess() {
    }

    static Class<?> type(String className) {
        try {
            return switch (className) {
                case "boolean" -> boolean.class;
                case "byte" -> byte.class;
                case "short" -> short.class;
                case "int" -> int.class;
                case "long" -> long.class;
                case "float" -> float.class;
                case "double" -> double.class;
                case "char" -> char.class;
                default -> Class.forName(className);
            };
        } catch (ClassNotFoundException error) {
            throw new IllegalArgumentException("class not found: " + className, error);
        }
    }

    static boolean classExists(String className) {
        try {
            type(className);
            return true;
        } catch (IllegalArgumentException error) {
            return false;
        }
    }

    static Object newInstance(Class<?> type, Object... args) {
        for (Constructor<?> constructor : sortedConstructors(type)) {
            Object[] converted = convertArgs(constructor.getParameterTypes(), args);
            if (converted == null) {
                continue;
            }
            try {
                constructor.setAccessible(true);
                return constructor.newInstance(converted);
            } catch (ReflectiveOperationException | RuntimeException ignored) {
                // Try the next compatible constructor.
            }
        }
        throw new IllegalArgumentException("no matching constructor: " + type.getName() + "/" + args.length);
    }

    static Object callStatic(Class<?> type, String methodName, Object... args) {
        return callMethod(type, null, methodName, args, true);
    }

    static Object call(Object target, String methodName, Object... args) {
        if (target == null) {
            throw new IllegalArgumentException("target is null");
        }
        Class<?> type = target instanceof Class<?> targetClass ? targetClass : target.getClass();
        Object instance = target instanceof Class<?> ? null : target;
        return callMethod(type, instance, methodName, args, instance == null);
    }

    static Object get(Object target, String fieldName) {
        if (target == null) {
            throw new IllegalArgumentException("target is null");
        }
        Class<?> type = target instanceof Class<?> targetClass ? targetClass : target.getClass();
        Object instance = target instanceof Class<?> ? null : target;
        return getFieldValue(type, instance, fieldName);
    }

    static void set(Object target, String fieldName, Object value) {
        if (target == null) {
            throw new IllegalArgumentException("target is null");
        }
        Class<?> type = target instanceof Class<?> targetClass ? targetClass : target.getClass();
        Object instance = target instanceof Class<?> ? null : target;
        setFieldValue(type, instance, fieldName, value);
    }

    static Object getStatic(Class<?> type, String fieldName) {
        return getFieldValue(type, null, fieldName);
    }

    static void setStatic(Class<?> type, String fieldName, Object value) {
        setFieldValue(type, null, fieldName, value);
    }

    static List<String> methodNames(Object targetOrClassName) {
        Class<?> type = resolveTargetClass(targetOrClassName);
        Set<String> names = new LinkedHashSet<>();
        for (Method method : allMethods(type)) {
            names.add(method.getName() + "/" + method.getParameterCount());
        }
        return new ArrayList<>(names);
    }

    static List<String> fieldNames(Object targetOrClassName) {
        Class<?> type = resolveTargetClass(targetOrClassName);
        Set<String> names = new LinkedHashSet<>();
        Class<?> current = type;
        while (current != null) {
            for (Field field : current.getDeclaredFields()) {
                names.add(field.getName());
            }
            current = current.getSuperclass();
        }
        return new ArrayList<>(names);
    }

    static Object coerce(Object value, Class<?> targetType) {
        if (value == null) {
            if (targetType.isPrimitive()) {
                throw new IllegalArgumentException("cannot pass null to primitive " + targetType.getName());
            }
            return null;
        }
        Class<?> boxedTarget = boxed(targetType);
        if (boxedTarget.isInstance(value)) {
            return value;
        }
        if (boxedTarget == String.class) {
            return String.valueOf(value);
        }
        if (Number.class.isAssignableFrom(boxedTarget) && value instanceof Number number) {
            if (boxedTarget == Byte.class) {
                return number.byteValue();
            }
            if (boxedTarget == Short.class) {
                return number.shortValue();
            }
            if (boxedTarget == Integer.class) {
                return number.intValue();
            }
            if (boxedTarget == Long.class) {
                return number.longValue();
            }
            if (boxedTarget == Float.class) {
                return number.floatValue();
            }
            if (boxedTarget == Double.class) {
                return number.doubleValue();
            }
        }
        if (boxedTarget == Character.class && value instanceof String string && string.length() == 1) {
            return string.charAt(0);
        }
        if (boxedTarget.isEnum() && value instanceof String string) {
            @SuppressWarnings({ "unchecked", "rawtypes" })
            Object enumValue = Enum.valueOf((Class<Enum>) boxedTarget.asSubclass(Enum.class), string);
            return enumValue;
        }
        if (boxedTarget.isAssignableFrom(value.getClass())) {
            return value;
        }
        throw new IllegalArgumentException("cannot convert " + value.getClass().getName() + " to " + targetType.getName());
    }

    private static Object callMethod(Class<?> type, Object target, String methodName, Object[] args, boolean requireStatic) {
        for (Method method : allMethods(type)) {
            if (!method.getName().equals(methodName)) {
                continue;
            }
            if (requireStatic && !Modifier.isStatic(method.getModifiers())) {
                continue;
            }
            Object[] converted = convertArgs(method.getParameterTypes(), args);
            if (converted == null) {
                continue;
            }
            try {
                method.setAccessible(true);
                return method.invoke(target, converted);
            } catch (ReflectiveOperationException | RuntimeException ignored) {
                // Try the next compatible overload.
            }
        }
        throw new IllegalArgumentException("no matching method: " + type.getName() + "." + methodName + "/" + args.length);
    }

    private static Object getFieldValue(Class<?> type, Object target, String fieldName) {
        Field field = findField(type, fieldName);
        try {
            field.setAccessible(true);
            return field.get(target);
        } catch (ReflectiveOperationException | RuntimeException error) {
            throw new IllegalArgumentException("cannot read field: " + type.getName() + "." + fieldName, error);
        }
    }

    private static void setFieldValue(Class<?> type, Object target, String fieldName, Object value) {
        Field field = findField(type, fieldName);
        try {
            field.setAccessible(true);
            field.set(target, coerce(value, field.getType()));
        } catch (ReflectiveOperationException | RuntimeException error) {
            throw new IllegalArgumentException("cannot write field: " + type.getName() + "." + fieldName, error);
        }
    }

    private static Field findField(Class<?> type, String fieldName) {
        Class<?> current = type;
        while (current != null) {
            try {
                return current.getDeclaredField(fieldName);
            } catch (NoSuchFieldException ignored) {
                current = current.getSuperclass();
            }
        }
        throw new IllegalArgumentException("field not found: " + type.getName() + "." + fieldName);
    }

    private static Object[] convertArgs(Class<?>[] parameterTypes, Object[] args) {
        if (parameterTypes.length != args.length) {
            return null;
        }
        Object[] converted = new Object[args.length];
        try {
            for (int index = 0; index < args.length; index++) {
                converted[index] = coerce(args[index], parameterTypes[index]);
            }
            return converted;
        } catch (IllegalArgumentException error) {
            return null;
        }
    }

    private static List<Method> allMethods(Class<?> type) {
        List<Method> methods = new ArrayList<>();
        methods.addAll(List.of(type.getMethods()));
        Class<?> current = type;
        while (current != null) {
            methods.addAll(List.of(current.getDeclaredMethods()));
            current = current.getSuperclass();
        }
        methods.sort(Comparator.comparing(Method::getName).thenComparingInt(Method::getParameterCount));
        return methods;
    }

    private static List<Constructor<?>> sortedConstructors(Class<?> type) {
        List<Constructor<?>> constructors = new ArrayList<>(List.of(type.getDeclaredConstructors()));
        constructors.sort(Comparator.comparingInt(Constructor::getParameterCount));
        return constructors;
    }

    private static Class<?> resolveTargetClass(Object targetOrClassName) {
        if (targetOrClassName instanceof String className) {
            return type(className);
        }
        if (targetOrClassName instanceof Class<?> type) {
            return type;
        }
        if (targetOrClassName == null) {
            throw new IllegalArgumentException("target is null");
        }
        return targetOrClassName.getClass();
    }

    private static Class<?> boxed(Class<?> type) {
        if (!type.isPrimitive()) {
            return type;
        }
        if (type == boolean.class) {
            return Boolean.class;
        }
        if (type == byte.class) {
            return Byte.class;
        }
        if (type == short.class) {
            return Short.class;
        }
        if (type == int.class) {
            return Integer.class;
        }
        if (type == long.class) {
            return Long.class;
        }
        if (type == float.class) {
            return Float.class;
        }
        if (type == double.class) {
            return Double.class;
        }
        if (type == char.class) {
            return Character.class;
        }
        if (type == void.class) {
            return Void.class;
        }
        return type;
    }
}
