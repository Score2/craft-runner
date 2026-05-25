package io.insinuate.score2.craftrunner.agent.common.runtime;

import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.experimental.Accessors;

@Getter
@Setter(AccessLevel.PACKAGE)
@Accessors(fluent = true)
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
public final class AgentConfig {
    private String token = "";
    private long pollIntervalMs = 250L;
    private String endpointName = "";

    public boolean isValid() {
        return token != null && !token.isBlank();
    }

    public static AgentConfig generated(String endpointName, String token) {
        return new AgentConfig(token, 250L, endpointName);
    }
}
