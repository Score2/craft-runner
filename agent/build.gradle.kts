plugins {
    java
}

group = "io.insinuate.score2.craftrunner"
version = "0.1.0"

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

dependencies {
    compileOnly("io.papermc.paper:paper-api:1.21.4-R0.1-SNAPSHOT")
    compileOnly("net.md-5:bungeecord-api:1.21-R0.3")
    compileOnly("com.velocitypowered:velocity-api:3.4.0")
    compileOnly("net.fabricmc:fabric-loader:0.19.2")
    compileOnly("net.minecraftforge:forge:1.21.4-54.1.16:universal") {
        isTransitive = false
    }
    compileOnly("net.minecraftforge:fmlloader:1.21.4-54.1.16") {
        isTransitive = false
    }
    compileOnly("net.minecraftforge:javafmllanguage:1.21.4-54.1.16") {
        isTransitive = false
    }
    compileOnly("net.minecraftforge:eventbus:6.2.33") {
        isTransitive = false
    }
    compileOnly("net.neoforged:neoforge:21.1.230:universal") {
        isTransitive = false
    }
    compileOnly("net.neoforged.fancymodloader:loader:4.0.42") {
        isTransitive = false
    }
    compileOnly("net.neoforged:bus:8.0.5") {
        isTransitive = false
    }
    compileOnly("org.graalvm.polyglot:polyglot:25.0.3")
    compileOnly("org.graalvm.polyglot:js:25.0.3")
    implementation("com.google.code.gson:gson:2.13.2")
    implementation("org.incendo:cloud-paper:2.0.0-beta.15")
    implementation("org.incendo:cloud-bungee:2.0.0-beta.15")
    implementation("org.incendo:cloud-velocity:2.0.0-beta.15")
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    options.release.set(21)
}

tasks.jar {
    archiveBaseName.set("craft-runner-agent")
    archiveClassifier.set("")
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
    from({
        configurations.runtimeClasspath.get()
            .filter { it.exists() }
            .filter { it.isDirectory || it.extension == "jar" }
            .map { if (it.isDirectory) it else zipTree(it) }
    })
    manifest {
        attributes["Multi-Release"] = "true"
        attributes["Implementation-Title"] = "Craft Runner Agent"
        attributes["Implementation-Version"] = project.version
    }
}
