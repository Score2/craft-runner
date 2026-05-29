pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
        maven("https://libraries.minecraft.net/")
        maven("https://repo.papermc.io/repository/maven-public/")
        maven("https://maven.fabricmc.net/")
        maven("https://maven.minecraftforge.net/")
        maven("https://maven.neoforged.net/releases/")
    }
}

rootProject.name = "craft-runner-agent"

include(
    "common",
    "bukkit",
    "bungee",
    "velocity",
    "fabric",
    "forge-legacy",
    "forge-modern",
    "neoforge-legacy",
    "neoforge-modern"
)
