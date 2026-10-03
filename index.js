#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");

const net = require("net");

// Suppress experimental sqlite warning
process.removeAllListeners("warning");

// Single-instance lock
const singleInstanceServer = net.createServer();
singleInstanceServer.once("error", (err) => {
  if (err.code === "EADDRINUSE") {
    process.exit(0);
  }
});
singleInstanceServer.listen(47892, "127.0.0.1");

let DatabaseSync = null;
try {
  DatabaseSync = require("node:sqlite").DatabaseSync;
} catch (_) {}

function getDevToolsFilePath() {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library/Application Support/Antigravity/DevToolsActivePort");
  } else if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData/Roaming");
    return path.join(appData, "Antigravity/DevToolsActivePort");
  } else {
    const configHome = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
    return path.join(configHome, "Antigravity/DevToolsActivePort");
  }
}

const DEVTOOLS_FILE = getDevToolsFilePath();
const CONVERSATIONS_DIR = path.join(os.homedir(), ".gemini/antigravity/conversations");
const TOKEN_STATS_SCRIPT = path.join(__dirname, "token_stats.py");
const CLIENT_SCRIPT_PATH = fs.existsSync(path.join(__dirname, "client_widget.js"))
  ? path.join(__dirname, "client_widget.js")
  : path.join(__dirname, "client_widget_injector.js");
const CONFIG_FILE = path.join(__dirname, "config.json");

let cdpMessageId = 1;
function nextCdpId() {
  cdpMessageId = (cdpMessageId + 1) & 0x7fffffff;
  return cdpMessageId;
}

