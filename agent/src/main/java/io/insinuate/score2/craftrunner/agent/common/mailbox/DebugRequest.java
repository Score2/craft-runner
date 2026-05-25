package io.insinuate.score2.craftrunner.agent.common.mailbox;

import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

@Getter
@Setter
@Accessors(fluent = true)
public final class DebugRequest {
    private String id = "";
    private String token = "";
    private String language = "js";
    private String thread = "main";
    private long timeoutMs = 3000L;
    private String code = "";
    private String action = "";
    private String path = "";
    private String pluginName = "";
    private boolean enable = true;
}
