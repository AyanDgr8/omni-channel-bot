import { z } from "zod/v4";

export const mediaSessionSchema = z.object({
  mediaBridgeUrl: z.string().url(),
  mediaSessionToken: z.string().min(1),
  sessionConfig: z.record(z.string(), z.unknown()),
});

export const originateRequestSchema = z.object({
  config: z.record(z.string(), z.unknown()),
  callId: z.string().min(1),
  to: z.string().min(1),
  session: mediaSessionSchema,
});

export const dtmfRequestSchema = z.object({
  config: z.record(z.string(), z.unknown()),
  digit: z.string().regex(/^[0-9A-D*#]$/),
});

export const inboundSessionResponseSchema = mediaSessionSchema.extend({
  accepted: z.literal(true),
  callId: z.string().min(1),
  freeswitchUuid: z.string().min(1),
});

export const workerCallStateSchema = z.enum(["ringing", "answered", "failed", "ended"]);
export const workerEventTypeSchema = z.enum(["dtmf", "media_attached", "media_detached", "log"]);