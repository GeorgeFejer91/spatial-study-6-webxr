# Spatial Study 6 WebXR

Spatial Study 6 WebXR is a browser and immersive-WebXR implementation of the
Study 6 operator flow, participant allocation, four-condition sequence, guided
audio, and questionnaires. It is designed for static hosting on GitHub Pages
and runs without an application server.

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
- Quest system text entry for names and manual IDs, plus an in-world age pad;
- English and German operator/participant copy;
- DHS (`PH`) and SHD (`PI`) participant pools, deterministic 24-order
  condition/audio allocation, and local no-reuse selection;
- eight 300-second `Hand`/`Env` × `HC`/`LC` × `HE`/`LE` placeholder videos;
- the exact V01–V04 English/German guided-audio set used by the pinned source;
- four questionnaire rounds covering SAM, affect, emotions, ownership, and
  agency;
- append-only IndexedDB records, immutable export revisions, JSON/CSV export,
  and unfinished-session recovery after reload; and
- an explicitly enabled VDO.Ninja companion that mirrors the spectator canvas
  and can issue only bounded, revision-checked study commands.

The normal timing mode runs each block for five minutes. The clipped mode runs
ten-second blocks for diagnostics only. Both routes remain test-only and
participant-ineligible.

## Run locally

Requirements: Node.js 24.15 or newer and npm.

```console
npm ci
npm run dev
```

Open the local URL printed by Vite. A desktop browser provides the browser
view. A compatible headset browser on an HTTPS origin exposes **Enter VR**.
WebXR immersive sessions generally require a secure context; a plain HTTP LAN
URL is useful for desktop checking but may not be admitted by a headset.

At operator setup:

1. choose English or German;
2. choose DHS or SHD;
3. choose full or clipped timing;
4. select the next unused local ID or enter an allowed manual ID; and
5. enter only synthetic test demographics unless a separately approved study
   protocol explicitly authorizes real participant data.

The app recovers an unfinished session from the same browser profile on reload.
At completion, export both JSON and CSV before clearing browser storage or
moving to a different device/profile.

## Optional companion

Pairing is off by default. In the experiment, select **Browser companion**,
then explicitly enable one-time pairing. Scan or copy the generated fragment
URL into `companion.html`. Remote control is a second opt-in and starts off.

The companion can request status, recenter the panel, start an admissible
block, pause/resume media, or use reducer-admissible back/advance actions. It
cannot enter participant data, answer questionnaires, grant consent, enter VR,
export records, or delete records. The image is the browser's spectator canvas,
not an exact binocular compositor capture, and this application does not
record it.

Treat the pairing link as a short-lived secret. Stop pairing before leaving a
headset unattended.

## Data and privacy boundary

There is no study backend, account system, analytics integration, or automatic
result upload. Study state is stored unencrypted in origin-scoped IndexedDB on
the local browser profile. Anyone with access to that profile or its storage
may be able to read it. Clearing site data, using a different profile, or
resetting the device can permanently remove the registry and sessions.

GitHub Pages still serves the static files and may process ordinary request
metadata under GitHub's own policies. If an operator explicitly enables the
companion, the app contacts VDO.Ninja public signaling and STUN/TURN services.
A direct WebRTC route can disclose peer IP addresses, and the spectator image
may show participant-entered text. Application messages are encrypted with a
one-time AES-GCM key carried in the URL fragment, but that does not remove
signaling, endpoint, or operator-side privacy risks.

Do not commit exports, participant names/IDs/responses, pairing links, browser
profiles, headset pulls, logs, captures, credentials, or signing material.
Coupling-kernel mathematics and implementation are outside this public
repository's boundary.

## Validate

```console
npm run check
```

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

## GitHub Pages deployment

The Vite base path is fixed to `/spatial-study-6-webxr/`. The workflow in
`.github/workflows/pages.yml` tests and builds every push to `main`, uploads
only `dist/`, and deploys it with GitHub's official Pages actions. It can also
be run manually.

For the first deployment, create the public repository with the exact name
`spatial-study-6-webxr`, push `main`, then choose **GitHub Actions** under
**Settings → Pages → Build and deployment → Source**. Do not select a branch
folder; the workflow owns the Pages artifact. Repository forks or renames must
also update `base` in `vite.config.ts`.

## Provenance

The questionnaire, allocation, copy, and audio projection is pinned to
[`MesmerPrism/spatial-study-6`](https://github.com/MesmerPrism/spatial-study-6)
commit `dd41646e02e4a1d73b990626b74048d34ce8f26a` (tree
`0764bcfad349aee20724b3a8fe50c776410fe3d3`), with upstream authority pinned in
the machine-readable files under `public/assets/manifests/`. Those manifests
also record every public media hash and the placeholder-generation parameters.

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
