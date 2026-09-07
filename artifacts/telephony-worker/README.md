# VoxAgent FreeSWITCH SIP worker

This is an external Node.js service that exposes the private HTTP contract consumed by
the API gateway: `GET /health` and authenticated `POST /v1/gateways/{reload,register,
unregister,test-call,originate}`, plus `POST /v1/calls/:callId/dtmf`. Both originate
and test-call require
the durable API call ID and authenticated media session; DTMF controls accept one
`0-9`, `*`, `#`, or `A-D` digit for an active correlation. It is deliberately not a Replit production service: SIP uses
UDP/TCP/TLS and FreeSWITCH owns RTP/SRTP, NAT traversal, codec negotiation, and media.
Replit cannot provide the required UDP/RTP networking.

## Deployment

Deploy beside a real FreeSWITCH host on a private network. Set:

* `FREESWITCH_WORKER_AUTH_SECRET` (gateway-to-worker bearer secret)
* `FREESWITCH_CALLBACK_URL` (API `/internal/freeswitch/callback`)
* `FREESWITCH_WORKER_CALLBACK_SECRET` (callback bearer secret)
* `FREESWITCH_ESL_HOST`, `FREESWITCH_ESL_PORT` (default `8021`), and
  `FREESWITCH_ESL_PASSWORD`
* `FREESWITCH_ESL_TLS=true` where ESL TLS is enabled. Certificate verification is on
  by default; only set `FREESWITCH_ESL_REJECT_UNAUTHORIZED=false` for an explicitly
  trusted private self-signed deployment.
* `PORT` (default `8080`) and optional `HOST`.
* `FREESWITCH_SOFIA_GATEWAY_DIR`, a mounted FreeSWITCH
  `conf/sip_profiles/external` include directory writable by this worker, and
  `FREESWITCH_CONFIG_URL`, the authenticated API inventory endpoint.

Expose worker HTTP only to the API gateway. Expose ESL only on its private network;
never publish port 8021. Open SIP signalling (5060/5061 as appropriate) and the
configured FreeSWITCH RTP UDP range between FreeSWITCH and carrier/firewall—not to
this worker.

FreeSWITCH requires `mod_sofia`, `mod_event_socket`, `mod_dptools`, `mod_commands`, and an `external`
Sofia profile. Configure Sofia profile gateway options for `options-ping`, register
expiry, NAT (`ext-sip-ip`/`ext-rtp-ip` or STUN), TLS certificates, SRTP, allowed codecs,
and RTP ports. The worker uses ESL Sofia registration/originate controls; production
installations should mount the gateway include directory into the worker and permit
`reloadxml` plus `sofia profile external rescan`. Enable a `mod_audio_fork` build that
provides `uuid_audio_fork <uuid> start|stop`; it receives a WSS bridge URL and
base64url session metadata containing the API-issued media token. The media service
must authenticate that token and exchange 20ms mono signed-little-endian PCM at 16kHz
in both directions with codec metadata. This worker's jitter buffer is for those PCM
frames, not raw RTP.

Callback events carry unique IDs for API idempotency and bearer + HMAC headers. Secrets,
SIP passwords, and SDP are never logged by this service. Run `pnpm --filter
@workspace/telephony-worker build && pnpm --filter @workspace/telephony-worker test`.
The inventory endpoint must return `{ "configs": [<secure SIP config payloads>] }` and
authenticate the worker bearer token; it is reconciled at startup and every 60 seconds.
Before answering inbound calls, the worker authenticates to
`/internal/freeswitch/inbound-session` with the gateway identity and FreeSWITCH UUID.
Only an accepted response with a durable call ID, WSS bridge URL, media token, and
session configuration can be answered. Ringing, answer, DTMF, media attach/detach,
failure, and hangup callbacks carry both IDs. Lifecycle uses `callState`
(`ringing|answered|failed|ended`), while DTMF/media use `eventType`; media tokens are never included in
callbacks or logs.
Inbound DID entries are either exact E.164 numbers with 8–15 digits after `+`, or
prefixes with 1–15 digits and one trailing `*` (for example `+1*` or `+4420*`).
They are matched only inside the identified Sofia gateway;
arbitrary regular expressions and global extension/DID matching are rejected.
Canonical SIP values match the database checks: `dtmfMode` is
`rfc2833|sip_info|inband`, `srtpMode` is `disabled|optional|required`, and
`natTraversal` is `none|stun|force_rport`. Gateway XML also applies ptime, keepalive,
STUN, proxy, codec, caller/originate, prefix, and concurrency policy. RTP ranges,
bind/external addresses, and recording are FreeSWITCH profile/dialplan settings and
must be applied on the host rather than misrepresented as per-gateway Sofia options.
Real registration/status events, gateway rescan, carrier OPTIONS/NAT behavior, TLS/SRTP,
audio-fork command syntax, authenticated media frames, and call lifecycle must be
validated against an actual FreeSWITCH host.