package io.insinuate.score2.craftrunner.agent.common.command;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import io.insinuate.score2.craftrunner.agent.common.hot.HotPluginOperations;
import io.insinuate.score2.craftrunner.agent.common.runtime.AgentPlatform;
import io.insinuate.score2.craftrunner.agent.common.runtime.AgentRuntime;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import lombok.Getter;
import lombok.experimental.Accessors;

@Getter
@Accessors(fluent = true)
public final class AgentCommandContext {
    static final String PREFIX = "§8[§6CR§e§lA§8] ";
    static final String GRAY = "§7";
    static final String YELLOW = "§e";
    static final String GREEN = "§a";
    static final String RED = "§c";

    private final AgentPlatform platform;
    private final AgentRuntime runtime;
    private final HotPluginOperations hotPlugins;
    private final Gson gson = new GsonBuilder().disableHtmlEscaping().setPrettyPrinting().create();

    public AgentCommandContext(AgentPlatform platform, AgentRuntime runtime) {
        this.platform = platform;
        this.runtime = runtime;
        this.hotPlugins = platform.hotPluginOperations();
    }

    public void send(AgentCommandSender sender, String message) {
        sender.sendMessage(PREFIX + GRAY + message);
    }

    public void sendError(AgentCommandSender sender, String message) {
        sender.sendMessage(PREFIX + RED + message);
    }

    public void sendJson(AgentCommandSender sender, Map<String, Object> result) {
        for (String line : gson.toJson(result).split("\n")) {
            send(sender, line);
        }
    }

    public String colorBoolean(boolean value) {
        return (value ? GREEN : RED) + value;
    }

    public Path resolvePluginPath(String value) {
        Path direct = Path.of(value).toAbsolutePath().normalize();
        if (Files.isRegularFile(direct)) {
            return direct;
        }
        List<PluginJarCandidate> matches = pluginJarCandidates().stream()
            .filter(candidate -> candidate.matches(value))
            .toList();
        if (matches.size() == 1) {
            return matches.getFirst().path();
        }
        if (matches.size() > 1) {
            throw new IllegalArgumentException("plugin jar match is ambiguous: " + value);
        }
        return direct;
    }

    public List<String> loadedPluginNames() {
        try {
            Object plugins = hotPlugins.list().get("plugins");
            if (!(plugins instanceof Iterable<?> iterable)) {
                return List.of();
            }
            Set<String> names = new LinkedHashSet<>();
            for (Object item : iterable) {
                if (item instanceof Map<?, ?> map) {
                    addString(names, map.get("name"));
                    addString(names, map.get("id"));
                }
            }
            return new ArrayList<>(names);
        } catch (Throwable ignored) {
            return List.of();
        }
    }

    public List<String> loadSuggestions() {
        Set<String> values = new LinkedHashSet<>();
        for (PluginJarCandidate candidate : pluginJarCandidates()) {
            values.add(candidate.primaryName());
            values.add(candidate.path().getFileName().toString());
            Path relative = Path.of("").toAbsolutePath().normalize().relativize(candidate.path());
            if (!relative.toString().startsWith("..")) {
                values.add(relative.toString());
            }
        }
        return new ArrayList<>(values);
    }

    public List<String> prefix(String prefix, List<String> values) {
        List<String> result = new ArrayList<>();
        String normalized = prefix.toLowerCase(Locale.ROOT);
        for (String value : values) {
            if (value.toLowerCase(Locale.ROOT).startsWith(normalized)) {
                result.add(value);
            }
        }
        return result;
    }

    public boolean contains(String[] args, String value) {
        for (String arg : args) {
            if (value.equalsIgnoreCase(arg)) {
                return true;
            }
        }
        return false;
    }

