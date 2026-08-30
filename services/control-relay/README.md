# Study 6 control relay

> **Experimental scaffold — do not expose publicly or use for participant sessions.**
> The current service has no server-issued, role-bound capabilities, authenticated
> idle deadline, or per-room rate limit, and the APK/WebXR clients do not yet
> implement transport failover. It exists only to exercise the bounded relay model.

This service is an optional routing scaffold among the researcher controller, the WebXR
experiment owner, and the headset sensor bridge. It does not interpret BRSP or
`study6.bridge.v2` commands and must never be a session authority. After the first bounded
authentication message, text and binary frames are routed opaquely to the other authenticated
roles in the room.

The unwired browser prototype end-to-end encrypts its legacy domain envelopes before sending
them; production BRSP/WebXR/APK relay adapters do not yet exist. Any promoted clients must keep
that end-to-end confidentiality property. The relay retains only an in-memory SHA-256 digest of
the random room bearer and forgets an empty room. It deliberately has no database, participant
identifiers, questionnaire fields, raw ECG, or command retry logic.

## Configuration

- `STUDY6_RELAY_BIND` — listener address, default `127.0.0.1:8787`.
- `STUDY6_RELAY_ALLOWED_ORIGINS` — comma-separated exact browser origins. Native clients omit
  `Origin`; browser connections are rejected unless their exact origin is listed.
- `STUDY6_RELAY_MAX_FRAME_BYTES` — default 16384.
- `STUDY6_RELAY_QUEUE_CAPACITY` — per-peer bounded queue, default 64.
- `STUDY6_RELAY_MAX_ROOMS` — default 1024.

For a private development deployment, terminate TLS at a reverse proxy and expose `/v1/socket`
only as WSS. The first frame
must be JSON with protocol `study6.relay.v1`, kind `authenticate`, random room/peer identifiers,
one of the roles `bridge`, `webxr`, or `controller`, and a 256-bit base64url bearer. Bearers must
be distributed only inside the encrypted, short-lived pairing descriptor.

Run locally with:

```sh
cargo run --manifest-path services/control-relay/Cargo.toml
```

Before promotion, replace the shared room bearer with server-issued role-bound capabilities,
add authenticated idle deadlines and connection/rate limits, actively cancel evicted sockets,
and pass a native-APK/WebXR/controller end-to-end failover test. The relay is not required for
the headset-local block transaction. Losing it must affect remote monitoring only; the APK
foreground service remains the sensor-recording authority, while WebXR remains the experiment
authority.
