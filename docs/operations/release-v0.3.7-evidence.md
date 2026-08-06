# v0.3.7 historical release evidence

This file records the live GitHub state observed on 2026-08-06. It is historical evidence for the v0.3.7 candidate and is not a promotion claim for the current `main` branch.

## Immutable identity

- Repository: `enzohuang98-crypto/Reckoning`
- Release: [v0.3.7](https://github.com/enzohuang98-crypto/Reckoning/releases/tag/v0.3.7)
- Annotated tag object: `f7efc67da97f3f4fc77bfc89625f8cb902d53cf6`
- Product commit referenced by the tag: `e6cce2f7e0a045b080f40c4e4454cc0d32335ab8`
- Current `main` observed separately: `81bee70dd1eaf53014fa8ffd736195f5eae98855`
- Installer: `xiangqi-analyzer-0.3.7-setup.exe`
- Installer size: `169646390` bytes
- Installer SHA-256: `1277f5a3da64519178d38ec6bec09cf8fc7bbeb44cd4562ca4f466ff32ee8c21`
- Release state: published, non-draft, prerelease; intentionally unsigned

## Workflow evidence

- Run: [30426166887](https://github.com/enzohuang98-crypto/Reckoning/actions/runs/30426166887)
- Event: `workflow_dispatch`
- Run head: `81bee70dd1eaf53014fa8ffd736195f5eae98855`
- Build, tests, dependency audit, unsigned package, exact-byte install/uninstall smoke, and Windows Server 2022/2025 proxy jobs completed successfully.
- The clean Windows 10 22H2 / Windows 11 client-evidence job was still `waiting` when recorded. Server proxy success is not Windows 10/11 client evidence.
- The waiting job is intentionally not a valid route for promoting v0.3.7 or any future unsigned candidate to Latest.

## Interpretation

The artifact bytes and tag remain preserved as a historical unsigned prerelease. This record does not establish trusted Authenticode provenance, clean-client evidence, professional xiangqi correctness, or teacher-pilot completion. The teacher-test candidate must use a new version and a new immutable artifact identity.
