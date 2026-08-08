/**
 * xai-cpa-sub2api-convert :: shared conversion core
 *
 * This is the single implementation of the conversion. Both the CLI
 * (scripts/cli.mjs) and the browser page (docs/ui.js) import this file, so the
 * two cannot drift apart.
 *
 * Hard rules for this file:
 *   - Pure logic only. No fs, no DOM, no network, no process.
 *   - Never throws for a single bad record; the caller decides via options.onInvalid.
 */

export const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const XAI_ISSUER = "https://auth.x.ai";
export const CPA_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
export const CPA_TOKEN_HEADER = { "X-XAI-Token-Auth": "xai-grok-cli" };
export const DEFAULT_SCOPE = "openid profile email offline_access grok-cli:access api:access";

export const REQUIRED_FIELDS = ["access_token", "refresh_token", "email"];

export const DEFAULTS = {
  target: "both",              // cpa | sub2api | both
  mode: "both",                // merged | split | both
  label: "xai",
  sub2apiBaseUrl: CPA_BASE_URL,
  limit: 0,
  excludeEmails: [],
  skipExpired: false,
  onInvalid: "abort",          // abort | skip
};

/* ------------------------------------------------------------------ helpers */

function stripBom(text) {
  return typeof text === "string" ? text.replace(/^\uFEFF/, "") : "";
}

/** base64url -> utf8 string. Padding is restored first; works in browser and Node. */
function base64urlToUtf8(segment) {
  let s = String(segment).replace(/-/g, "+").replace(/_/g, "/");
  s += "=".repeat((4 - (s.length % 4)) % 4);
  if (typeof atob === "function") {
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }
  return globalThis.Buffer.from(s, "base64").toString("utf8");
}

