# Hybrid WebXR + Sensor Bridge implementation

Status: host-implemented placeholder/acquisition rehearsal; Quest hardware qualification pending  
Scope: questionnaire, acquisition, control, persistence, and UI infrastructure only  
Participant eligibility: **false** while placeholder stimuli are selected

## Product boundary

The new application is one experiment with two deliberately separate authorities:

```text
Meta Quest Browser / WebXR (sole study authority)
  ├─ questionnaire, condition, allocation, and progression logic
  ├─ study reducer, revision, recovery, and audit trail
  ├─ browser IndexedDB plus study JSON/CSV export
  ├─ 2D/immersive presentation and media control
  └─ discovery-only public beacon + private DTLS-protected BRSP operator companion
                         ⇅ study6.bridge.v2
Quest Sensor Bridge APK (sensor-recorder provider only)
  ├─ visible setup/readiness Activity
  ├─ connectedDevice foreground service
  ├─ continuous Polar H10 PMD readiness/preview
  ├─ reusable app-private raw ECG recording-job engine
  ├─ durable timestamped experiment-marker journal
  └─ recorder finalization and sensor-artifact export
```

WebXR never delegates questionnaire answers, condition selection, navigation, or
study progression to the APK. It commits those transitions locally, then sends
privacy-minimized metadata markers so the APK can label the independently durable
ECG jobs. The APK does not return or reconstruct study state. It projects only
bounded recorder, Polar-readiness, writer-health, and waveform-preview data.

The two exports therefore have different owners:

- the browser study export contains the condition/questionnaire/session record;
- the APK sensor export contains raw ECG, recorder health, and metadata markers.

They are correlated by the pseudonymous session and event identifiers supplied by
WebXR. Questionnaire answers and participant-entered demographics do not cross the
bridge.

## Implemented repositories and modules

### WebXR repository

- `src/study/reducer.ts` is the sole questionnaire, condition, progression, and
  study-revision authority.
- `src/app/controller.ts` applies every study transition to the WebXR reducer and
  browser database. It treats the APK only as a provider of sensor status and
  recorder effects.
- `src/persistence/database.ts` owns browser recovery, the study audit trail, and study
  JSON/CSV export.
- `src/bridge/contract.ts` freezes the bounded sensor-recorder contract, Polar
  projection, process/page/transport epochs, marker schema, and recording
  receipts.
- `src/bridge/client.ts` rejects stale epochs and recording snapshots, correlates
  sensor commands, waits for requested receipt stages, and never guesses the
  result of an ambiguous disconnect.
- `src/bridge/transport.ts` supplies the authenticated loopback/WSS launch seam;
  bootstrap tokens are accepted from the URL fragment and immediately removed
  from browser history.
- `src/app/panel-renderer.ts` renders the same acquisition gate with bounded data
  populated by real APK samples only.
- `src/media/stimulus-provider.ts` and `src/media/player.ts` define a replaceable
  placeholder provider, decoded Web Audio scheduling, output-clock evidence, and
  first-video-frame effect receipts.
- `src/timing/clock-fit.ts` and `src/timing/start-barrier.ts` implement pure,
  deterministic clock-fit and multi-owner barrier state machines. They are not
  production-wired and do not establish physical onset accuracy.
- `src/companion/public-beacon.ts` publishes and receives the fixed,
  passwordless VDO.Ninja discovery room. It announces only an opaque derived
  availability handle. No function maps that public handle to a BRSP room,
  stream, key, scope, or control capability.
- The rest of `src/companion/*` carries BRSP/1 on dedicated reliable-control and
  unordered latest-state RTCDataChannels. Optional spectator monitoring is
  separate and off by default. BRSP proves possession of a random private descriptor,
  negotiates the fixed bounded scopes, revision-fences commands, and returns
  application-level `applied` receipts. The descriptor is delivered only by a
  fragment/QR/paste pairing path, retained locally for reconnect, and revoked by
  rotating the trusted credential.
- Study commands terminate at the WebXR authority; only typed sensor and recorder
  effects are forwarded to the APK. These include recording-job start/timed
  record/pause/resume/stop/verify, sensor reconnect, marker/finalize, sensor
  export, and return. The APK does not advertise, discover, join, or authenticate
  the public browser beacon.
