#!/usr/bin/env node
/**
 * xai-cpa-sub2api-convert :: CLI
 *
 * Thin shell around docs/core.mjs: read input, call the shared core, write
 * output, print a JSON report. All conversion rules live in the core so the CLI
 * and the browser page cannot disagree.
 *
 * No dependencies. Node 18+.
 *
 * Usage:
 *   node convert_xai_auth.mjs --input <file|folder> --target both --mode both --outdir <folder>
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  CPA_BASE_URL,
  convert,
  detectSkipHint,
  parseSource,
  serialize,
} from "../docs/core.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- args

function parseArgs(argv) {
  const a = {
    input: null,
    outdir: null,
    target: "both",          // cpa | sub2api | both
    mode: "both",            // merged | split | both
    sub2apiBaseUrl: CPA_BASE_URL,
    label: "xai",
    limit: 0,
    excludeEmails: null,     // file with one email per line, or comma list
    skipExpired: false,
    onInvalid: "abort",      // abort | skip
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    switch (k) {
      case "--input": a.input = v; i++; break;
      case "--outdir": a.outdir = v; i++; break;
      case "--target": a.target = String(v).toLowerCase(); i++; break;
      case "--mode": a.mode = String(v).toLowerCase(); i++; break;
      case "--sub2api-base-url": a.sub2apiBaseUrl = v; i++; break;
      case "--label": a.label = v; i++; break;
      case "--limit": a.limit = Number(v) || 0; i++; break;
      case "--exclude-emails": a.excludeEmails = v; i++; break;
      case "--skip-expired": a.skipExpired = true; break;
      case "--on-invalid": a.onInvalid = String(v || "").toLowerCase(); i++; break;
      default:
        throw new Error("unknown argument: " + k);
    }
  }
  if (!a.input) throw new Error("--input is required");
  if (!a.outdir) throw new Error("--outdir is required");
  if (!["cpa", "sub2api", "both"].includes(a.target)) throw new Error("--target must be cpa|sub2api|both");
  if (!["merged", "split", "both"].includes(a.mode)) throw new Error("--mode must be merged|split|both");
  if (!["abort", "skip"].includes(a.onInvalid)) throw new Error("--on-invalid must be abort|skip");
  return a;
}

// ---------------------------------------------------------------- io

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function loadExcludes(value) {
  if (!value) return [];
  if (fs.existsSync(value)) {
    return readText(value).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Collect parsed nodes from a file or a folder, matching the documented CLI behaviour. */
function loadItems(inputPath) {
  const stat = fs.statSync(inputPath);
  const items = [];

  const addFile = (full, name) => {
    const { records, parseError } = parseSource(readText(full), name);
    if (parseError) {
      throw new Error(
        "Failed to parse JSON line in " + full + " (line " + parseError.line + "): " + parseError.message
      );
    }
    items.push(...records);
  };

  if (stat.isDirectory()) {
    const names = fs
      .readdirSync(inputPath)
      .filter((n) => /\.(json|jsonl|txt)$/i.test(n))
      .sort();
    for (const name of names) {
      if (detectSkipHint(name)) continue;
      addFile(path.join(inputPath, name), name);
    }
    return items;
  }

  addFile(inputPath, path.basename(inputPath));
  return items;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serialize(value), "utf8");
}

// ---------------------------------------------------------------- main

function main() {
  const a = parseArgs(process.argv);

  const items = loadItems(a.input);
  if (!items.length) throw new Error("No JSON records found in input.");

  const report = convert(items, {
    target: a.target,
    mode: a.mode,
    label: a.label,
    sub2apiBaseUrl: a.sub2apiBaseUrl,
    limit: a.limit,
    excludeEmails: loadExcludes(a.excludeEmails),
    skipExpired: a.skipExpired,
    onInvalid: a.onInvalid,
  });

  if (report.aborted) {
    const x = report.aborted;
    throw new Error(
      "Record " + x.label + " (" + x.source + ", " + x.position + ") is missing required fields: " +
      x.reasons.map((r) => r.replace(/^missing_/, "")).join(", ")
    );
  }

  let cpaSplit = 0;
  let subSplit = 0;
  const mergedFiles = [];

  for (const out of report.outputs) {
    const file = path.join(a.outdir, out.path);
    writeJson(file, out.json);
    if (out.path.startsWith("cpa/per-account/")) cpaSplit++;
    else if (out.path.startsWith("sub2api/per-account/")) subSplit++;
    else mergedFiles.push(file);
  }

  const reportOut = {
    input: a.input,
    outdir: a.outdir,
    target: a.target,
    mode: a.mode,
    on_invalid: a.onInvalid,
    source_records_seen: report.counts.seen,
    accounts_converted: report.counts.converted,
    skipped: {
      incomplete: report.counts.incomplete,
      duplicate: report.counts.duplicate,
      excluded: report.counts.excluded,
      expired: report.counts.expired,
    },
    counts: report.counts,
    cpa_per_account_files: cpaSplit,
    sub2api_per_account_files: subSplit,
    merged_files: mergedFiles,
    warnings: report.warnings,
    sub2api_base_url: report.sub2api_base_url,
    file_stamp: report.file_stamp,
    core: path.relative(path.join(HERE, ".."), path.join(HERE, "../docs/core.mjs")).replace(/\\/g, "/"),
  };
  console.log(JSON.stringify(reportOut, null, 2));
  return 0;
}

try {
  process.exitCode = main();
} catch (err) {
  console.error("ERROR: " + (err && err.message ? err.message : String(err)));
  process.exitCode = 1;
}
