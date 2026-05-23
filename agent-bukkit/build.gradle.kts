plugins {
    java
}

group = "io.github.score2.craftrunner"
version = "0.1.0"

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

dependencies {
    compileOnly("io.papermc.paper:paper-api:1.21.4-R0.1-SNAPSHOT")
    implementation("org.graalvm.polyglot:polyglot:25.0.3")
    implementation("org.graalvm.polyglot:js:25.0.3")
    implementation("com.google.code.gson:gson:2.13.2")
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    options.release.set(21)
}

tasks.jar {
    archiveBaseName.set("craft-runner-agent-bukkit")
    archiveClassifier.set("")
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
    from({
        configurations.runtimeClasspath.get()
            .filter { it.exists() }
            .filter { it.isDirectory || it.extension == "jar" }
            .map { if (it.isDirectory) it else zipTree(it) }
    })
    manifest {
        attributes["Implementation-Title"] = "Craft Runner Bukkit Agent"
        attributes["Implementation-Version"] = project.version
    }
}