- `services/control-relay` is an experimental Rust WSS room-router scaffold. It
  is not wired to WebXR/APK failover and lacks the production role/capability and
  abuse-control proof required for deployment. Do not expose it for participant
  sessions.
- `tools/build-release-manifest.mjs` emits hashes for the deployed artifact and
  optionally signs the manifest with Ed25519.

### Native repository

The sensor-recorder implementation is isolated in the private
`MesmerPrism/spatial-study-6` repository so the WebXR variant does not pull the
old immersive renderer into the background service:

- `bridge-contract`: canonical Kotlin sensor-recorder envelopes, strict parser,
  schemas, fixtures, recording revisions, and receipt correlation;
- `broker-transport-android`: bounded RFC 6455 transport reused from the proven
  Rusty Quest pattern;
- `sensor-runtime-android`: Polar H10 stream/readiness and durable ECG writer
  ownership;
- `sensor-bridge-app`: visible acquisition gate, foreground-service lifecycle,
  loopback admission, recorder controls, and allowlisted browser launch.

The APK accepts only the sensor-recorder command family:

```text
request_status, reconnect_sensor, begin_recording,
start_recording_job, record_for, pause_recording_job, resume_recording_job,
stop_recording_job, verify_recording_artifact, record_experiment_marker,
finalize_recording, request_sensor_export, return_to_experiment
```

An experiment marker may carry a WebXR revision, pseudonymous session/block,
condition and media identifiers, browser monotonic/UTC timestamps, and the event
type. It must not carry names, demographics, consent values, or questionnaire
answers.

The old standalone Spatial APK remains a visual and behavioral oracle. It is not
the WebXR study authority and is not silently converted into this bridge variant.
Its native repository also contains a debug-build-only, Android `DUMP`-protected
qualification provider for closed shell/root scenarios. That provider is absent
from release builds, is not an AccessibilityService or browser remote-control
surface, and is intentionally not connected to BRSP. The supported three-channel
runtime remains companion browser → WebXR authority → Sensor Bridge APK; the
standalone Spatial APK is an alternate experiment implementation, not a fourth
simultaneous authority.

## Runtime sequence

1. The researcher opens the Sensor Bridge Activity and grants Bluetooth access.
2. The Activity explicitly starts the `connectedDevice` foreground service.
3. The service selects/connects the H10, configures 130 Hz PMD ECG, and exposes
   fresh real samples plus recorder/storage readiness without choosing a study
   session.
4. The acquisition card shows HR, sample rate/count/age, a bounded waveform,
   reconnect/gap counters, and recorder/storage state. **Launch experiment**
   remains gated.
5. The APK generates a fresh per-process 256-bit bridge token plus a nonsecret
   launch nonce and launches the exact allowlisted HTTPS WebXR URL in Meta
   Browser. The token remains fragment-only and is scrubbed after bootstrap.
6. WebXR opens/reconciles its own IndexedDB study record, authenticates to the
   sensor provider, and renders the questionnaire/condition flow from its local
   authoritative state. After a participant session is durably allocated or
   recovered, WebXR issues one stable `begin_recording` request and waits for a
   snapshot whose envelope session and `ownerSessionId` match before accepting
   demographics or acquisition markers.
7. Every participant or remote study action is validated, reduced, audited, and
   persisted by WebXR. The APK neither accepts that action as a reducer command nor
   advances a study page.
8. For each block, WebXR derives a safe artifact stem from its authoritative
   session/condition/attempt state and sends `record_for` with the intended active
   duration. Media pause/resume sends the matching recorder command and pauses the
   APK's monotonic countdown. At media completion WebXR sends stop, waits for the
   durable atomic CSV promotion, then sends `verify_recording_artifact`; only a
   successful verification permits questionnaire progression. Technical hold,
   abort, owner loss, and finalization also close admission fail-closed. H10
   streaming/preview remains live between jobs, but out-of-job samples are
   discarded before the disk queue and are not counted as drops.
