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
- public operator companion:
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
- a strict sensor-recorder `study6.bridge.v2` client with launch binding,
  session-owned `begin_recording`,
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
- an automatic public browser-to-browser beacon: a bare `companion.html` visit
  discovers an online WebXR target, derives its data-only BRSP/VDO descriptor,
  and requests the full bounded, revision-checked Study 6 operator profile;
  optional spectator monitoring remains a separate plane and is off by default.

The normal timing mode runs each block for five minutes. The clipped mode runs
ten-second blocks for diagnostics only. Both routes remain test-only and
participant-ineligible.

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

## Browser companion public prototype

The current prototype is zero-click and browser-to-browser. While the experiment
page is open, WebXR automatically starts a passwordless public availability
announcement and its data-only BRSP target without opening a dialog or changing
focus. Open the bare public [`companion.html`](https://georgefejer91.github.io/spatial-study-6-webxr/companion.html)
URL on a phone or computer. It listens for Study 6 announcements, sorts the
opaque target handles, selects the first one deterministically, derives the same
BRSP/VDO descriptor, and connects and retries automatically. No QR scan, copied
link, or headset confirmation is required for this browser pairing, and the APK
does not participate in it. If discovery is unavailable, the headset's **Browser
companion** dialog still exposes a direct QR/link, and the companion retains a
manual link/code input as a fallback.

The public descriptor is reproducible by design. The target persists a random
seed, publishes only a truncated SHA-256-derived opaque beacon handle, and both
browsers use domain-separated SHA-256 derivations of that handle for the BRSP
key and separate VDO room/stream names. Consequently, this phase intentionally
has **no operator identity or access control**: any visitor who can see the public
beacon can derive the same descriptor and request control. BRSP mutual transcript
proof still detects a peer that does not possess that descriptor, but it does
not identify or authorize a person in this open mode. Use **Pause automatic
pairing** to stop both browser planes or **Rotate public identity** to replace the
advertised handle. Identity, approval, and policy controls are deferred.

The target admits one BRSP controller at a time and automatically offers all nine
defined Study 6 scopes. Those scopes remain bounded by the typed command allowlist,
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
If the WebXR page closes, remote control ends even though the APK may continue
recording; the experimental relay and independent controller-to-APK path are not
production-wired.

Companion status is privacy-minimized, not anonymous. It includes the selected
variant/language/timing, expected participant-code prefix, completed-block count,
whether a participant and immersive session are active, phase, block and
condition code, media timing/paused state, live heart rate, ECG sample
rate/count/age, and APK/recorder health counters. It excludes participant codes,
names, demographics, questionnaire answers, and raw ECG samples. Records and
prepared sensor exports never traverse the companion channel.

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
DTLS-protected data channels. In public mode, the HMAC/VDO key is deterministically
derived from the advertised opaque handle and therefore provides protocol
transcript integrity, not operator identity or access control. A manually
supplied private descriptor remains available as a fallback and is scrubbed from
the URL fragment before networking. None of this removes signaling, endpoint, or
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
