const DEFAULT_API_ORIGIN = "http://localhost:3000";
const DEFAULT_EXPORT_FIELDS = "accountId,username,password,deviceId,remark,expireAt";
const STORAGE_KEY = "tn-importer-settings";

const els = {
  apiOrigin: document.getElementById("apiOrigin"),
  fileInput: document.getElementById("fileInput"),
  rawInput: document.getElementById("rawInput"),
  exportFields: document.getElementById("exportFields"),
  exportFilter: document.getElementById("exportFilter"),
  fileMeta: document.getElementById("fileMeta"),
  result: document.getElementById("result"),
  statusBadge: document.getElementById("statusBadge"),
  pingBtn: document.getElementById("pingBtn"),
  previewBtn: document.getElementById("previewBtn"),
  importBtn: document.getElementById("importBtn"),
  exportBtn: document.getElementById("exportBtn"),
};

document.addEventListener("DOMContentLoaded", async () => {
  await restoreSettings();
  bindEvents();
  writeResult("等待执行。");
});

function bindEvents() {
  els.fileInput.addEventListener("change", handleFileMeta);
  els.apiOrigin.addEventListener("change", persistSettings);
  els.exportFields.addEventListener("change", persistSettings);
  els.exportFilter.addEventListener("change", persistSettings);
  els.rawInput.addEventListener("change", persistSettings);
  els.pingBtn.addEventListener("click", pingServer);
  els.previewBtn.addEventListener("click", previewRows);
  els.importBtn.addEventListener("click", importRows);
  els.exportBtn.addEventListener("click", exportRows);
}

async function restoreSettings() {
  const saved = await getStorage(STORAGE_KEY);
  if (!saved) {
    handleFileMeta();
    return;
  }

  els.apiOrigin.value = saved.apiOrigin || DEFAULT_API_ORIGIN;
  els.exportFields.value = saved.exportFields || DEFAULT_EXPORT_FIELDS;
  els.exportFilter.value = saved.exportFilter || "";
  els.rawInput.value = saved.rawInput || "";
  handleFileMeta();
}

async function persistSettings() {
  await setStorage(STORAGE_KEY, {
    apiOrigin: els.apiOrigin.value.trim(),
    exportFields: els.exportFields.value.trim(),
    exportFilter: els.exportFilter.value.trim(),
    rawInput: els.rawInput.value.trim(),
  });
}

function handleFileMeta() {
  const file = els.fileInput.files && els.fileInput.files[0];
  els.fileMeta.textContent = file ? `${file.name} · ${formatSize(file.size)}` : "未选择文件";
}

async function pingServer() {
  const apiOrigin = normalizeApiOrigin();
  setBusyState(true, "连接中");
  writeResult(`正在测试 ${apiOrigin}/api/health ...`);

  try {
    const response = await fetch(`${apiOrigin}/api/health`);
    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || payload?.detail || `HTTP ${response.status}`);
    }

    setStatus("success", "连接正常");
    writeResult(JSON.stringify(payload, null, 2));
  } catch (error) {
    setStatus("error", "连接失败");
    writeResult(normalizeError(error));
  } finally {
    setBusyState(false);
  }
}

async function previewRows() {
  setBusyState(true, "预检中");
  try {
    const { rows, source, parserErrors } = await collectRows();
    const validation = validateRows(rows);
    const previewPayload = {
      source,
      total: rows.length,
      richRows: validation.richRows,
      classicRows: validation.classicRows,
      parserErrors,
      sample: rows.slice(0, 2),
      issues: validation.issues.slice(0, 12),
    };
    setStatus(validation.issues.length ? "error" : "success", validation.issues.length ? "预检有问题" : "预检通过");
    writeResult(JSON.stringify(previewPayload, null, 2));
  } catch (error) {
    setStatus("error", "预检失败");
    writeResult(normalizeError(error));
  } finally {
    setBusyState(false);
  }
}

