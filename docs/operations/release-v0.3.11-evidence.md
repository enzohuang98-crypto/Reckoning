# v0.3.11 live teacher-candidate evidence

This file records the public GitHub state observed on 2026-08-07 after the v0.3.11 `teacher-candidate` workflow completed. It is candidate evidence only; it is not a formal signing, Latest-promotion, teacher-review, second-machine, temporary-key, or clean Windows 10/11 client-evidence claim.

## Immutable identity

- Repository: [enzohuang98-crypto/Reckoning](https://github.com/enzohuang98-crypto/Reckoning)
- Release: [v0.3.11](https://github.com/enzohuang98-crypto/Reckoning/releases/tag/v0.3.11)
- Release name: `象棋 AI 分析講解 v0.3.11（未簽章 teacher-test candidate）`
- Release state: public, non-draft, prerelease; the stable release list still has v0.3.6 as the latest non-prerelease release.
- Annotated tag object: `ed31686815caafb100c3a5113557f9a35f4b0fee`
- Peeled tag/product source commit: `c45c92585d35bee62a1186dd9816fb12ae2e0284`
- Tag target verification: the tag object names `c45c92585d35bee62a1186dd9816fb12ae2e0284`; the workflow head SHA is the same commit.
- Release workflow run: [31134511847](https://github.com/enzohuang98-crypto/Reckoning/actions/runs/31134511847)
- Workflow event/mode: `workflow_dispatch`, `teacher-candidate`
- Release published: `2026-08-07T00:27:19Z`

## Workflow jobs

| Job | Result | Evidence |
| --- | --- | --- |
| Build teacher-candidate Windows x64 artifact once | success | job `92730796691` |
| Publish teacher-candidate candidate | success | job `92731328981` |
| Windows Server 2022 compatibility proxy | success | job `92731375717` |
| Windows Server 2025 compatibility proxy | success | job `92731375764` |
| Require clean Windows 10 22H2 and Windows 11 client evidence | skipped | job `92731528369`; candidate mode intentionally does not assert this gate |
| Promote validated candidate to latest | skipped | job `92731529010`; unsigned teacher candidates cannot be promoted |

The successful build path includes the repository's Windows typecheck/test/audit/build, explicit unsigned packaging, candidate metadata/SHA-256 verification, and unsigned install/uninstall smoke. The Server jobs are compatibility proxies only and are not consumer-client evidence.

## Security finding and remediation

The v0.3.10 follow-up CI run on 2026-08-07 exposed a new high-severity `js-yaml` advisory, `GHSA-5p4m-2wfm-xmqj` / CVE-2026-59870, affecting `js-yaml` `4.0.0` through `4.3.0`. The reachable dependency tree included the package through `electron-updater` at runtime and through the `electron-builder` build chain. PR #38 updated the lockfile to `js-yaml` `4.3.1`, bumped the candidate to v0.3.11, and passed the Windows CI audit. The v0.3.11 release build independently passed `security:audit` with zero moderate-or-higher runtime findings and zero actionable build-tool findings.

## Public assets and independent byte verification

GitHub's public Release asset metadata and an independent HTTPS stream check agree:

| Asset | Public size | GitHub digest | Independent check |
| --- | ---: | --- | --- |
| `xiangqi-analyzer-0.3.11-setup.exe` | `164630863` bytes | `sha256:31d89f8c69dbaec1aec2be2205108b54d4bec243dc9e2eb7b8ccfb412c762824` | SHA-256 stream hash `31d89f8c69dbaec1aec2be2205108b54d4bec243dc9e2eb7b8ccfb412c762824` |
| `SHA256SUMS.txt` | `101` bytes | `sha256:3dfab3b7f1e71b8c64d11934aceb9b71ee8c211c93344153b7173ceeeba61e59` | public content names the same installer and hash |
| `latest.yml` | `364` bytes | `sha256:505ec9bb6f4f1e89eb8536cddc19c2f1500acb6a409fd6a9f96ae392acaf3758` | public content reports version `0.3.11` and size `164630863` |
| `xiangqi-analyzer-0.3.11-setup.exe.blockmap` | `172557` bytes | `sha256:88e93b62c0ab78154477df3101f08cb1b5d8aa23be69f641a04b767a47e46039` | GitHub asset metadata |

The public `SHA256SUMS.txt` line is:

```text
31D89F8C69DBAEC1AEC2BE2205108B54D4BEC243DC9E2EB7B8CCFB412C762824  xiangqi-analyzer-0.3.11-setup.exe
```

The public `latest.yml` records version `0.3.11`, installer size `164630863`, and the electron-builder SHA-512 value `a1xnL4iXy9Kktsyrctp6rXPQl8Tj2Ny52IDIjWKuQu5UgSBLDhFvGdjMZPDvHFdtkJ2daLRtuv51e4Sk0zG9WA==`.

## What the current candidate includes

- The v0.3.10 Settings active-run identity display: app version, release tag, product source commit, installer filename/SHA-256, and Windows runtime.
- The v0.3.10 renderer regression test and the teacher-test protocol's seven external 1–5 dimensions plus three independent gates.
- The v0.3.9 run-isolated teacher-test export fix.
- The v0.3.11 lockfile remediation for `js-yaml` and a new candidate-specific release identity.

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
