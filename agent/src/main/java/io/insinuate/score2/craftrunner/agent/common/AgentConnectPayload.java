package io.insinuate.score2.craftrunner.agent.common;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class AgentConnectPayload {
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();

    private AgentConnectPayload() {
    }

    public static String encode(AgentPlatform platform, AgentEndpointInfo endpoint) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("schema", "craft-runner-agent-connect");
        payload.put("version", 1);
        payload.put("platform", platform.platformName());
        payload.put("serverPort", platform.serverPort());
        payload.put("hosts", localHosts());
        payload.put("endpointName", endpoint.endpointName());
        payload.put("endpoint", endpoint.endpoint().toString());
        payload.put("token", endpoint.token());
        payload.put("protocol", "file-mailbox");
        String json = GSON.toJson(payload);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(json.getBytes(StandardCharsets.UTF_8));
    }

    private static List<String> localHosts() {
        List<String> hosts = new ArrayList<>();
        hosts.add("127.0.0.1");
        try {
            String hostAddress = InetAddress.getLocalHost().getHostAddress();
            if (hostAddress != null && !hostAddress.isBlank() && !hosts.contains(hostAddress)) {
                hosts.add(hostAddress);
            }
        } catch (Exception ignored) {
        }
        try {
            var interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces.hasMoreElements()) {
                NetworkInterface network = interfaces.nextElement();
                if (!network.isUp() || network.isLoopback()) {
                    continue;
                }
                var addresses = network.getInetAddresses();
                while (addresses.hasMoreElements()) {
                    InetAddress address = addresses.nextElement();
                    if (address.isLoopbackAddress() || address.isLinkLocalAddress()) {
                        continue;
                    }
                    String value = address.getHostAddress();
                    if (value != null && !value.contains(":") && !hosts.contains(value)) {
                        hosts.add(value);
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return hosts;
    }
}
