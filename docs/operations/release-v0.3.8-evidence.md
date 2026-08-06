# v0.3.8 live teacher-candidate evidence

This file records the public GitHub state observed on 2026-08-06 after the v0.3.8 `teacher-candidate` workflow completed. It is candidate evidence only; it is not a formal signing, Latest-promotion, teacher-review, or clean Windows 10/11 client-evidence claim.

## Source and workflow identity

- Repository: `enzohuang98-crypto/Reckoning`
- Release: [v0.3.8](https://github.com/enzohuang98-crypto/Reckoning/releases/tag/v0.3.8)
- Annotated tag object: `4e25c45857e9c9febb24305fe72691f9d7ed0cd9`
- Peeled product/source commit: `f4eceb293780c3974189ada2a5ada2767cb02520`
- Release workflow run: [31102841850](https://github.com/enzohuang98-crypto/Reckoning/actions/runs/31102841850)
- Workflow mode: `teacher-candidate`
- Published at: `2026-08-06T12:50:21Z`
- Release state: published, non-draft, prerelease; `make_latest` is null. The GitHub `latest` endpoint remains v0.3.6.

## Artifact identity

| Asset | Size | GitHub asset SHA-256 |
| --- | ---: | --- |
| `xiangqi-analyzer-0.3.8-setup.exe` | 164630417 | `e3e9fd0b727e614ed911ff5dbabc5b8df843de2cbdba3566af8e0cae9127d94c` |
| `xiangqi-analyzer-0.3.8-setup.exe.blockmap` | 172631 | `18a75dc8c32149e14b235114cce549acadf68e67234a8075767042f6057eb60c` |
| `latest.yml` | 361 | `6f4cdfbb42a567ccb93d931d1ccd5f48442a2c9d2728f162e01f76fe53691968` |
| `SHA256SUMS.txt` | 100 | `4575f0375cead45dc152feacbcffce77148089b3072cf3dad2ea6e9eca1583fa` |

The public `SHA256SUMS.txt` content was read back and matched the setup executable hash. The public setup URL was independently streamed without saving the file locally; the observed byte count was `164630417` and the observed SHA-256 was `e3e9fd0b727e614ed911ff5dbabc5b8df843de2cbdba3566af8e0cae9127d94c`.

## Workflow jobs

- `Build teacher-candidate Windows x64 artifact once`: success, job `92620453582`.
- `Publish teacher-candidate candidate`: success, job `92621379292`.
- Windows Server 2025 compatibility proxy: success, job `92621471247`.
- Windows Server 2022 compatibility proxy: success, job `92621471414`.
- `Require clean Windows 10 22H2 and Windows 11 client evidence`: skipped because the selected mode was `teacher-candidate`, job `92621658607`.
- `Promote validated candidate to latest`: skipped because the selected mode was `teacher-candidate`, job `92621658385`.

The build job also completed typecheck, full test, dependency audit, explicit unsigned packaging, candidate metadata/SHA-256 verification, and exact unsigned install/uninstall smoke. Server proxy jobs are compatibility checks only.

## Interpretation

This is a reproducible public unsigned teacher-test candidate tied to one annotated tag, one merged source commit, one workflow run, and one exact installer SHA-256. It intentionally has no trusted Authenticode publisher or timestamp and may trigger Windows SmartScreen. No teacher score, second-machine result, temporary API-key residue check, Windows 10/11 consumer-client evidence, or Latest promotion is implied by this file.
