# Study 6 data-collection parity gate

This document is the acceptance checklist for replacing the original standalone
Study 6 APK with the hybrid WebXR experiment plus Sensor Bridge APK. “Pass” means
the same scientific data objective is preserved; it does not require the two
implementations to use the same UI framework or physical file layout.

Current overall status: **host-qualified, physical Quest/H10 qualification
pending**. Placeholder stimuli and unmeasured audio/ECG onset keep all current
outputs participant-ineligible.

## Objective matrix

| Previous APK objective | Hybrid owner and durable output | Current evidence | Promotion gate |
| --- | --- | --- | --- |
| DHS/SHD selection and the frozen 24 four-condition permutations | WebXR reducer and IndexedDB revisions | Unit-tested exact four-block allocation | Run PH/PI synthetic IDs through all four blocks on Quest |
| Participant allocation, repeat data sets, and incomplete-block recovery | WebXR IndexedDB session/reservation/revision stores | Host recovery and ownership tests | Force-stop/reload at each protected boundary |
| Demographics, consent, language, handedness, and gender | WebXR state revisions and browser JSON export | Schema/range/ownership tests | Enter EN and DE data using the in-panel XR keyboard |
| Four questionnaire rounds per condition: SAM, affect VAS, six emotion VAS items, ownership, and agency | WebXR response record plus immutable owning state revision | Reducer, completeness, back-edge, gesture, and parity tests | Complete all fields by ray and direct hand input without clipping or focus loss |
| Stable native-like participant panel | WebXR UIKit world-space panel | Geometry/gesture tests; same-revision Polar updates no longer rebuild the page | Confirm no flicker, root drag, keyboard crash, or wrong-target activation on Quest |
| Live Polar readiness before a block | Native H10/PMD client; bounded status/waveform to WebXR | Native readiness tests and strict WebXR preflight | Worn H10: 130 Hz, fresh increasing real samples for at least 3 s |
| Raw ECG for each experimental condition | APK condition-window writer and sensor export | Recorder tests reject pre-block, questionnaire, between-block, and post-final samples | Inspect only counters/headers on-device; four labeled windows and zero drops |
| Correct ECG ownership and labels | Every ECG row includes recording window, session, block order, condition, and media; marker journal shares marker/session identity | Cross-language v2 contract and exact-label tests | Verify B1–B4 tuples against the browser’s allocated plan |
| HR/RR and acquisition state at block boundaries | Browser `sensor_marker_observed` audit events contain bounded HR, latest RR interval, count/rate/freshness, reconnect/gap, and recorder counters; no waveform/raw ECG | Typed projection and controller tests | Observe non-null HR/RR on a worn-H10 start/end pair |
| Media start/end and pause/resume observations | Browser study events plus APK marker journal | Durable marker ordering tests | Compare both artifacts for one marker ID and monotonic timestamps |
| No questionnaire until condition ECG is durably closed | WebXR controller requires APK `media_ended` persistence, queue drain, and fsync before `complete_stimulus` | Fail-closed controller and native barrier tests | Force bridge loss at block end; questionnaire must remain locked/held |
| Durable terminal close and export | Browser JSON/CSV export; separate APK ECG/marker export after finalization | Host persistence/finalize tests | Read back hashes and counts after a four-block clipped run, then repeat with a new session |
| Remote researcher operation and monitoring | Discovery-only public availability plus private persisted BRSP target/controller; WebXR remains mutation authority | Bearer isolation, scope, revision, reconnect, dedupe, revocation, and status tests | Pair once, reconnect from a bare phone visit, rotate/revoke, then run the complete clipped study while the Quest stays immersive |
| Raw-data privacy boundary | Raw ECG remains app-private; companion status omits raw samples, answers, demographics, and participant identity | Contract/UI tests | Network inspection during a complete remote run |

## Deliberate storage-policy change

The original native implementation kept a session-continuous master while its
per-block files contained active-window samples. The hybrid bridge keeps the H10
connection and real-sample preview continuous but admits raw rows to disk only
inside conditions. This is the requested lower-junk policy. It preserves the
scientific per-condition sample set and strengthens row-level ownership because
every row repeats its exact WebXR tuple.

The condition opens only after a durable `block_start_intent` and closes on
`media_ended`, `technical_hold`, `session_aborted`, `session_finalized`, browser
owner loss, or recorder finalization. Close is an ordering barrier: sample
admission stops first, all admitted batches drain, the file is flushed and
fsynced, and only then may WebXR expose the questionnaire.

## Known non-parity and evidence limits

- The production controller does not yet execute the future-monotonic `T0`
  prepare/commit barrier. Marker correlation is implemented, but exact physical
  audio-to-ECG onset accuracy is not yet proven.
- The deployed media are placeholders. Their recordings cannot be promoted to
  participant/scientific evidence.
- Host tests cannot establish Quest compositor sharpness, Meta Browser thermal
  stability, BLE background survival, or a worn-H10 sample stream.
- A browser export and sensor export are deliberately separate. A qualification
  run must prove their session/marker/condition joins and final hashes.

## Required final qualification

1. Build the exact WebXR assets and APK from the reviewed source and record both
   hashes.
2. Install on the reserved Quest, connect a worn H10, and launch WebXR only from
   the APK’s tokenized button.
3. Use a clearly synthetic manual participant code and clipped timing.
4. Complete four conditions and all questionnaires from a PC/phone companion,
   while confirming the headset remains immersive and responsive.
5. Confirm four unique condition windows, 130 Hz rows only inside those windows,
   exact labels, zero dropped batches, durable finalization, and correlated
   browser sensor-observation events.
6. Force one browser/bridge interruption and one reload; require fail-closed
   condition recording and whole-incomplete-block recovery.
7. Inspect bounded fatal/ANR/renderer evidence, stop the package, and leave raw
   ECG and participant data uncommitted.
