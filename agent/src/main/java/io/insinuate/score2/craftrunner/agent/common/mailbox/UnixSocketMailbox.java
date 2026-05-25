package io.insinuate.score2.craftrunner.agent.common.mailbox;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import io.insinuate.score2.craftrunner.agent.common.runtime.AgentConfig;
import io.insinuate.score2.craftrunner.agent.common.runtime.AgentPlatform;
import java.io.ByteArrayOutputStream;
import java.net.StandardProtocolFamily;
import java.net.UnixDomainSocketAddress;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.channels.ServerSocketChannel;
import java.nio.channels.SocketChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.ExecutorService;
import java.util.logging.Level;

public final class UnixSocketMailbox implements Runnable {
    private final AgentPlatform platform;
    private final Path socket;
    private final DebugRequestHandler requestHandler;
    private final Gson gson = new GsonBuilder().disableHtmlEscaping().create();
    private volatile boolean running = true;
    private ServerSocketChannel server;

    public UnixSocketMailbox(AgentPlatform platform, AgentConfig config, Path socket, ExecutorService asyncExecutor) {
        this.platform = platform;
        this.socket = socket;
        this.requestHandler = new DebugRequestHandler(platform, config, asyncExecutor);
    }

    public void stop() {
        running = false;
        try {
            if (server != null) {
                server.close();
            }
        } catch (Exception ignored) {
        }
        try {
            Files.deleteIfExists(socket);
        } catch (Exception ignored) {
        }
    }

    public static boolean supported() {
        return !System.getProperty("os.name", "").toLowerCase().contains("win");
    }

    @Override
    public void run() {
        if (!supported()) {
            return;
        }
        try {
            Files.createDirectories(socket.getParent());
            Files.deleteIfExists(socket);
            server = ServerSocketChannel.open(StandardProtocolFamily.UNIX);
            server.bind(UnixDomainSocketAddress.of(socket));
            while (running) {
                try (SocketChannel client = server.accept()) {
                    handle(client);
                } catch (Exception error) {
                    if (running) {
                        platform.logger().log(Level.WARNING, "Failed to process craft-runner agent socket request", error);
                    }
                }
            }
        } catch (Exception error) {
            platform.logger().log(Level.WARNING, "Craft Runner Unix socket mailbox is unavailable; file mailbox remains active", error);
        } finally {
            stop();
        }
    }

    private void handle(SocketChannel client) throws Exception {
        DebugResponse response;
        try {
            DebugRequest request = gson.fromJson(readAll(client), DebugRequest.class);
            response = requestHandler.handle(request);
        } catch (Exception error) {
            response = DebugResponse.failure("unknown", error, 0L);
        }
        ByteBuffer output = ByteBuffer.wrap((gson.toJson(response) + "\n").getBytes(StandardCharsets.UTF_8));
        while (output.hasRemaining()) {
            client.write(output);
        }
    }

    private String readAll(SocketChannel client) throws Exception {
        ByteBuffer buffer = ByteBuffer.allocate(8192);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        while (client.read(buffer) >= 0) {
            buffer.flip();
            while (buffer.hasRemaining()) {
                output.write(buffer.get());
            }
            buffer.clear();
        }
        return output.toString(StandardCharsets.UTF_8);
    }
}
