package io.github.score2.craftrunner.agent;

final class AgentConfig {
    String token = "";
    long pollIntervalMs = 250L;

    boolean isValid() {
        return token != null && !token.isBlank();
    }
}
