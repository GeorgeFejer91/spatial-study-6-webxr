# Spatial Study 6 WebXR — notices and attribution

This file identifies material that is not originally authored as part of
Spatial Study 6 WebXR. It is informational and does not replace or alter any
license. Exact dependency versions are locked by `package-lock.json`.

## Study assets

### Self-Assessment Manikin pictographs

The 18 SAM valence/arousal PNGs in `public/assets/sam/` are distributed under
the BSD 2-Clause License.

Copyright (c) 2019, Thomas Röggla, Distributed & Interactive Systems.

The complete notice is retained at
`public/assets/sam/LICENSE-BSD-2-Clause.txt`. Source identity, selection, and
per-file SHA-256 values are in
`public/assets/manifests/sam-assets.v1.json`.

### Guided audio and placeholder videos

The eight V01–V04 English/German guided tracks are pinned to
`MesmerPrism/spatial-study-6` commit
`dd41646e02e4a1d73b990626b74048d34ce8f26a` (tree
`0764bcfad349aee20724b3a8fe50c776410fe3d3`) and are classified
`AGPL-3.0-only` for this public project. Their source paths, hashes, codec
metadata, and upstream authority are recorded in
`public/assets/manifests/audio-assets.v1.json`.

The eight silent condition-label videos are generated placeholder content,
also `AGPL-3.0-only`. They contain no stimulus. Their generation recipe,
classification, and hashes are recorded in
`public/assets/manifests/placeholder-videos.generated.json`.

The authoritative asset licensing index is
`public/assets/manifests/asset-licenses.v1.json`.

## Vendored VDO.Ninja SDK

`public/vendor/vdoninja/1.5.5/vdoninja-sdk.js` is an unmodified copy of the
official VDO.Ninja SDK v1.5.5 from
<https://github.com/steveseguin/ninjasdk>. It is distributed under the Mozilla
Public License 2.0. Its complete license and pinned SHA-256 are retained in:

- `public/vendor/vdoninja/1.5.5/LICENSE-MPL-2.0.txt`
- `public/vendor/vdoninja/1.5.5/NOTICE.md`

The independently written TypeScript adapter under `src/companion/` is part of
the AGPL-3.0-only application, not the vendored SDK.

## Runtime packages

The production dependency graph includes the following directly selected
packages. Transitive versions remain recorded in `package-lock.json`.

| Package | Version | License | Copyright / attribution |
| --- | ---: | --- | --- |
| [three](https://github.com/mrdoob/three.js) | 0.185.1 | MIT | Copyright © 2010–2026 three.js authors |
| [@pmndrs/uikit](https://github.com/pmndrs/uikit) | 1.0.75 | MIT | Copyright 2024 Bela Bohlender; Copyright 2023 Coconut Capital |
| [@iwsdk/xr-input](https://github.com/facebook/immersive-web-sdk) | 0.5.3 | MIT | Copyright Meta Platforms, Inc. and affiliates |
| [@pmndrs/pointer-events](https://github.com/pmndrs/xr) | 6.6.30 | MIT | Copyright 2024 Bela Bohlender; Copyright 2023 Coconut Capital |
| [idb](https://github.com/jakearchibald/idb) | 8.0.3 | ISC | Copyright (c) 2016 Jake Archibald |
| [qrcode](https://github.com/soldair/node-qrcode) | 1.5.4 | MIT | Copyright (c) 2012 Ryan Day |
| [zod](https://github.com/colinhacks/zod) | 4.5.4 | MIT | Copyright (c) 2025 Colin McDonnell |

The UI/runtime graph also includes `@pmndrs/msdfonts`,
`@pmndrs/uikit-pub-sub`, `@preact/signals-core`,
`@zappar/msdf-generator`, `comlink`, and `yoga-layout`. The QR encoder's npm
graph includes `dijkstrajs`, `pngjs`, and command-line-only support packages.
Their exact versions, upstream package metadata, and declared licenses are
available from the lockfile and installed package manifests.

`@pmndrs/msdfonts` redistributes Google Fonts in MSDF form, including Roboto
under Apache-2.0 and additional fonts under their respective bundled notices.
Downstream redistributors should preserve that package's full `LICENSE` when
changing or directly repackaging its font set.

### MIT License text

The following terms apply to the MIT-licensed packages identified above, with
the corresponding copyright notice(s) for each package:

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the “Software”), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

### ISC License text for idb

Copyright (c) 2016, Jake Archibald <jaffathecake@gmail.com>

> Permission to use, copy, modify, and/or distribute this software for any
> purpose with or without fee is hereby granted, provided that the above
> copyright notice and this permission notice appear in all copies.
>
> THE SOFTWARE IS PROVIDED “AS IS” AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
> REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
> AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
> INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
> LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
> OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
> PERFORMANCE OF THIS SOFTWARE.

## Privacy-related service attribution

GitHub Pages serves the static site. VDO.Ninja public signaling and STUN/TURN
services are contacted only after an operator explicitly enables companion
pairing. These services are operational dependencies, not recipients of study
exports. Their own terms and privacy practices apply independently.
