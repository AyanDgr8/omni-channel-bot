import { EventEmitter } from "node:events";
import net from "node:net";
import tls from "node:tls";

export type EslFrame = { headers: Record<string, string>; body: string };
export function parseFrames(input: string): { frames: EslFrame[]; remainder: string } {
  const frames: EslFrame[] = []; let rest = input;
  while (true) {
    const boundary = rest.indexOf("\n\n"); if (boundary < 0) break;
    const headerText = rest.slice(0, boundary); const headers: Record<string, string> = {};
    for (const line of headerText.split("\n")) { const at = line.indexOf(":"); if (at > 0) headers[line.slice(0, at).trim().toLowerCase()] = decodeURIComponent(line.slice(at + 1).trim()); }
    const length = Number(headers["content-length"] ?? 0); if (!Number.isSafeInteger(length) || length < 0) throw new Error("Invalid ESL content length");
    if (rest.length < boundary + 2 + length) break;
    frames.push({ headers, body: rest.slice(boundary + 2, boundary + 2 + length) }); rest = rest.slice(boundary + 2 + length);
  } return { frames, remainder: rest };
}
export class EslClient extends EventEmitter {
  private socket?: net.Socket; private buffer = ""; private reconnectMs = 1_000; private retry?: NodeJS.Timeout; private ready = false;
  constructor(private readonly options: { host: string; port: number; password: string; tls?: boolean; rejectUnauthorized?: boolean }) { super(); }
  get connected(): boolean { return this.ready; }
  connect(): void {
    const socket = this.options.tls ? tls.connect({ host: this.options.host, port: this.options.port, rejectUnauthorized: this.options.rejectUnauthorized !== false }) : net.connect(this.options.port, this.options.host);
    this.socket = socket; socket.setKeepAlive(true, 30_000);
    socket.on("data", (chunk: Buffer) => this.receive(chunk.toString("utf8")));
    socket.once("error", () => undefined); socket.once("close", () => { this.ready = false; this.emit("disconnect"); this.schedule(); });
  }
  private schedule(): void { if (!this.retry) this.retry = setTimeout(() => { this.retry = undefined; this.connect(); }, Math.min(this.reconnectMs *= 2, 300_000)); }
  private receive(data: string): void {
    const parsed = parseFrames(this.buffer + data); this.buffer = parsed.remainder;
    for (const frame of parsed.frames) { if (frame.headers["content-type"] === "auth/request") this.write(`auth ${this.options.password}`); else if (frame.headers["reply-text"]?.startsWith("+OK accepted")) { this.ready = true; this.reconnectMs = 1_000; this.write("event plain CHANNEL_CREATE CHANNEL_PROGRESS CHANNEL_ANSWER CHANNEL_HANGUP CHANNEL_HANGUP_COMPLETE DTMF CUSTOM sofia::register sofia::gateway_state"); this.emit("ready"); } else this.emit("frame", frame); }
  }
  private write(command: string): void { this.socket?.write(`${command}\n\n`); }
  command(command: string): void { if (!this.ready) throw new Error("ESL is not connected"); if (/[\r\n]/.test(command)) throw new Error("Unsafe ESL command"); this.write(command); }
  close(): void { if (this.retry) clearTimeout(this.retry); this.socket?.destroy(); }
}
