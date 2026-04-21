import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// User data dir: env override → ~/.amazon-rufus-spy (never inside the plugin bundle)
export const ROOT = process.env.AMAZON_SPY_DIR
  || path.join(os.homedir(), ".amazon-rufus-spy");

export function resolveLarkCli() {
  if (process.env.LARK_CLI) return process.env.LARK_CLI;
  return "lark-cli";
}

export function loadConfig() {
  const p = path.join(ROOT, "config.json");
  if (!existsSync(p)) throw new Error(`Missing config.json at ${p}`);
  const cfg = JSON.parse(readFileSync(p, "utf8"));
  if (!cfg.baseId) throw new Error("config.json: baseId 未填写");
  if (!cfg.tables?.asins) throw new Error("config.json: tables.asins 未填写");
  return cfg;
}

export function loadCreds() {
  const p = path.join(ROOT, "amazon.config.local.json");
  if (!existsSync(p)) throw new Error("Missing amazon.config.local.json");
  return JSON.parse(readFileSync(p, "utf8"));
}

export function larkCli(...args) {
  const cli = resolveLarkCli();
  const r = spawnSync(cli, args, {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    cwd: ROOT,
  });
  if (r.status !== 0) {
    throw new Error(`lark-cli ${args.slice(0, 3).join(" ")} 失败:\n${r.stderr || r.stdout}`);
  }
  return r.stdout.trim();
}

export function listRecords(baseId, tableId) {
  let out;
  try {
    out = larkCli("base", "+record-list", "--base-token", baseId, "--table-id", tableId, "--limit", "500");
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(out);
    const rows = parsed?.data?.data;
    const fieldNames = parsed?.data?.fields;
    const ids = parsed?.data?.record_id_list;
    if (Array.isArray(rows) && Array.isArray(fieldNames) && Array.isArray(ids)) {
      return rows.map((row, i) => {
        const fields = {};
        fieldNames.forEach((f, j) => {
          fields[f] = Array.isArray(row[j]) ? row[j][0] ?? null : row[j];
        });
        return { record_id: ids[i], fields };
      });
    }
    return [];
  } catch {
    return [];
  }
}

export function createRecord(baseId, tableId, fields) {
  const tmpDir = path.join(ROOT, "scripts", "_tmp");
  mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `rec-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(tmpFile, JSON.stringify(fields), "utf8");
  const rel = path.relative(ROOT, tmpFile).split(path.sep).join("/");
  try {
    const out = larkCli("base", "+record-upsert", "--base-token", baseId, "--table-id", tableId, "--json", `@${rel}`);
    let parsed;
    try { parsed = JSON.parse(out); } catch { return ""; }
    return parsed?.data?.record?.record_id_list?.[0]
      || parsed?.data?.record?.id
      || parsed?.record?.record_id
      || parsed?.record_id
      || "";
  } finally {
    try { rmSync(tmpFile); } catch {}
  }
}

export function updateRecord(baseId, tableId, recordId, fields) {
  const tmpDir = path.join(ROOT, "scripts", "_tmp");
  mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `rec-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(tmpFile, JSON.stringify(fields), "utf8");
  const rel = path.relative(ROOT, tmpFile).split(path.sep).join("/");
  try {
    larkCli("base", "+record-upsert", "--base-token", baseId, "--table-id", tableId, "--record-id", recordId, "--json", `@${rel}`);
  } finally {
    try { rmSync(tmpFile); } catch {}
  }
}

export function uploadAttachment(baseId, tableId, recordId, filePath) {
  const cli = resolveLarkCli();
  const dir = path.dirname(path.resolve(filePath));
  const base = path.basename(filePath);
  const r = spawnSync(cli, [
    "base", "+record-upload-attachment",
    "--base-token", baseId,
    "--table-id", tableId,
    "--record-id", recordId,
    "--field-id", "截图",
    "--file", base,
  ], { encoding: "utf8", shell: false, windowsHide: true, cwd: dir });
  if (r.status !== 0) {
    throw new Error(`lark-cli base +record-upload-attachment 失败:\n${r.stderr || r.stdout}`);
  }
}

export function batchCreate(baseId, tableId, rows) {
  let success = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      createRecord(baseId, tableId, row);
      success++;
    } catch (e) {
      console.error(`[batchCreate] 写入失败: ${e.message}`);
      failed++;
    }
  }
  return { success, failed };
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
