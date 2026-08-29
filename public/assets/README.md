# Public Study 6 WebXR assets

This directory contains only the media admitted for the public, test-only
WebXR implementation:

- `audio/`: the exact eight 300-second V01-V04 English/German guided tracks;
- `sam/`: the 18 PNGs loaded by the current questionnaire plus the
  BSD-2-Clause notice;
- `video/`: eight generated, silent, 300-second condition placeholders; and
- `manifests/`: immutable source identities, hashes, media metadata, mapping,
  and license classifications.

The placeholder media IDs combine the source visualization role and condition:

| Media prefix | Source variant | Meaning |
| --- | --- | --- |
| `Hand` | `DHS` | dynamic hands / static environment target |
| `Env` | `SHD` | static hands / dynamic environment target |

Each prefix is paired with `HC_HE`, `LC_HE`, `HC_LE`, and `LC_LE`. `HC`/`LC`
mean high/low coherence; `HE`/`LE` mean high/low energy. These videos contain
no stimulus content and cannot support participant or scientific claims.

The audio variant is assigned by the frozen participant permutation and block
ordinal. It is not encoded in the visual media ID.

For SAM dominance, preserve current-APK behavior: render
`sam/valence/valence_05.png` at the nine scale factors in
`manifests/sam-assets.v1.json`. Do not substitute the unused dominance PNG set.

Regenerate and verify the placeholders with FFmpeg:

```powershell
pwsh -NoProfile -File tools/Generate-PlaceholderVideos.ps1 -Force
pwsh -NoProfile -File tools/Test-PublicAssets.ps1
```

No participant data, participant registry, private lookup table, headset pull,
credential, signing material, or coupling-kernel content belongs here.
