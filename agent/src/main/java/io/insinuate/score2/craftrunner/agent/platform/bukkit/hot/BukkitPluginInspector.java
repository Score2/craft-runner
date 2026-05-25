package io.insinuate.score2.craftrunner.agent.platform.bukkit.hot;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.PluginDescriptionFile;

final class BukkitPluginInspector {
    BukkitPluginDescriptor inspectJar(Path path) {
        if (Files.notExists(path)) {
            throw new IllegalArgumentException("Plugin jar does not exist: " + path);
        }
        if (!Files.isRegularFile(path)) {
            throw new IllegalArgumentException("Plugin path is not a file: " + path);
        }
        if (!path.getFileName().toString().endsWith(".jar")) {
            throw new IllegalArgumentException("Plugin path is not a jar: " + path);
        }
        try (JarFile jar = new JarFile(path.toFile())) {
            JarEntry pluginYml = jar.getJarEntry("plugin.yml");
            String pluginName = null;
            if (pluginYml != null) {
                try (InputStream input = jar.getInputStream(pluginYml)) {
                    pluginName = new PluginDescriptionFile(input).getName();
                } catch (Exception error) {
                    throw new IllegalArgumentException("Failed to read plugin.yml from plugin jar: " + path, error);
                }
            }
            return new BukkitPluginDescriptor(pluginYml != null, jar.getJarEntry("paper-plugin.yml") != null, pluginName);
        } catch (IOException error) {
            throw new IllegalArgumentException("Failed to read plugin jar: " + path, error);
        }
    }

    Map<String, Object> pluginInfo(Plugin plugin) {
        return Map.of(
            "name", plugin.getDescription().getName(),
            "version", plugin.getDescription().getVersion(),
            "enabled", plugin.isEnabled(),
            "main", plugin.getDescription().getMain(),
            "class", plugin.getClass().getName(),
            "classLoader", plugin.getClass().getClassLoader().getClass().getName()
        );
    }

    boolean isPaperFamily() {
        return BukkitReflection.classExists("io.papermc.paper.plugin.manager.PaperPluginManagerImpl")
            || BukkitReflection.classExists("com.destroystokyo.paper.PaperConfig")
            || isFolia();
    }

    boolean isFolia() {
        return BukkitReflection.classExists("io.papermc.paper.threadedregions.RegionizedServer");
    }

    String platformName() {
        if (isFolia()) {
            return "folia";
        }
        if (isPaperFamily()) {
            return "paper-family";
        }
        return "bukkit-family";
    }
}
