package io.insinuate.score2.craftrunner.agent.common;

public final class DebugRequest {
    public String id = "";
    public String token = "";
    public String language = "js";
    public String thread = "main";
    public long timeoutMs = 3000L;
    public String code = "";
    public String action = "";
    public String path = "";
    public String pluginName = "";
    public boolean enable = true;
}
