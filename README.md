# Spatial Study 6 WebXR

Spatial Study 6 WebXR is the experiment authority in a hybrid Quest
application. It owns the questionnaire and condition logic, progression, study
reducer, browser IndexedDB record, and study JSON/CSV exports. A separate native
Sensor Bridge APK is only a sensor-recorder provider: it owns Polar H10
Bluetooth, continuous ECG writing, timestamped metadata markers, recorder
finalization, and the sensor artifact export. The browser assets remain
statically hosted on GitHub Pages; the page talks to the APK through an
authenticated loopback WebSocket.

> **Incubator / test-only build.** This site is participant-ineligible and is
> not a production study or a replacement for an approved native build. Its
> eight videos are labeled placeholders, not experimental stimuli. Do not use
> outputs as participant or scientific evidence.

The intended public endpoints are:

- experiment: <https://georgefejer91.github.io/spatial-study-6-webxr/>
- optional operator companion:
  <https://georgefejer91.github.io/spatial-study-6-webxr/companion.html>

## What is implemented

- browser and immersive-VR views of the same dark-world, light-panel UI;
- controller, hand/pinch, mouse, and touch pointer interaction;
- Quest system text entry for names, age, and manual IDs;
- English and German operator/participant copy;
- DHS (`PH`) and SHD (`PI`) participant pools and deterministic 24-order
  condition/audio allocation;
- eight 300-second `Hand`/`Env` × `HC`/`LC` × `HE`/`LE` placeholder videos;
- the exact V01–V04 English/German guided-audio set used by the pinned source;
- four questionnaire rounds covering SAM, affect, emotions, ownership, and
  agency;
- a strict sensor-recorder `study6.bridge.v1` client with
  process/page/transport epochs, recording-revision fencing, staged effect
  receipts, and native golden fixtures;
- a live, bounded Polar quality status/waveform populated only by real APK samples;
- a WebXR-authoritative questionnaire/condition reducer with browser IndexedDB
  recovery and study JSON/CSV exports;
- privacy-minimized experiment markers sent to the APK so its ECG artifact can
  be correlated with WebXR events without transferring questionnaire answers;
- explicit APK sensor reconnect, recorder finalize, and sensor-export requests;
- decoded Web Audio and clock/barrier libraries ready for later hardware timing
  integration; and
- an explicitly enabled, data-only VDO.Ninja companion that issues only
  WebRTC/DTLS-protected, bounded, revision-checked study commands to WebXR,
  with optional spectator monitoring kept off by default.

The normal timing mode runs each block for five minutes. The clipped mode runs
ten-second blocks for diagnostics only. Both routes remain test-only and
participant-ineligible.

## Run locally

Requirements: Node.js 24.15 or newer and npm.

```console
npm ci
npm run dev
```

Open the local URL printed by Vite. WebXR owns study state in every mode. Polar
H10 and durable-writer readiness are advisory quality evidence: missing evidence
marks the run quality-ineligible but never disables Start or questionnaire/data
collection. For isolated questionnaire/UI work, use:

```text
?sensor=disabled-rehearsal
```

That explicit route runs without the APK bridge and remains participant-ineligible.
It uses the same origin-scoped browser study store as hybrid mode.
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
sensor artifact.

## Optional companion

Pairing is off by default. In the experiment, select **Browser companion**,
then explicitly enable a pairing session. Scan or copy the generated fragment
URL into `companion.html`. Remote control is a second opt-in and starts off.
The session link can reconnect one controller at a time until pairing is stopped
on the headset; starting a new pairing session creates a new descriptor.

The companion uses BRSP/1 over two dedicated data-only WebRTC channels: reliable
ordered commands/receipts and unordered latest-state telemetry. The peers prove
the random 256-bit session secret mutually, negotiate narrow scopes, and fence
commands with the authoritative WebXR revision. It can request status, recenter
the panel, start an admissible block, pause/resume media, navigate, request
sensor reconnect/return, and explicitly confirm a WebXR-owned abort or an APK
recorder finalize/sensor-export request.
It cannot enter participant data, answer questionnaires, grant consent, enter
VR, receive an export, or delete records. Today it routes through the active
WebXR page; the experimental relay is not production-wired, and direct APK
control during a browser failure is not implemented. Read-only pairing grants
only `study.status.read`; mutation scopes must be enabled before pairing starts.
Optional spectator monitoring is a separate plane and is off by default.

Only one BRSP controller is admitted per pairing session. Treat the pairing link
as a short-lived secret and stop pairing before leaving a headset unattended.

Companion status is privacy-minimized, not anonymous. It includes language,
whether a participant and immersive session are active, phase, block and
condition code, media timing/paused state, live heart rate, ECG sample
rate/count/age, and APK/recorder health counters. It excludes participant
names/IDs, demographics, questionnaire answers, and raw ECG samples. Records
and prepared sensor exports never traverse the companion channel.

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
metadata under GitHub's own policies. If an operator explicitly enables the
companion, the app contacts VDO.Ninja public signaling and STUN/TURN services.
A direct WebRTC route can disclose peer IP addresses. If optional spectator
monitoring is explicitly enabled, its image may show participant-entered text.
BRSP application frames travel inside
WebRTC's DTLS-protected data channels; the fragment secret is used for mutual
HMAC proof and VDO.Ninja session protection, not as a separate one-time AES-GCM
application-message wrapper. This does not remove signaling, endpoint, or
operator-side privacy risks.

Do not commit exports, participant names/IDs/responses, pairing links, browser
profiles, headset pulls, logs, captures, credentials, or signing material.
Coupling-kernel mathematics and implementation are outside this public
repository's boundary.

## Validate

```console
npm run check
```

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
