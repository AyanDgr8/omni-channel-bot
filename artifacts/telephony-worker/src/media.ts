/** FreeSWITCH (not this process) owns RTP/SRTP/NAT. This handles only PCM frames supplied by an audio-fork bridge. */
export const PCM16_16K_FRAME_BYTES = 640; // 20ms mono, signed little-endian
export function pcmFrame(data: Buffer<ArrayBufferLike>): Buffer<ArrayBufferLike> { if (data.length !== PCM16_16K_FRAME_BYTES) throw new Error("Expected 20ms 16kHz PCM16 frame"); return data; }
export class JitterBuffer {
  private frames = new Map<number, Buffer<ArrayBufferLike>>(); private next?: number; private last: Buffer<ArrayBufferLike> = Buffer.alloc(PCM16_16K_FRAME_BYTES);
  push(sequence: number, frame: Buffer<ArrayBufferLike>): void { this.frames.set(sequence >>> 0, pcmFrame(frame)); if (this.next === undefined) this.next = sequence >>> 0; }
  pull(): Buffer<ArrayBufferLike> { if (this.next === undefined) return this.last; const frame = this.frames.get(this.next); this.frames.delete(this.next); this.next = (this.next + 1) >>> 0; if (frame) this.last = frame; return frame ?? Buffer.from(this.last); }
}