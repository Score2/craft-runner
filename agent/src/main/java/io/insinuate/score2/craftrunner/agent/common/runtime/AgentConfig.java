package io.insinuate.score2.craftrunner.agent.common.runtime;

public final class AgentConfig {
    String token = "";
    long pollIntervalMs = 250L;
    String endpointName = "";

    public boolean isValid() {
        return token != null && !token.isBlank();
    }

    public long pollIntervalMs() {
        return pollIntervalMs;
    }

    public String token() {
        return token;
    }

    public String endpointName() {
        return endpointName;
    }

    public static AgentConfig generated(String endpointName, String token) {
        AgentConfig config = new AgentConfig();
        config.endpointName = endpointName;
        config.token = token;
        config.pollIntervalMs = 250L;
        return config;
    }
}
