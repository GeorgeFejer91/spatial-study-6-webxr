# Study 6 bridge contract

`study6-bridge-v2.schema.json` and the fixture envelopes in `fixtures/` are
byte-for-byte vendored from the private native sensor-provider module:

```text
MesmerPrism/spatial-study-6
src/spatial-hand-lab-android/bridge-contract/
```

The native module owns generation of these files. The WebXR tests parse every
native fixture with the TypeScript decoder so a payload-shape change cannot be
released here without an explicit synchronized update. The release manifest
hashes the vendored schema and fixtures. Do not hand-edit one repository's copy
without updating and validating the other.

Protocol v2 is intentionally a placeholder-rehearsal contract. It binds the
browser launch, opens one recording owned by the durably allocated WebXR
session, and carries a bounded Polar/recording projection plus privacy-minimized
experiment markers. It never carries questionnaire state, participant details,
answers, raw ECG, or exported records. WebXR—not the APK—owns all questionnaire
and condition logic.
