package io.insinuate.score2.craftrunner.agent.common.js;

import java.io.InputStream;
import java.net.URI;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.logging.Logger;

final class GraalJsLibraries {
    private static final String VERSION = "25.0.3";
    private static final String REPOSITORY = "https://repo1.maven.org/maven2/";
    private static final List<MavenJar> JARS = List.of(
        jar("org.graalvm.polyglot", "polyglot"),
        jar("org.graalvm.js", "js-language"),
        jar("org.graalvm.regex", "regex"),
        jar("org.graalvm.truffle", "truffle-api"),
        jar("org.graalvm.truffle", "truffle-runtime"),
        jar("org.graalvm.truffle", "truffle-compiler"),
        jar("org.graalvm.sdk", "jniutils"),
        jar("org.graalvm.sdk", "collections"),
        jar("org.graalvm.sdk", "nativeimage"),
        jar("org.graalvm.sdk", "word"),
        jar("org.graalvm.shadowed", "icu4j"),
        jar("org.graalvm.shadowed", "xz")
    );

    private final Logger logger;
    private volatile ClassLoader classLoader;
    private volatile boolean loading;
    private volatile String lastError;

    GraalJsLibraries(Logger logger) {
        this.logger = logger;
    }

    ClassLoader classLoader() {
        ClassLoader existing = classLoader;
        if (existing != null) {
            return existing;
        }
        synchronized (this) {
            if (classLoader == null) {
                loading = true;
                lastError = null;
                try {
                    classLoader = createClassLoader();
                } catch (RuntimeException error) {
                    lastError = error.getMessage();
                    throw error;
                } finally {
                    loading = false;
                }
            }
            return classLoader;
        }
    }

    void prepare() {
        classLoader();
    }

    boolean ready() {
        return classLoader != null;
    }

    Map<String, Object> status() {
        String state;
        if (classLoader != null) {
            state = "ready";
        } else if (loading) {
            state = "loading";
        } else if (lastError != null) {
            state = "failed";
        } else {
            state = "not-loaded";
        }
        return Map.of(
            "state", state,
            "ready", classLoader != null,
            "loading", loading,
            "version", VERSION,
            "error", lastError == null ? "" : lastError
        );
    }

    private ClassLoader createClassLoader() {
        try {
            Path root = Path.of(System.getProperty("user.home"), ".craft-runner", "cache", "agent-libraries")
                .resolve("libraries")
                .resolve("graaljs-" + VERSION);
            Files.createDirectories(root);
            List<URL> urls = new ArrayList<>();
            for (MavenJar jar : JARS) {
                Path file = root.resolve(jar.filename());
                if (!Files.isRegularFile(file) || Files.size(file) == 0L) {
                    download(jar, file);
                }
                urls.add(file.toUri().toURL());
            }
            return new URLClassLoader(urls.toArray(URL[]::new), GraalJsLibraries.class.getClassLoader());
        } catch (Exception error) {
            throw new IllegalStateException("Failed to prepare GraalJS libraries", error);
        }
    }

    private void download(MavenJar jar, Path file) throws Exception {
        Files.createDirectories(file.getParent());
        Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
        URI uri = URI.create(REPOSITORY + jar.path());
        logger.info("Downloading Craft Runner agent library: " + jar.coordinate());
        try (InputStream input = uri.toURL().openStream()) {
            Files.copy(input, tmp, StandardCopyOption.REPLACE_EXISTING);
        }
        Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    private static MavenJar jar(String group, String artifact) {
        return new MavenJar(group, artifact, VERSION);
    }

    private record MavenJar(String group, String artifact, String version) {
        String filename() {
            return artifact + "-" + version + ".jar";
        }

        String path() {
            return group.replace('.', '/') + "/" + artifact + "/" + version + "/" + filename();
        }

        String coordinate() {
            return group + ":" + artifact + ":" + version;
        }
    }
}