9. On page startup WebXR automatically enables the full bounded operator profile,
   starts its private data-only BRSP target, and publishes an opaque availability
   handle that cannot derive the control credential. Pairing a phone/PC once with
   the private fragment link persists the random descriptor on both browsers;
   later bare companion visits reconnect automatically. One credential holder is
   admitted at a time. WebXR alone decides and applies progression; sensor
   requests go through WebXR to the APK.
10. WebXR finalizes/exports the browser study record. The APK separately
    finalizes/exports the sensor artifact. Neither export is transported through
    VDO.Ninja or the experimental relay.

## Start and synchronization contract

The live ECG stream begins before a block, while raw persistence begins only
after the durable block-start intent and before `play()`. A media-start marker
sent after an ordinary `play()` call is useful for audit correlation, but it is
not proof that audio and the ECG persistence window began simultaneously.

The intended production design uses a shared future instant:

```text
real ECG + durable writer + decoded media + fresh clock fit
                    ↓
        reserve a future APK-monotonic T0
                    ↓
 APK persists future marker     WebXR schedules Web Audio
                    ↓
             commit before deadline
                    ↓
 ECG bracket observed       audio output estimate observed
                    ↓
          compound “observed” timing receipt
```

`AudioContext.getOutputTimestamp()` is software evidence, not an acoustic
measurement. H10 sample time, Android packet-receipt time, browser monotonic time,
and the audio clock remain separate clock domains.

**Current gap:** the clock-fit/barrier libraries exist, but the production
controller and recorder do not yet execute this future-`T0`
prepare/offer/schedule/commit flow. The placeholder route must not be described as
synchronized or used as scientific timing evidence. Physical audio-to-ECG
accuracy still requires measurement on the target Quest/H10/audio route before a
tolerance is declared.

## Remote command surface

### BRSP reference intake

- **Reference:** `GeorgeFejer91/browser-remote-sync-protocol`, version `0.1.0`,
  commit `62ff66c6df724847c1e54161feabb470b67b1192`. The release also ships
  `brsp-provenance.json` with the exact source blob and normalized SHA-256.
- **Why it matters:** it provides a transport-neutral one-controller/one-target
  state machine for descriptor-possession proof, capability/scope negotiation,
  semantic commands, applied receipts, snapshots, and latest-state telemetry.
- **Lesson borrowed:** WebXR is the target/authority; phone or PC is the
  controller; reliable control is distinct from replaceable state; transport
  delivery is not application effect; state is always target-authoritative.
- **Overreach rejected:** the APK is not exposed as a second BRSP experiment
  target, arbitrary DOM/input/code execution is forbidden, the pre-1.0 reference
  is not treated as an independently audited production security product, and
  its data-only VDO lifecycle is not duplicated beside the existing spectator
  peer.
- **Target layer:** the exact MIT core is vendored behind the Study 6 Zod profile
  and a same-peer VDO custom-channel adapter. Questionnaire/condition authority
  remains in the WebXR reducer; BLE/ECG durability remains in the APK.
- **Pairing layer:** `public-beacon.ts` provides discovery-only availability.
  The BRSP key and VDO room/stream tuple come from a separate random 256-bit
  descriptor and cannot be derived from the beacon. The private QR/link is the
  initial trust transfer; the companion persists it for later reconnect, and
  target rotation revokes it.
- **Validation/follow-up:** host conformance covers HMAC, envelopes, scopes,
  two-channel semantics, strict status parsing, revisions, lifecycle re-seeding,
  and privacy-preserving peer-quality projection. Physical Quest, Android/iOS
  phone, desktop, direct/TURN, sleep/wake, and network-migration qualification
  remains required.

The companion's bounded study command surface is:

```text
configure_study, start_participant, request_status, recenter_panel, start_block,
pause_media, resume_media, advance, back, abort_session, finalize_session,
reconnect_sensor, return_to_experiment, request_export
```

`configure_study` carries exactly the variant, questionnaire language, and
timing mode. `start_participant` carries one bounded pseudonymous participant
code. Neither command can carry demographics, consent, questionnaire answers,
selectors, DOM events, scripts, URLs, or arbitrary method names, and companion
status never echoes the participant code.

