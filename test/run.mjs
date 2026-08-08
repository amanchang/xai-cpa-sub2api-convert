#!/usr/bin/env node
/**
 * Zero-dependency test runner.
 *
 * Golden files in test/golden/ were produced by the previous standalone script
 * before the shared core was introduced. Any behaviour drift in docs/core.mjs
 * shows up here as a field-level diff.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

import {
  convert,
  detectSkipHint,
  maskEmail,
  parseSource,
  serialize,
  toIso,
  toIsoMs,
} from "../docs/core.mjs";
import { LANGS, STRINGS, resolveLang, t } from "../docs/i18n.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const FIX = path.join(HERE, "fixtures");
const GOLD = path.join(HERE, "golden");

let pass = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    pass++;
  } catch (err) {
    failures.push(name + ": " + (err && err.message ? err.message : String(err)));
  }
}

function eq(actual, expected, what) {
  const a = JSON.stringify(actual, null, 2);
  const b = JSON.stringify(expected, null, 2);
  if (a !== b) {
    throw new Error((what || "value") + " mismatch\n--- actual\n" + a + "\n--- expected\n" + b);
  }
}

function readText(p) {
  return fs.readFileSync(p, "utf8");
}

/** Same input walk the CLI performs, so golden folder cases stay comparable. */
function loadItems(inputPath) {
  const stat = fs.statSync(inputPath);
  const items = [];
  const addFile = (full, name) => {
    const { records, parseError } = parseSource(readText(full), name);
    if (parseError) throw new Error("unexpected parse error in " + name + " line " + parseError.line);
    items.push(...records);
  };
  if (stat.isDirectory()) {
    const names = fs.readdirSync(inputPath).filter((n) => /\.(json|jsonl|txt)$/i.test(n)).sort();
    for (const name of names) {
      if (detectSkipHint(name)) continue;
      addFile(path.join(inputPath, name), name);
    }
    return items;
  }
  addFile(inputPath, path.basename(inputPath));
  return items;
}

/** Flatten a golden case directory into { relPath: json }. */
function readGoldTree(dir, pre = "", out = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) readGoldTree(full, pre + e.name + "/", out);
    else out[pre + e.name] = JSON.parse(readText(full));
  }
  return out;
}

function stripVolatile(json) {
  const copy = JSON.parse(JSON.stringify(json));
  delete copy.exported_at;
  return copy;
}

/* --------------------------------------------------------------- golden cases */

const cases = [
  ["single-flat", "single-flat.json", { target: "both", mode: "both" }],
  ["array", "array.json", { target: "both", mode: "both" }],
  ["lines", "lines.jsonl", { target: "both", mode: "both" }],
  ["text-export", "text-export.txt", { target: "both", mode: "both" }],
  ["nested-credentials", "nested-credentials.json", { target: "both", mode: "both" }],
  ["admin-auth-export", "admin-auth-export.json", { target: "both", mode: "both" }],
  ["duplicate", "duplicate.json", { target: "both", mode: "both" }],
  ["expired-skip", "expired.json", { target: "both", mode: "both", skipExpired: true }],
  ["unrecognized", "unrecognized.json", { target: "both", mode: "both" }],
  ["cpa-only-split", "array.json", { target: "cpa", mode: "split" }],
  ["sub2api-only-merged", "array.json", { target: "sub2api", mode: "merged", label: "grok" }],
  ["folder", "folder", { target: "both", mode: "both" }],
  ["limit1", "array.json", { target: "cpa", mode: "merged", limit: 1 }],
  ["exclude", "array.json", { target: "cpa", mode: "merged", excludeEmails: ["bravo@example.com"] }],
  ["missing-refresh-skip", "missing-refresh.json", { target: "both", mode: "both" }],
];

for (const [name, input, options] of cases) {
  check("golden " + name, () => {
    const items = loadItems(path.join(FIX, input));
    const report = convert(items, Object.assign({ onInvalid: "skip" }, options));
    if (report.aborted) throw new Error("unexpected abort: " + JSON.stringify(report.aborted));

    const gold = readGoldTree(path.join(GOLD, name));
    const actual = {};
    for (const out of report.outputs) actual[out.path] = stripVolatile(out.json);

    eq(Object.keys(actual).sort(), Object.keys(gold).sort(), name + " file list");
    for (const rel of Object.keys(gold).sort()) {
      eq(actual[rel], stripVolatile(gold[rel]), name + "/" + rel);
    }

    const expected = JSON.parse(readText(path.join(GOLD, name + ".report.json")));
    eq(report.counts.seen, expected.source_records_seen, name + " seen");
    eq(report.counts.converted, expected.accounts_converted, name + " converted");
    eq(
      {
        incomplete: report.counts.incomplete,
        duplicate: report.counts.duplicate,
        excluded: report.counts.excluded,
        expired: report.counts.expired,
      },
      expected.skipped,
      name + " skipped counts"
    );
    eq(report.warnings, expected.warnings, name + " warnings");
  });
}

/* ------------------------------------------------------- timestamp precision */

