# v0.3.9 live teacher-candidate evidence

This file records the public GitHub state observed on 2026-08-06 after the v0.3.9 `teacher-candidate` workflow completed. It is candidate evidence only; it is not a formal signing, Latest-promotion, teacher-review, or clean Windows 10/11 client-evidence claim.

## Source and workflow identity

- Repository: `enzohuang98-crypto/Reckoning`
- Release: [v0.3.9](https://github.com/enzohuang98-crypto/Reckoning/releases/tag/v0.3.9)
- Annotated tag object: `6172332bd8433aedc6f5ce59223a07271fb35dae`
- Peeled product/source commit: `5514b3ecfc63481a3942a277605d9114f1b54308`
- Workflow definition commit: `5514b3ecfc63481a3942a277605d9114f1b54308` (`.github/workflows/release.yml`); the dispatched run's `head_sha` matches this commit.
- Release workflow run: [31105552449](https://github.com/enzohuang98-crypto/Reckoning/actions/runs/31105552449)
- Workflow mode: `teacher-candidate`
- Published at: `2026-08-06T13:25:53Z`
- Release state: published, non-draft, prerelease; `make_latest` is null. The GitHub `latest` endpoint remains v0.3.6.
- Behavior fix carried by this candidate: teacher-test exports with a run manifest now include only traces and regression cases whose evaluation link has the same `testRunId`.

## Artifact identity

| Asset | Size | GitHub asset SHA-256 |
| --- | ---: | --- |
| `xiangqi-analyzer-0.3.9-setup.exe` | 164630467 | `f29e5687437a54ea43a7f7fa75503e85a752aa64ae37ec6e0b9c9fb8c69df8b8` |
| `xiangqi-analyzer-0.3.9-setup.exe.blockmap` | 172585 | `c64a09b75aa623b2799bca412615099e7e2c7d047cca45f805956e629f12fcf7` |
| `latest.yml` | 361 | `2b903a8b52d5505de56930be384c5d55e27196c4943a18a74d7ec23f657e8346` |
| `SHA256SUMS.txt` | 100 | `5ed696f00cab0c54436932527f1afdd9d351ff990d83bb859028f3f12ea9d044` |

The public `SHA256SUMS.txt` content was read back and matched the setup executable hash. The public setup URL was independently streamed without saving the file locally; the observed byte count was `164630467` and the observed SHA-256 was `f29e5687437a54ea43a7f7fa75503e85a752aa64ae37ec6e0b9c9fb8c69df8b8`.

The public `latest.yml` was read back and reported version `0.3.9`, setup size `164630467`, and the electron-builder SHA-512 value for `xiangqi-analyzer-0.3.9-setup.exe`.

## Workflow jobs

- `Build teacher-candidate Windows x64 artifact once`: success, job `92629627925`.
- `Publish teacher-candidate candidate`: success, job `92630607864`.
- Windows Server 2025 compatibility proxy: success, job `92630751257`.
- Windows Server 2022 compatibility proxy: success, job `92630751288`.
- `Require clean Windows 10 22H2 and Windows 11 client evidence`: skipped because the selected mode was `teacher-candidate`, job `92631033394`.
- `Promote validated candidate to latest`: skipped because the selected mode was `teacher-candidate`, job `92631033727`.

The build job completed typecheck, full test, dependency audit, explicit unsigned packaging, candidate metadata/SHA-256 verification, and exact unsigned install/uninstall smoke. Server proxy jobs are compatibility checks only.

## Interpretation

This is a reproducible public unsigned teacher-test candidate tied to one annotated tag, one merged source commit, one workflow run, and one exact installer SHA-256. It intentionally has no trusted Authenticode publisher or timestamp and may trigger Windows SmartScreen. No teacher score, second-machine result, temporary API-key residue check, Windows 10/11 consumer-client evidence, or Latest promotion is implied by this file.

The current six frozen cases remain an engineering fixture baseline; three teacher-provided or teacher-confirmed cases are still required before the formal pilot run. See [teacher-test-protocol-v1.md](teacher-test-protocol-v1.md) for the pending rule and external rubric.
