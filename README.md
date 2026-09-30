# Spatial Study 6 WebXR

Spatial Study 6 WebXR is the experiment authority in a hybrid Quest
application. It owns the questionnaire and condition logic, progression, study
reducer, browser IndexedDB record, and study JSON/CSV exports. A separate native
Sensor Bridge APK is only a sensor-recorder provider: it owns Polar H10
Bluetooth, continuous ECG readiness/preview, study-neutral raw ECG recording
jobs, timestamped metadata markers, recorder
finalization, and the sensor artifact export. The browser assets remain
statically hosted on GitHub Pages; the page talks to the APK through an
authenticated loopback WebSocket.

> **Incubator / test-only build.** This site is participant-ineligible and is
> not a production study or a replacement for an approved native build. Its
> eight videos are labeled placeholders, not experimental stimuli. Do not use
> outputs as participant or scientific evidence.

The intended public endpoints are:

- experiment: <https://georgefejer91.github.io/spatial-study-6-webxr/>
- public operator companion:
  <https://georgefejer91.github.io/spatial-study-6-webxr/companion.html>

## What is implemented

- browser and immersive-VR views of the same dark-world, light-panel UI;
- controller, hand/pinch, mouse, and touch pointer interaction;
- an immersive WebXR-owned keyboard for names, age, and manual IDs, avoiding the
  crashing Meta Browser 149 Android overlay-keyboard path;
- English and German operator/participant copy;
- DHS (`PH`) and SHD (`PI`) participant pools and deterministic 24-order
  condition/audio allocation;
- eight 300-second `Hand`/`Env` × `HC`/`LC` × `HE`/`LE` placeholder videos;
- the exact V01–V04 English/German guided-audio set used by the pinned source;
- four questionnaire rounds covering SAM, affect, emotions, ownership, and
  agency;
- a strict sensor-recorder `study6.bridge.v2` client with launch binding,
  session-owned `begin_recording`,
  process/page/transport epochs, recording-revision fencing, staged effect
  receipts, and native golden fixtures;
- study-owned ECG jobs: WebXR derives each condition's safe CSV stem and duration,
  asks the APK to `record_for`, mirrors pause/resume, and requires an observed stop
  plus successful artifact verification before questionnaire progression;
- a live, bounded Polar quality status/waveform populated only by real APK samples;
- a WebXR-authoritative questionnaire/condition reducer with browser IndexedDB
  recovery and study JSON/CSV exports;
- privacy-minimized experiment markers sent to the APK so its ECG artifact can
  be correlated with WebXR events without transferring questionnaire answers;
- explicit APK sensor reconnect, recorder finalize, and sensor-export requests;
- decoded Web Audio and clock/barrier libraries ready for later hardware timing
  integration; and
- a discovery-only public browser beacon plus a private, persisted BRSP/VDO
  bearer descriptor: a bare `companion.html` visit can see that a WebXR target
  is online but cannot derive control authority; a phone pairs once through the
  fragment link/QR and then reconnects automatically from its local credential;
  optional spectator monitoring remains a separate plane and is off by default.

The normal timing mode runs each block for five minutes. The clipped mode runs
ten-second blocks for diagnostics only. Both routes remain test-only and
participant-ineligible.

The original-APK data objectives and the exact remaining hardware gates are
tracked in [`docs/DATA_COLLECTION_PARITY.md`](docs/DATA_COLLECTION_PARITY.md).

## Run locally

Requirements: Node.js 24.15 or newer and npm.

```console
npm ci
npm run dev
```

Open the local URL printed by Vite. WebXR owns study state in every mode. Block
Start is fail-closed until the APK reports fresh real 130 Hz Polar H10 samples
and a healthy durable writer; the WebXR controller rechecks that gate even for
remote commands. For isolated questionnaire/UI work, use:

```text
?sensor=disabled-rehearsal
```

That explicit route runs without the APK bridge and remains participant-ineligible;
its acquisition Start gate intentionally stays locked. It uses the same
origin-scoped browser study store as hybrid mode.
A compatible headset browser on an HTTPS origin exposes **Enter VR**.
WebXR immersive sessions generally require a secure context; a plain HTTP LAN
URL is useful for desktop checking but may not be admitted by a headset.