check("CPA uses whole seconds and Sub2API keeps milliseconds", () => {
  const epoch = 2000000000;
  eq(toIso(epoch), "2033-05-18T03:33:20Z", "toIso");
  eq(toIsoMs(epoch), "2033-05-18T03:33:20.000Z", "toIsoMs");
  if (/\.\d{3}Z$/.test(toIso(epoch))) throw new Error("toIso must not carry milliseconds");
  if (!/\.\d{3}Z$/.test(toIsoMs(epoch))) throw new Error("toIsoMs must carry milliseconds");
  eq(toIso(0), "", "toIso empty");
  eq(toIsoMs(0), "", "toIsoMs empty");
});

check("rendered files use the precision their importer expects", () => {
  const items = loadItems(path.join(FIX, "single-flat.json"));
  const report = convert(items, { target: "both", mode: "split" });
  const cpa = report.outputs.find((o) => o.path.startsWith("cpa/per-account/")).json;
  const sub = report.outputs.find((o) => o.path.startsWith("sub2api/per-account/")).json.accounts[0];
  if (/\.\d{3}Z$/.test(cpa.expired)) throw new Error("CPA expired must not carry milliseconds");
  if (!/\.\d{3}Z$/.test(sub.credentials.expires_at)) {
    throw new Error("Sub2API expires_at must carry milliseconds");
  }
});

/* -------------------------------------------------------------- error paths */

check("abort stops the whole batch and produces no outputs", () => {
  const items = loadItems(path.join(FIX, "missing-refresh.json"));
  const report = convert(items, { target: "both", mode: "both", onInvalid: "abort" });
  if (!report.aborted) throw new Error("expected an abort");
  eq(report.outputs, [], "outputs");
  eq(report.aborted.reasons, ["missing_refresh_token"], "reason");
  if (!report.aborted.source || !report.aborted.position) throw new Error("abort must name the record");
});

check("skip keeps the good records and reports the bad one", () => {
  const items = loadItems(path.join(FIX, "missing-refresh.json"));
  const report = convert(items, { target: "both", mode: "both", onInvalid: "skip" });
  eq(report.aborted, null, "aborted");
  eq(report.counts.converted, 2, "converted");
  eq(report.counts.incomplete, 1, "incomplete");
  eq(report.skipped.length, 1, "skipped rows");
});

check("an empty file yields no records instead of failing silently", () => {
  const { records, parseError } = parseSource(readText(path.join(FIX, "empty.json")), "empty.json");
  eq(records, [], "records");
  eq(parseError, null, "parseError");
  const report = convert([], { target: "both", mode: "both" });
  eq(report.counts.seen, 0, "seen");
  eq(report.outputs, [], "outputs");
});

check("broken JSON reports a line number", () => {
  const { records, parseError } = parseSource(readText(path.join(FIX, "bad-syntax.json")), "bad-syntax.json");
  eq(records, [], "records");
  if (!parseError) throw new Error("expected a parse error");
  if (typeof parseError.line !== "number") throw new Error("parse error must carry a line number");
});

check("a batch with nothing usable produces no download", () => {
  const items = loadItems(path.join(FIX, "all-invalid.json"));
  const report = convert(items, { target: "both", mode: "both", onInvalid: "skip" });
  eq(report.counts.converted, 0, "converted");
  eq(report.outputs, [], "outputs");
  if (report.skipped.length === 0) throw new Error("expected skipped rows");
});

check("duplicates are collapsed by account id", () => {
  const items = loadItems(path.join(FIX, "duplicate.json"));
  const report = convert(items, { target: "cpa", mode: "merged", onInvalid: "skip" });
  eq(report.counts.duplicate, 1, "duplicate");
  eq(report.counts.converted, 2, "converted");
  eq(report.skipped.map((s) => s.reasons).flat(), ["duplicate"], "reasons");
});

check("unreadable nodes are counted instead of dropped silently", () => {
  const items = loadItems(path.join(FIX, "unrecognized.json"));
  const report = convert(items, { target: "cpa", mode: "merged", onInvalid: "skip" });
  eq(report.counts.unrecognized, 2, "unrecognized");
  eq(report.counts.seen, 1, "seen");
  eq(report.counts.converted, 1, "converted");
});

/* ----------------------------------------------------------------- skip hints */

check("skip hints match the CLI folder rules", () => {
  eq(detectSkipHint("manifest.json").reason, "manifest_file", "manifest");
  eq(detectSkipHint("SHA256SUMS").reason, "manifest_file", "sha256sums");
  eq(detectSkipHint("notes.md").reason, "unsupported_extension", "extension");
  eq(detectSkipHint("xai-alpha@example.com.json"), null, "clean file");
  eq(detectSkipHint("accounts.jsonl"), null, "jsonl");
  eq(detectSkipHint("export.txt"), null, "txt");
});

/* ------------------------------------------------------------------- privacy */

check("email masking keeps only the first character and the domain", () => {
  eq(maskEmail("bravo@example.com"), "b****@example.com", "normal");
  eq(maskEmail(""), "", "empty");
  eq(maskEmail("noatsign"), "n****", "no @");
});