// Protobuf decode helpers for SQLite data
function decodeVarint(buf, offset) {
  let res = 0;
  let shift = 0;
  while (true) {
    if (offset >= buf.length) break;
    const b = buf[offset++];
    res |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return [res, offset];
}

function parseProto(buf, offset = 0, end = null) {
  if (end === null) end = buf.length;
  const fields = [];
  while (offset < end) {
    const [tag, newOffset] = decodeVarint(buf, offset);
    offset = newOffset;
    const fieldNum = tag >> 3;
    const wireType = tag & 7;
    if (wireType === 0) {
      const [val, nextOffset] = decodeVarint(buf, offset);
      offset = nextOffset;
      fields.push({ fieldNum, type: "varint", val });
    } else if (wireType === 2) {
      const [length, nextOffset] = decodeVarint(buf, offset);
      offset = nextOffset;
      const val = buf.subarray(offset, offset + length);
      offset += length;
      fields.push({ fieldNum, type: "bytes", val });
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 5) {
      offset += 4;
    } else {
      break;
    }
  }
  return fields;
}

// Fast in-memory cache for parsed conversation databases
const dbCache = new Map();

function collectMetricsNode(currentConvId = null) {
  if (!DatabaseSync || !fs.existsSync(CONVERSATIONS_DIR)) return null;

  const nowTs = Math.floor(Date.now() / 1000);
  let dbFiles = fs.readdirSync(CONVERSATIONS_DIR)
    .filter(f => f.endsWith(".db"))
    .map(f => {
      const fullPath = path.join(CONVERSATIONS_DIR, f);
      try {
        const stat = fs.statSync(fullPath);
        let mtime = stat.mtimeMs;
        try {
          const walStat = fs.statSync(fullPath + "-wal");
          if (walStat.mtimeMs > mtime) mtime = walStat.mtimeMs;
        } catch (_) {}
        try {
          const shmStat = fs.statSync(fullPath + "-shm");
          if (shmStat.mtimeMs > mtime) mtime = shmStat.mtimeMs;
        } catch (_) {}
        return { path: fullPath, name: f, mtime };
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);

  dbFiles.sort((a, b) => b.mtime - a.mtime);
  if (!currentConvId && dbFiles.length > 0) {
    currentConvId = dbFiles[0].name.replace(".db", "");
  }

  const cutoffTs = nowTs - (8 * 86400);
  const allRecords = [];
  let latestTs = 0;

  for (const { path: dbPath, name, mtime } of dbFiles) {
    const sessId = name.replace(".db", "");
    if (sessId !== currentConvId && (mtime / 1000) < cutoffTs) {
      continue;
    }

    const cached = dbCache.get(dbPath);
    if (cached && cached.mtime === mtime) {
      for (const r of cached.records) {
        if (r.timestamp > latestTs) latestTs = r.timestamp;
        allRecords.push(r);
      }
      continue;
    }

    const recordsForDb = [];
    try {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const stepTimes = new Map();
      try {
        const stepRows = db.prepare("SELECT idx, metadata FROM steps WHERE metadata IS NOT NULL").all();
        for (const row of stepRows) {
          if (!row.metadata) continue;
          const proto = parseProto(row.metadata);
          for (const f of proto) {
            if (f.fieldNum === 1 && f.type === "bytes") {
              const sub = parseProto(f.val);
              for (const sf of sub) {
                if (sf.fieldNum === 1 && sf.type === "varint") {
                  stepTimes.set(row.idx, sf.val);
                }
              }
            }
          }
        }
      } catch (_) {}

      try {
        const metaRows = db.prepare("SELECT idx, data FROM gen_metadata ORDER BY idx ASC").all();
        for (const row of metaRows) {
          if (!row.data) continue;
          const ts = stepTimes.get(row.idx) || 0;
          if (ts > latestTs) latestTs = ts;
          const proto = parseProto(row.data);
          for (const f of proto) {
            if (f.fieldNum === 1 && f.type === "bytes") {
              const sub = parseProto(f.val);
              for (const sf of sub) {
                if (sf.fieldNum === 17 && sf.type === "bytes") {
                  const tsub = parseProto(sf.val);
                  for (const tf of tsub) {
                    if (tf.type === "bytes") {
                      const dsub = parseProto(tf.val);
                      const d = {};
                      for (const df of dsub) {
                        if (df.type === "varint") d[df.fieldNum] = df.val;
                      }
                      if (d && ((d[2] || 0) > 0 || (d[5] || 0) > 0 || (d[3] || 0) > 0)) {
                        const promptTokens = d[2] || 0;
                        const outputTokens = d[3] || 0;
                        const cachedTokens = d[5] || 0;
                        const thinkingTokens = d[9] || 0;
                        const textTokens = d[10] || 0;

                        // Filter out non-token telemetry records (e.g. durations in nanoseconds > 2M)
                        if (promptTokens > 2000000 || cachedTokens > 2000000 || outputTokens > 1000000) {
                          continue;
                        }

                        const rec = {
                          session_id: sessId,
                          idx: row.idx,
                          timestamp: ts,
                          prompt_tokens: promptTokens,
                          output_tokens: outputTokens,
                          cached_tokens: cachedTokens,
                          thinking_tokens: thinkingTokens,
                          text_tokens: textTokens,
                          context_size: cachedTokens + promptTokens + outputTokens
                        };
                        recordsForDb.push(rec);
                        allRecords.push(rec);
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } catch (_) {}
      db.close();
      dbCache.set(dbPath, { mtime, records: recordsForDb });
    } catch (_) {}
  }

  const refTs = latestTs > 0 ? latestTs : nowTs;
  const h5Ts = refTs - (5 * 3600);
  const w1Ts = refTs - (7 * 86400);

  const h5Records = allRecords.filter(r => r.timestamp >= h5Ts);
  const w1Records = allRecords.filter(r => r.timestamp >= w1Ts);

  const maxContext = 1000000;
  const sessionsMap = {};
  for (const r of allRecords) {
    const sid = r.session_id;
    const ctx = r.context_size;
    sessionsMap[sid] = {
      session_id: sid,
      context_size: ctx,
      max_context: maxContext,
      context_percent: Number(((ctx / maxContext) * 100).toFixed(2)),
      cached_tokens: r.cached_tokens,
      prompt_tokens: r.prompt_tokens,
      output_tokens: r.output_tokens,
      thinking_tokens: r.thinking_tokens,
      text_tokens: r.text_tokens
    };
  }

  const currentSession = sessionsMap[currentConvId] || null;
  const currentContext = currentSession ? currentSession.context_size : 0;
  const currentCached = currentSession ? currentSession.cached_tokens : 0;
  const currentPrompt = currentSession ? currentSession.prompt_tokens : 0;
  const currentOutput = currentSession ? currentSession.output_tokens : 0;
  const currentThinking = currentSession ? currentSession.thinking_tokens : 0;
  const currentText = currentSession ? currentSession.text_tokens : 0;

  return {
    current_session: {
      session_id: currentConvId,
      context_size: currentContext,
      max_context: maxContext,
      context_percent: Number(((currentContext / maxContext) * 100).toFixed(2)),
      cached_tokens: currentCached,
      prompt_tokens: currentPrompt,
      output_tokens: currentOutput,
      thinking_tokens: currentThinking,
      text_tokens: currentText
    },
    sessions: sessionsMap,
    usage_5h: {
      window_hours: 5,
      total_requests: h5Records.length,
      input_tokens: h5Records.reduce((s, r) => s + r.prompt_tokens, 0),
      output_tokens: h5Records.reduce((s, r) => s + r.output_tokens, 0),
      thinking_tokens: h5Records.reduce((s, r) => s + r.thinking_tokens, 0),
      total_tokens: h5Records.reduce((s, r) => s + r.prompt_tokens + r.output_tokens, 0)
    },
    usage_weekly: {
      window_days: 7,
      total_requests: w1Records.length,
      input_tokens: w1Records.reduce((s, r) => s + r.prompt_tokens, 0),
      output_tokens: w1Records.reduce((s, r) => s + r.output_tokens, 0),
      thinking_tokens: w1Records.reduce((s, r) => s + r.thinking_tokens, 0),
      total_tokens: w1Records.reduce((s, r) => s + r.prompt_tokens + r.output_tokens, 0)
    },
    updated_at: new Date().toISOString()
  };
}

function fetchTokenStatsPython() {
  return new Promise((resolve) => {
    const pythonBin = process.platform === "win32" ? "python" : "python3";
    const env = { ...process.env };
    if (process.platform !== "win32") {
      env.PATH = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", process.env.PATH || ""].join(":");
    }
    execFile(pythonBin, [TOKEN_STATS_SCRIPT, "--json"], { timeout: 8000, env }, (err, stdout) => {
      if (err || !stdout) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (_) {
        resolve(null);
      }
    });
  });
}

async function fetchTokenStats() {
  try {
    const nodeMetrics = collectMetricsNode();
    if (nodeMetrics) return nodeMetrics;
  } catch (_) {}
  return await fetchTokenStatsPython();
}

// Map of pageId -> { ws, injected: boolean, url: string }
const activePages = new Map();
let currentPort = null;
let isUpdating = false;

function getConfigLang() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      if (cfg && cfg.lang) return cfg.lang;
    }
  } catch (_) {}
  return "ru";
}

function getDevToolsInfo() {
  if (!fs.existsSync(DEVTOOLS_FILE)) return null;
  try {
    const content = fs.readFileSync(DEVTOOLS_FILE, "utf8").trim().split("\n");
    if (content.length >= 1 && content[0]) {
      return { port: parseInt(content[0].trim(), 10) };
    }
  } catch (_) {}
  return null;
}

async function listAntigravityPages(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1500) });
    const list = await res.json();
    return list.filter(p => p.type === "page" && p.url && (p.url.includes("127.0.0.1") || p.url.includes("localhost") || p.url.includes("antigravity")));
  } catch (_) {
    return [];
  }
}

function connectPageWebSocket(page) {
  return new Promise((resolve) => {
    let resolved = false;
    let ws = null;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { if (ws) ws.close(); } catch (_) {}
        resolve(null);
      }
    }, 2000);

    try {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      const entry = { ws, injected: false, pageId: page.id, url: page.url };

      ws.onopen = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          activePages.set(page.id, entry);
          resolve(entry);
        }
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data.error) {
            const msgText = data.error.message || "";
            if (msgText.includes("execution context") || msgText.includes("detached") || msgText.includes("Target closed")) {
              entry.injected = false;
              try { ws.close(); } catch (_) {}
              activePages.delete(page.id);
            }
          }
        } catch (_) {}
      };

      ws.onerror = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(null);
        }
        activePages.delete(page.id);
      };

      ws.onclose = () => {
        activePages.delete(page.id);
      };
    } catch (_) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(null);
      }
    }
  });
}

