# Public and private files

Public source includes code, tests, dependency manifests, generic documentation and `.env.example`. The publication starts with a new Git history; private local commits are not imported. Use a public alias and GitHub noreply email for commits.

Private files stay outside the published repository:

- `.env` and `.env.*` profiles, credentials, SSH configuration and OBS authentication.
- `.runtime/`, `logs/`, local validation reports, screenshots and recordings.
- `server/minecraft/`, including world data, player lists and EULA acceptance.
- Model weights, `.vendor/`, dependency installations and machine-specific administration scripts.

The ignore rules protect new files but cannot remove files already committed. Check the index and history before every upload. Review runtime logs before sharing them: they may contain paths, account names, chat and hardware metadata.

```sh
node scripts/check-publication.mjs
git diff --cached --stat
```

The checker inspects selected Git files for private artifacts, absolute user paths, private network addresses, recognizable credential formats, private keys, current machine identifiers, populated example credentials and non-noreply author emails. Optionally pass `--deny-values-file /path/to/private-values.json` with a private JSON array of additional names or secrets. It prints file names and finding types rather than the sensitive values. Pattern checks cannot guarantee the absence of every possible secret; retain a manual review.

Loopback addresses, generic player placeholders, public model IDs/revisions and game constants are reusable defaults. Personal player names and machine-specific hosts must be configured privately. No local machine paths or real player names are included in the examples.
