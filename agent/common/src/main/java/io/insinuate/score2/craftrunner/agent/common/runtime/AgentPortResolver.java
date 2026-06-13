package io.insinuate.score2.craftrunner.agent.common.runtime;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.InetSocketAddress;

final class AgentPortResolver {
    private AgentPortResolver() {
    }

    static int resolve(Object server) {
        if (server == null) {
            return -1;
        }
        Integer direct = firstPositiveInt(
            invoke(server, "getServerPort"),
            invoke(server, "getPort"),
            invoke(server, "getLocalPort")
        );
        if (direct != null) {
            return direct;
        }
        Integer address = portFromAddress(
            invoke(server, "getServerAddress"),
            invoke(server, "getLocalAddress"),
            invoke(server, "getBoundAddress")
        );
        if (address != null) {
            return address;
        }
        return portFromProperties(invoke(server, "getProperties"));
    }

    private static Integer firstPositiveInt(Object... values) {
        for (Object value : values) {
            Integer port = positiveInt(value);
            if (port != null) {
                return port;
            }
        }
        return null;
    }

    private static Integer portFromAddress(Object... values) {
        for (Object value : values) {
            if (value instanceof InetSocketAddress address) {
                Integer port = positiveInt(address.getPort());
                if (port != null) {
                    return port;
                }
            }
        }
        return null;
    }

    private static Integer portFromProperties(Object properties) {
        if (properties == null) {
            return -1;
        }
        Integer direct = firstPositiveInt(
            invoke(properties, "serverPort"),
            invoke(properties, "getServerPort"),
            readField(properties, "serverPort")
        );
        return direct == null ? -1 : direct;
    }

    private static Integer positiveInt(Object value) {
        if (value instanceof Number number) {
            int port = number.intValue();
            if (port > 0 && port <= 65535) {
                return port;
            }
        }
        return null;
    }

    private static Object invoke(Object target, String methodName) {
        if (target == null) {
            return null;
        }
        try {
            Method method = target.getClass().getMethod(methodName);
            return method.invoke(target);
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            return null;
        }
    }

    private static Object readField(Object target, String fieldName) {
        if (target == null) {
            return null;
        }
        try {
            Field field = target.getClass().getField(fieldName);
            return field.get(target);
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            return null;
        }
    }
}
