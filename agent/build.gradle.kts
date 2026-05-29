import org.gradle.jvm.toolchain.JavaLanguageVersion
import groovy.json.JsonSlurper

plugins {
    base
}

val packageJson = JsonSlurper().parse(rootProject.layout.projectDirectory.file("../package.json").asFile) as Map<*, *>

group = "io.insinuate.score2.craftrunner"
version = packageJson["version"].toString()

val agentVersion = version.toString()

subprojects {
    group = rootProject.group
    version = rootProject.version

    plugins.apply("java")

    extensions.configure<JavaPluginExtension>("java") {
        toolchain {
            languageVersion.set(JavaLanguageVersion.of(21))
        }
    }

    tasks.withType<JavaCompile>().configureEach {
        options.encoding = "UTF-8"
    }

    tasks.withType<ProcessResources>().configureEach {
        val resolvedVersion = rootProject.version.toString()
        inputs.property("agentVersion", resolvedVersion)
        filesMatching(listOf(
            "plugin.yml",
            "bungee.yml",
            "velocity-plugin.json",
            "fabric.mod.json",
            "META-INF/mods.toml",
            "META-INF/neoforge.mods.toml"
        )) {
            expand("version" to resolvedVersion)
        }
    }
}

fun Project.release(level: Int) {
    tasks.withType<JavaCompile>().configureEach {
        options.release.set(level)
    }
}

fun Project.sharedSource(name: String) {
    extensions.configure<SourceSetContainer>("sourceSets") {
        named("main") {
            java.srcDir(rootProject.layout.projectDirectory.dir("platform-$name/src/main/java"))
        }
    }
}

fun Project.platformResources(name: String) {
    extensions.configure<SourceSetContainer>("sourceSets") {
        named("main") {
            resources.srcDir(rootProject.layout.projectDirectory.dir("platform-$name/src/main/resources"))
        }
    }
}

fun Project.fatAgentJar(classifier: String) {
    tasks.named<Jar>("jar") {
        archiveBaseName.set("craft-runner-agent-$classifier")
        archiveClassifier.set("")
        duplicatesStrategy = DuplicatesStrategy.EXCLUDE
        from({
            configurations.getByName("runtimeClasspath")
                .filter { it.exists() }
                .filter { it.isDirectory || it.extension == "jar" }
                .map { if (it.isDirectory) it else zipTree(it) }
        })
        manifest {
            attributes["Implementation-Title"] = "Craft Runner Agent"
            attributes["Implementation-Version"] = project.version
        }
    }
}

project(":common") {
    release(17)

    val generatedBuildInfoDir = layout.buildDirectory.dir("generated/sources/build-info/java")
    val generateBuildInfo by tasks.registering {
        val resolvedVersion = rootProject.version.toString()
        inputs.property("agentVersion", resolvedVersion)
        outputs.dir(generatedBuildInfoDir)
        doLast {
            val file = generatedBuildInfoDir.get()
                .file("io/insinuate/score2/craftrunner/agent/common/runtime/AgentBuildInfo.java")
                .asFile
            file.parentFile.mkdirs()
            file.writeText("""
                package io.insinuate.score2.craftrunner.agent.common.runtime;

                public final class AgentBuildInfo {
                    public static final String VERSION = "$resolvedVersion";

                    private AgentBuildInfo() {
                    }
                }
            """.trimIndent() + "\n")
        }
    }

    extensions.configure<SourceSetContainer>("sourceSets") {
        named("main") {
            java.srcDir(generatedBuildInfoDir)
        }
    }

    tasks.named("compileJava") {
        dependsOn(generateBuildInfo)
    }

    dependencies {
        "compileOnly"("com.mojang:brigadier:1.0.18")
        "compileOnly"("org.incendo:cloud-core:2.0.0")
        "compileOnly"("org.graalvm.polyglot:polyglot:25.0.3")
        "compileOnly"("org.graalvm.polyglot:js:25.0.3")
        "compileOnly"("org.projectlombok:lombok:1.18.42")
        "annotationProcessor"("org.projectlombok:lombok:1.18.42")
        "compileOnly"("com.google.code.gson:gson:2.13.2")
    }
}

fun Project.commonAgentDependencies() {
    dependencies {
        "implementation"(project(":common"))
        "compileOnly"("org.projectlombok:lombok:1.18.42")
        "annotationProcessor"("org.projectlombok:lombok:1.18.42")
    }
}

