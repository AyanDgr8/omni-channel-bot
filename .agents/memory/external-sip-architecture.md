---
name: External SIP architecture
description: Durable deployment boundary and failure policy for VoxAgent SIP telephony.
---

Keep VoxAgent on Replit as the multi-tenant control plane and run FreeSWITCH as a separate worker on infrastructure that supports inbound SIP and UDP RTP port ranges. FreeSWITCH owns SIP registration/signaling, RTP/SRTP, codecs, NAT traversal, and media transport; VoxAgent owns configuration, authorization, call state, compliance, campaigns, and engine session contracts.

**Why:** Replit published applications cannot expose the inbound UDP/RTP ranges required for a real SIP media server. Simulating registration or calls would hide deployment failures and violate the product's audit requirements.

**How to apply:** Preserve WebRTC behavior as the default. SIP actions must fail explicitly when the external worker or media bridge is unavailable. Validate protocol changes across both the API and worker, then perform final SIP acceptance testing on the external FreeSWITCH host.