At operator setup:

1. choose English or German;
2. choose DHS or SHD;
3. choose full or clipped timing;
4. select any pool ID or enter an allowed manual ID; partially completed data
   resumes at the first unfinished block, while a completed ID creates another
   timestamped data set; and
5. enter only synthetic test demographics unless a separately approved study
   protocol explicitly authorizes real participant data.

In every mode, WebXR recovers the study session from the same browser profile
and offers study JSON/CSV export. In hybrid mode, the APK separately keeps the
durable ECG samples and marker journal and owns finalization/export of that
sensor artifact. After WebXR durably allocates or recovers a session, it sends
one stable `begin_recording` request and waits for a matching session-owned
recording snapshot before demographics can be submitted or a block can start.

## Browser companion trusted pairing

While the experiment page is open, WebXR automatically starts a private,
data-only BRSP target and a separate passwordless availability beacon without
opening a dialog or changing focus. A bare public
[`companion.html`](https://georgefejer91.github.io/spatial-study-6-webxr/companion.html)
visit can list opaque online targets, but a beacon contains no room, stream,
secret, identity, or control capability and cannot be transformed into one.

Open the WebXR **Browser companion** dialog and scan or open its private link on
the operator phone once. The random 256-bit bearer descriptor is carried only in
the URL fragment, scrubbed before networking or rendering, and stored locally on
both browsers when storage is available. Later bare companion visits reconnect
automatically with that saved credential. **Pause automatic pairing** stops both
browser planes; **Rotate trusted credential** revokes the old room/stream/key,
disconnects its controller, and publishes a new unrelated availability handle.
The APK never receives or participates in browser pairing.

The target admits one bearer-authenticated BRSP controller at a time and offers
all nine defined Study 6 scopes after mutual proof. Those scopes remain bounded by the typed command allowlist,
authoritative WebXR revision, application reducer, and live experiment/sensor
gates; they do not create arbitrary browser or APK access. The companion can
request status, recenter the panel, apply variant/language/timing setup, select
and start a pseudonymous participant code, start an admissible block, pause or
resume media, navigate eligible questionnaire pages, request sensor reconnect or
return, and explicitly confirm a WebXR-owned abort or APK recorder
finalize/sensor-export request. It cannot enter names, demographics, consent, or
questionnaire answers; enter VR; receive an export; run scripts or arbitrary DOM
input; or delete records. Optional spectator monitoring is separate and off by
default.

The public beacon and BRSP peer live entirely between the WebXR browser on the
headset and `companion.html` on the phone/PC. The APK never joins the beacon or
accepts BRSP. WebXR remains the experiment authority and forwards only its
existing bounded sensor-recorder effects to the APK through `study6.bridge.v2`.
If the WebXR owner disconnects, remote control ends and the APK fail-closes any
active recording job; the experimental relay and independent controller-to-APK
path are not production-wired.

Companion status is privacy-minimized, not anonymous. It includes the selected
variant/language/timing, expected participant-code prefix, completed-block count,
whether a participant and immersive session are active, phase, block and
condition code, media timing/paused state, live heart rate, ECG sample
rate/count/age, and APK/recorder health counters. It excludes participant codes,
names, demographics, questionnaire answers, and raw ECG samples. Records and
prepared sensor exports never traverse the companion channel.

The trusted connection panel also shows two independently sampled transport
views: the phone-observed and headset-observed WebRTC route (`Direct WebRTC`,
`TURN relay`, or `Unknown`) and rounded RTT in milliseconds. These diagnostics
are bound to the authenticated peer and deliberately omit ICE candidates, peer
UUIDs, addresses, and other raw network details. They diagnose the remote-control
hop only; they are not ECG timing evidence.

## Data and privacy boundary

There is no study backend, account system, analytics integration, or automatic
result upload. Study state, condition assignment, demographics, questionnaire
answers, and browser audit events remain in origin-scoped IndexedDB and are
included in the browser's explicit study export. Raw ECG and its
privacy-minimized marker journal stay in the APK's app-private storage and are
never sent over VDO.Ninja. The browser store is not application-encrypted;
anyone with access to that profile may be able to read it. Clearing site data
can remove the browser study record; clearing APK data can remove the separate
sensor record.

GitHub Pages still serves the static files and may process ordinary request
metadata under GitHub's own policies. While the automatic headset beacon or a
companion listener is active, the page contacts VDO.Ninja public signaling and
STUN/TURN services. A direct WebRTC route can disclose peer IP addresses. If
optional spectator monitoring is explicitly enabled, its image may show
participant-entered text. BRSP application frames travel inside WebRTC's
DTLS-protected data channels. The HMAC/VDO bearer key is random, is not derivable
from the public availability handle, and is scrubbed from the URL fragment before
networking. The paired operator browser retains it locally until **Forget
pairing**; possession grants the bounded operator profile, so the private link
must be protected and rotated if exposed. None of this removes signaling,
endpoint, bearer-credential, or operator-side privacy risks.

Do not commit exports, participant names/IDs/responses, pairing links, browser
profiles, headset pulls, logs, captures, credentials, or signing material.
Coupling-kernel mathematics and implementation are outside this public
repository's boundary.

## Validate

```console
npm run check
```

The live private-companion qualification is opt-in because it contacts the
public VDO.Ninja signaling service. It uses separate clean browser contexts for
the WebXR target and a simulated phone, keeps the private descriptor in memory,
disables screenshots/traces/video and failed-run output preservation, proves
fragment scrubbing and BRSP mutual
authentication, checks both peer-bound route/RTT views, closes and re-seeds the
first protocol epoch, then requires a bare companion visit to reconnect from
trusted phone storage:

```powershell
$env:STUDY6_LIVE_VDO_E2E = '1'
npm run test:e2e
```

Without that environment variable, `npm run test:e2e` reports the network test
as skipped. This desktop two-context test does not replace a physical phone,
Quest Browser, direct/TURN, roaming, or endurance qualification.

The route/RTT revision passes the deterministic lifecycle suite. On 2026-08-31,
`npm run qualify:quest-companion` also passed against the real Meta Browser on a
Quest 3 and an isolated desktop Chromium controller at a phone-sized viewport.
BRSP authenticated all nine scopes; both peers observed direct WebRTC at 5–6 ms;
`request_status` and WebXR-owned `recenter_panel` returned accepted receipts;
and a bare companion URL established a second authenticated epoch from saved
controller storage after explicit disconnect/re-seed. The harness consumes an
already established localhost CDP endpoint, retains no pairing/artifact output,
and deliberately leaves Meta Browser running. This proves the physical Quest
Browser target plus desktop controller, not a physical smartphone, forced TURN,
roaming, or endurance.

For a controlled device run, the Quest workflow first owns and records the
localhost CDP forward, then invokes:

```powershell
$env:STUDY6_QUEST_CDP_ENDPOINT = 'http://127.0.0.1:<forwarded-port>'
npm run qualify:quest-companion
```

The harness requires an existing local Study 6 tab and never prints the private
descriptor, opens a new Quest tab, closes Meta Browser, or retains Playwright
artifacts. The owning device workflow must remove its exact CDP forward afterward.

The isolated questionnaire parity surface renders the production UIKit tree
without opening IndexedDB, media, allocation, or export paths:

```text
questionnaire-preview.html?page=sam&state=empty&language=en&mode=pointer
```

`page` is limited to `demographics`, `sam`, `affect`, `emotion`, or `hand`;
`state` is `empty` or `complete`; `language` is `en` or `de`; and `mode` is
`pointer` or `direct`. The route is test-only and in-memory. It exists for
direct native-APK/WebXR surface comparison and is not participant evidence.

Questionnaire geometry, palette, controls, and navigation are regression-bound
to the pinned native Android panel in `src/ui/questionnaire-contract.ts`.
The participant route is pointer-only: it exposes no Direct-mode or panel-drag
control, disables body scrolling on the four assessment pages, and reserves
repositioning for explicit operator recenter plus the native-matching 0.75 m
viewer-drift guard. The parity-preview route alone may opt into Direct mode.

Before an immersive session starts, the runtime requests a 1.25 WebXR
framebuffer scale and 0.25 fixed foveation to improve small-text clarity over
Three.js defaults. The SAM PNGs remain the native-authoritative raster assets:
at their actual panel size they are already approximately 4–7 times
oversampled, while the available UIKit SVG path drops their stroke-only paths.
Passing host tests does not establish visual parity: final acceptance still
requires attended empty/completed page comparisons in Quest Browser against
the exact native APK visual oracle.

On Windows, validate the immutable media manifests and files as well:

```powershell
pwsh -NoProfile -File tools/Test-PublicAssets.ps1
```

The build output is written to `dist/` and is intentionally not committed.
For a production-like local check:

```console
npm run build
npm run preview
```

Browser tests do not replace attended qualification in Quest Browser. Before
any study use, validate both DHS and SHD, both timing paths, controller and
physical hand input, system keyboard behavior, audio playback, reload recovery,
exports, and the companion on the exact deployed revision.

## Hybrid Sensor Bridge implementation

The implemented host-side slice and its exact limitations are documented in
[`docs/HYBRID_IMPLEMENTATION.md`](docs/HYBRID_IMPLEMENTATION.md). The broader
future-study provider boundary and recording-job API are documented in
[`docs/SENSOR_BRIDGE_REUSE.md`](docs/SENSOR_BRIDGE_REUSE.md). The broader
architecture, direct-APK relay options, Tauri/PWA assessment, synchronization
contract, and hardware qualification plan remain in
[`docs/QUEST_WEBXR_BLE_BRIDGE_ARCHITECTURE.md`](docs/QUEST_WEBXR_BLE_BRIDGE_ARCHITECTURE.md).
The current build still has three explicit production gaps:

- the future-`T0` audio/ECG start barrier exists as host-side timing logic but is
  not production-wired into the controller and recorder;
- the experimental relay is not production-wired into WebXR/APK failover; and
- physical Meta Quest + Polar H10 validation, including loopback behavior,
  foreground BLE survival, BRSP phone/PC behavior over direct and forced-TURN
  routes, visual parity, and measured audio/ECG onset, is pending.

## GitHub Pages deployment

The Vite base path is fixed to `/spatial-study-6-webxr/`. The workflow in
`.github/workflows/pages.yml` tests and builds every push to `main`, uploads
only `dist/`, and deploys it with GitHub's official Pages actions. It can also
be run manually.

Every build includes `release-manifest.json` with artifact and bridge-contract
hashes. It is labelled `unsigned_rehearsal` unless the protected Pages
environment supplies an Ed25519 signing key and key ID. A participant release
must additionally pin the native bridge source revision, APK version, and APK
SHA-256 through the documented workflow variables.

For the first deployment, create the public repository with the exact name
`spatial-study-6-webxr`, push `main`, then choose **GitHub Actions** under
**Settings → Pages → Build and deployment → Source**. Do not select a branch
folder; the workflow owns the Pages artifact. Repository forks or renames must
also update `base` in `vite.config.ts`.

## Provenance

The questionnaire geometry, participant copy, and Polar-readiness projection are pinned to
[`MesmerPrism/spatial-study-6`](https://github.com/MesmerPrism/spatial-study-6)
commit `384935890d8ba29a2851002163352019d65768f6` (tree
`3bdba70e545b7b9224c0e8469b49d64b405b24b9`). The admitted audio and SAM raster
bytes remain independently pinned to the earlier `dd41646…` intake in their
machine-readable files under `public/assets/manifests/`; their hashes did not
change as part of the UI-authority update. Those manifests also record every
public media hash and the placeholder-generation parameters.

The public repository contains no real stimulus implementation. See
[`public/assets/README.md`](public/assets/README.md) for the admitted asset set
and limitations.

## License and notices

Original software, guided audio, and generated placeholder media in this
repository are licensed under the
[GNU Affero General Public License v3.0 only](LICENSE), except where a file or
directory carries a different notice. The SAM pictographs are BSD-2-Clause,
and the vendored VDO.Ninja SDK is MPL-2.0. Dependency and asset attributions are
collected in [NOTICE.md](NOTICE.md).

The software is provided without warranty; see the license for details.