project(":bukkit") {
    release(17)
    sharedSource("bukkit")
    platformResources("bukkit")
    commonAgentDependencies()
    dependencies {
        "compileOnly"("io.papermc.paper:paper-api:1.20.4-R0.1-SNAPSHOT")
        "implementation"("org.incendo:cloud-paper:2.0.0-beta.15")
    }
    fatAgentJar("bukkit")
}

project(":bungee") {
    release(17)
    sharedSource("bungee")
    platformResources("bungee")
    commonAgentDependencies()
    dependencies {
        "compileOnly"("net.md-5:bungeecord-api:1.21-R0.3")
        "implementation"("org.incendo:cloud-bungee:2.0.0-beta.15")
    }
    fatAgentJar("bungee")
}

project(":velocity") {
    release(17)
    sharedSource("velocity")
    platformResources("velocity")
    commonAgentDependencies()
    dependencies {
        "compileOnly"("com.velocitypowered:velocity-api:3.4.0")
        "implementation"("org.incendo:cloud-velocity:2.0.0-beta.15")
    }
    fatAgentJar("velocity")
}

project(":fabric") {
    release(17)
    sharedSource("fabric")
    platformResources("fabric")
    commonAgentDependencies()
    dependencies {
        "compileOnly"("net.fabricmc:fabric-loader:0.19.2")
    }
    fatAgentJar("fabric")
}

project(":forge-legacy") {
    release(17)
    sharedSource("forge")
    platformResources("forge-legacy")
    commonAgentDependencies()
    dependencies {
        "compileOnly"("net.minecraftforge:forge:1.20.1-47.4.20:universal") { isTransitive = false }
        "compileOnly"("net.minecraftforge:fmlloader:1.20.1-47.4.20") { isTransitive = false }
        "compileOnly"("net.minecraftforge:javafmllanguage:1.20.1-47.4.20") { isTransitive = false }
        "compileOnly"("net.minecraftforge:eventbus:6.2.33") { isTransitive = false }
    }
    fatAgentJar("forge-legacy")
}

project(":forge-modern") {
    release(21)
    sharedSource("forge")
    platformResources("forge-modern")
    commonAgentDependencies()
    dependencies {
        "compileOnly"("net.minecraftforge:forge:1.21.4-54.1.16:universal") { isTransitive = false }
        "compileOnly"("net.minecraftforge:fmlloader:1.21.4-54.1.16") { isTransitive = false }
        "compileOnly"("net.minecraftforge:javafmllanguage:1.21.4-54.1.16") { isTransitive = false }
        "compileOnly"("net.minecraftforge:eventbus:6.2.33") { isTransitive = false }
    }
    fatAgentJar("forge-modern")
}

project(":neoforge-legacy") {
    release(17)
    sharedSource("neoforge")
    platformResources("neoforge-legacy")
    commonAgentDependencies()
    dependencies {
        "compileOnly"("net.neoforged:neoforge:20.4.251:universal") { isTransitive = false }
        "compileOnly"("net.neoforged.fancymodloader:loader:2.0.21-1.20.4") { isTransitive = false }
        "compileOnly"("net.neoforged:bus:7.2.0") { isTransitive = false }
    }
    fatAgentJar("neoforge-legacy")
}

project(":neoforge-modern") {
    release(21)
    sharedSource("neoforge")
    platformResources("neoforge-modern")
    commonAgentDependencies()
    dependencies {
        "compileOnly"("net.neoforged:neoforge:21.1.230:universal") { isTransitive = false }
        "compileOnly"("net.neoforged.fancymodloader:loader:4.0.42") { isTransitive = false }
        "compileOnly"("net.neoforged:bus:8.0.5") { isTransitive = false }
    }
    fatAgentJar("neoforge-modern")
}

val platformProjects = listOf(
    "bukkit",
    "bungee",
    "velocity",
    "fabric",
    "forge-legacy",
    "forge-modern",
    "neoforge-legacy",
    "neoforge-modern"
)

tasks.register<Copy>("jar") {
    dependsOn(platformProjects.map { project(":$it").tasks.named("jar") })
    into(layout.buildDirectory.dir("libs"))
    from(platformProjects.map { project(":$it").tasks.named<Jar>("jar").flatMap { jar -> jar.archiveFile } })
    rename { name -> name.replace("-$agentVersion.jar", ".jar") }
}