These commands target the active WebXR coordinator. BRSP/1 validates a mutual
HMAC proof over the private bearer descriptor and negotiates all nine defined
Study 6 scopes. The public availability handle supplies no proof material. The
target still validates the exact
scope/action pair, bounded arguments, experiment revision, reducer transition,
and live acquisition gates. It owns all questionnaire, condition, block, abort,
and study-finalization decisions and maps only relevant recorder effects to the
smaller APK command family. APK recorder revisions remain result telemetry and
never replace the WebXR experiment revision.

After an `applied` receipt, the controller keeps relative and destructive
controls closed until an authoritative status names that exact BRSP command ID.
An equal WebXR revision is deliberately insufficient because sensor-only effects
can retain the experiment revision and the latest-state data channel is unordered.
The target evicts a transport peer that does not complete mutual authentication
within ten seconds, and a reconnected controller remains read-only until it has
received a fresh status from that connection epoch.

The companion renders independently observed controller-side and target-side
route/RTT diagnostics for the currently authenticated WebRTC peer. Route is
reduced to direct, relay, or unknown and RTT is rounded and bounded; raw ICE
candidates, addresses, and peer identifiers never enter application status.
These values diagnose the BRSP hop and are not used as experiment or ECG clocks.

Commands cannot enter an identifier, demographic value, consent response, or
questionnaire answer; cannot grant WebXR user activation; and cannot erase data.
`abort_session` and recorder finalization/export require explicit confirmation
where exposed. A transport acknowledgement is not shown as an observed effect.
Likewise, a BRSP `start_block` receipt proves WebXR command application, not
audio/ECG onset; the future local `T0` barrier remains the timing authority.

**Current gap:** the VDO.Ninja path requires the WebXR page to remain connected.
Pairing authenticates possession of a private persisted bearer and supports
explicit revocation, but it does not establish a named human/operator identity.
The Rust relay scaffold is not production-wired, and independent
controller-to-APK reachability is not implemented.

## Acceptance boundary

Host tests prove deterministic browser reduction and persistence, strict bridge
parsing, BRSP HMAC/scope/envelope conformance, two-lane delivery semantics,
bounded command/receipt correlation, replay/epoch fencing, Web Audio
scheduling behavior, clock/barrier transitions, and build integrity. They do
**not** prove Android foreground survival, Meta Browser loopback admission, BLE
performance, visual parity in-headset, or onset accuracy.

The opt-in Playwright live gate is designed to add real VDO.Ninja signaling and WebRTC evidence
between two isolated desktop-browser contexts: private fragment capture and
scrubbing, BRSP authentication/scope grant, trusted phone storage, explicit
disconnect plus target re-seed, both peer-bound route/RTT views, and bare-URL
reconnect from the saved descriptor.
It disables screenshots, traces, video, and failed-run output preservation so
the bearer descriptor is not written to Playwright artifacts. Run it with
`STUDY6_LIVE_VDO_E2E=1 npm run test:e2e` (or set the variable separately in
PowerShell). This is transport evidence, not physical Quest/phone evidence.

The route/RTT revision passes deterministic host/lifecycle tests. On 2026-08-31,
the secret-safe `qualify:quest-companion` harness also passed with a physical
Quest 3 Meta Browser target and isolated desktop Chromium controller at a
phone-sized viewport: all nine scopes authenticated, both peers read direct
WebRTC at 5–6 ms, status and recenter commands were acknowledged, and a bare URL
established a second authenticated epoch after disconnect/re-seed. No pairing or
Playwright artifact was retained. This qualifies that named target/controller
shape only; physical smartphone, forced TURN, roaming, sleep/wake, and endurance
remain open.

**Current gap:** physical Meta Quest + Polar H10 acquisition qualification is pending. Before
participant use, run the hardware matrix in
`QUEST_WEBXR_BLE_BRIDGE_ARCHITECTURE.md`, including a real Polar H10, 60–120
minute immersive sessions, Activity destruction, headset sleep/wake, browser
refresh, sensor loss/reconnect, storage pressure, controller reconnect, and
external audio-onset measurement.

Until that evidence is captured, every build remains a placeholder acquisition
rehearsal and its exports are scientifically ineligible.