check("no token values appear in the report", () => {
  const items = loadItems(path.join(FIX, "missing-refresh.json"));
  const report = convert(items, { target: "both", mode: "both", onInvalid: "skip" });
  const text = JSON.stringify({ counts: report.counts, skipped: report.skipped, warnings: report.warnings });
  if (text.includes("eyJ")) throw new Error("report leaked a JWT");
  if (text.includes("rt_")) throw new Error("report leaked a refresh token");
});

/* -------------------------------------------------------------- serialization */

check("serialize is stable two-space JSON", () => {
  eq(serialize({ a: 1 }), '{\n  "a": 1\n}', "shape");
});

/* -------------------------------------------------- source-level privacy scan */

check("shipped source makes no network calls", () => {
  const files = [
    "docs/core.mjs",
    "docs/ui.js",
    "docs/i18n.js",
    "docs/index.html",
    "docs/app.css",
    "scripts/convert_xai_auth.mjs",
  ];
  // Allowed URL strings are documentation links, the SVG XML namespace and the
  // upstream endpoints written into converted files. None is requested at runtime.
  const allowedHosts = [
    "github.com",
    "amanchang.github.io",
    "auth.x.ai",
    "cli-chat-proxy.grok.com",
    "api.x.ai",
    "semver.org",
    "developer.mozilla.org",
    "opensource.org",
    "unpkg.com",
    "www.w3.org",
  ];
  const banned = [/\bfetch\s*\(/, /new\s+XMLHttpRequest/, /navigator\.sendBeacon/, /new\s+WebSocket/, /import\s*\(\s*["'`]https?:/];
  for (const rel of files) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) throw new Error("missing file: " + rel);
    const text = readText(full);
    for (const re of banned) {
      if (re.test(text)) throw new Error(rel + " matches banned pattern " + re);
    }
    for (const m of text.matchAll(/https?:\/\/([^\s"'`)<>]+)/g)) {
      const host = m[1].split("/")[0];
      if (!allowedHosts.includes(host)) throw new Error(rel + " references an unexpected host: " + host);
    }
  }
});

check("vendor checksums match", () => {
  const sums = path.join(ROOT, "docs", "vendor", "CHECKSUMS");
  for (const line of readText(sums).split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const [hash, name] = s.split(/\s+/);
    const full = path.join(ROOT, "docs", "vendor", name);
    const actual = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    if (actual !== hash) throw new Error(name + " sha256 mismatch: " + actual + " != " + hash);
  }
});

check("i18n keys are identical across all three languages", () => {
  const base = Object.keys(STRINGS["zh-TW"]).sort();
  eq(LANGS, ["zh-TW", "zh-CN", "en"], "language list");
  for (const lang of LANGS) {
    const keys = Object.keys(STRINGS[lang]).sort();
    const missing = base.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !base.includes(k));
    if (missing.length || extra.length) {
      throw new Error(lang + " missing=" + JSON.stringify(missing) + " extra=" + JSON.stringify(extra));
    }
    for (const k of keys) {
      if (typeof STRINGS[lang][k] !== "string" || STRINGS[lang][k] === "") {
        throw new Error(lang + " has an empty value for " + k);
      }
    }
  }
});

check("every data-i18n key used by the page exists", () => {
  const html = readText(path.join(ROOT, "docs", "index.html"));
  const keys = new Set();
  for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) keys.add(m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
    for (const pair of m[1].split(";")) {
      const key = pair.split(":")[1];
      if (key) keys.add(key.trim());
    }
  }
  if (keys.size === 0) throw new Error("index.html has no data-i18n keys");
  const missing = [...keys].filter((k) => STRINGS["zh-TW"][k] === undefined);
  eq(missing, [], "keys missing from i18n.js");
});

check("the page wires every control the browser shell reads", () => {
  const html = readText(path.join(ROOT, "docs", "index.html"));
  for (const id of ["target-choices", "mode-choices", "filter-choices", "invalid-choices", "skip-expired", "label", "run", "download", "bar"]) {
    if (!html.includes('id="' + id + '"')) throw new Error("index.html is missing #" + id);
  }
  for (const value of ["cpa", "sub2api", "merged", "split"]) {
    if (!html.includes('value="' + value + '"')) throw new Error("index.html is missing option " + value);
  }
});

check("language resolution falls back sensibly", () => {
  eq(resolveLang("zh-TW"), "zh-TW", "exact");
  eq(resolveLang("zh-Hant-TW"), "zh-TW", "traditional");
  eq(resolveLang("zh-CN"), "zh-CN", "simplified");
  eq(resolveLang("zh-Hans"), "zh-CN", "hans");
  eq(resolveLang("fr-FR"), "en", "unknown");
  eq(resolveLang(""), "en", "empty");
  if (!t("zh-TW", "card1.records", { n: 5 }).includes("5")) throw new Error("interpolation failed");
});

/* --------------------------------------------------------------------- done */

const total = pass + failures.length;
if (failures.length) {
  console.error("FAIL " + failures.length + "/" + total);
  for (const f of failures) console.error("\n- " + f);
  process.exitCode = 1;
} else {
  console.log("ok " + pass + "/" + total);
}
