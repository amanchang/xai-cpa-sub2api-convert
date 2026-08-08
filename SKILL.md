---
name: xai-cpa-sub2api-convert
description: Convert xAI / Grok account exports (grokcli-2api admin export, native xai-<email>.json auth files, CPA auth files, sub2api-data payloads, JSONL or text exports) into CPA (CLIProxyAPI) xAI OAuth auth files and Sub2API import payloads. Use when the user asks to convert Grok/xAI accounts for CPA, CLIProxyAPI, sub2api, /v0/management/auth-files, or asks for merged plus one-file-per-account output.
---

# xAI -> CPA / Sub2API Converter

Converts xAI (Grok) OAuth account records into the two import shapes that were
verified working in this project. Do **not** use `sub2api-auth-converter` for
these records; that skill targets Codex/OpenAI-style auth and drops the xAI
fields needed here.

## Quick start

```bash
node scripts/convert_xai_auth.mjs \
  --input "<file-or-folder>" --target both --mode both --outdir "<output-folder>" --label "<tag>"
```

Node 18+, no dependencies. The script prints a JSON report and never touches the source.
The conversion core is `docs/core.mjs`; the CLI and the online page share that single implementation.

## Options

| Flag | Values | Meaning |
|---|---|---|
| `--input` | file or folder | Source export. Folders read `*.json`, `*.jsonl`, `*.txt`, skipping `manifest.json` / `SHA256SUMS`. |
| `--outdir` | folder | Output root. `cpa/` and `sub2api/` subfolders are created as needed. |
| `--target` | `cpa` \| `sub2api` \| `both` | Which format(s) to emit. Default `both`. |
| `--mode` | `merged` \| `split` \| `both` | One aggregated file, one file per account, or both. Default `both`. |
| `--label` | string | Tag used in output filenames. Default `xai`. |
| `--limit` | int | Keep only the first N accounts after dedupe. |
| `--skip-expired` | flag | Drop accounts whose access token already expired. |
| `--exclude-emails` | file or comma list | Skip these emails (avoid re-exporting accounts already deployed elsewhere). |
| `--sub2api-base-url` | url | Override Sub2API `credentials.base_url`. Default `https://cli-chat-proxy.grok.com/v1`. |
| `--on-invalid` | `abort` \| `skip` | What to do when a record is missing required fields. Default `abort` (stop the whole batch); `skip` converts the rest and reports each skipped record. |

## Output layout

```
<outdir>/
  cpa/
    cpa-xai-merged-<N>.json          # backup/reference bundle only
    manifest.json                    # count + file list + import hint
    per-account/xai-<email>.json     # <- these are what CPA imports
  sub2api/
    sub2api-<label>-all-<N>.json     # <- Sub2API admin import
    per-account/<email>_sub2api.json
```

## Import paths

- **CPA / CLIProxyAPI**: one file per account. `POST /v0/management/auth-files` with `multipart file=@xai-<email>.json`, or drop into the container's `auths/` directory. The merged bundle is **not** importable; it is backup only.
- **Sub2API**: admin import accepts the `sub2api-data` payload object. Use the merged file for bulk, per-account files to validate one first.

## Field mapping

| Canonical | CPA output | Sub2API output | Resolution order |
|---|---|---|---|
| access token | `access_token` | `credentials.access_token` | `access_token` / `key` / `credentials.access_token` |
| refresh token | `refresh_token` | `credentials.refresh_token` | `refresh_token` / `credentials.refresh_token` |
| email | `email` | `name`, `credentials.email`, `extra.email` | `email` / `credentials.email` / `extra.email` / JWT `email` / filename |
| expiry | `expired` (RFC3339, no ms) | `credentials.expires_at` (RFC3339 **with** ms) | source `expires_at` / `expired` -> JWT `exp` -> `last_refresh + expires_in` |
| last refresh | `last_refresh` | not used | source `last_refresh` -> JWT `iat` -> `create_time` |
| principal | `user_id`, `sub`, `account_id` | not used | `principal_id` / `user_id` / `sub` / JWT `principal_id` / JWT `sub` |
| team | `team_id` | not used | `team_id` / JWT `team_id` |
| client id | `oidc_client_id` | `credentials.client_id` | JWT `client_id` / `oidc_client_id` / `client_id` / JWT `aud` / xAI default |
| scope | `scope` | not used | JWT `scope` / source `scope` / xAI default |
| base url | `https://cli-chat-proxy.grok.com/v1` (fixed) | `--sub2api-base-url` | constant / flag |
| auth header | `headers["X-XAI-Token-Auth"] = "xai-grok-cli"` | n/a | constant |

Constants: xAI OIDC client id `b1a00492-073a-47ea-816f-4c329264a828`, issuer `https://auth.x.ai`, `account_id = https://auth.x.ai::<principal_id>`.

CPA output always sets `disabled: false` so an account disabled in the source pool is still importable; check the source pool status separately if that matters.

Sub2API accounts are emitted with `platform: "grok"`, `type: "oauth"`, `concurrency: 1`, `priority: 1`, `rate_multiplier: 1`, `auto_pause_on_expired: true`.

## Accepted source shapes

- grokcli-2api admin export: `{ "auth": { "https://auth.x.ai::<uuid>": { key, refresh_token, ... } } }` — note the access token lives in `key`.
- Native grokcli auth file: `xai-<email>.json` with `type: "xai"`, `access_token`, `refresh_token`, `id_token`, `sub`.
- CPA auth file (round-trips back to Sub2API).
- Sub2API payload with `accounts[].credentials` (round-trips back to CPA).
- JSON array of account objects, JSONL, or a text export with one JSON object per line.

## Guardrails

- Never write into the input folder; always a separate `--outdir`.
- Dedupe by `account_id`, falling back to email. Records missing an access or refresh token are skipped and counted.
- Report counts, paths, and field names only. Never print token, cookie, or password values.
- The report includes `counts.unrecognized`: nodes that were read but could not be recognized as an account. A non-zero value means part of the input was not in a supported shape.
- The source export may also contain `password` / `sso` / `session_cookies`. Neither output format uses them; do not copy them into converted files.
- After conversion, verify: converted count, email set matches the source, JSON parses, and `warnings.access_token_already_expired` is acceptable.
- Refresh tokens are single-holder. If the same account is imported into more than one runtime, one side will start failing with `invalid_grant` / `Refresh token has been revoked`. Use `--exclude-emails` to keep deployments disjoint.
- Conversion success is not quota success; converted accounts can still return 402 spending-limit or 429 free-usage-exhausted.

## Verification performed

Output was diffed field-by-field against auth files already accepted by each runtime:

- Sub2API merged output is byte-identical (every account, every field) to a known-good Sub2API import payload.
- CPA per-account output matches the key set of a known-good CPA xAI auth file, plus `sub` and `scope` which accepted single-account CPA files also carry.
- Round-trips verified in both directions with no field loss: grokcli native -> CPA -> Sub2API, and Sub2API -> CPA.
- All emitted files parse as JSON; email sets match the source exactly.
- Invalid flag combinations exit without creating empty output directories.