    private List<PluginJarCandidate> pluginJarCandidates() {
        Map<Path, PluginJarCandidate> candidates = new LinkedHashMap<>();
        for (Path directory : List.of(Path.of("").toAbsolutePath().normalize(), Path.of("").toAbsolutePath().resolve("plugins").normalize())) {
            if (!Files.isDirectory(directory)) {
                continue;
            }
            try (var stream = Files.list(directory)) {
                for (Path path : stream.filter(file -> file.getFileName().toString().endsWith(".jar")).toList()) {
                    readPluginJar(path.toAbsolutePath().normalize()).ifPresent(candidate -> candidates.put(candidate.path(), candidate));
                }
            } catch (IOException ignored) {
                // Best-effort command completion.
            }
        }
        return new ArrayList<>(candidates.values());
    }

    private Optional<PluginJarCandidate> readPluginJar(Path path) {
        try (JarFile jar = new JarFile(path.toFile())) {
            Optional<PluginJarCandidate> yaml = firstPresent(
                readYamlPluginJar(jar, path, "paper-plugin.yml"),
                readYamlPluginJar(jar, path, "plugin.yml"),
                readYamlPluginJar(jar, path, "bungee.yml")
            );
            if (yaml.isPresent()) {
                return yaml;
            }
            JarEntry velocity = jar.getJarEntry("velocity-plugin.json");
            if (velocity != null) {
                try (InputStream input = jar.getInputStream(velocity)) {
                    JsonObject json = JsonParser.parseString(new String(input.readAllBytes(), StandardCharsets.UTF_8)).getAsJsonObject();
                    String id = json.has("id") ? json.get("id").getAsString() : "";
                    String name = json.has("name") ? json.get("name").getAsString() : id;
                    return Optional.of(new PluginJarCandidate(path, id, name));
                }
            }
        } catch (Exception ignored) {
            // Best-effort command completion.
        }
        return Optional.empty();
    }

    @SafeVarargs
    private Optional<PluginJarCandidate> firstPresent(Optional<PluginJarCandidate>... candidates) {
        for (Optional<PluginJarCandidate> candidate : candidates) {
            if (candidate.isPresent()) {
                return candidate;
            }
        }
        return Optional.empty();
    }

    private Optional<PluginJarCandidate> readYamlPluginJar(JarFile jar, Path path, String entryName) throws IOException {
        JarEntry entry = jar.getJarEntry(entryName);
        if (entry == null) {
            return Optional.empty();
        }
        try (InputStream input = jar.getInputStream(entry)) {
            Map<String, String> values = readTopLevelYaml(new String(input.readAllBytes(), StandardCharsets.UTF_8));
            String name = values.getOrDefault("name", "");
            String id = values.getOrDefault("id", name);
            if (name.isBlank() && id.isBlank()) {
                return Optional.empty();
            }
            return Optional.of(new PluginJarCandidate(path, id, name.isBlank() ? id : name));
        }
    }

    private Map<String, String> readTopLevelYaml(String content) {
        Map<String, String> result = new LinkedHashMap<>();
        for (String line : content.split("\\R")) {
            String trimmed = line.trim();
            if (trimmed.isEmpty() || trimmed.startsWith("#") || !trimmed.contains(":")) {
                continue;
            }
            int index = trimmed.indexOf(':');
            String key = trimmed.substring(0, index).trim().toLowerCase(Locale.ROOT);
            String value = trimmed.substring(index + 1).trim();
            if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.substring(1, value.length() - 1);
            }
            result.put(key, value);
        }
        return result;
    }

    private void addString(Set<String> values, Object value) {
        if (value instanceof String string && !string.isBlank()) {
            values.add(string);
        }
    }

    private record PluginJarCandidate(Path path, String id, String name) {
        String primaryName() {
            return !name.isBlank() ? name : id;
        }

        boolean matches(String value) {
            String normalized = value.toLowerCase(Locale.ROOT);
            return path.toString().equals(value)
                || path.getFileName().toString().equalsIgnoreCase(value)
                || id.equalsIgnoreCase(value)
                || name.equalsIgnoreCase(value)
                || stripJar(path.getFileName().toString()).equals(normalized);
        }

        private String stripJar(String filename) {
            String lower = filename.toLowerCase(Locale.ROOT);
            return lower.endsWith(".jar") ? lower.substring(0, lower.length() - 4) : lower;
        }
    }
}
