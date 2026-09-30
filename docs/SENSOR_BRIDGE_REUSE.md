# Reusable WebXR sensor-bridge contract

The native APK is a sensor-recorder provider. It does not contain a study state machine. A WebXR
experiment owns condition order, duration, participant-facing naming, progression, and any remote
operator policy; it maps those decisions onto the fixed native command registry.

## Stable module boundary

```text
phone/PC companion
  └─ BRSP typed study intents + privacy-minimized status
              ⇅
WebXR study adapter (the only study authority)
  └─ maps a condition to {sessionId, jobId, artifactStem, durationMs}
              ⇅ authenticated loopback study6.bridge.v2
Quest sensor bridge APK
  ├─ bridge-contract: strict envelopes, commands, receipts, snapshots
  ├─ broker-transport-android: bounded loopback WebSocket
  ├─ sensor-runtime-android: BLE, timer, recording jobs, atomic CSVs
  └─ sensor-bridge-app: foreground service, readiness and browser launch
```

Future experiments replace only the WebXR study adapter and the allowlisted deployment URL/origin.
They should not fork the BLE client, recorder, timer, transport, or command processor. The current
wire namespace retains its `study6.bridge.v2` compatibility name until a second real experiment or
neutral conformance harness proves the contract independently; the command engine itself is
study-neutral.

## Fixed recording-job API

| Command | APK effect | Positive feedback |
| --- | --- | --- |
| `begin_recording` | Bind one WebXR-owned session to the open recorder | Observed receipt and matching owner snapshot |
| `start_recording_job` | Start sample admission for a named job | `recording_job_started` receipt and `recording` snapshot |
| `record_for` | Start admission and an APK-monotonic active-time countdown | Same start confirmation; later unsolicited `completed` snapshot |
| `pause_recording_job` | Stop admission, fsync, and suspend the countdown | `recording_job_paused` receipt and `paused` snapshot |
| `resume_recording_job` | Resume admission and remaining active time | `recording_job_resumed` receipt and `recording` snapshot |
| `stop_recording_job` | Drain, fsync, and atomically promote the job CSV | `recording_job_completed` receipt and `completed` snapshot |
| `verify_recording_artifact` | Verify the original job/stem, durable samples, final CSV, and absent partial | `recording_artifact_verified` observed receipt |

`StudyBridgeClient.recordForUntilCompleted` is the convenience operation for future WebXR studies:
it resolves only after the start command was observed and the APK later announced a durable
completion. The caller can then use `verifyRecordingArtifact` before advancing. Individual command
methods remain available when media and recording lifecycles must be coordinated separately.

The APK timer uses Android monotonic elapsed time and counts active recording time. Pausing a job
therefore pauses its requested duration. A lost WebXR owner closes an active job fail-closed. Raw
ECG, app-private paths, tokens, job IDs, artifact stems, and participant identifiers are not sent to
the external companion.

## Naming and safety

WebXR sends an `artifactStem`, never a path or complete filename. The stem is a 1–96 character token
containing only letters, digits, `.`, `_`, and `-`, beginning with a letter or digit. The APK resolves
it below the current app-private recording directory, writes `<stem>.partial.csv`, fsyncs it, and
atomically promotes it to `<stem>.csv`. Existing artifacts are never overwritten.

The APK accepts no shell command, executable text, filesystem path, URL, DOM selector, or arbitrary
method name. Reuse means extending the typed command registry and its cross-language schema/tests
when a genuinely new sensor operation is needed—not adding a generic command executor.

## Future-study integration checklist

1. Keep the native four-module provider unchanged and configure the allowlisted WebXR deployment
   URL/origin for the new build.
2. In WebXR, bind a pseudonymous session with `begin_recording`.
3. Derive deterministic job IDs and safe stems from that study's authoritative condition state.
4. Use the individual lifecycle calls or `recordForUntilCompleted`; treat receipts as command
   effects and snapshots as authoritative state.
5. Require durable completion and `verify_recording_artifact` before study progression.
6. Project only identifier-free job state/counters to the external companion.
7. Run the shared Kotlin/TypeScript fixtures, unit tests, lint, APK assembly, then a serial-scoped
   Quest + real Polar H10 timing/recovery qualification.

Host tests prove contract and persistence logic, not exact physical duration, foreground survival,
BLE performance, or Meta Browser loopback behavior. Those remain device gates for every released
experiment.
