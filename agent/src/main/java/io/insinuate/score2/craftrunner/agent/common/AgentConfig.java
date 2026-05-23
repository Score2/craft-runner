package io.insinuate.score2.craftrunner.agent.common;

public final class AgentConfig {
    String token = "";
    long pollIntervalMs = 250L;

    public boolean isValid() {
        return token != null && !token.isBlank();
    }

    public long pollIntervalMs() {
        return pollIntervalMs;
    }
}
