package io.insinuate.score2.craftrunner.agent.platform.bukkit.api;

import io.insinuate.score2.craftrunner.agent.common.runtime.AgentPlatform;
import io.insinuate.score2.craftrunner.agent.common.api.PlatformDebugApi;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.World;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.Plugin;

public final class BukkitDebugApi extends PlatformDebugApi {
    private final Plugin plugin;

    public BukkitDebugApi(Plugin plugin) {
        super((AgentPlatform) plugin);
        this.plugin = plugin;
    }

    @Override
    public Map<String, Object> api() {
        Map<String, Object> api = new LinkedHashMap<>(super.api());
        api.put("capabilities", capabilities());
        api.put("methods", List.of(
            "name()", "server()", "plugin()", "bukkit()",
            "isFolia()", "onlinePlayers()", "onlinePlayerNames()", "player(name)",
            "worlds()", "worldNames()", "world(name)", "plugins()", "plugin(name)",
            "console()", "dispatchCommand(command)", "material(name)",
            "namespacedKey(namespace, key)", "pluginKey(key)", "itemStack(materialName, amount)"
        ));
        return api;
    }

    @Override
    public List<String> capabilities() {
        return List.of(
            "platform-info",
            "raw-server-object",
            "raw-plugin-object",
            "bukkit-api",
            "players",
            "worlds",
            "plugins",
            "commands",
            "materials",
            "items",
            isFolia() ? "folia-global-scheduler" : "bukkit-sync-scheduler"
        );
    }

    public Class<?> bukkit() {
        return Bukkit.class;
    }

    public boolean isFolia() {
        try {
            Class.forName("io.papermc.paper.threadedregions.RegionizedServer");
            Bukkit.class.getMethod("getGlobalRegionScheduler");
            return true;
        } catch (ReflectiveOperationException | LinkageError error) {
            return false;
        }
    }

    public Collection<? extends Player> onlinePlayers() {
        return Bukkit.getOnlinePlayers();
    }

    public List<String> onlinePlayerNames() {
        List<String> names = new ArrayList<>();
        for (Player player : Bukkit.getOnlinePlayers()) {
            names.add(player.getName());
        }
        return names;
    }

    public Player player(String name) {
        return Bukkit.getPlayerExact(name);
    }

    public List<World> worlds() {
        return Bukkit.getWorlds();
    }

    public List<String> worldNames() {
        List<String> names = new ArrayList<>();
        for (World world : Bukkit.getWorlds()) {
            names.add(world.getName());
        }
        return names;
    }

    public World world(String name) {
        return Bukkit.getWorld(name);
    }

    public Plugin[] plugins() {
        return Bukkit.getPluginManager().getPlugins();
    }

    public Plugin plugin(String name) {
        return Bukkit.getPluginManager().getPlugin(name);
    }

    public CommandSender console() {
        return Bukkit.getConsoleSender();
    }

    public boolean dispatchCommand(String command) {
        return Bukkit.dispatchCommand(Bukkit.getConsoleSender(), command);
    }

    public Material material(String name) {
        Material material = Material.matchMaterial(name);
        if (material == null) {
            throw new IllegalArgumentException("unknown Bukkit material: " + name);
        }
        return material;
    }

    public NamespacedKey namespacedKey(String namespace, String key) {
        return new NamespacedKey(namespace, key);
    }

    public NamespacedKey pluginKey(String key) {
        return new NamespacedKey(plugin, key);
    }

    public ItemStack itemStack(String materialName, int amount) {
        return new ItemStack(material(materialName), amount);
    }

    public Object globalScheduler() {
        try {
            Method schedulerMethod = Bukkit.class.getMethod("getGlobalRegionScheduler");
            return schedulerMethod.invoke(null);
        } catch (ReflectiveOperationException | LinkageError error) {
            return null;
        }
    }
}
