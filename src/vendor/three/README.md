# three.js, vendored

Reader: whoever updates or checks the 3D renderer that the page carries inlined.

- **Version**: three.js r185, npm package `three` 0.185.1.
- **Source**: the npm package `three` 0.185.1 (`npm pack three@0.185.1`), its files `build/three.core.min.js`, `build/three.module.min.js` and `LICENSE`.
- **Unmodified**: the three files here are byte for byte those of the package. The page's build (`build.mjs`, `vendorScript`) inlines them as one classic script, `<script id="lt-vendor-three">`, with the full licence text on top; its only change is mechanical: the core's export list becomes an object, the module's import from the core a destructuring of it, and the module's exports `globalThis.THREE`, a frozen namespace with every export of both files.
- **Checksums** (sha256; `build.mjs` refuses to build and `test/vendor.test.mjs` fails if a file differs):

| File | sha256 |
|---|---|
| three.core.min.js | `05b2609338c76cd65daf74f3ac515bc9a5045e1b3b33edc07d8c9bd55250fa90` |
| three.module.min.js | `86bcee248b64f44bcfc23c331ae74619061957d59cab040171dcb6fb5900beb6` |
| LICENSE | `8b378ebe60e2fe500158cb0ac71cb5e8b7d92953c2abcc63a0eb90499653b5bc` |

- **In Node** (tests): `import * as THREE from '../src/vendor/three/three.module.min.js'`.
- **To update**: replace the three files from the new package, put their sha256 here and in `build.mjs`, run `node build.mjs` and `npm test`.