async function updateLoop() {
  if (isUpdating) return;
  isUpdating = true;

  try {
    const info = getDevToolsInfo();
    if (!info) {
      for (const [id, entry] of activePages) {
        try { entry.ws.close(); } catch (_) {}
      }
      activePages.clear();
      return;
    }

    if (currentPort !== info.port) {
      currentPort = info.port;
      for (const [id, entry] of activePages) {
        try { entry.ws.close(); } catch (_) {}
      }
      activePages.clear();
    }

    const pages = await listAntigravityPages(currentPort);
    const currentPageIds = new Set(pages.map(p => p.id));

    // Remove dead pages
    for (const [id, entry] of activePages) {
      if (!currentPageIds.has(id)) {
        try { entry.ws.close(); } catch (_) {}
        activePages.delete(id);
      }
    }

    // Connect new pages
    for (const page of pages) {
      const existing = activePages.get(page.id);
      if (!existing || existing.ws.readyState !== WebSocket.OPEN) {
        if (existing) {
          try { existing.ws.close(); } catch (_) {}
          activePages.delete(page.id);
        }
        await connectPageWebSocket(page);
      }
    }

    if (activePages.size === 0) return;

    const stats = await fetchTokenStats();
    if (!stats) return;

    let clientScript = "";
    try {
      clientScript = fs.readFileSync(CLIENT_SCRIPT_PATH, "utf8");
    } catch (_) {}

    const lang = getConfigLang();
    const payload = JSON.stringify(stats);

    for (const [id, entry] of activePages) {
      if (entry.ws.readyState !== WebSocket.OPEN) continue;

      let evalCode = "";
      if (!entry.injected) {
        entry.injected = true;
        evalCode = `
          window.__AGY_DATA__ = ${payload};
          window.__AGY_LANG__ = ${JSON.stringify(lang)};
          ${clientScript}
        `;
      } else {
        evalCode = `
          window.__AGY_DATA__ = ${payload};
          if (window.__AGY_RENDER__) window.__AGY_RENDER__();
        `;
      }

      entry.ws.send(JSON.stringify({
        id: nextCdpId(),
        method: "Runtime.evaluate",
        params: {
          expression: evalCode,
          returnByValue: false
        }
      }));
    }
  } catch (_) {
    // Non-fatal, retry next tick
  } finally {
    isUpdating = false;
  }
}

// Watch conversations directory for real-time reactivity
if (fs.existsSync(CONVERSATIONS_DIR)) {
  try {
    fs.watch(CONVERSATIONS_DIR, () => {
      updateLoop();
    });
  } catch (_) {}
}

console.log("[Antigravity Tokens HUD] High-speed daemon running. Monitoring Antigravity DevTools...");
setInterval(updateLoop, 250);
updateLoop();
