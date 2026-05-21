import net from "node:net";

const SERVERDATA_AUTH = 3;
const SERVERDATA_EXECCOMMAND = 2;
const SERVERDATA_RESPONSE_VALUE = 0;

export async function sendRconCommand(options: {
  host: string;
  port: number;
  password: string;
  command: string;
  timeoutMs?: number;
}): Promise<string> {
  const socket = net.createConnection({ host: options.host, port: options.port });
  socket.setTimeout(options.timeoutMs ?? 10000);
  let nextId = 1;

  try {
    await onceConnect(socket);
    const authId = nextId++;
    await writePacket(socket, authId, SERVERDATA_AUTH, options.password);
    const auth = await readPacket(socket);
    if (auth.id === -1 || auth.id !== authId) {
      throw new Error("RCON authentication failed");
    }

    const commandId = nextId++;
    await writePacket(socket, commandId, SERVERDATA_EXECCOMMAND, options.command);
    const response = await readPacket(socket);
    if (response.type !== SERVERDATA_RESPONSE_VALUE && response.id !== commandId) {
      throw new Error("unexpected RCON response");
    }
    return response.body;
  } finally {
    socket.end();
  }
}

function onceConnect(socket: net.Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
    socket.once("timeout", () => reject(new Error("RCON connection timed out")));
  });
}

function writePacket(socket: net.Socket, id: number, type: number, body: string): Promise<void> {
  const bodyBuffer = Buffer.from(body, "utf8");
  const length = 4 + 4 + bodyBuffer.length + 2;
  const packet = Buffer.alloc(4 + length);
  packet.writeInt32LE(length, 0);
  packet.writeInt32LE(id, 4);
  packet.writeInt32LE(type, 8);
  bodyBuffer.copy(packet, 12);
  packet.writeInt16LE(0, 12 + bodyBuffer.length);
  return new Promise((resolve, reject) => {
    socket.write(packet, (error) => error ? reject(error) : resolve());
  });
}

function readPacket(socket: net.Socket): Promise<{ id: number; type: number; body: string }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let expected = 0;

    const cleanup = (): void => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onTimeout = (): void => {
      cleanup();
      reject(new Error("RCON read timed out"));
    };
    const onData = (chunk: Buffer): void => {
      chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      if (expected === 0 && buffer.length >= 4) {
        expected = buffer.readInt32LE(0) + 4;
      }
      if (expected > 0 && buffer.length >= expected) {
        cleanup();
        const id = buffer.readInt32LE(4);
        const type = buffer.readInt32LE(8);
        const body = buffer.subarray(12, expected - 2).toString("utf8");
        resolve({ id, type, body });
      }
    };

    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
  });
}