/** Decode a JWT payload. Returns {} for anything unusable. */
export function jwtPayload(token) {
  if (typeof token !== "string" || !token.includes(".")) return {};
  const parts = token.split(".");
  if (parts.length < 2) return {};
  try {
    const value = JSON.parse(base64urlToUtf8(parts[1]));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function toEpoch(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v);
  const n = Number(v);
  if (Number.isFinite(n) && String(v).trim() !== "") {
    return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
  }
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

/** RFC3339 without milliseconds, matching validated CPA auth files. */
export function toIso(epoch) {
  if (!epoch) return "";
  return new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** RFC3339 with milliseconds, matching validated Sub2API import files. */
export function toIsoMs(epoch) {
  if (!epoch) return "";
  return new Date(epoch * 1000).toISOString();
}

export function safeName(email) {
  return String(email).replace(/[\\/:*?"<>|]/g, "_");
}

/** Mask an email for reporting: keep the first character and the full domain. */
export function maskEmail(email) {
  const s = String(email || "").trim();
  if (!s) return "";
  const at = s.indexOf("@");
  if (at <= 0) return s[0] + "****";
  return s[0] + "****" + s.slice(at);
}

/** File-name hint used when a record carries no email of its own. */
export function hintFromName(sourceName) {
  const base = String(sourceName || "").split(/[\\/]/).pop() || "";
  return base.replace(/^xai-/, "").replace(/\.(json|jsonl|txt)$/i, "");
}

/* ------------------------------------------------------------ canonical model */

/**
 * Canonical account record. Every supported source shape is normalized to this,
 * then rendered into CPA / Sub2API. Fields are resolved with this precedence:
 *   explicit source field -> access_token JWT claim -> documented xAI default
 */
export function canonicalize(src, hintName) {
  const access =
    src.access_token || src.accessToken || src.key || src.token ||
    (src.credentials && src.credentials.access_token) || "";
  const refresh =
    src.refresh_token || src.refreshToken ||
    (src.credentials && src.credentials.refresh_token) || "";
  const idToken =
    src.id_token || src.idToken || (src.credentials && src.credentials.id_token) || "";

  const pl = jwtPayload(access);
  const idpl = jwtPayload(idToken);
  const cred = src.credentials || {};

  const principal =
    src.principal_id || src.user_id || src.sub || pl.principal_id || pl.sub || idpl.sub || "";

  const email =
    src.email || cred.email || (src.extra && src.extra.email) ||
    pl.email || idpl.email || hintName || "";

  const accountId =
    src.account_id || src.id ||
    (principal ? XAI_ISSUER + "::" + principal : "");

  // Explicit source expiry wins; grokcli-2api stores the authoritative value and
  // it can differ from the JWT exp claim by a second. JWT exp is the fallback.
  const expEpoch =
    toEpoch(src.expires_at) || toEpoch(cred.expires_at) || toEpoch(src.expired) ||
    toEpoch(pl.exp) ||
    (src.expires_in && src.last_refresh
      ? toEpoch(src.last_refresh) + Number(src.expires_in) : 0);

  const iatEpoch = toEpoch(pl.iat) || toEpoch(src.last_refresh) || toEpoch(src.create_time);

  return {
    email,
    access_token: access,
    refresh_token: refresh,
    id_token: idToken,
    token_type: src.token_type || cred.token_type || "Bearer",
    scope: pl.scope || src.scope || cred.scope || DEFAULT_SCOPE,
    client_id:
      pl.client_id || src.oidc_client_id || src.client_id || cred.client_id ||
      pl.aud || XAI_CLIENT_ID,
    principal_id: principal,
    team_id: src.team_id || pl.team_id || "",
    account_id: accountId,
    expires_at: expEpoch,
    last_refresh: iatEpoch,
    disabled: src.disabled === true,
    source_disabled_reason: src.disabled_reason || src.source_pool_status || "",
  };
}

export function isUsable(rec) {
  return Boolean(rec.access_token && rec.refresh_token && rec.email);
}

export function missingFields(rec) {
  return REQUIRED_FIELDS.filter((key) => !rec[key]);
}

/* ------------------------------------------------------------------ parsing */

/**
 * Walk one parsed JSON node and collect canonical records.
 *
 * stats.unrecognized counts nodes that were read but could not be recognized as
 * an account; the legacy script dropped these silently.
 */
export function extractRecords(node, hintName, out, stats) {
  if (node === null || node === undefined) return;

  if (Array.isArray(node)) {
    for (const item of node) extractRecords(item, hintName, out, stats);
    return;
  }
  if (typeof node !== "object") {
    if (stats) stats.unrecognized++;
    return;
  }

  // grokcli-2api admin export: { "auth": { "<account_id>": {...} } }
  if (node.auth && typeof node.auth === "object" && !Array.isArray(node.auth)) {
    for (const [k, v] of Object.entries(node.auth)) extractRecords(v, k, out, stats);
    return;
  }

  // sub2api-data / CPA merged bundle / grokcli export: { accounts: [...] }
  if (Array.isArray(node.accounts)) {
    for (const item of node.accounts) extractRecords(item, hintName, out, stats);
    return;
  }

  // sub2api account object: credentials nested
  if (node.credentials && typeof node.credentials === "object") {
    const merged = Object.assign({}, node.credentials, {
      email: node.credentials.email || (node.extra && node.extra.email) || node.name,
      disabled: node.disabled,
    });
    out.push(canonicalize(merged, hintName));
    return;
  }

  // flat account object (grokcli native xai file, CPA auth file, admin auth entry)
  if (node.access_token || node.key || node.refresh_token) {
    out.push(canonicalize(node, hintName));
    return;
  }

  if (stats) stats.unrecognized++;
}

/**
 * Parse one source document into top-level nodes.
 *
 * Returns { records, parseError }:
 *   records    -> [{ source, position, hint, value }]  (value = raw parsed node)
 *   parseError -> null, or { message, line } when a JSON-lines row is broken
 */
export function parseSource(text, sourceName = "input") {
  const raw = stripBom(text);
  const trimmed = raw.trim();
  const hint = hintFromName(sourceName);
  if (!trimmed) return { records: [], parseError: null };

  const isJsonl = /\.jsonl$/i.test(String(sourceName || ""));

  if (!isJsonl) {
    try {
      const parsed = JSON.parse(trimmed);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      return {
        records: nodes.map((value, i) => ({
          source: sourceName,
          position: nodes.length === 1 ? "record 1" : "record " + (i + 1),
          hint,
          value,
        })),
        parseError: null,
      };
    } catch {
      // fall through to JSON-lines handling
    }
  }

  const records = [];
  const lines = raw.split(/\r?\n/);
  let sawLine = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("{") && !line.startsWith("[")) continue;
    sawLine = true;
    try {
      records.push({
        source: sourceName,
        position: "line " + (i + 1),
        hint,
        value: JSON.parse(line),
      });
    } catch (err) {
      return {
        records: [],
        parseError: { message: String(err && err.message ? err.message : err), line: i + 1 },
      };
    }
  }
  if (!sawLine && trimmed) {
    return { records: [], parseError: { message: "No JSON object found.", line: 1 } };
  }
  return { records, parseError: null };
}

/**
 * Files the CLI skips in folder mode. The web UI shows these as an overridable
 * hint instead of silently dropping them.
 */
export function detectSkipHint(fileName) {
  const name = String(fileName || "").toLowerCase();
  const base = name.split(/[\\/]/).pop() || name;

  if (base === "manifest.json" || base === "sha256sums") {
    return { reason: "manifest_file", overridable: true };
  }
  if (!/\.(json|jsonl|txt)$/i.test(base)) {
    return { reason: "unsupported_extension", overridable: true };
  }
  return null;
}

/* --------------------------------------------------------------- renderers */

/** CPA (CLIProxyAPI) xAI OAuth auth file. Filename must be xai-<email>.json */
export function toCpa(rec) {
  return {
    type: "xai",
    auth_kind: "oauth",
    email: rec.email,
    access_token: rec.access_token,
    refresh_token: rec.refresh_token,
    token_type: rec.token_type,
    expired: toIso(rec.expires_at),
    last_refresh: toIso(rec.last_refresh),
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

/** Sub2API account entry inside a sub2api-data payload. */
export function toSub2api(rec, baseUrl) {
  return {
    name: rec.email,
    platform: "grok",
    type: "oauth",
    credentials: {
      access_token: rec.access_token,
      refresh_token: rec.refresh_token,
      token_type: rec.token_type,
      expires_at: toIsoMs(rec.expires_at),
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

/* ----------------------------------------------------------------- convert */

/**
 * Convert parsed nodes into output documents.
 *
 * items   -> [{ source, position, hint, value }] from parseSource()
 * options -> see DEFAULTS, plus { now }
 *
 * Always returns a report. With onInvalid === "abort" the report carries
 * aborted:true and no outputs; the caller turns that into an error if it wants.
 */
export function convert(items, options = {}) {
  const opts = Object.assign({}, DEFAULTS, options);
  const target = String(opts.target || "both").toLowerCase();
  const mode = String(opts.mode || "both").toLowerCase();
  const label = opts.label || "xai";
  const baseUrl = opts.sub2apiBaseUrl || CPA_BASE_URL;
  const now = opts.now instanceof Date ? opts.now : new Date();
  const exportedAt = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const fileStamp = exportedAt.replace(/[-:]/g, "");
  const nowEpoch = Math.floor(now.getTime() / 1000);

  const exclude = new Set(
    (Array.isArray(opts.excludeEmails) ? opts.excludeEmails : [])
      .map((s) => String(s).trim().toLowerCase())
      .filter(Boolean)
  );

  const counts = {
    seen: 0,
    converted: 0,
    incomplete: 0,
    duplicate: 0,
    excluded: 0,
    expired: 0,
    unrecognized: 0,
  };

  const skipped = [];
  const seenKeys = new Set();
  let records = [];
  let aborted = null;

  for (const item of items) {
    const extracted = [];
    extractRecords(item.value, item.hint || hintFromName(item.source), extracted, counts);
    counts.seen += extracted.length;

    for (let i = 0; i < extracted.length; i++) {
      const rec = extracted[i];
      const position = extracted.length > 1 ? item.position + "[" + (i + 1) + "]" : item.position;
      const entry = {
        source: item.source,
        position,
        emailMasked: maskEmail(rec.email),
        reasons: [],
      };

      const missing = missingFields(rec);
      if (missing.length) {
        counts.incomplete++;
        entry.reasons = missing.map((key) => "missing_" + key);
        skipped.push(entry);
        if (opts.onInvalid === "abort") {
          aborted = Object.assign({ label: rec.email || item.hint || "<unknown>" }, entry);
          break;
        }
        continue;
      }

      const key = String(rec.account_id || rec.email).toLowerCase();
      if (seenKeys.has(key)) {
        counts.duplicate++;
        entry.reasons = ["duplicate"];
        skipped.push(entry);
        continue;
      }
      if (exclude.has(String(rec.email).toLowerCase())) {
        counts.excluded++;
        entry.reasons = ["excluded"];
        skipped.push(entry);
        continue;
      }
      if (opts.skipExpired && rec.expires_at && rec.expires_at <= nowEpoch) {
        counts.expired++;
        entry.reasons = ["expired"];
        skipped.push(entry);
        continue;
      }

      seenKeys.add(key);
      records.push(rec);
    }

    if (aborted) break;
  }

  const limit = Number(opts.limit) || 0;
  if (limit > 0 && records.length > limit) records = records.slice(0, limit);
  counts.converted = records.length;

  const warnings = {
    access_token_already_expired: records.filter((r) => r.expires_at && r.expires_at <= nowEpoch).length,
    missing_team_id: records.filter((r) => !r.team_id).length,
    missing_principal_id: records.filter((r) => !r.principal_id).length,
  };

  if (aborted) {
    return {
      converted: [],
      skipped,
      counts,
      warnings,
      outputs: [],
      aborted,
      exported_at: exportedAt,
      file_stamp: fileStamp,
      sub2api_base_url: baseUrl,
    };
  }

  const wantCpa = target === "cpa" || target === "both";
  const wantSub = target === "sub2api" || target === "both";
  const wantMerged = mode === "merged" || mode === "both";
  const wantSplit = mode === "split" || mode === "both";

  const outputs = [];

  if (records.length) {
    if (wantCpa && wantSplit) {
      for (const r of records) {
        outputs.push({
          path: "cpa/per-account/xai-" + safeName(r.email) + ".json",
          json: toCpa(r),
        });
      }
      outputs.push({
        path: "cpa/manifest.json",
        json: {
          exported_at: exportedAt,
          format: "CLIProxyAPI xAI OAuth",
          label,
          count: records.length,
          import_hint:
            "POST /v0/management/auth-files (multipart file=@xai-<email>.json), one file per account",
          files: records.map((r) => "xai-" + safeName(r.email) + ".json"),
        },
      });
    }

    if (wantCpa && wantMerged) {
      outputs.push({
        path: "cpa/cpa-xai-merged-" + records.length + ".json",
        json: {
          type: "cliproxyapi-xai-auth-bundle",
          version: 1,
          exported_at: exportedAt,
          note:
            "CPA /v0/management/auth-files imports individual JSON files; this merged file is backup/reference only.",
          count: records.length,
          accounts: records.map((r) =>
            Object.assign({ file: "xai-" + safeName(r.email) + ".json" }, toCpa(r))
          ),
        },
      });
    }

    if (wantSub && wantMerged) {
      outputs.push({
        path: "sub2api/sub2api-" + label + "-all-" + records.length + ".json",
        json: {
          type: "sub2api-data",
          version: 1,
          exported_at: exportedAt,
          proxies: [],
          accounts: records.map((r) => toSub2api(r, baseUrl)),
        },
      });
    }

    if (wantSub && wantSplit) {
      for (const r of records) {
        outputs.push({
          path: "sub2api/per-account/" + safeName(r.email) + "_sub2api.json",
          json: {
            type: "sub2api-data",
            version: 1,
            exported_at: exportedAt,
            proxies: [],
            accounts: [toSub2api(r, baseUrl)],
          },
        });
      }
    }
  }

  return {
    converted: records,
    skipped,
    counts,
    warnings,
    outputs,
    aborted: null,
    exported_at: exportedAt,
    file_stamp: fileStamp,
    sub2api_base_url: baseUrl,
  };
}

/** Stable serialization used by both the CLI and the browser download. */
export function serialize(value) {
  return JSON.stringify(value, null, 2);
}
