# API server media control environment

SIP media sessions require `MEDIA_BRIDGE_URL` and `MEDIA_BRIDGE_TOKEN_SECRET`.
Inbound DTMF is delivered by HTTP POST to `MEDIA_BRIDGE_DTMF_URL` with the
tenant, bot, call, FreeSWITCH UUID, digit, and worker event ID. The request body
is signed as an HMAC-SHA256 using `MEDIA_BRIDGE_TOKEN_SECRET`; the lowercase hex
signature is sent as `Authorization: Bearer <signature>`.

`MEDIA_BRIDGE_DTMF_URL` is mandatory in production and must use HTTPS. In
development/test, plain HTTP is permitted only for localhost. Delivery times
out after five seconds and non-success responses fail the worker callback
explicitly.