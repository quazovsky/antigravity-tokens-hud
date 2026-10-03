(() => {
  function getActiveConvId() {
    try {
      if (window.__TSR_ROUTER__?.state) {
        const matches = window.__TSR_ROUTER__.state.matches || [];
        for (let i = matches.length - 1; i >= 0; i--) {
          const cid = matches[i]?.params?.cascadeId;
          if (cid) return cid;
        }
        const pathname = window.__TSR_ROUTER__.state.location?.pathname || "";
        const parts = pathname.split("/");
        const idx = parts.indexOf("c");
        if (idx !== -1 && parts[idx + 1]) {
          return parts[idx + 1];
        }
      }

      const mainChat = document.querySelector("div:not([data-testid=\"conversation-row-sidebar\"])[data-cascade-id]");
      if (mainChat) {
        const id = mainChat.getAttribute("data-cascade-id");
        if (id) return id;
      }

      const selRow = document.querySelector("[data-selected=\"true\"][data-cascade-id]") || document.querySelector("[data-selected=\"true\"]");
      if (selRow) {
        const id = selRow.getAttribute("data-cascade-id");
        if (id) return id;
      }

      const parts = window.location.pathname.split("/");
      const idx = parts.indexOf("c");
      if (idx !== -1 && parts[idx + 1]) {
        return parts[idx + 1];
      }

      const anyChat = document.querySelector("[data-cascade-id]");
      if (anyChat) {
        const id = anyChat.getAttribute("data-cascade-id");
        if (id) return id;
      }
    } catch (_) {}
    return null;
  }

  function getActiveModelName() {
    try {
      const btns = Array.from(document.querySelectorAll("button"));
      const modelBtn = btns.find(b => {
        const t = (b.textContent || "").trim();
        return t.includes("Gemini") || t.includes("Claude") || t.includes("GPT") || t.includes("OpenAI");
      });
      if (modelBtn) {
        let txt = modelBtn.innerText.replace(/\s+/g, " ").trim();
        txt = txt.replace(/^[^\w\dа-яА-ЯёЁ]+/, "");
        txt = txt.replace(/^(model|switch model):\s*/i, "");
        return txt;
      }
    } catch (_) {}
    return "Gemini 3.8 Flash";
  }

  function fmtK(n) {
    if (!n || n <= 0) return "0";
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return Math.round(n / 1000) + "k";
    return n + "";
  }

  function formatResetTime(seconds, isRu) {
    if (!seconds) return "";
    const sec = typeof seconds === "string" ? parseInt(seconds, 10) : Number(seconds);
    if (isNaN(sec)) return "";
    const diff = sec - Math.floor(Date.now() / 1000);
    if (diff <= 0) return isRu ? "сейчас" : "now";
    const days = Math.floor(diff / 86400);
    const hours = Math.floor((diff % 86400) / 3600);
    const mins = Math.floor((diff % 3600) / 60);
    if (days > 0) return isRu ? `${days}д ${hours}ч` : `${days}d ${hours}h`;
    if (hours > 0) return isRu ? `${hours}ч ${mins}м` : `${hours}h ${mins}m`;
    return isRu ? `${mins}м` : `${mins}m`;
  }

  function getBarGradient(pct) {
    if (pct >= 50) return "linear-gradient(90deg, #10b981, #34d399)";
    if (pct >= 20) return "linear-gradient(90deg, #f59e0b, #fbbf24)";
    return "linear-gradient(90deg, #ef4444, #f87171)";
  }

  function getTextColor(pct) {
    if (pct >= 50) return "#34d399";
    if (pct >= 20) return "#fbbf24";
    return "#f87171";
  }

  async function fetchOfficialQuotas() {
    try {
      const btn = document.querySelector("button");
      if (!btn) return null;
      const fk = Object.keys(btn).find(k => k.startsWith("__reactFiber"));
      if (!fk) return null;
      let cur = btn[fk];
      let client = null;
      while (cur) {
        if (cur.memoizedProps?.value?.retrieveUserQuotaSummary) {
          client = cur.memoizedProps.value;
          break;
        }
        cur = cur.return;
      }
      if (!client) return null;
      const res = await Promise.race([
        client.retrieveUserQuotaSummary({}),
        new Promise(r => setTimeout(() => r(null), 1500))
      ]);
      return res?.response?.groups || null;
    } catch (e) {
      return null;
    }
  }

  let cachedQuotas = null;
  let lastQuotaFetch = 0;
  let isFetchingQuotas = false;

  async function getQuotas(force = false) {
    const now = Date.now();
    // 30 seconds refresh cycle
    if (force || !cachedQuotas || (now - lastQuotaFetch >= 30000 && !isFetchingQuotas)) {
      isFetchingQuotas = true;
      lastQuotaFetch = now;
      try {
        const q = await fetchOfficialQuotas();
        if (q && q.length > 0) cachedQuotas = q;
      } finally {
        isFetchingQuotas = false;
      }
    }
    return cachedQuotas;
  }

  function parseQuotaGroups(groups, isRu) {
    if (!groups || !groups.length) return [];
    return groups.map(g => {
      const dName = g.displayName || "";
      const isGemini = dName.toLowerCase().includes("gemini");
      const isClaudeGpt = dName.toLowerCase().includes("claude") || dName.toLowerCase().includes("gpt");

      let shortName = dName;
      if (isGemini) shortName = "Gemini";
      else if (isClaudeGpt) shortName = "Claude & GPT";

      const hBucket = g.buckets?.find(b => b.window === "5h" || b.bucketId?.includes("5h"));
      const wBucket = g.buckets?.find(b => b.window === "weekly" || b.bucketId?.includes("weekly"));

      const hVal = hBucket?.remaining?.value != null ? hBucket.remaining.value : 1.0;
      const wVal = wBucket?.remaining?.value != null ? wBucket.remaining.value : 1.0;

      const hPct = Math.round(hVal * 100);
      const wPct = Math.round(wVal * 100);

      const hResetSec = hBucket?.resetTime?.seconds;
      const wResetSec = wBucket?.resetTime?.seconds;

      const hResetStr = formatResetTime(hResetSec, isRu);
      const wResetStr = formatResetTime(wResetSec, isRu);

      let modelsDesc = (g.description || "").replace(/^Models within this group:\s*/i, "");
      modelsDesc = modelsDesc
        .replace("Gemini Flash, Gemini Pro", "Flash, Pro")
        .replace("Claude Opus, Claude Sonnet, GPT-OSS", "Opus, Sonnet, GPT");

      return {
        id: isGemini ? "gemini" : (isClaudeGpt ? "claude-gpt" : dName.toLowerCase().replace(/\s+/g, "-")),
        displayName: dName,
        shortName,
        isGemini,
        modelsDesc,
        fiveHour: {
          pct: hPct,
          resetStr: hResetStr,
          resetSec: hResetSec
        },
        weekly: {
          pct: wPct,
          resetStr: wResetStr,
          resetSec: wResetSec
        }
      };
    });
  }

  // Matte Carbon styling
  const CARBON_BG = [
    "background-color: #0c0d10",
    "background-image: linear-gradient(45deg, #16181e 25%, transparent 25%), linear-gradient(-45deg, #16181e 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #16181e 75%), linear-gradient(-45deg, transparent 75%, #16181e 75%)",
    "background-size: 6px 6px",
    "background-position: 0 0, 0 3px, 3px -3px, -3px 0px",
    "border: 1px solid rgba(255, 255, 255, 0.16)",
    "box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 6px 20px rgba(0, 0, 0, 0.65)"
  ].join("; ");

  window.__AGY_RENDER__ = async function() {
    const data = window.__AGY_DATA__;
    if (!data) return;

    let container = document.getElementById("antigravity-token-widget");
    const settingsBtn = Array.from(document.querySelectorAll("button")).find(b =>
      b.textContent && (b.textContent.includes("Settings") || b.textContent.includes("Настройки"))
    );
    if (!settingsBtn) return;

    // Language resolution
    let currentLang = "ru";
    try {
      currentLang = localStorage.getItem("agy_hud_lang") || window.__AGY_LANG__ || "ru";
    } catch (_) {
      currentLang = window.__AGY_LANG__ || "ru";
    }
    const isRu = currentLang === "ru";

    // Collapsed resolution
    let isCollapsed = false;
    try {
      isCollapsed = localStorage.getItem("agy_hud_collapsed") === "true";
    } catch (_) {}

    const containerStyles = [
      isCollapsed ? "padding: 8px 11px" : "padding: 10px 12px",
      "margin: 6px 8px 10px 8px",
      "border-radius: 10px",
      CARBON_BG,
      "font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      "color: #ffffff",
      "user-select: none",
      "cursor: default",
      "transition: border-color 0.2s ease, box-shadow 0.2s ease, padding 0.2s ease"
    ].join("; ");

    if (!container) {
      container = document.createElement("div");
      container.id = "antigravity-token-widget";
      container.style.cssText = containerStyles;
      settingsBtn.parentElement.insertBefore(container, settingsBtn);
    } else {
      container.onclick = null;
      container.style.cssText = containerStyles;
    }

    container.onmouseenter = () => {
      container.style.borderColor = "rgba(255, 255, 255, 0.32)";
      container.style.boxShadow = "inset 0 1px 0 rgba(255, 255, 255, 0.2), 0 8px 24px rgba(0, 0, 0, 0.75)";
    };
    container.onmouseleave = () => {
      container.style.borderColor = "rgba(255, 255, 255, 0.16)";
      container.style.boxShadow = "inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 6px 20px rgba(0, 0, 0, 0.65)";
    };

    // 1. Session Context
    const activeId = getActiveConvId();
    let session = null;
    if (data.sessions && activeId && data.sessions[activeId]) {
      session = data.sessions[activeId];
    } else if (activeId && data.current_session && data.current_session.session_id === activeId) {
      session = data.current_session;
    } else if (!activeId && data.current_session) {
      session = data.current_session;
    } else {
      session = {
        session_id: activeId || "new",
        context_size: 0,
        max_context: 1000000,
        context_percent: 0.0
      };
    }

    const pct = (session.context_percent != null) ? session.context_percent : 0.0;
    const barWidth = Math.min(100, Math.max(0, pct));
    const ctxK = fmtK(session.context_size || 0);
    const maxK = ((session.max_context || 1000000) >= 1000000) ? "1M" : fmtK(session.max_context);
    const modelName = getActiveModelName();

    // 2. Render COLLAPSED state
    if (isCollapsed) {
      container.innerHTML = `
        <div id="agy-expand-row" title="${isRu ? "Нажмите, чтобы открыть HUD" : "Click to open HUD"}" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; gap: 6px;">
          <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; min-width: 0;">
            <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #10b981; box-shadow: 0 0 6px #10b981; flex-shrink: 0;"></span>
            <span style="font-weight: 700; color: #ffffff; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -0.2px;" title="${modelName}">${modelName}</span>
            <span style="font-size: 11.5px; color: #34d399; font-weight: 700; flex-shrink: 0;">${pct.toFixed(1)}%</span>
          </div>
          <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
            <button type="button" id="agy-btn-expand" style="background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.22); color: #ffffff; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; gap: 3px; line-height: 1.1;">
              <span>${isRu ? "Открыть" : "Open"}</span>
              <span style="font-size: 8px;">▼</span>
            </button>
          </div>
        </div>
      `;

      const expandTrigger = container.querySelector("#agy-expand-row");
      if (expandTrigger) {
        expandTrigger.onclick = (e) => {
          e.stopPropagation();
          try { localStorage.setItem("agy_hud_collapsed", "false"); } catch (_) {}
          getQuotas(true);
          window.__AGY_RENDER__();
        };
      }
      return;
    }

    // 3. Render EXPANDED state (Both Gemini AND Claude/GPT always visible!)
    const rawGroups = await getQuotas();
    const groups = parseQuotaGroups(rawGroups, isRu);

    const title5h = isRu ? "5-часовой" : "5-Hour";
    const titleWeekly = isRu ? "Недельный" : "Weekly";
    const hideBtnLabel = isRu ? "Скрыть" : "Hide";

    let groupsHtml = "";
    if (!groups || groups.length === 0) {
      groupsHtml = `
        <div style="font-size: 12px; font-weight: 600; color: #ffffff; padding: 10px 0; text-align: center;">
          ${isRu ? "Загрузка данных квот..." : "Loading quota data..."}
        </div>
      `;
    } else {
      groupsHtml = groups.map((g, idx) => {
        const hGrad = getBarGradient(g.fiveHour.pct);
        const wGrad = getBarGradient(g.weekly.pct);
        const hTextColor = getTextColor(g.fiveHour.pct);
        const wTextColor = getTextColor(g.weekly.pct);

        const borderTop = (idx > 0) ? "border-top: 1px solid rgba(255,255,255,0.12); padding-top: 8px; margin-top: 8px;" : "margin-top: 6px;";
        const descHtml = g.modelsDesc ? `<span style="font-size: 10.5px; color: #cbd5e1; font-weight: 500; margin-left: 5px;">(${g.modelsDesc})</span>` : "";

        return `
          <div style="${borderTop}">
            <!-- Group Header -->
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 5px;">
              <span style="font-size: 12.5px; font-weight: 700; color: #ffffff;">${g.shortName}${descHtml}</span>
            </div>

            <!-- 5-Hour Row -->
            <div style="margin-bottom: 6px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
                <span style="font-size: 11.5px; font-weight: 600; color: #ffffff;">${title5h}</span>
                <span style="font-size: 12px; font-weight: 700; color: ${hTextColor};">
                  ${g.fiveHour.pct}% ${g.fiveHour.resetStr ? `<span style="font-weight: 600; color: #cbd5e1; font-size: 11px; margin-left: 3px;">(${g.fiveHour.resetStr})</span>` : ""}
                </span>
              </div>
              <div style="background: rgba(255,255,255,0.14); height: 6px; border-radius: 3px; overflow: hidden;">
                <div style="background: ${hGrad}; width: ${g.fiveHour.pct}%; height: 100%; border-radius: 3px; transition: width 0.3s ease;"></div>
              </div>
            </div>

            <!-- Weekly Row -->
            <div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
                <span style="font-size: 11.5px; font-weight: 600; color: #ffffff;">${titleWeekly}</span>
                <span style="font-size: 12px; font-weight: 700; color: ${wTextColor};">
                  ${g.weekly.pct}% ${g.weekly.resetStr ? `<span style="font-weight: 600; color: #cbd5e1; font-size: 11px; margin-left: 3px;">(${g.weekly.resetStr})</span>` : ""}
                </span>
              </div>
              <div style="background: rgba(255,255,255,0.14); height: 6px; border-radius: 3px; overflow: hidden;">
                <div style="background: ${wGrad}; width: ${g.weekly.pct}%; height: 100%; border-radius: 3px; transition: width 0.3s ease;"></div>
              </div>
            </div>
          </div>
        `;
      }).join("");
    }

    container.innerHTML = `
      <!-- 1. Header: Model name + Controls + Session Context Stats -->
      <div style="margin-bottom: 9px;">
        <!-- Top Row: Full Model Name & Control Buttons -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; gap: 6px;">
          <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; min-width: 0;">
            <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #10b981; box-shadow: 0 0 6px #10b981; flex-shrink: 0;"></span>
            <span style="font-weight: 700; color: #ffffff; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -0.2px;" title="${modelName}">${modelName}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
            <button type="button" id="agy-lang-toggle" title="${isRu ? "Переключить язык (RU/EN)" : "Switch language (RU/EN)"}" style="background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.22); color: #ffffff; font-size: 9.5px; font-weight: 700; padding: 2px 5px; border-radius: 4px; cursor: pointer; line-height: 1.1;">${isRu ? "RU" : "EN"}</button>
            <button type="button" id="agy-btn-collapse" title="${isRu ? "Скрыть полностью" : "Hide completely"}" style="background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.22); color: #ffffff; font-size: 9.5px; font-weight: 700; padding: 2px 5px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; gap: 2px; line-height: 1.1;">
              <span>${hideBtnLabel}</span>
              <span style="font-size: 7.5px;">▲</span>
            </button>
          </div>
        </div>

        <!-- Middle Row: Session Context Label & High-Contrast Stats -->
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px;">
          <span style="font-size: 11px; font-weight: 600; color: #94a3b8;">${isRu ? "Контекст сессии" : "Session Context"}</span>
          <span style="font-size: 12px; color: #34d399; font-weight: 700;">${pct.toFixed(1)}% <span style="font-weight: 500; color: #cbd5e1; font-size: 10.5px;">(${ctxK}/${maxK})</span></span>
        </div>

        <!-- Bottom Row: Real-time Context Bar -->
        <div style="background: rgba(255,255,255,0.14); height: 6px; border-radius: 3px; overflow: hidden;">
          <div style="background: linear-gradient(90deg, #10b981, #34d399); width: ${barWidth}%; height: 100%; border-radius: 3px; transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);"></div>
        </div>
      </div>

      <!-- 2. Quota Groups (Gemini + Claude & GPT both displayed clearly) -->
      ${groupsHtml}
    `;

    // Event listeners
    const langBtn = container.querySelector("#agy-lang-toggle");
    if (langBtn) {
      langBtn.onclick = (e) => {
        e.stopPropagation();
        const nextLang = isRu ? "en" : "ru";
        try { localStorage.setItem("agy_hud_lang", nextLang); } catch (_) {}
        window.__AGY_LANG__ = nextLang;
        window.__AGY_RENDER__();
      };
    }

    const collapseBtn = container.querySelector("#agy-btn-collapse");
    if (collapseBtn) {
      collapseBtn.onclick = (e) => {
        e.stopPropagation();
        try { localStorage.setItem("agy_hud_collapsed", "true"); } catch (_) {}
        window.__AGY_RENDER__();
      };
    }
  };

  if (!window.__AGY_LISTENER_SET__) {
    window.__AGY_LISTENER_SET__ = true;
    let lastId = null;
    let lastPath = window.location.pathname;

    if (window.__TSR_ROUTER__ && typeof window.__TSR_ROUTER__.subscribe === "function") {
      try {
        window.__TSR_ROUTER__.subscribe(() => {
          if (window.__AGY_RENDER__) window.__AGY_RENDER__();
        });
      } catch (_) {}
    }

    // High frequency watcher for navigation
    setInterval(() => {
      const currentId = getActiveConvId();
      const currentPath = window.location.pathname;
      if (currentId !== lastId || currentPath !== lastPath) {
        lastId = currentId;
        lastPath = currentPath;
        if (window.__AGY_RENDER__) window.__AGY_RENDER__();
      }
    }, 150);

    // Fast 1s tick for countdown timers
    setInterval(() => {
      if (window.__AGY_RENDER__) {
        window.__AGY_RENDER__();
      }
    }, 1000);

    // Hard refresh every 30 seconds: guaranteed fresh quotas without any stale cache
    setInterval(async () => {
      try {
        await getQuotas(true);
        if (window.__AGY_RENDER__) window.__AGY_RENDER__();
      } catch (_) {}
    }, 30000);
  }

  if (window.__AGY_RENDER__) {
    window.__AGY_RENDER__();
  }
})();
