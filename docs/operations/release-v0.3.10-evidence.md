# v0.3.10 live teacher-candidate evidence

This file records the public GitHub state observed on 2026-08-06 after the v0.3.10 `teacher-candidate` workflow completed. It is candidate evidence only; it is not a formal signing, Latest-promotion, teacher-review, second-machine, temporary-key, or clean Windows 10/11 client-evidence claim.

## Immutable identity

- Repository: [enzohuang98-crypto/Reckoning](https://github.com/enzohuang98-crypto/Reckoning)
- Release: [v0.3.10](https://github.com/enzohuang98-crypto/Reckoning/releases/tag/v0.3.10)
- Release name: `象棋 AI 分析講解 v0.3.10（未簽章 teacher-test candidate）`
- Release state: public, non-draft, prerelease; the stable release list still has v0.3.6 as the latest non-prerelease release.
- Annotated tag object: `6b3144c84bc4e8459462b83c8453630cff03c83e`
- Peeled tag/product source commit: `fd43bdad500418570d8dc3f7f0bdbb7794c1ed46`
- Tag target verification: the tag object names `fd43bdad500418570d8dc3f7f0bdbb7794c1ed46`; the workflow head SHA is the same commit.
- Release workflow run: [31108379560](https://github.com/enzohuang98-crypto/Reckoning/actions/runs/31108379560)
- Workflow event/mode: `workflow_dispatch`, `teacher-candidate`
- Release published: `2026-08-06T14:01:44Z`

## Workflow jobs

| Job | Result | Evidence |
| --- | --- | --- |
| Build teacher-candidate Windows x64 artifact once | success | job `92639388515` |
| Publish teacher-candidate candidate | success | job `92640310192` |
| Windows Server 2022 compatibility proxy | success | job `92640751229` |
| Windows Server 2025 compatibility proxy | success | job `92640751905` |
| Require clean Windows 10 22H2 and Windows 11 client evidence | skipped | job `92641024435`; candidate mode intentionally does not assert this gate |
| Promote validated candidate to latest | skipped | job `92641025068`; unsigned teacher candidates cannot be promoted |

The successful build path includes the repository's Windows typecheck/test/audit/build, explicit unsigned packaging, candidate metadata/SHA-256 verification, and unsigned install/uninstall smoke. The Server jobs are compatibility proxies only and are not consumer-client evidence.

## Public assets and independent byte verification

GitHub's public Release asset metadata and an independent HTTPS stream check agree:

| Asset | Public size | GitHub digest | Independent check |
| --- | ---: | --- | --- |
| `xiangqi-analyzer-0.3.10-setup.exe` | `164630893` bytes | `sha256:6facf8bca3a202fe4d668da3235b0b90b006d96f0cfc6ecd04c61ac0113c0aa7` | SHA-256 stream hash `6facf8bca3a202fe4d668da3235b0b90b006d96f0cfc6ecd04c61ac0113c0aa7` |
| `SHA256SUMS.txt` | `101` bytes | `sha256:725252c8d3383b8121e3ef7f2752e0d268c394273336cd97acc95a9d1b5484d2` | public content names the same installer and hash |
| `latest.yml` | `364` bytes | `sha256:6782b90f8cd118f71bcbc5eb7378cc2692085ba94f5f857395b7f8a018fd398d` | public content reports version `0.3.10` and size `164630893` |
| `xiangqi-analyzer-0.3.10-setup.exe.blockmap` | `172522` bytes | `sha256:41fee1732eb25a78f6d4c66d533b47ba28b03fbf7001a6adf9334be493e6f74f` | GitHub asset metadata |

The public `SHA256SUMS.txt` line is:

```text
6FACF8BCA3A202FE4D668DA3235B0B90B006D96F0CFC6ECD04C61AC0113C0AA7  xiangqi-analyzer-0.3.10-setup.exe
```

The public `latest.yml` records version `0.3.10`, installer size `164630893`, and the electron-builder SHA-512 value `N/1fRySLKtprkIBIyLCV+ymrAXe3TRVu9Yky2pfmflaTe+YBJSKrtPkvnU35uWcdvSfApSbrguQpvPWOOm2CWg==`.

## What v0.3.10 changes

- Settings' active teacher-test run view shows the app version, release tag, product source commit, installer filename/SHA-256, and Windows runtime in addition to the run ID.
- A renderer regression test protects that identity display.
- The teacher-test protocol and learning-history draft use the requested seven external dimensions, each scored 1–5, plus independent `softwareEnvironment`, `xiangqiContent`, and `teachingValue` gates with `pass`/`concern`/`fail`/`not_assessed` states.
- The run-isolated teacher-test export and its v0.3.9 regression fix remain in the candidate history; v0.3.10 is a new product commit, tag, workflow run, and installer SHA.

## Deliberate limits

This evidence does not prove that the requested external pilot is complete. The following remain pending and must be filled with real evidence before the learning-history pack can be marked complete:

- three teacher-provided or teacher-confirmed cases replacing the current fixture-only slots;
- two real Windows machines running the same six frozen cases, with distinct run manifests and matching artifact claims;
- external teacher rubric scores, short reasons, and the three independent gate decisions;
- invalid WXF/FEN, provider timeout/network loss, cancellation, and post-key-deletion failure-path observations;
- immediate temporary API-key deletion, zero-residue checks, and a post-delete provider-call denial on each machine;
- clean Windows 10 22H2 and Windows 11 client evidence;
- trusted Authenticode signing and timestamping before any formal Latest consideration.

The installer is intentionally unsigned. SmartScreen may warn or block it, and no trusted publisher claim is made. The candidate is not Latest. No product website was viewed as part of this evidence capture.
