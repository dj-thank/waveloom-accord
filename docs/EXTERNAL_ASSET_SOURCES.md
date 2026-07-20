# External model and material sources

The map pipeline can use downloadable assets from international model sites,
but a download is not automatically a shippable game asset. Each candidate is
admitted through `ASSET_LICENSES.md`, kept decorative by default, and receives
gameplay collision only through the shared map blueprint.

## Preferred sources

| Source | Good fit | License gate | Current use |
|---|---|---|---|
| [Poly Haven](https://polyhaven.com/) | PBR materials, HDRIs, environment models | Provider assets are CC0; capture the exact asset page and file hash | Concrete floor and wall PBR are bundled |
| [Kenney](https://kenney.nl/assets) | Modular environment kits and UI/game assets | Prefer asset pages marked CC0; retain the downloaded archive and license text | Modular Dungeon Kit evaluated, not bundled |
| [Quaternius](https://quaternius.com/) | Modular streets, buildings, sci-fi and stylized worlds | Admit only packs whose source page and included license are verified | Approved discovery source; no runtime pack bundled yet |
| [Sketchfab](https://sketchfab.com/) | Author-published models with per-item licenses | Accept CC0 or attributable CC BY only; reject unknown, NC, ND, Editorial, or model-page-only claims | User-provided mine is retained as CC BY decorative reference |

## Download and admission workflow

1. Capture the exact source page, author, advertised license, archive bytes,
   download date, and SHA-256 before conversion.
2. Reject assets whose redistribution or commercial-use rights are unclear.
3. Inspect the model visually and scan its archive before importing it into the
   repository.
4. Record every texture conversion, mesh simplification, LOD, or compression
   step and hash the shipped bytes.
5. Import the asset as `collision:false`. Author competitive collision in the
   blueprint, then run map, route, spawn, browser, and license tests.

The current release intentionally does not contain an arbitrary URL downloader.
Fetching untrusted third-party archives on a game server would expand the attack
surface and make release provenance non-reproducible. Downloads are a controlled
build-time workflow.