async function importRows() {
  const apiOrigin = normalizeApiOrigin();
  setBusyState(true, "导入中");

  try {
    const { rows, source, parserErrors } = await collectRows();
    const validation = validateRows(rows);

    if (validation.issues.length) {
      throw new Error([
        `预检未通过，来源：${source}`,
        parserErrors.length ? `解析提醒：${parserErrors.join("；")}` : "",
        ...validation.issues.slice(0, 10).map((item) => `第 ${item.index + 1} 行：${item.message}`),
      ].filter(Boolean).join("\n"));
    }

    const response = await fetch(`${apiOrigin}/api/tn-accounts/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: rows }),
    });

    const payload = await readJsonSafely(response);
    if (!response.ok) {
      throw new Error(payload?.error || payload?.detail || `HTTP ${response.status}`);
    }

    setStatus(payload.failed ? "error" : "success", payload.failed ? "部分失败" : "导入完成");
    writeResult(JSON.stringify({
      source,
      imported: payload.imported || 0,
      updated: payload.updated || 0,
      failed: payload.failed || 0,
      errors: payload.errors || [],
    }, null, 2));
  } catch (error) {
    setStatus("error", "导入失败");
    writeResult(normalizeError(error));
  } finally {
    await persistSettings();
    setBusyState(false);
  }
}

async function exportRows() {
  const apiOrigin = normalizeApiOrigin();
  const fields = (els.exportFields.value.trim() || DEFAULT_EXPORT_FIELDS)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .join(",");
  const filter = els.exportFilter.value.trim();

  setBusyState(true, "导出中");
  try {
    const params = new URLSearchParams();
    params.set("fields", fields);
    if (filter) {
      params.set("filter", filter);
    }

    const response = await fetch(`${apiOrigin}/api/v1/export?${params.toString()}`);
    if (!response.ok) {
      const payload = await readJsonSafely(response);
      throw new Error(payload?.error || payload?.detail || `HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const filename = `tn-export-${timestamp()}.csv`;
    downloadBlob(blob, filename);
    setStatus("success", "导出完成");
    writeResult(JSON.stringify({ filename, fields: fields.split(","), filter: filter || null, size: blob.size }, null, 2));
  } catch (error) {
    setStatus("error", "导出失败");
    writeResult(normalizeError(error));
  } finally {
    await persistSettings();
    setBusyState(false);
  }
}

async function collectRows() {
  const rawInput = els.rawInput.value.trim();
  const file = els.fileInput.files && els.fileInput.files[0];

  if (!rawInput && !file) {
    throw new Error("请先选择 CSV / JSON 文件，或在文本框内粘贴内容。");
  }

  const source = rawInput ? "textarea" : file.name;
  const rawText = rawInput || await file.text();
  const parserErrors = [];
  let rows;

  if (looksLikeJson(rawText)) {
    rows = parseJsonRows(rawText);
  } else {
    const parsed = Papa.parse(rawText, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (header) => String(header || "").trim(),
    });
    rows = parsed.data;
    if (Array.isArray(parsed.errors) && parsed.errors.length) {
      parserErrors.push(...parsed.errors.map((item) => `${item.message}${item.row != null ? ` @ row ${item.row + 1}` : ""}`));
    }
  }

  const sanitizedRows = rows
    .map(sanitizeRow)
    .filter(isMeaningfulRow);

  if (!sanitizedRows.length) {
    throw new Error("没有读取到有效数据行，请检查表头或粘贴内容。");
  }

  return {
    rows: sanitizedRows,
    source,
    parserErrors,
  };
}

function sanitizeRow(row) {
  const next = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) return;
    next[normalizedKey] = typeof value === "string" ? value.trim() : value;
  });
  return next;
}

function isMeaningfulRow(row) {
  return Object.values(row).some((value) => {
    if (value == null) return false;
    if (typeof value === "string") return value.trim() !== "";
    return true;
  });
}

function validateRows(rows) {
  const issues = [];
  let richRows = 0;
  let classicRows = 0;

  rows.forEach((row, index) => {
    if (isRichRow(row)) {
      richRows += 1;
      const missing = [
        ["phone", ["phone"]],
        ["username", ["username"]],
        ["token", ["token", "cookie", "Cookie"]],
        ["clientId", ["clientId"]],
        ["signature", ["signature", "X-TN-Integrity-Session", "x-tn-integrity-session", "X-PX-AUTHORIZATION", "x-px-authorization"]],
      ].filter(([_, aliases]) => !hasValue(row, aliases)).map(([label]) => label);

      if (missing.length) {
        issues.push({ index, message: `富字段模式缺少 ${missing.join(", ")}` });
      }
      return;
    }

    classicRows += 1;
    const missing = [
      ["username", ["username"]],
      ["password", ["password"]],
    ].filter(([_, aliases]) => !hasValue(row, aliases)).map(([label]) => label);

    if (missing.length) {
      issues.push({ index, message: `简版模式缺少 ${missing.join(", ")}` });
    }
  });

  return { issues, richRows, classicRows };
}

function isRichRow(row) {
  return hasValue(row, ["phone", "email", "clientId", "token", "cookie", "Cookie", "X-PX-AUTHORIZATION", "x-px-authorization"]);
}

function hasValue(row, aliases) {
  return aliases.some((alias) => {
    if (!Object.prototype.hasOwnProperty.call(row, alias)) return false;
    const value = row[alias];
    if (typeof value === "string") return value.trim() !== "";
    return value != null;
  });
}

function parseJsonRows(rawText) {
  const parsed = JSON.parse(rawText);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.items)) return parsed.items;
  throw new Error("JSON 需要是数组，或包含 items 数组。");
}

function looksLikeJson(rawText) {
  const trimmed = rawText.trim();
  return trimmed.startsWith("[") || trimmed.startsWith("{");
}

function normalizeApiOrigin() {
  const raw = els.apiOrigin.value.trim() || DEFAULT_API_ORIGIN;
  const normalized = raw.replace(/\/+$/, "");
  els.apiOrigin.value = normalized;
  return normalized;
}

function setBusyState(isBusy, label) {
  [els.pingBtn, els.previewBtn, els.importBtn, els.exportBtn].forEach((button) => {
    button.disabled = isBusy;
  });
  if (isBusy) {
    setStatus("running", label || "处理中");
  }
}

function setStatus(kind, label) {
  els.statusBadge.className = `status ${kind}`;
  els.statusBadge.textContent = label;
}

function writeResult(value) {
  els.result.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function normalizeError(error) {
  if (error instanceof Error) return error.message;
  return String(error || "Unknown error");
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function readJsonSafely(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { detail: text };
  }
}

function getStorage(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => resolve(result[key]));
  });
}

function setStorage(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, () => resolve());
  });
}
