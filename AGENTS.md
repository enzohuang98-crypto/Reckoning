# Repository delivery policy

- GitHub is the source of truth for this project.
- Modify source files only inside a Git checkout. Never edit files under the installed
  application directory, including `%LOCALAPPDATA%\Programs\xiangqi-analyzer`.
- Every deliverable change must use a branch, an intentional commit, a GitHub push,
  and a pull request. Do not copy build output directly into an installed application.
- Desktop installations may change only through a published GitHub Release: either
  the in-app updater or the Release installer.
- Build and publish Releases through the GitHub Actions Release workflow from a
  version tag. Do not manually replace files on an end user's computer.
- Never commit API keys, signing credentials, license private keys, or user data.
