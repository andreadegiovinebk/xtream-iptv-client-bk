# Xtream IPTV — device sync data

Data store of the "Sync devices" feature of [Xtream IPTV](https://github.com/andreadegiovine/xtream-iptv-client): one file per account
under `users/`, named after a hash of the username, holding only data encrypted on the device with a key derived from the user's
password. Nothing here is readable without that password.

- The app never writes here directly: it sends its changes with a `repository_dispatch` event, and the workflow in
  `.github/workflows/` checks the account, merges the changes and commits them with the deploy key (the only actor the rulesets allow
  to push).
- A daily job removes accounts without activity for 30 days, and accounts created without data after 1 day.

## Files

- `users/<account>.json`: `{ v, rev, created, updated, seen, auth, check, fails, items }` — see `.github/scripts/merge.js`.
- `.github/scripts/merge.js`: checks a payload and merges it (newer item wins); `cleanup.js`: the daily removals. Tests:
  `node --test .github/scripts/test.js`.
- Secrets: `DEPLOY_KEY` (private key of the deploy key with write access). Rulesets on all branches and tags block every push except
  the deploy key; the token built into the app (fine-grained, Contents read/write on this repository only) can then only read and start
  the workflow.
