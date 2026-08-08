# xAI → CPA / Sub2API Converter

[繁體中文](README.md) ｜ [简体中文](README.zh-CN.md) ｜ **English**

🌐 **Online converter (no install, data never leaves your browser)**: <https://amanchang.github.io/xai-cpa-sub2api-convert/>

![version](https://img.shields.io/badge/version-1.1.0-blue)
![node](https://img.shields.io/badge/node-18%2B-339933)
![deps](https://img.shields.io/badge/dependencies-0-brightgreen)
![license](https://img.shields.io/badge/license-MIT-green)

Convert **xAI / Grok** account authorization (auth) exports into two formats that have been **verified to import successfully**:

1. **CPA (CLIProxyAPI)** xAI OAuth auth files
2. **Sub2API** import payloads (`sub2api-data`)

This is a **Codex / Claude skill package**, and also a standalone Node script. **Zero third-party dependencies** — all you need is Node 18 or newer. It **never modifies your source files**.

> 📖 **This README is written for complete beginners.**
> It does not assume you know OAuth, JWT, RFC3339, or recursion. Every term is explained first, every layer of the program's logic is walked through in plain language, and source snippets are shown alongside.
> If you just want to run it right now, jump to [30-second start](#30-second-start).

---

## Table of contents

- [Read this first: what does this tool actually do](#read-this-first-what-does-this-tool-actually-do)
- [Terminology, explained (read this if you're new)](#terminology-explained-read-this-if-youre-new)
- [Why this tool exists](#why-this-tool-exists)
- [Don't use the wrong skill](#dont-use-the-wrong-skill)
- [30-second start](#30-second-start)
- [Installation](#installation)
- [Full pipeline diagram](#full-pipeline-diagram)
- [Program logic, walked through](#program-logic-walked-through)
  - [Design rationale: why an intermediate format](#design-rationale-why-an-intermediate-format)
  - [Step 1: read the files in (read layer)](#step-1-read-the-files-in-read-layer)
  - [Step 2: dig accounts out of arbitrary nesting (recognition layer)](#step-2-dig-accounts-out-of-arbitrary-nesting-recognition-layer)
  - [Step 3: assemble thirteen fields (normalization layer)](#step-3-assemble-thirteen-fields-normalization-layer)
  - [Step 4: the filter pipeline (filter layer)](#step-4-the-filter-pipeline-filter-layer)
  - [Step 5: shape it the way each side wants (render layer)](#step-5-shape-it-the-way-each-side-wants-render-layer)
  - [Step 6: writing files and the report (output layer)](#step-6-writing-files-and-the-report-output-layer)
- [Supported input shapes (5 of them)](#supported-input-shapes-5-of-them)
- [Four outputs: a two-axis cross product](#four-outputs-a-two-axis-cross-product)
- [Command-line arguments](#command-line-arguments)
- [Output directory structure](#output-directory-structure)
- [How to import](#how-to-import)
- [Field mapping table](#field-mapping-table)
- [How to read the run report](#how-to-read-the-run-report)
- [Safety guardrails](#safety-guardrails)
- [Troubleshooting](#troubleshooting)
- [Verification checklist](#verification-checklist)
- [Doing it by hand vs using this script](#doing-it-by-hand-vs-using-this-script)
- [Glossary](#glossary)
- [Installing as a Codex skill](#installing-as-a-codex-skill)
- [Versioning](#versioning)
- [License](#license)

---

## Read this first: what does this tool actually do

An everyday analogy:

> You have a stack of "account passes" exported from one machine.
> Now you want to move those passes onto two different machines.
>
> The problem: these three machines use **completely different registry formats**:
>
> - Machine A writes the "pass number" in a column called **key**
> - Machine B requires it in **access_token**, and the timestamp **must not include milliseconds**
> - Machine C also wants **access_token**, but the timestamp **must include milliseconds**, and it wants one big book submitted at once, not one page at a time

> This script is the clerk who **understands all three registries and recopies everything for you**.

In technical terms:

```text
Various xAI / Grok account exports  ──►  this script  ──►  ① auth files CPA accepts (one per account)
        (5 shapes)                     (unified format)   ② payload Sub2API accepts (one bundle)
```

It **does not** go online, **does not** modify your source files, and **does not** print tokens to the screen. It does exactly one thing: **format conversion**.

**What it deliberately does not do:**

| It won't | Why |
|---|---|
| Register new accounts for you | It only processes exports you already have |
| Refresh tokens for you | Refreshing happens inside CPA / Sub2API after import |
| Guarantee an account has quota | Quota is a property of the account, unrelated to format |
| Decide whether an account is disabled | CPA output always writes `disabled: false` — see [Field mapping table](#field-mapping-table) |

---

## Terminology, explained (read this if you're new)

Skip this section if you already know these.

### What xAI / Grok / grokcli-2api / CPA / Sub2API each are

| Name | Plain explanation | Role in this project |
|---|---|---|
| **xAI** | The company behind the Grok AI model | The authority that issues passes |
| **Grok** | xAI's AI model | The service you ultimately want to use |
| **grokcli-2api** | A tool for managing Grok accounts, with an admin panel that can export accounts | **Source** (data comes from here) |
| **CPA / CLIProxyAPI** | A proxy tool that rotates through multiple accounts | **Destination one** |
| **Sub2API** | Another proxy tool with similar functionality | **Destination two** |

So the whole path looks like:

```text
grokcli-2api export  ──►  this script  ──►  CPA or Sub2API  ──►  your program calls Grok
     (source)              (convert)          (destination)
```

### What JSON is

A text format for describing data. It looks like this:

```json
{
  "email": "user@example.com",
  "type": "xai"
}
```

Curly braces `{}` wrap an **object**; square brackets `[]` wrap an **array** (a list).

**Nested** means an object inside another object:

```json
{
  "accounts": [
    { "name": "a@example.com", "credentials": { "access_token": "..." } }
  ]
}
```

Here `access_token` is buried three levels deep: `accounts` → `[0]` → `credentials`. A large part of this script's job is **digging accounts out of nesting at any depth**.

### What a token is

A **token** is a temporary pass. You log in once, the system hands you a pass, and afterwards you present that pass instead of re-entering your password every time.

Three kinds show up in this project:

| Name | Plain explanation | Expires? | Required by this script |
|---|---|---|---|
| `access_token` | **The ticket.** Presented on every API call | Yes, usually within hours | ✅ **Required** |
| `refresh_token` | **The exchange voucher.** When the ticket expires, trade it for a new one | Only after a long time | ✅ **Required** |
| `id_token` | **The ID card.** Says who you are (email, name) | Yes | ❌ Optional |

> ⚠️ All three are sensitive — equivalent to your account password. **Do not paste them anywhere public** (GitHub issues, chat groups, forums).

**Why is `refresh_token` required?** Because `access_token` expires within hours. If you hand over a ticket without an exchange voucher, the account becomes dead weight a few hours after import. That is why `isUsable()` **demands both**, and drops the whole record if either is missing.

### What a JWT is (and why the script can "extract" times, email, and team)

`access_token` is usually in **JWT** format. It is really three strings separated by dots `.`:

```text
eyJhbGciOi....  .  eyJzdWIiOiIxMjM0.... .  SflKxwRJSMeKKF2QT4...
   ↑ header            ↑ payload (the useful part)   ↑ signature
   says which algorithm   the actual data lives here    tamper protection
```

**The middle payload segment is Base64-encoded JSON** — meaning **anyone can read it without a password**.

Fields commonly found in an xAI access token payload:

| Field | Meaning | What this script uses it for |
|---|---|---|
| `iat` | issued at — when this ticket was issued (Unix timestamp) | Fills `last_refresh` |
| `exp` | expires — when this ticket expires (Unix timestamp) | Fills `expires_at` |
| `sub` | subject — the user's unique ID | Fills `principal_id` |
| `principal_id` | xAI's own user ID | Fills `principal_id` |
| `team_id` | Which team this account belongs to | Fills `team_id` |
| `client_id` | Which application requested this ticket | Fills `client_id` |
| `aud` | audience — who this ticket is for | Fallback for `client_id` |
| `scope` | The permission scope of this ticket | Fills `scope` |
| `email` | The account email | Fills `email` |

**This is one of the most important design points of the project: even if the source file records nothing, as long as there is an `access_token`, the script can dig all of the above out by itself.** [Step 3](#step-3-assemble-thirteen-fields-normalization-layer) covers this in detail.

> 💡 "Base64 encoding" is **not** encryption. It merely rewrites data in a transport-friendly way, and **anyone can reverse it**.
> Incidentally, this script uses the `base64url` variant (`+` and `/` replaced by `-` and `_`), which is also why **Node 18+** is required — older Node's `Buffer.from()` does not accept `"base64url"`.

### What a Unix timestamp is

A large integer: the number of seconds elapsed since 1 January 1970, 00:00 UTC.

For example `1786291200` is some moment in 2026.

**But there is a trap: some systems use seconds, others milliseconds.** Millisecond values are 1000× larger. The script uses one very simple rule:

```js
return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v);
```

`1e12` is one trillion. **If the number exceeds one trillion it must be milliseconds** (a seconds value would not cross one trillion until the year 33658), so it is divided by 1000 back into seconds.

### What RFC3339 is, and why milliseconds matter so much

**RFC3339** is a standard way of writing timestamps:

```text
2026-08-08T12:34:56Z          ← without milliseconds
2026-08-08T12:34:56.789Z      ← with milliseconds (the extra .789)
```

The trailing `Z` means UTC (Coordinated Universal Time).

**This is the easiest trap in the whole project:**

| Destination | Required format | Example |
|---|---|---|
| **CPA** | **Without** milliseconds | `2026-08-08T12:34:56Z` |
| **Sub2API** | **With** milliseconds | `2026-08-08T12:34:56.789Z` |

So the script has **two** formatting functions. This is not duplicated code, it is deliberate:

```js
/** RFC3339 without milliseconds, matching validated CPA auth files. */
function toIso(epoch) {
  if (!epoch) return "";
  return new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** RFC3339 with milliseconds, matching validated Sub2API import files. */
function toIsoMs(epoch) {
  if (!epoch) return "";
  return new Date(epoch * 1000).toISOString();
}
```

JavaScript's `toISOString()` always includes milliseconds, so `toIsoMs()` uses it directly; `toIso()` uses a regular expression to replace `.789Z` with `Z`, stripping the milliseconds.

> These two formats were derived by **comparing files that were actually verified to import successfully** — not guessed. If you swap them, one side's import may fail or misread the timestamp.

### What JSONL is

**JSON Lines.** A file with one JSON object per line, with **no** commas between lines and **no** outer brackets:

```text
{"email":"a@example.com","access_token":"..."}
{"email":"b@example.com","access_token":"..."}
```

The benefit is that you can read it line by line without loading the whole file into memory. Many tools use it when exporting large volumes of data.

### OAuth terminology

| Term | Plain explanation |
|---|---|
| **OAuth** | A standard flow for granting access without handing over a password |
| **issuer** | The issuing authority. Fixed to `https://auth.x.ai` in this project |
| **client_id** | The application's ID number. Whichever app requested the ticket goes here |
| **scope** | The permission list on this ticket, e.g. "may read email", "may use grok-cli" |
| **principal_id** | The user's own unique ID |
| **team_id** | Which team the account belongs to (not every account has one) |
| **account_id** | A composite ID this project builds, formatted as `<issuer>::<principal_id>` |

**Why build `account_id` that way?** Because in theory the same `principal_id` could appear under a different issuer. Including the issuer guarantees global uniqueness. CPA uses exactly this format as an account's primary key:

```text
https://auth.x.ai::0552a0b9-953e-43ce-bd11-9eb435cec24a
└──── issuer ────┘└─────────── principal_id ───────────┘
                 ↑ two colons
```

---

## Why this tool exists

xAI / Grok accounts are stored very differently across tools. Below are the traps you **will definitely hit** if you edit files by hand, ordered by severity.

### Trap 1: the access token hides in the `key` field (easiest to miss)

A grokcli-2api admin export looks like this:

```json
{
  "auth": {
    "https://auth.x.ai::0552a0b9-...": {
      "key": "eyJ0eXAiOiJhdCtqd3Qi...",
      "refresh_token": "mmhF_twJkd03...",
      "email": "user@example.com"
    }
  }
}
```

Note: **the access token is in `key`, not `access_token`.**

If your code only looks for `access_token`, you get an empty string, and then the entire batch is judged "incomplete" and thrown away. This is the single most important compatibility rule in this tool:

```js
const access =
  src.access_token || src.accessToken || src.key || src.token ||
  (src.credentials && src.credentials.access_token) || "";
```

Five locations are tried in order; whichever has a value wins.

### Trap 2: differing timestamp precision

As explained under [RFC3339](#what-rfc3339-is-and-why-milliseconds-matter-so-much): CPA does not want milliseconds, Sub2API does. When editing by hand it is very easy to write both the same way, breaking one side.

### Trap 3: differing import units

| Destination | Import unit | Meaning |
|---|---|---|
| **CPA** | **One file per account** | 200 accounts means 200 uploads |
| **Sub2API** | **One large payload** | 200 accounts in one file, uploaded once |

These two requirements are exact opposites, so this script must be able to **produce both**. That is why the `--mode` argument exists (see [Four outputs](#four-outputs-a-two-axis-cross-product)).

### Trap 4: some fields exist only inside the JWT

`scope`, `client_id`, `team_id`, and `principal_id` are often **not recorded at all** in the source file — they are hidden in the `access_token` JWT payload.

Doing it manually means:

1. Copy the token into a Base64 decoder website
2. Paste, decode, read the JSON
3. Find the field, copy it back into your file
4. **Repeat 200 times**

And pasting tokens into a third-party website is itself a security risk. The script does all of this locally, with no network access.

### Trap 5: CPA needs a special header

When CPA calls xAI, it must send a custom HTTP header:

```json
"headers": { "X-XAI-Token-Auth": "xai-grok-cli" }
```

Without it, the CPA import raises no error, but **actual calls fail**. This is the worst kind of bug — the format looks correct, it just does not work. The script fills it in automatically.

---

## Don't use the wrong skill

> ❌ **Do not** use `sub2api-auth-converter` for xAI / Grok accounts.
>
> That tool targets Codex / OpenAI-style auth. Its intermediate format has **no** `team_id`, `principal_id`, `X-XAI-Token-Auth`, or xAI `base_url`. Files converted with it lose all of those fields, and calls will certainly fail after importing into CPA.
>
> ✅ For xAI / Grok, use this project.

A simple decision rule:

```text
Which vendor is your account from?
  │
  ├─ OpenAI / Codex (has chatgpt_account_id)  ──►  use sub2api-auth-converter
  │
  └─ xAI / Grok (has key or auth.x.ai)        ──►  use this project
```

---

## 30-second start

### Scenario 1: I want everything, all at once

```bash
node scripts/convert_xai_auth.mjs \
  --input  ./my-grok-export \
  --outdir ./converted \
  --target both \
  --mode   both \
  --label  batch01
```

This produces both CPA and Sub2API formats, in both merged and per-account modes, under `./converted/`. **Recommended for your first run** — look at all four and then decide which you need.

### Scenario 2: CPA only, one file per account

```bash
node scripts/convert_xai_auth.mjs \
  --input ./my-grok-export --outdir ./converted \
  --target cpa --mode split
```

Produces `./converted/cpa/per-account/xai-<email>.json` — these are the files CPA actually uploads.

### Scenario 3: Sub2API bulk file, excluding accounts already deployed on CPA

```bash
node scripts/convert_xai_auth.mjs \
  --input ./my-grok-export --outdir ./converted \
  --target sub2api --mode merged \
  --exclude-emails ./already-deployed.txt
```

`already-deployed.txt` is a plain text file with one email per line. **This step matters a lot** — see the refresh token discussion under [Safety guardrails](#safety-guardrails).

### Scenario 4: I just want to test 3 accounts first

```bash
node scripts/convert_xai_auth.mjs \
  --input ./my-grok-export --outdir ./test-out \
  --limit 3
```

> **Notes for Windows PowerShell users**
>
> 1. PowerShell's line-continuation character is a backtick, not `\`. The simplest approach is to **write everything on one line**
> 2. If you don't have `node`, install the LTS build from [nodejs.org](https://nodejs.org/)
> 3. Quote paths that contain spaces

---

## Installation

Requirement: **Node 18 or newer** (because of `Buffer.from(..., "base64url")`). **No** `npm install` needed.

### Step 1: check your Node version

```bash
node --version
```

You need `v18.x.x` or higher. On `v16` or older, `base64url` cannot be decoded and nothing can be extracted from the JWT.

### Step 2: download

```bash
git clone https://github.com/amanchang/xai-cpa-sub2api-convert.git
cd xai-cpa-sub2api-convert
```

### Step 3: confirm it runs

```bash
node scripts/convert_xai_auth.mjs
```

You should see:

```text
Error: --input is required
```

**Seeing this error means the installation worked.** It is telling you an argument is missing, not that something is broken.

---
## Full pipeline diagram

Get an overall impression from the diagram first; the next section explains every layer in plain language. Each box is labelled with the layer it belongs to.

```text
INPUT  (--input : file or folder)
  +--------------------------------------------------------------------------+
  | 1) grokcli-2api admin export                                             |
  |      { "auth": { "https://auth.x.ai::<uuid>": { key, refresh_token,...}}}|
  |      NOTE: access token lives in "key", not "access_token"               |
  | 2) native grokcli auth file   xai-<email>.json                           |
  | 3) CPA auth file              (round-trips back to Sub2API)              |
  | 4) sub2api-data payload       accounts[].credentials                     |
  | 5) JSON array / JSONL / text export (one JSON object per line)           |
  +---------------------------------+----------------------------------------+
                                    |
                                    v
                    +-----------------------------------+
                    |            loadInput()            |  <-- read layer
                    |  folder: *.json *.jsonl *.txt     |
                    |  skips manifest.json / SHA256SUMS |
                    +-----------------+-----------------+
                                      |
                                      v
                    +-----------------------------------+
                     |   extractRecords()  (recursive)   |
                    |   auth{} / accounts[] /           |
                    |   credentials{} / flat object     |
                    +-----------------+-----------------+
                                      |
                                      v
                    +-----------------------------------+
                    |          canonicalize()           |  <-- normalization layer
                    |                                   |
                    |  resolution precedence:           |
                    |    source field                   |
                    |      -> access_token JWT claim    |
                    |        -> xAI documented default  |
                    |                                   |
                    |  canonical record:                |
                    |    email  access_token            |
                    |    refresh_token  id_token        |
                    |    token_type  scope  client_id   |
                    |    principal_id  team_id          |
                    |    account_id  expires_at         |
                    |    last_refresh                   |
                    +-----------------+-----------------+
                                      |
                                      v
                    +-----------------------------------+
                    |        filter pipeline            |  <-- filter layer
                    |  isUsable()  -> skipped.incomplete|
                    |  dedupe      -> skipped.duplicate |
                    |  --exclude-emails -> .excluded    |
                    |  --skip-expired   -> .expired     |
                    |  --limit N   -> slice(0, N)       |
                    +--------+---------------+----------+
                             |               |
             --target cpa    |               |    --target sub2api
                             v               v
              <-- render layer -->                <-- render layer -->
        +--------------------------+   +---------------------------+
        |         toCpa()          |   |       toSub2api()         |
        |  type: "xai"             |   |  platform: "grok"         |
        |  auth_kind: "oauth"      |   |  type: "oauth"            |
        |  expired: RFC3339 no ms  |   |  expires_at: RFC3339 + ms |
        |  base_url: cli-chat-...  |   |  base_url: --sub2api-...  |
        |  headers:                |   |  concurrency: 1           |
        |    X-XAI-Token-Auth      |   |  priority: 1              |
        |      = xai-grok-cli      |   |  rate_multiplier: 1       |
        |  disabled: false         |   |  auto_pause_on_expired    |
        +------------+-------------+   +-------------+-------------+
                     |                               |
                     v                               v
   <outdir>/cpa/                            <outdir>/sub2api/
     per-account/xai-<email>.json  <==IMPORT   sub2api-<label>-all-<N>.json <==IMPORT
     manifest.json                            per-account/<email>_sub2api.json
     cpa-xai-merged-<N>.json  (backup only)
                     |                               |
                     v                               v
   POST /v0/management/auth-files            Sub2API admin import
   multipart file=@xai-<email>.json          accepts sub2api-data object
   (or drop into container auths/)
                     |
                     v
             +---------------------------------------------+
             |  stdout: JSON report  <-- output layer      |
             |    source_records_seen / accounts_converted |
             |    skipped{incomplete,duplicate,            |
             |            excluded,expired}                |
             |    warnings{access_token_already_expired,   |
             |             missing_team_id,                |
             |             missing_principal_id}           |
             +---------------------------------------------+

  !! refresh tokens are SINGLE-HOLDER
     same account in CPA and Sub2API at once
       -> one side eventually returns invalid_grant
       -> use --exclude-emails to keep deployments disjoint
```

Don't worry if it looks dense — **the next section takes each layer apart and shows the corresponding source code**.

---

## Program logic, walked through

This section is the heart of the README. After reading it you should be able to **modify the script yourself**.

The script is a single file, `scripts/convert_xai_auth.mjs`, about 380 lines, divided into six layers:

| Layer | Main functions | One-line responsibility |
|---|---|---|
| **Read layer** | `loadInput()` / `loadFile()` | Read the text of a file (or a whole folder) and turn it into JSON |
| **Recognition layer** | `extractRecords()` | Dig "accounts" out of arbitrary nested structures |
| **Normalization layer** | `canonicalize()` | Unify wildly varying field names into 13 fixed fields |
| **Filter layer** | The pipeline inside `main()` | Drop incomplete, duplicate, excluded, and expired records |
| **Render layer** | `toCpa()` / `toSub2api()` | Reshape the unified format into what each side wants |
| **Output layer** | `writeJson()` + report | Write files, produce the manifest, print the report |

### Design rationale: why an intermediate format

The most intuitive approach is: **for every format encountered, write code that converts it directly to the target format.**

```text
❌ Direct conversion (N × M paths)

grokcli admin  ──► CPA        grokcli admin  ──► Sub2API
grokcli native ──► CPA        grokcli native ──► Sub2API
CPA file       ──► CPA        CPA file       ──► Sub2API
Sub2API file   ──► CPA        Sub2API file   ──► Sub2API
JSONL          ──► CPA        JSONL          ──► Sub2API

→ 5 inputs × 2 outputs = 10 conversion routines
→ the rule "where do I look for email" has to be written 10 times
→ changing one field rule means changing 10 places; miss one and you have a bug
```

Written that way, the code explodes every time you add an input format or an output target.

This project uses a **canonical model** (intermediate format) instead:

```text
✅ Through an intermediate format (N + M paths)

grokcli admin  ─┐
grokcli native ─┤
CPA file        ─┼──► [13 canonical fields] ─┬──► toCpa()      ──► CPA file
Sub2API file    ─┤     intermediate format  └──► toSub2api()  ──► Sub2API payload
JSONL / text    ─┘

→ 5 readers + 2 renderers = 7 routines
→ field rules live in exactly one place (canonicalize)
→ adding a third destination only needs one more toXxx()
```

**The intermediate format is the object returned by `canonicalize()`**, with 13 fields:

```js
return {
  email,                    // account email
  access_token: access,     // the ticket (required)
  refresh_token: refresh,   // the exchange voucher (required)
  id_token: idToken,        // the ID card (may be empty)
  token_type: ...,          // always "Bearer"
  scope: ...,               // permission scope
  client_id: ...,           // application ID
  principal_id: principal,  // user ID
  team_id: ...,             // team ID (may be empty)
  account_id: accountId,    // issuer::principal_id
  expires_at: expEpoch,     // expiry (Unix seconds)
  last_refresh: iatEpoch,   // issuance time (Unix seconds)
  disabled: src.disabled === true,
  source_disabled_reason: ...,
};
```

**Note that times here are Unix seconds, not strings.** That is deliberate:

```text
Source (many formats) ──► canonical (always Unix seconds) ──► render layer (each to its own string)
   ms / s /                          ↑                        ├─ toIso()   → no milliseconds (CPA)
   ISO string / JWT exp        unified here                    └─ toIsoMs() → with milliseconds (Sub2API)
```

**Why store numbers rather than strings in the canonical model?** Because numbers compare easily. The filter layer needs to ask "has this token expired?", which is one line: `r.expires_at <= nowEpoch`. With strings, every comparison would require re-parsing. **Format at the point where formatting is needed** — a general principle.

This pattern is common in software design; it is sometimes called **hub-and-spoke** and sometimes a **canonical data model**. It applies to any "many-to-many conversion" program you write.

---

### Step 1: read the files in (read layer)

**Functions involved**: `loadInput()` → `loadFile()`

#### In plain language

The path you pass to `--input` may be:

- **A folder** → every relevant file inside must be scanned
- **A file** → process it directly

#### The logic of `loadInput()`

```js
function loadInput(input) {
  const out = [];
  const st = fs.statSync(input);
  if (st.isDirectory()) {
    const files = fs.readdirSync(input)
      .filter(f => /\.(json|jsonl|txt)$/i.test(f))
      .filter(f => f.toLowerCase() !== "manifest.json" && f.toLowerCase() !== "sha256sums")
      .sort();
    for (const f of files) loadFile(path.join(input, f), out);
  } else {
    loadFile(input, out);
  }
  return out;
}
```

Line by line:

| What this line does | Why it is done this way |
|---|---|
| `fs.statSync(input)` | Asks the operating system "is this path a file or a folder?" |
| `.filter(/\.(json\|jsonl\|txt)$/i)` | Only these three extensions. `/i` means case-insensitive, so `.JSON` works too |
| Exclude `manifest.json` | **That is an index file this tool itself produces**; it contains no accounts |
| Exclude `sha256sums` | That is a checksum file, not data |
| `.sort()` | **Makes results reproducible.** Without sorting, the filesystem order can differ each run, making "who wins during dedupe" unstable |
| Passing `out` as a parameter | This is the **accumulator pattern**: all recursive calls share one array, so nothing has to be merged afterwards |

#### Why `manifest.json` must be excluded (the trap beginners hit most)

Suppose your first run produced this output directory:

```text
converted/cpa/
├── manifest.json          ← index produced by this tool
└── per-account/
    ├── xai-a@example.com.json
    └── xai-b@example.com.json
```

If you then point `--input` at `converted/cpa/` (to round-trip into Sub2API), without the exclusion rule `manifest.json` would be read as well. It contains no token, so it is judged "incomplete", adding one to `skipped.incomplete` and making you think an account went missing.

**This rule is not fastidiousness — it prevents false alarms from "eating your own output".**

#### `loadFile()`: how the file format is detected

```js
function loadFile(file, out) {
  const ext = path.extname(file).toLowerCase();
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const hint = path.basename(file).replace(/^xai-/, "").replace(/\.(json|jsonl|txt)$/i, "");

  if (ext === ".jsonl") {
    // parse line by line
    for (const line of raw.split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s[0] !== "{") continue;
      try { extractRecords(JSON.parse(s), hint, out); } catch {}
    }
    return;
  }

  try {
    extractRecords(JSON.parse(raw), hint, out);   // try the whole file first
    return;
  } catch {}

  // whole-file parse failed → fall back to "one JSON per line"
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s[0] !== "{") continue;
    try { extractRecords(JSON.parse(s), hint, out); } catch {}
  }
}
```

Three things to note:

**① What is `replace(/^\uFEFF/, "")` for?**

Some Windows programs silently insert an invisible character at the start of UTF-8 files (called the **BOM**, Byte Order Mark, code point `U+FEFF`). Your text editor won't show it, but `JSON.parse()` fails with "unexpected character at position 1". This line strips it.

**② "Try the strictest thing first, degrade on failure"**

```text
Extension is .jsonl?
  │
  ├─ yes → parse line by line directly (JSONL is not valid single JSON by design)
  │
  └─ no  → try JSON.parse() on the whole file
            │
            ├─ success → hand off to extractRecords()
            │
            └─ failure → probably a "header line + one JSON per line" text export
                         → scan line by line, skipping lines that don't start with {
```

This is called **sniffing**. The benefit: **the user doesn't have to tell the script what format the data is in; the script figures it out.**

**③ What is `hint`, and why is it needed?**

```js
const hint = path.basename(file).replace(/^xai-/, "").replace(/\.(json|jsonl|txt)$/i, "");
```

It turns the filename `xai-user@example.com.json` into `user@example.com`.

**Why?** Because some auth files **contain no email at all** — the email exists only in the filename. In that case the filename is the last clue available. It is the final entry in `canonicalize()`'s email lookup chain:

```js
const email =
  src.email || cred.email || (src.extra && src.extra.email) ||
  pl.email || idpl.email || hintName || "";
//                          ↑ only used when everything before is empty
```

**④ Why does `catch {}` swallow errors?**

```js
try { extractRecords(JSON.parse(s), hint, out); } catch {}
```

Because during a line-by-line scan, **one corrupted line should not fail the whole batch of 200 accounts**. Skip that line, carry on with the rest, and when `source_records_seen` in the report doesn't match your expectation you will know something was skipped.

> This is a **deliberate trade-off**: fault tolerance versus explicit failure. Fault tolerance wins here, because in bulk processing "save whatever can be saved" is more useful than "all or nothing".

---

### Step 2: dig accounts out of arbitrary nesting (recognition layer)

**Function involved**: `extractRecords()`

#### In plain language

At this point you hold a parsed JavaScript object. But **accounts may be hidden at any depth**:

```text
Shape A: { auth: { "https://auth.x.ai::uuid": { key, refresh_token } } }
                                              ↑ here (level 3)

Shape B: { accounts: [ { name, credentials: { access_token } } ] }
                                              ↑ here (level 4)

Shape C: { access_token, refresh_token, email }
          ↑ here (level 1)

Shape D: [ {...}, {...}, {...} ]
            ↑ every element in the array
```

#### Why recursion

**Without recursion**, you would need an `if` per shape, and it becomes unwritable as nesting deepens:

```js
// ❌ this spirals out of control
if (obj.auth) { for (...) { if (obj.auth[k].accounts) { for (...) { ... } } } }
```

**With recursion** you only describe "when I meet this shape, where do I keep looking", and the depth problem solves itself:

```js
function extractRecords(node, hintName, out) {
  if (node == null) return;                                    // ① termination condition

  if (Array.isArray(node)) {                                   // ② array → search each element
    for (const item of node) extractRecords(item, hintName, out);
    return;
  }
  if (typeof node !== "object") return;                         // ③ not an object → nothing to find

  // ④ grokcli-2api admin export: { "auth": { "<account_id>": {...} } }
  if (node.auth && typeof node.auth === "object" && !Array.isArray(node.auth)) {
    for (const [k, v] of Object.entries(node.auth)) extractRecords(v, k, out);
    //                                                            ↑ the key becomes the hint!
    return;
  }

  // ⑤ sub2api-data / CPA merged / grokcli export: { accounts: [...] }
  if (Array.isArray(node.accounts)) {
    for (const item of node.accounts) extractRecords(item, hintName, out);
    return;
  }

  // ⑥ Sub2API account object: credentials nesting
  if (node.credentials && typeof node.credentials === "object") {
    const merged = Object.assign({}, node.credentials, {
      email: node.credentials.email || (node.extra && node.extra.email) || node.name,
      disabled: node.disabled,
    });
    out.push(canonicalize(merged, hintName));
    return;
  }

  // ⑦ flat account object (native grokcli xai file, CPA auth file, admin auth entry)
  if (node.access_token || node.key || node.refresh_token) {
    out.push(canonicalize(node, hintName));
    return;
  }
}
```

#### Branch by branch

| # | Condition | Action | Why |
|---|---|---|---|
| ① | `node == null` | return immediately | **The recursion's termination condition.** Without it you loop forever |
| ② | is an array | call itself on each element | The array itself is not an account; its elements are |
| ③ | not an object | return immediately | Strings and numbers cannot contain accounts |
| ④ | has an `auth` object | recurse into each value, **passing the key as the hint** | This is grokcli-2api's shape, where the key *is* the `account_id` |
| ⑤ | has an `accounts` array | recurse into each element | Both Sub2API and CPA merged files use this shape |
| ⑥ | has a `credentials` object | **flatten, then accept** | Sub2API wraps tokens inside `credentials` |
| ⑦ | has `access_token` or `key` or `refresh_token` | accept directly | The most basic "flat object" shape |

**Note that every branch ends in `return`.** That means "once a matching shape is found, stop; do not try the other branches" — **earlier checks take priority**. The order must not be shuffled: if ⑦ came before ④, the outer layer of a grokcli admin export could be misidentified.

#### ④ Why pass the key as a hint (a neat trick)

A grokcli-2api export:

```json
{
  "auth": {
    "https://auth.x.ai::0552a0b9-953e-43ce-bd11-9eb435cec24a": {
      "key": "eyJ...",
      "refresh_token": "mmhF..."
    }
  }
}
```

Note: **the `account_id` is the object's key, not a field inside it.** If the key isn't passed down, that information is lost forever.

So `extractRecords(v, k, out)` passes the key down as `hintName`. Although it is mainly used as an email fallback in the end, this technique of **carrying outer context down with you** is very common when handling nested data.

#### ⑥ Why `Object.assign()` is used to flatten

A Sub2API account object looks like this:

```json
{
  "name": "user@example.com",
  "platform": "grok",
  "credentials": { "access_token": "...", "refresh_token": "..." },
  "extra": { "email": "user@example.com" },
  "disabled": false
}
```

The email can appear in **three places**: `credentials.email`, `extra.email`, and `name`. Meanwhile the tokens are inside `credentials`.

```js
const merged = Object.assign({}, node.credentials, {
  email: node.credentials.email || (node.extra && node.extra.email) || node.name,
  disabled: node.disabled,
});
```

Meaning: **start from `credentials`, then add the email and `disabled` picked up from the outer layer**, flattened into one plain object before handing it to `canonicalize()`.

This way `canonicalize()` never has to know what Sub2API's structure looks like — **the complexity is isolated in the recognition layer**.

#### A bonus benefit: reverse round-trips work

Because ⑤⑥ recognise Sub2API's shape and ⑦ recognises CPA's shape:

```text
Sub2API file ──► this script ──► CPA file      ✅ works
CPA file     ──► this script ──► Sub2API file  ✅ also works
```

This **was not a designed feature; it is a natural by-product of recursion plus the canonical model.** Good architecture often behaves like this: a design made for purpose A happens to solve problem B.

---
### Step 3: assemble thirteen fields (normalization layer)

**Responsible function**: `canonicalize()`, helped by the utility functions `jwtPayload()` and `toEpoch()`.

This is the **most important** part of the whole script. All the "compatibility intelligence" is concentrated here.

#### The core trick: `||` chaining

JavaScript's `||` (or) operator has a useful property: **it returns the first thing that has a value**.

```js
const access = src.access_token || src.accessToken || src.key || src.token || "";
```

Meaning: first check whether `access_token` has a value; if not, check `accessToken`; still nothing, check `key`… and if none of them has anything, fall back to an empty string.

**That single line replaces a long chain of `if / else if`.** It reads like a **priority list**.

> ⚠️ A small trap: `||` also treats `0`, `""` and `false` as "no value". For token strings that is fine (an empty string genuinely should be skipped), but if you ever handle a field where **the number 0 is a legitimate value**, you must switch to `??` (nullish coalescing). None of the fields in this script need that, so `||` stays the cleanest choice.

#### Three-tier resolution precedence

Every field obeys the same principle:

```text
① the field the source file explicitly wrote
        ↓ missing
② dug out of the access_token JWT payload
        ↓ missing
③ the default from xAI's documentation (hard-coded constant)
```

**Why this order?**

| Rank | Why it sits here |
|---|---|
| ① source field | **Most trustworthy.** A value the tool explicitly stored means the tool itself confirmed it |
| ② JWT claim | **Second most trustworthy.** It was signed by xAI so it is certainly correct, but it may be incomplete |
| ③ hard-coded default | **Last resort.** At minimum the account still runs; one missing `scope` should not throw away a whole record |

The actual constants (declared at the top of the file):

```js
const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const XAI_ISSUER = "https://auth.x.ai";
const CPA_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
const CPA_TOKEN_HEADER = { "X-XAI-Token-Auth": "xai-grok-cli" };
const DEFAULT_SCOPE = "openid profile email offline_access grok-cli:access api:access";
```

> These are all **public identifiers of the official grok-cli public client**, not anybody's private data. Keeping them in source is safe.

#### `jwtPayload()`

```js
function jwtPayload(token) {
  if (typeof token !== "string" || !token.includes(".")) return {};
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch { return {}; }
}
```

Step by step:

| Step | Code | Explanation |
|---|---|---|
| 1 | `typeof token !== "string"` | Not a string, no point trying |
| 2 | `!token.includes(".")` | No dot means it is not a JWT (could be an API key or similar) |
| 3 | `token.split(".")[1]` | Split on dots into three parts and take the **middle** one (index 1) |
| 4 | `Buffer.from(..., "base64url")` | Base64URL-decode into bytes |
| 5 | `.toString("utf8")` | Bytes become text |
| 6 | `JSON.parse(...)` | Text becomes an object |
| 7 | `catch { return {} }` | If any step fails, return an **empty object** |

**⑦ Why return an empty object instead of `null`?**

Because the caller can then write `pl.exp` directly without checking first:

```js
const pl = jwtPayload(access);   // guaranteed to be an object
const expEpoch = toEpoch(pl.exp) || ...;   // cannot blow up
```

If it returned `null`, every use site would have to write `pl && pl.exp`. **This is the Null Object Pattern**: use an object that "holds nothing but has the right shape" instead of forcing `null` checks everywhere.

#### `toEpoch()`

```js
function toEpoch(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v);
  const n = Number(v);
  if (Number.isFinite(n) && String(v).trim() !== "") {
    return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
  }
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}
```

It accepts four kinds of input:

| Example input | Which path | Result |
|---|---|---|
| `1786291200` (number, seconds) | line 2 | `1786291200` |
| `1786291200000` (number, milliseconds) | line 2, `> 1e12` holds | divide by 1000 → `1786291200` |
| `"1786291200"` (numeric string) | lines 3-4, `Number()` succeeds | `1786291200` |
| `"2026-08-08T12:00:00Z"` (ISO string) | final `Date.parse()` | `1786291200` |
| `null` / `""` / garbage | the various guards | `0` |

**Returning `0` means "absent"**, because `0` is treated as "no value" inside a `||` chain and the search simply continues. That is what makes `toEpoch(a) || toEpoch(b) || toEpoch(c)` work naturally.

#### Field-by-field strategy

##### access_token

```js
const access =
  src.access_token || src.accessToken || src.key || src.token ||
  (src.credentials && src.credentials.access_token) || "";
```

Five locations, and **`key` is the crucial one** (the grokcli-2api admin export uses it). `accessToken` is the camelCase variant some tools write.

##### refresh_token

```js
const refresh =
  src.refresh_token || src.refreshToken ||
  (src.credentials && src.credentials.refresh_token) || "";
```

##### email

```js
const email =
  src.email || cred.email || (src.extra && src.extra.email) ||
  pl.email || idpl.email || hintName || "";
```

Six locations, in this order: **source field → nested field → access token JWT → id token JWT → filename**.

Note that two JWTs get decoded here:

```js
const pl = jwtPayload(access);     // payload of the access token
const idpl = jwtPayload(idToken);  // payload of the id token
```

**Why decode the id token as well?** Because an id token exists specifically to describe *who you are*, so identity information such as email is usually more complete in it. An access token is about permissions and does not necessarily carry an email.

##### principal_id

```js
const principal =
  src.principal_id || src.user_id || src.sub || pl.principal_id || pl.sub || idpl.sub || "";
```

Six locations. `sub` is the OAuth standard field name for "subject"; `user_id` and `principal_id` are what different tools call the same thing.

##### account_id

```js
const accountId =
  src.account_id || src.id ||
  (principal ? XAI_ISSUER + "::" + principal : "");
```

**If the source wrote one, use it; otherwise build one out of `principal_id`.** That is where the `https://auth.x.ai::<uuid>` format comes from.

Note the `principal ? ... : ""` — if there is no `principal_id` either, return an empty string rather than assembling a mutilated ID such as `https://auth.x.ai::`.

##### expires_at

```js
const expEpoch =
  toEpoch(src.expires_at) || toEpoch(cred.expires_at) || toEpoch(src.expired) ||
  toEpoch(pl.exp) ||
  (src.expires_in && src.last_refresh
    ? toEpoch(src.last_refresh) + Number(src.expires_in) : 0);
```

Four fallback tiers, and **note the order: source fields come before the JWT `exp`**. The source has a comment explaining why:

> `// Explicit source expiry wins; grokcli-2api stores the authoritative value and`
> `// it can differ from the JWT exp claim by a second. JWT exp is the fallback.`

In plain words: **the expiry grokcli-2api stored can differ from the JWT `exp` by a second.** Since the source tool keeps its own record, that record wins — it knows its own state better.

The last tier, `last_refresh + expires_in`, is **computed**: some formats only record "when it was issued" plus "how many seconds until it expires", never an absolute time.

##### last_refresh

```js
const iatEpoch = toEpoch(pl.iat) || toEpoch(src.last_refresh) || toEpoch(src.create_time);
```

**Here the order is reversed: the JWT `iat` wins.** Why? Because `iat` was written into the token by xAI at signing time, so it **is the real moment this token was issued** — more precise than a source tool's own note about "when I last refreshed".

> The two fields deliberately use different precedence because their meanings differ: `exp` is a **prediction** (renewal can change it), while `iat` is a **fact** (an issuance that already happened).

##### scope / client_id / team_id

```js
scope: pl.scope || src.scope || cred.scope || DEFAULT_SCOPE,
client_id: pl.client_id || src.oidc_client_id || src.client_id || cred.client_id || pl.aud || XAI_CLIENT_ID,
team_id: src.team_id || pl.team_id || "",
```

- `scope` and `client_id` are **JWT-first**, because both are facts decided by xAI at signing time
- `client_id` has a special fallback, `pl.aud` — in the OAuth standard `aud` (audience) is normally the client id
- `team_id` is **allowed to be empty**, because not every account belongs to a team

#### Required-field check: `isUsable()`

```js
function isUsable(rec) {
  return Boolean(rec.access_token && rec.refresh_token && rec.email);
}
```

If any one of these three is missing, the whole record is dropped in the filter layer and counted under `skipped.incomplete`.

**Why exactly these three?**

| Field | Why it is non-negotiable |
|---|---|
| `access_token` | Without the ticket, nothing can be done |
| `refresh_token` | Without the exchange voucher the account is dead within hours — importing it is a waste |
| `email` | **Both the filename and account identification depend on it.** CPA's filename format literally is `xai-<email>.json` |

Note that `id_token` and `team_id` are **not** on the required list. Accounts work fine without them.

> There is an important design judgement on display here: **the required list must be "just enough" and never greedy.** If `team_id` were also required, plenty of perfectly usable accounts would be killed by mistake.

---
### Step 4: the filter pipeline (filter layer)

**Location**: inside the `main()` function.

#### In plain language

At this point you have a big pile of normalized accounts. This layer is responsible for **dropping the ones that should not be exported**, and for **recording why each one was dropped**.

```js
const seen = new Set();
const skipped = { incomplete: 0, duplicate: 0, excluded: 0, expired: 0 };
let records = [];
for (const r of raw) {
  if (!isUsable(r)) { skipped.incomplete++; continue; }
  const key = (r.account_id || r.email).toLowerCase();
  if (seen.has(key)) { skipped.duplicate++; continue; }
  if (exclude.has(String(r.email).toLowerCase())) { skipped.excluded++; continue; }
  if (a.skipExpired && r.expires_at && r.expires_at <= nowEpoch) { skipped.expired++; continue; }
  seen.add(key);
  records.push(r);
}
if (a.limit > 0) records = records.slice(0, a.limit);
```

#### The four gates

```text
all normalized accounts
      │
      ▼
[Gate 1] isUsable()?                 ──no──► skipped.incomplete++
      │yes
      ▼
[Gate 2] key already seen?           ──yes─► skipped.duplicate++
      │no
      ▼
[Gate 3] on the exclude list?         ──yes─► skipped.excluded++
      │no
      ▼
[Gate 4] --skip-expired and expired? ──yes─► skipped.expired++
      │no
      ▼
   accepted, key recorded
      │
      ▼
[Finally] --limit N ? ──► keep only the first N
```

#### Why the dedupe key falls back to email

```js
const key = (r.account_id || r.email).toLowerCase();
```

**`account_id` is preferred** because it is the genuinely unique identifier. The same account can appear in different export files with different email capitalisation, but `account_id` is always identical.

**When `account_id` is missing, fall back to email**, because that is still better than no deduplication at all.

**`.toLowerCase()` is necessary**: in most systems email is case-insensitive, so `User@Example.com` and `user@example.com` are the same person. Without lowercasing they would be counted as two records and imported twice.

#### What a `Set` is

JavaScript's `Set` is a "collection without duplicates". A `seen.has(key)` lookup costs **O(1)** (constant time), regardless of how many items are inside.

If you used an array with `.includes()`, each lookup would be **O(n)**: with 1000 records that is 1000 comparisons per lookup, a million comparisons in total. **With a Set it is 1000.**

> This is a very practical piece of performance common sense: **when you need to keep asking "have I seen this before", use a Set or a Map, not an array.**

#### Gate 3: why `--exclude-emails` exists

This parameter exists to **stop one account from being held by two systems at once**.

```text
one and the same refresh token
        │
        ├──► CPA      uses it to get a new token → the old one is void
        │
        └──► Sub2API  tries the old one → invalid_grant ❌
```

**A refresh token is usually single-use**: once spent it is replaced by a new one and the old one dies immediately. So if the same account is loaded into two environments at once, one of the two sides will eventually receive:

```text
invalid_grant / Refresh token has been revoked
```

`--exclude-emails` lets you keep your **deployments mutually exclusive**:

```bash
# first batch of 100 for CPA
node scripts/convert_xai_auth.mjs --input ./export --outdir ./out-cpa \
  --target cpa --limit 100

# record the used emails in cpa-used.txt, then exclude them for the Sub2API batch
node scripts/convert_xai_auth.mjs --input ./export --outdir ./out-sub \
  --target sub2api --exclude-emails ./cpa-used.txt
```

The parameter itself supports **two notations**, and the program figures out which one you meant:

```js
if (fs.existsSync(a.excludeEmails)) {
  // it is a file → one email per line
  for (const line of fs.readFileSync(a.excludeEmails, "utf8").split(/\r?\n/)) {
    const s = line.trim(); if (s) exclude.add(s.toLowerCase());
  }
} else {
  // not a file → treat it as a comma-separated list
  for (const s of a.excludeEmails.split(",")) if (s.trim()) exclude.add(s.trim().toLowerCase());
}
```

**Check whether it is a file first; if not, treat it as a list.** This "one parameter, two usages" design is convenient for someone who only wants to exclude two or three emails and does not want to create a file just for that.

#### Gate 4: why expiry isn't filtered by default

```js
if (a.skipExpired && r.expires_at && r.expires_at <= nowEpoch) { ... }
```

Note that you must **explicitly pass `--skip-expired`** for this to take effect. The default is **not to filter**.

**Why?** Because an expired `access_token` is a **normal state**, and it is **recoverable**: as long as the `refresh_token` is still valid, CPA / Sub2API will automatically exchange it for a fresh ticket after import.

If expiry were filtered by default, you would throw away a large batch of accounts that are in fact perfectly usable.

That is why `warnings.access_token_already_expired` in the report is a **warning, not an error**:

```text
warnings.access_token_already_expired: 4
   ↑ the tickets of these 4 accounts have expired, but they are still exported
     after import they will be renewed automatically via the refresh token
```

---
### Step 5: shape it the way each side wants (render layer)

**Responsible functions**: `toCpa()` and `toSub2api()`.

By this point the data is fully unified, so the render layer has a very simple job: **lay the fields out in the shape the destination expects**.

#### `toCpa()`: the shape CPA wants

```js
function toCpa(rec) {
  return {
    type: "xai",
    auth_kind: "oauth",
    email: rec.email,
    access_token: rec.access_token,
    refresh_token: rec.refresh_token,
    token_type: rec.token_type,
    expired: toIso(rec.expires_at),          // ← no milliseconds
    last_refresh: toIso(rec.last_refresh),   // ← no milliseconds
    base_url: CPA_BASE_URL,
    headers: Object.assign({}, CPA_TOKEN_HEADER),
    disabled: false,
    account_id: rec.account_id,
    user_id: rec.principal_id,
    sub: rec.principal_id,
    team_id: rec.team_id,
    oidc_client_id: rec.client_id,
    scope: rec.scope,
  };
}
```

A few things worth noticing:

**① Field names change**

| Intermediate format | What CPA calls it |
|---|---|
| `expires_at` | `expired` |
| `principal_id` | `user_id` **and** `sub` (the same value written into two fields!) |
| `client_id` | `oidc_client_id` |

**Why write the same value into both `user_id` and `sub`?** Because different code paths inside CPA read different fields. Filling both is the safest thing to do — that is an empirically established conclusion, not a theory.

**② Why `Object.assign({}, CPA_TOKEN_HEADER)` instead of the constant itself**

```js
headers: Object.assign({}, CPA_TOKEN_HEADER),   // ✅
headers: CPA_TOKEN_HEADER,                       // ❌ dangerous
```

If you wrote `CPA_TOKEN_HEADER` directly, **the `headers` of all 200 accounts would point at one and the same object**. If anyone later modified the header of one account, the other 199 would change with it.

`Object.assign({}, x)` is a **shallow copy**, so every account gets its own copy.

> This is one of the most common sources of bugs for JavaScript newcomers: **objects are passed by reference, not copied.** If you want a copy, you have to say so explicitly.

**③ `disabled: false` is always hard-coded**

```js
disabled: false,
```

Even when the intermediate record carries `rec.disabled` (the source pool marked it disabled), the output **still writes `false`**.

**Why design it this way?** Because "disabled in the source pool" and "should it be enabled in the destination pool" are **two different questions**. Very often the reason you are moving an account from machine A to machine B is precisely that it was disabled on A. If the conversion disabled it for you automatically, you would then have to go into the admin panel and re-enable them one by one.

**But this is behaviour you need to be aware of**: if your source pool contains a pile of deliberately disabled dead accounts, they will also be exported in an enabled state. To avoid that, check the states in the source pool first, or exclude them with `--exclude-emails`.

#### `toSub2api()`: the shape Sub2API wants

```js
function toSub2api(rec, baseUrl) {
  return {
    name: rec.email,
    platform: "grok",
    type: "oauth",
    credentials: {
      access_token: rec.access_token,
      refresh_token: rec.refresh_token,
      token_type: rec.token_type,
      expires_at: toIsoMs(rec.expires_at),   // ← with milliseconds
      email: rec.email,
      client_id: rec.client_id,
      base_url: baseUrl,
    },
    extra: { email: rec.email },
    concurrency: 1,
    priority: 1,
    rate_multiplier: 1,
    auto_pause_on_expired: true,
  };
}
```

Side-by-side differences:

| Aspect | CPA | Sub2API |
|---|---|---|
| **Structure** | flat | tokens wrapped inside `credentials` |
| **Time** | `toIso()`, no milliseconds | `toIsoMs()`, **with** milliseconds |
| **Where email goes** | `email` | `name`, `credentials.email`, `extra.email` (three places!) |
| **base_url** | hard-coded constant | overridable by argument (`--sub2api-base-url`) |
| **Scheduling fields** | none | `concurrency`, `priority`, `rate_multiplier` |
| **Fields not needed** | — | no `team_id`, `scope` or `principal_id` |

**Why does email go in three places?** Another empirical conclusion: the Sub2API admin list reads `name`, the quota lookup reads `credentials.email`, and internal labels read `extra.email`. Only by filling all three do you avoid blanks somewhere in the UI.

**Why is `concurrency: 1` rather than 10?** Because a free Grok account has a fairly small allowance (roughly a 1M-token rolling quota per account). Setting 1 is the conservative value: it avoids firing several simultaneous requests at the same account and hitting the limit sooner. If your accounts are on a paid plan, feel free to raise it.

> If you want different defaults, just edit the literal values inside these two functions — **one edit takes effect everywhere**, which is exactly the benefit the intermediate-format architecture buys you.

---
### Step 6: writing files and the report (output layer)

#### `writeJson()`

```js
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
}
```

| This line | What it does |
|---|---|
| `path.dirname(file)` | Takes the folder path the file lives in |
| `{ recursive: true }` | **Creates every missing intermediate folder.** That is why you never have to create `cpa/per-account/` by hand |
| `JSON.stringify(obj, null, 2)` | The `2` means indent by two spaces, producing **layout a human can read** |

**Why indent at all?** Because you may want to open the file and inspect it manually, or use `git diff` to compare two exports. JSON squashed onto one line makes diffs useless.

#### When each of the four outputs is produced

```js
const wantCpa = a.target === "cpa" || a.target === "both";
const wantSub = a.target === "sub2api" || a.target === "both";
const wantMerged = a.mode === "merged" || a.mode === "both";
const wantSplit = a.mode === "split" || a.mode === "both";
```

**Compute "do I want this?" into four booleans first**, and afterwards you only need four `if` statements:

```text
if (wantCpa && wantSplit)  → cpa/per-account/*.json + cpa/manifest.json
if (wantCpa && wantMerged) → cpa/cpa-xai-merged-<N>.json
if (wantSub && wantMerged) → sub2api/sub2api-<label>-all-<N>.json
if (wantSub && wantSplit)  → sub2api/per-account/*.json
```

That is far clearer than repeating `a.target === "cpa" || a.target === "both"` in four different places. **Extracting a condition into a named variable is the cheapest way there is to make code readable.**

#### What `manifest.json` is

Only CPA split mode produces it:

```js
writeJson(manifest, {
  exported_at: stamp,
  format: "CLIProxyAPI xAI OAuth",
  label: a.label,
  count: records.length,
  import_hint: "POST /v0/management/auth-files (multipart file=@xai-<email>.json), one file per account",
  files: records.map(r => "xai-" + safeName(r.email) + ".json"),
});
```

**Why is it needed?** Because CPA uploads one file per account. When 200 files are sitting in front of you, you will want to:

- know **how many there should be** (`count`) → so you can verify nothing is missing
- get **the complete list of filenames** (`files`) → so you can write a for loop to upload them automatically
- remember **how to upload them** (`import_hint`) → so it still makes sense six months later
- know **when the conversion happened** (`exported_at`) → very useful when debugging

**This is precisely why `loadInput()` skips `manifest.json`** — it is a description for humans and scripts, not account data.

#### Why `cpa-xai-merged-<N>.json` is "not importable"

```js
writeJson(f, {
  type: "cliproxyapi-xai-auth-bundle",
  version: 1,
  exported_at: stamp,
  note: "CPA /v0/management/auth-files imports individual JSON files; this merged file is backup/reference only.",
  count: records.length,
  accounts: records.map(r => Object.assign({ file: "xai-" + safeName(r.email) + ".json" }, toCpa(r))),
});
```

**Notice the `note` field — it writes "this file cannot be imported" straight into the file itself.**

CPA's import API only accepts single-account JSON files. The reasons this merged file exists at all are:

| Purpose | Explanation |
|---|---|
| **Backup** | One file holds everything, easy to archive |
| **Comparison** | Use `git diff` to see what changed between two exports |
| **Re-run source** | It can itself be fed back in as `--input` and converted to Sub2API |

Each record also carries an extra `file` field recording which per-account filename it corresponds to, which makes cross-referencing easy.

> **A design reminder**: if a file is easy to misuse, then besides documenting it in the README, **it is best to write a sentence of explanation inside the file content too.** Whoever receives the file does not necessarily have the README at hand.

#### Filename sanitising: `safeName()`

```js
function safeName(email) {
  return String(email).replace(/[\\\/:*?"<>|]/g, "_");
}
```

It replaces the characters Windows forbids in filenames (`\\ / : * ? " < > |`) with underscores.

**How would an email contain those characters?** Normally it would not, but:

- the source data may be polluted
- `hintName` comes from a filename and may not really be an email
- someone may have edited the file by hand

**Without sanitising, `fs.writeFileSync()` on Windows would throw outright and abort the whole batch.** One line of defence for that much stability is well worth it.

#### The report output

```js
console.log(JSON.stringify(report, null, 2));
```

**It prints to stdout, and it is valid JSON.** That means you can do:

```bash
node scripts/convert_xai_auth.mjs --input ./export --outdir ./out > report.json
```

to save the report as a file, or pipe it into another tool for further processing.

**The report never contains token values**, only counts, paths and arguments. That is deliberate: reports frequently get pasted into chat rooms or issues for discussion.

---

## Supported input shapes (5 of them)

| # | Shape | Key characteristic | Which branch recognises it |
|---|---|---|---|
| 1 | **grokcli-2api admin export** | `{ "auth": { "https://auth.x.ai::<uuid>": { key, refresh_token } } }`; **the access token lives in `key`** | `extractRecords()` ④ |
| 2 | **Native grokcli auth file** | `xai-<email>.json`, containing `type: "xai"`, `access_token`, `refresh_token`, `sub` | `extractRecords()` ⑦ |
| 3 | **CPA auth file** | flat object containing `base_url` and `headers` | `extractRecords()` ⑦ |
| 4 | **Sub2API payload** | `accounts[].credentials` | `extractRecords()` ⑤⑥ |
| 5 | **JSON array / JSONL / text export** | one JSON object per line | the fallback path in `loadFile()` |

**③④ are what make reverse round-trips possible**: a CPA file can be turned back into Sub2API, and a Sub2API file into CPA.

Skip rules in folder mode:

| Rule | Why |
|---|---|
| Only read `.json` / `.jsonl` / `.txt` | Other extensions cannot possibly be data |
| Skip `manifest.json` | **That is the listing file this tool produces**, it holds no accounts |
| Skip `SHA256SUMS` | That is a checksum file |

---
## Four outputs: a two-axis cross product

The four outputs are not four arbitrary choices; they are **two independent axes crossed with each other**:

```text
                 --mode merged          --mode split
              ┌──────────────────────┬──────────────────────┐
--target cpa  │ cpa-xai-merged-N     │ per-account/         │
              │ .json                │   xai-<email>.json   │
              │ (backup, not         │ + manifest.json      │
              │  importable)         │ ← CPA imports these  │
              ├──────────────────────┼──────────────────────┤
--target      │ sub2api-<label>-     │ per-account/         │
  sub2api     │   all-N.json         │   <email>_sub2api    │
              │ ← Sub2API bulk       │   .json              │
              │   import             │ (for a single-record │
              │                      │  trial first)        │
              └──────────────────────┴──────────────────────┘
```

**The two axes mean completely different things:**

| Axis | What it decides | Consequence of choosing wrong |
|---|---|---|
| `--target` | **Format** (field names, time precision, structure) | Import rejected, or import succeeds but calls fail |
| `--mode` | **Packaging** (one big bundle or a pile of small files) | The import interface simply refuses it |

### Which one should you use

```text
Where are you importing to?
  │
  ├─ CPA
  │    └─► --target cpa --mode split
  │          use per-account/xai-<email>.json
  │          (the merged one is only a backup, do not import it)
  │
  └─ Sub2API
       │
       ├─ first time, want to confirm the format is right
       │    └─► --target sub2api --mode split
       │          try one <email>_sub2api.json first
       │
       └─ already confirmed, going bulk
            └─► --target sub2api --mode merged
                  use sub2api-<label>-all-N.json
```

**Do not throw 200 accounts in on your first attempt.** Use split to import a single record, and scale up once it succeeds.

---

## Command-line arguments

| Argument | Value | Default | Explanation |
|---|---|---|---|
| `--input` | file or folder | **required** | Source export. A folder is read for `*.json`, `*.jsonl` and `*.txt`, skipping `manifest.json` / `SHA256SUMS` |
| `--outdir` | folder | **required** | Output root; `cpa/` and `sub2api/` are created automatically |
| `--target` | `cpa` \| `sub2api` \| `both` | `both` | Which formats to produce |
| `--mode` | `merged` \| `split` \| `both` | `both` | Bundle file, per-account files, or both |
| `--label` | string | `xai` | Label used in output filenames, e.g. `--label batch01` produces `sub2api-batch01-all-50.json` |
| `--limit` | integer | `0` (unlimited) | Keep only the first N records **after deduplication** |
| `--skip-expired` | flag (no value needed) | off | Drop accounts whose access token has already expired |
| `--exclude-emails` | file path or comma list | none | Exclude these emails (avoids double deployment) |
| `--sub2api-base-url` | URL | `https://cli-chat-proxy.grok.com/v1` | Override Sub2API's `credentials.base_url` |
| `--on-invalid` | `abort` \| `skip` | `abort` | Abort the whole batch on the first invalid record (`abort`), or skip it and list the reason in the report (`skip`) |

### The design of argument parsing

```js
default:
  throw new Error("unknown argument: " + k);
```

**An unknown argument aborts immediately; it is never silently ignored.**

**Why does that matter?** Suppose you mistype `--taget cpa`. If the program silently ignored it, it would run to completion using the default `both`, and you would believe only CPA files were produced while Sub2API files were quietly created too. **A silent mistake is more dangerous than an obvious one.**

And because `parseArgs()` runs at the very beginning, **no directory has been created yet when it aborts**, so no half-finished output is left behind.

---

## Output directory structure

```text
<outdir>/
├── cpa/
│   ├── cpa-xai-merged-<N>.json        # backup / reference only, not importable
│   ├── manifest.json                  # count + file list + import hint
│   └── per-account/
│       └── xai-<email>.json           # ← these are what CPA actually imports
└── sub2api/
    ├── sub2api-<label>-all-<N>.json   # ← Sub2API bulk import
    └── per-account/
        └── <email>_sub2api.json       # for verifying one account first
```

**Putting the count `<N>` in the filename is deliberate**: the filename alone tells you how many accounts are inside, without opening the file. If you convert the same source twice and the counts differ, you notice immediately.

---

## How to import

### CPA / CLIProxyAPI

**One file per account.**

```bash
curl -X POST "<CPA_BASE>/v0/management/auth-files" \
  -F "file=@./converted/cpa/per-account/xai-user@example.com.json"
```

Or simply drop the files into the container's `auths/` directory.

For bulk upload, write a loop over the `files` list in `manifest.json`.

> ⚠️ `cpa-xai-merged-<N>.json` is **not importable**; it is only a bundle for backup and diffing.

### Sub2API

The admin import accepts a `sub2api-data` payload object:

- Bulk: `sub2api/sub2api-<label>-all-<N>.json`
- Single trial first: `sub2api/per-account/<email>_sub2api.json`

---

## Field mapping table

| Normalized field | CPA output | Sub2API output | Resolution order (leftmost wins) |
|---|---|---|---|
| access token | `access_token` | `credentials.access_token` | `access_token` / `accessToken` / **`key`** / `token` / `credentials.access_token` |
| refresh token | `refresh_token` | `credentials.refresh_token` | `refresh_token` / `refreshToken` / `credentials.refresh_token` |
| id token | not used | not used | `id_token` / `idToken` / `credentials.id_token` (only used to dig out email and sub) |
| email | `email` | `name`, `credentials.email`, `extra.email` | `email` / `credentials.email` / `extra.email` / access JWT `email` / id JWT `email` / filename |
| expiry | `expired` (RFC3339, **without** milliseconds) | `credentials.expires_at` (RFC3339, **with** milliseconds) | `expires_at` / `credentials.expires_at` / `expired` → JWT `exp` → `last_refresh + expires_in` |
| last refresh | `last_refresh` | not used | JWT `iat` → `last_refresh` → `create_time` |
| principal | `user_id`, `sub`, `account_id` | not used | `principal_id` / `user_id` / `sub` / JWT `principal_id` / JWT `sub` / id JWT `sub` |
| team | `team_id` | not used | `team_id` / JWT `team_id` (may be empty) |
| client id | `oidc_client_id` | `credentials.client_id` | JWT `client_id` / `oidc_client_id` / `client_id` / `credentials.client_id` / JWT `aud` / xAI default |
| scope | `scope` | not used | JWT `scope` / `scope` / `credentials.scope` / xAI default |
| token type | `token_type` | `credentials.token_type` | `token_type` / `credentials.token_type` / `"Bearer"` |
| base url | fixed `https://cli-chat-proxy.grok.com/v1` | `--sub2api-base-url` | constant / argument |
| auth header | `headers["X-XAI-Token-Auth"] = "xai-grok-cli"` | not used | constant |

### Fixed constants

| Item | Value | Explanation |
|---|---|---|
| xAI OIDC issuer | `https://auth.x.ai` | The issuing authority |
| xAI grok-cli client_id | `b1a00492-073a-47ea-816f-4c329264a828` | grok-cli's official public client ID |
| How `account_id` is built | `https://auth.x.ai::<principal_id>` | Note it is **two colons** |
| Default scope | `openid profile email offline_access grok-cli:access api:access` | grok-cli's standard permission set |
| CPA fixed fields | `type: "xai"`, `auth_kind: "oauth"`, `disabled: false` | — |
| Sub2API fixed fields | `platform: "grok"`, `type: "oauth"`, `concurrency: 1`, `priority: 1`, `rate_multiplier: 1`, `auto_pause_on_expired: true` | — |

> **⚠️ Remember the `disabled: false` behaviour**: CPA output always writes `false`, so **accounts that were disabled in the source pool are still exported in an enabled state**. The reasoning is explained in [Step 5](#step-5-shape-it-the-way-each-side-wants-render-layer). If that matters to you, check the states in the source pool separately, or exclude them with `--exclude-emails`.

### Sensitive fields are never carried over

Source files may contain these fields. **Neither output format uses them, and neither copies them across**:

| Field | What it is |
|---|---|
| `password` | The account password in plain text |
| `sso` | An SSO cookie |
| `session_cookies` | A browser session |

That is because the render layer **explicitly lists the fields it wants** (an allowlist), rather than "copy the whole object and delete a few" (a denylist). **An allowlist is safer than a denylist**: when a new source adds another sensitive field, an allowlist automatically keeps it out, whereas a denylist relies on you remembering to add it.

---
## How to read the run report

When the script finishes it prints the report to stdout as JSON:

```json
{
  "input": "./my-grok-export",
  "outdir": "./converted",
  "target": "both",
  "mode": "both",
  "source_records_seen": 120,
  "accounts_converted": 115,
  "skipped": { "incomplete": 2, "duplicate": 3, "excluded": 0, "expired": 0 },
  "cpa_per_account_files": 115,
  "sub2api_per_account_files": 115,
  "merged_files": ["..."],
  "warnings": {
    "access_token_already_expired": 4,
    "missing_team_id": 0,
    "missing_principal_id": 0
  },
  "sub2api_base_url": "https://cli-chat-proxy.grok.com/v1",
  "file_stamp": "20260808T120000Z"
}
```

### Start with an arithmetic check

```text
source_records_seen
  - skipped.incomplete
  - skipped.duplicate
  - skipped.excluded
  - skipped.expired
  = accounts_converted        ← should match exactly (unless --limit was used)
```

In the example above: `120 - 2 - 3 - 0 - 0 = 115` ✅

**If the arithmetic does not work out, it means you used `--limit`** (which slices at the very end).

### How to read each field

| Field | Reading | Should you worry |
|---|---|---|
| `source_records_seen` | How many records were dug out of the source files in total | Lower than expected → check whether the format was recognised |
| `accounts_converted` | How many were actually written out | This is the number that matters most |
| `skipped.incomplete` | Missing access / refresh token / email | A few is normal; **a lot means the format was not recognised correctly** |
| `skipped.duplicate` | Duplicate by `account_id` (falling back to email) | Normal. Happens when the same account appears in several source files |
| `skipped.excluded` | Excluded by `--exclude-emails` | Should equal the number of entries on your list |
| `skipped.expired` | Dropped by `--skip-expired` | Guaranteed to be 0 if you did not pass that flag |
| `warnings.access_token_already_expired` | Ticket expired, exported anyway | **Acceptable**; it will be renewed automatically after import |
| `warnings.missing_team_id` | No team | Usually ignorable; personal accounts have no team to begin with |
| `warnings.missing_principal_id` | No user ID | **Pay attention**: `account_id` will be empty and CPA may not identify it correctly |
| `file_stamp` | The timestamp of this run | Useful for cross-referencing logs while debugging |

### The one situation to be alarmed about

```text
"source_records_seen": 200,
"accounts_converted": 0,
"skipped": { "incomplete": 200, ... }
```

**All 200 records "incomplete" = your source format was not recognised correctly.**

The most common cause is exactly this: **the access token sits in the `key` field and was not recognised.** Open the source file in a text editor and check:

- whether it has the `{ "auth": { ... } }` shape
- whether the token is in `key` or in `access_token`
- whether `refresh_token` is present (**an access token with no refresh token is also dropped entirely**)

---

## Safety guardrails

| Guardrail | Behaviour | Where it is implemented |
|---|---|---|
| Never writes to the source | It never writes into the `--input` directory, only into `--outdir` | Every `writeJson()` in `main()` is rooted at `a.outdir` |
| Never carries sensitive fields | `password` / `sso` / `session_cookies` never appear in the output | `toCpa()` / `toSub2api()` use an allowlist |
| Never leaks tokens | The report holds counts, paths and arguments only — no token values | the `report` object |
| Argument sanity | An unknown argument aborts immediately and **creates no empty directories** | `default: throw` in `parseArgs()` |
| Filename sanitising | Illegal characters become underscores | `safeName()` |
| Never eats its own listing file | Skips `manifest.json` / `SHA256SUMS` | `loadInput()` |
| Independent header per account | `Object.assign({}, ...)` shallow copy | `toCpa()` |
| Version-control isolation | `.gitignore` already excludes outputs such as `out/`, `cpa/`, `sub2api/` and `xai-*.json` | `.gitignore` |
| No network access | The whole script makes no network calls at all | — |

### ⚠️ A refresh token has a single holder

Plenty of people have been burned by this, so make sure you understand it:

```text
one and the same refresh token
        │
        ├──► CPA      uses it to get a new token → the old one is void
        │
        └──► Sub2API  tries the old one → invalid_grant ❌
```

If the same account is imported into CPA **and** Sub2API at once, one of the two sides will sooner or later start replying:

```text
invalid_grant / Refresh token has been revoked
```

**Keep your deployments mutually exclusive**: one account runs in exactly one place. Use `--exclude-emails` to maintain that.

### ⚠️ A successful conversion does not mean quota

Conversion only guarantees the **format is correct**. The account itself can still reply:

| Error | Meaning | Related to conversion? |
|---|---|---|
| `402 personal-team-blocked:spending-limit` | That team hit its spending limit | ❌ unrelated |
| `429 free-usage-exhausted` | The free rolling quota is used up | ❌ unrelated |
| `401 Invalid or expired credentials` | The token really is dead | ❌ unrelated (needs re-authorisation) |
| `invalid_grant` | The refresh token was revoked | ⚠️ possibly caused by two sides holding it at once |

**Correct format does not mean a usable account. They are two separate things.**

---

## Troubleshooting

| Symptom | Cause | What to do |
|---|---|---|
| `unknown argument: --xxx` | Argument typo | Compare against [Command-line arguments](#command-line-arguments); note everything is lowercase with two dashes |
| `--input is required` | A required argument is missing | Add `--input` |
| `--outdir is required` | A required argument is missing | Add `--outdir` |
| `--target must be cpa\|sub2api\|both` | Value misspelled or capitalised | Use a lowercase legal value |
| `--mode must be merged\|split\|both` | Same as above | Use a lowercase legal value |
| `ENOENT: no such file or directory` | The `--input` path does not exist | Check the path; quote Windows paths that contain spaces |
| Converted count is 0 and `skipped.incomplete` is large | The source lacks access / refresh tokens, or the format was not recognised | **Check whether the access token is in the `key` field**; confirm `refresh_token` exists |
| `source_records_seen` is 0 | The file is empty, the path is wrong, or the extension is not json/jsonl/txt | Check the extension; confirm the folder is not just a `manifest.json` |
| CPA import fails | The merged bundle file was used by mistake | Switch to `cpa/per-account/xai-<email>.json` |
| Sub2API import fails | A CPA file or a bare array was supplied | Use `sub2api-<label>-all-<N>.json` |
| CPA import succeeds but calls fail | The `X-XAI-Token-Auth` header is missing | Confirm the file came from this tool and was not hand-edited |
| `invalid_grant` after import | The same account is held by two environments at once | Disable one side and isolate them with `--exclude-emails` |
| Errors mentioning `Buffer.from(...) base64url` | The Node version is too old | Upgrade to Node 18+ |
| Time fields are empty strings | The source has no time information and the JWT could not be decoded | Check whether `access_token` really is a JWT (it must contain two dots) |

### "It finished but the import still fails" — how to diagnose

```text
1. Where are you importing to?
     ├─ CPA     → the file should be cpa/per-account/xai-<email>.json
     │             ✗ used cpa-xai-merged-N.json → change files, that one cannot be imported
     └─ Sub2API → the file should be sub2api-<label>-all-N.json
                   ✗ used a CPA file → change files

2. Open the file. Is the top level { } or [ ] ?
     └─ it is [ ] → wrong. Both formats have an object at the top level

3. Does the CPA file contain these three?
     type: "xai" / base_url / headers["X-XAI-Token-Auth"]
     └─ missing → this file did not come from this tool; run it again

4. Does the Sub2API file have "type": "sub2api-data" at the top level?
   Is accounts[].platform equal to "grok"?
     └─ no → same as above, run it again

5. Has the expires_at / expired time already passed?
     └─ yes → that is normal. As long as refresh_token is valid,
             renewal happens automatically after import. Not a conversion problem

6. Import succeeded but calls return 402 / 429 ?
     └─ the account has no quota; unrelated to conversion

7. Import succeeded but returns invalid_grant ?
     └─ this account's refresh token was already spent by another environment
         → check whether it is deployed in two places at once
```

---

## Verification checklist

After a conversion, it is worth confirming each of these:

1. **The counts add up**: `accounts_converted` matches expectation and every `skipped` entry can be explained (use [the arithmetic above](#start-with-an-arithmetic-check))
2. **The JSON is valid**:
   ```bash
   node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log('ok')" ./converted/sub2api/sub2api-xai-all-115.json
   ```
3. **The email set is identical**: compare against the source; nothing missing, nothing extra
4. **The CPA shape is right**: per-account files contain `type: "xai"`, `base_url` and `headers["X-XAI-Token-Auth"]`
5. **The Sub2API shape is right**: the top level is a `sub2api-data` **object** and `accounts[].platform == "grok"`
6. **The time precision is right**: CPA's `expired` has **no** milliseconds, Sub2API's `expires_at` **does**
7. **Sensitive fields are absent**: search the output for `password` / `sso` / `session_cookies` — you should find nothing
8. **Try one record first**: import a single account on each side and only then go bulk

---

## Doing it by hand vs using this script

| Item | By hand | This script |
|---|---|---|
| Time for 200 accounts | Hours | Seconds |
| Noticing the access token is in `key` | You have to discover it first | Automatic |
| Two different time precisions | Easy to write both the same | Automatically kept apart |
| Digging scope / client_id / team_id out of the JWT | Paste into a Base64 decoding site 200 times | Automatic, and **offline** |
| Assembling `account_id` | Easy to forget the two colons | Automatic |
| Adding the `X-XAI-Token-Auth` header | Very easy to miss, and missing it raises no error | Automatic |
| Filling `user_id` / `sub` twice | You would not know to do it | Automatic |
| Deduplication | By eye | Automatic, keyed on `account_id` |
| Excluding already-deployed accounts | Compare lists manually | `--exclude-emails` |
| Risk of leaking sensitive fields | High (copy-paste drags them along) | Low (allowlist) |
| Reproducible results | No | Yes |
| Knowing why something failed | You don't | The `skipped` breakdown in the report |

---
## Glossary

| Term | One-sentence explanation |
|---|---|
| **xAI** | The company behind Grok, and the authority that issues tokens |
| **Grok** | xAI's AI model |
| **grokcli-2api** | A tool for managing Grok accounts; the main **source** for this project |
| **CPA / CLIProxyAPI** | A proxy tool; **destination one** for this project |
| **Sub2API** | A proxy tool; **destination two** for this project |
| **auth** | Short for authorization / authentication, loosely "login credentials" |
| **token** | A temporary pass |
| **access_token** | The ticket. Presented when calling the API |
| **refresh_token** | The exchange voucher. Swaps an expired ticket for a new one. **Single holder** |
| **id_token** | The identity card. It records who you are |
| **JWT** | JSON Web Token, a token format whose middle segment can be decoded directly |
| **claim** | One field inside a JWT payload |
| **Base64 / Base64URL** | An encoding scheme. **Not encryption** — anyone can reverse it |
| **Unix timestamp** | Seconds (or milliseconds) counted from 1970-01-01 |
| **RFC3339** | The standard time-string format; this project must distinguish "with milliseconds" from "without" |
| **OAuth** | A standard flow for granting access without handing over your password |
| **issuer** | The issuing authority; fixed at `https://auth.x.ai` here |
| **client_id** | The identity number of an application |
| **scope** | The list of permissions a token carries |
| **principal_id** | The unique ID of the user themselves |
| **team_id** | The team an account belongs to (may be empty) |
| **account_id** | The composite ID `<issuer>::<principal_id>` |
| **JSON** | A text format for describing data |
| **JSONL** | A file with one JSON object per line |
| **BOM** | Invisible marker bytes at the start of a file; must be stripped before parsing |
| **canonical model** | The intermediate format: every input becomes this first, then becomes each output |
| **recursion** | A function calling itself, used to handle nesting of unknown depth |
| **Set** | A collection without duplicates; lookups are O(1) |
| **allowlist / denylist** | Allowlist = only what is listed is permitted; denylist = only what is listed is blocked. Allowlists are safer |
| **shallow copy** | Copying the first level of an object so several places do not share one object |
| **stdout / stderr** | Standard output / standard error: two separate output channels |
| **round-trip** | Converting back and forth: after A→B you can still do B→A |

---

## Installing as a Codex skill

Drop the whole repo into your skills directory and Codex / Claude will load it automatically:

```text
<your skills root>/xai-cpa-sub2api-convert/
├── SKILL.md                       ← the AI reads this to decide when to use the skill
├── agents/openai.yaml             ← skill metadata
└── scripts/convert_xai_auth.mjs   ← the script that actually runs
```

After that you can just give instructions in natural language. Example triggers:

- "Convert this batch of Grok accounts into files CPA can import"
- "Make me a Sub2API bulk import file, excluding the accounts already in CPA"
- "Turn this grokcli-2api export into one file per account"
- "Convert this CPA auth file back into Sub2API format"

The AI will work out which `--target` / `--mode` combination to use and whether `--exclude-emails` is needed.

---

## Versioning

- The version number lives in [`VERSION`](VERSION)
- The change history lives in [`CHANGELOG.md`](CHANGELOG.md)
- It follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`

| Position | When it increases | Impact on users |
|---|---|---|
| **MAJOR** | The CPA or Sub2API output shape changes | ⚠️ Breaks existing import flows; read the CHANGELOG before upgrading |
| **MINOR** | A new input shape or a new argument is added | Backwards compatible; old commands still work |
| **PATCH** | Typos or edge-case behaviour fixed | Upgrade without noticing |

Current version: **1.1.0**

---

## License

[MIT](LICENSE)
