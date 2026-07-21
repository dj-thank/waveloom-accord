# Character asset SSOT

`shared/data/character_assets.js` is the authoritative runtime descriptor for
the admitted third-person articulated base. The renderer must not duplicate its
URL, byte count, SHA-256, MIME type, size ceiling, animation mapping, authors,
source, or license.

The descriptor is deliberately separate from generated
`shared/data/hero_assets.js`: that generated manifest owns 2D hero concepts,
ability atlases, and audio, while the character descriptor owns static 3D
runtime assets.

Admission is fail-closed:

- the filename contains the first 12 hexadecimal characters of the full hash;
- browser bytes are verified before `GLTFLoader` receives an object URL;
- the actual GLB byte count and SHA-256 must match the descriptor;
- every animation-state alias must name a clip present in the admitted GLB;
- source, authors, CC0 license, and a bundled license sidecar are mandatory.

Run `npm run assets:verify` before packaging. The source candidate includes the
descriptor, GLB, license sidecar, tests, and third-party notice through the
explicit `shared/`, `client/`, `tests/`, and root-file allowlists.

The current asset is a shared articulated base. It does not claim that all 18
heroes have individually sculpted production meshes; hero identity is retained
through the existing project-authored silhouette, color, and accessory layer.
