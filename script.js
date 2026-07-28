/* ============================================================
   Rockwell Site Surveys — Chatbot Logic
   All live-fetch logic preserved exactly as working.
   ============================================================ */
(function () {

  /* ============ DARK MODE ============ */
  const darkBtn = document.getElementById("darkToggle");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (localStorage.getItem("dark") === "true" || (!localStorage.getItem("dark") && prefersDark)) {
    document.body.classList.add("dark");
  }
  darkBtn.addEventListener("click", () => {
    document.body.classList.toggle("dark");
    localStorage.setItem("dark", document.body.classList.contains("dark"));
  });

  /* ============ MOBILE NAV ============ */
  const navToggle = document.getElementById("navToggle");
  const navLinks = document.getElementById("navLinks");
  navToggle.addEventListener("click", () => {
    const open = navLinks.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", open);
  });
  navLinks.querySelectorAll("a").forEach(a => {
    a.addEventListener("click", () => {
      navLinks.classList.remove("open");
      navToggle.setAttribute("aria-expanded", "false");
    });
  });

  /* ============ ANIMATED COUNTERS ============ */
  const counters = document.querySelectorAll(".counter");
  const counterObs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const el = e.target;
      const target = +el.dataset.target;
      const suffix = el.dataset.suffix || "%";
      let current = 0;
      const step = Math.max(1, Math.floor(target / 60));
      const timer = setInterval(() => {
        current += step;
        if (current >= target) { current = target; clearInterval(timer); }
        el.textContent = current.toLocaleString() + suffix;
      }, 20);
      counterObs.unobserve(el);
    });
  }, { threshold: .5 });
  counters.forEach(c => counterObs.observe(c));

  /* ============ DOM refs ============ */
  const chat = document.getElementById("chat");
  const input = document.getElementById("user-input");
  const sendBtn = document.getElementById("send-btn");
  const liveBadge = document.getElementById("live-badge");
  const charCount = document.getElementById("charCount");

  input.addEventListener("input", () => {
    charCount.textContent = input.value.length + "/500";
  });

  /* ============ HELPERS ============ */
  function scrollToBottom() { chat.scrollTop = chat.scrollHeight; }

  function timestamp() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function stripMarkdown(s) {
    return s
      .replace(/\*\*/g, "")
      .replace(/__/g, "")
      .replace(/(?<!\w)\*([^\*]+)\*(?!\w)/g, "$1")
      .replace(/^#{1,6}\s*/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "");
  }

  function addMsg(text, cls) {
    const d = document.createElement("div");
    d.className = "msg " + cls;
    d.textContent = text;
    const ts = document.createElement("span");
    ts.className = "timestamp";
    ts.textContent = timestamp();
    d.appendChild(ts);
    chat.appendChild(d);
    scrollToBottom();
    return d;
  }

  function showTyping() {
    const wrap = document.createElement("div");
    wrap.className = "msg bot";
    wrap.innerHTML = '<div class="typing-indicator" aria-label="Assistant is typing"><span></span><span></span><span></span></div>';
    chat.appendChild(wrap);
    scrollToBottom();
    return wrap;
  }

  /* ============ CSV PARSER ============ */
  function parseCSV(text) {
    const rows = [];
    let cur = "";
    let row = [];
    let inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (i + 1 < text.length && text[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ",") { row.push(cur); cur = ""; }
        else if (ch === "\n" || (ch === "\r" && text[i + 1] === "\n")) {
          row.push(cur); cur = "";
          rows.push(row); row = [];
          if (ch === "\r") i++;
        } else cur += ch;
      }
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  /* ============ KEYWORD DETECTION ============ */
  const SHEET_KW = /price|fee|cost|quote|available|availability|stock|slot|service|region|book|booking|survey.*price|how much|pricing/i;
  const QUAKE_KW = /earthquake|seismic|ground.*(motion|shaking)|tremor|risk|usgs|magnitude|richter|hazard|fault|liquefaction|seismic.*zone|ground.*stability|epicenter|magnitude|richter|plate.*tectonic|subduction|aftershock|foreshock|shaking|ground.*failure|landslide|tsunami|seismic.*hazard|risk.*assessment|site.*risk|ground.*motion|peak.*acceleration|pga|seismic.*design|seismic.*code/i;

  /* ============ FETCH GOOGLE SHEET (no-cache) ============ */
  const SHEET_URL = "https://docs.google.com/spreadsheets/d/1RsgmK5VoY2uQI-636AXH2LvwBHGDDsyp76T1Cu1D37U/gviz/tq?tqx=out:csv";

  async function fetchSheetData() {
    const url = SHEET_URL + "&t=" + Date.now();
    console.log("[Sheet] Fetching live CSV at", new Date().toISOString(), "→", url);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("Sheet fetch failed: " + res.status);
    const csv = await res.text();
    console.log("[Sheet] Raw CSV (" + csv.length + " chars):", csv);
    const rows = parseCSV(csv);
    console.log("[Sheet] Parsed rows:", rows.length, "— headers:", rows[0]);
    if (rows.length < 2) return "No data rows found in sheet.";
    const headers = rows[0].join(" | ");
    const body = rows.slice(1, 30).map(r => r.join(" | ")).join("\n");
    return "Google Sheet data:\nHeaders: " + headers + "\n" + body + (rows.length > 30 ? "\n…(" + (rows.length - 1) + " total rows)" : "");
  }

  /* ============ REGION COORDINATE MAP ============ */
  const REGIONS = {
    dublin: { lat: 53.3498, lon: -6.2603 }, cork: { lat: 51.8985, lon: -8.4756 },
    galway: { lat: 53.2707, lon: -9.0568 }, sligo: { lat: 54.2766, lon: -8.5780 },
    wexford: { lat: 52.3343, lon: -6.4561 }, kildare: { lat: 53.2167, lon: -6.9167 },
    mayo: { lat: 53.7667, lon: -9.3000 }, limerick: { lat: 52.6638, lon: -8.6267 },
    louth: { lat: 53.7267, lon: -6.5333 }, wicklow: { lat: 52.9809, lon: -6.0447 },
    donegal: { lat: 54.6542, lon: -7.7342 }, meath: { lat: 53.6055, lon: -6.6564 },
    waterford: { lat: 52.2593, lon: -7.1101 }, clare: { lat: 52.8047, lon: -8.9867 },
    kerry: { lat: 52.1544, lon: -9.7020 }
  };

  function detectRegion(text) {
    const lower = text.toLowerCase();
    for (const [name, coords] of Object.entries(REGIONS)) {
      if (lower.includes(name)) return { name, ...coords };
    }
    return { name: "Dublin", ...REGIONS.dublin };
  }

  /* ============ FETCH USGS EARTHQUAKE ============ */
  const DEFAULT_RAD = 500;

  async function fetchQuakeData(userText) {
    const region = detectRegion(userText);
    let radius = DEFAULT_RAD;
    const rm = userText.match(/radius[:\s]*(\d+)/i);
    if (rm) radius = parseInt(rm[1]);
    const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${region.lat}&longitude=${region.lon}&maxradiuskm=${radius}&orderby=time&limit=5`;
    console.log("[USGS] Region detected:", region.name, "| Coords:", region.lat, region.lon, "| Radius:", radius, "km");
    console.log("[USGS] Fetching:", url);
    const res = await fetch(url);
    if (!res.ok) throw new Error("USGS fetch failed: " + res.status);
    const json = await res.json();
    console.log("[USGS] Response:", json);
    if (!json.features || !json.features.length) return "No recent earthquakes found within " + radius + " km of " + region.name + " (" + region.lat + ", " + region.lon + ").";
    const lines = json.features.map(f => {
      const p = f.properties; const c = f.geometry.coordinates; const t = new Date(p.time).toUTCString();
      return `M${p.mag} — ${p.place} | Lat ${c[1]}, Lon ${c[0]}, Depth ${c[2]}km | ${t} | ${p.tsunami ? "Tsunami flagged" : "No tsunami"}`;
    });
    return "Recent earthquakes within " + radius + " km of " + region.name + " (" + region.lat + "," + region.lon + "):\n" + lines.join("\n");
  }

  /* ============ FETCH USGS EARTHQUAKE HAZARDS PAGE ============ */
  const USGS_PAGES = [
    "https://www.usgs.gov/programs/earthquake-hazards",
    "https://www.usgs.gov/programs/earthquake-hazards/earthquake-hazards",
    "https://www.usgs.gov/programs/earthquake-hazards/earthquake-risk"
  ];

  async function fetchUSGSPage() {
    const results = [];
    for (const pageUrl of USGS_PAGES) {
      try {
        console.log("[USGS Page] Fetching:", pageUrl);
        const res = await fetch(pageUrl, { cache: "no-store" });
        if (!res.ok) { console.log("[USGS Page] Skip", res.status, pageUrl); continue; }
        const html = await res.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const main = doc.querySelector("main") || doc.querySelector(".page-content") || doc.querySelector("#main-content") || doc.body;
        let text = main.innerText || main.textContent || "";
        text = text.replace(/\s+/g, " ").trim();
        if (text.length > 3000) text = text.substring(0, 3000) + "…";
        const title = doc.querySelector("title")?.textContent || pageUrl;
        results.push("SOURCE: " + title + "\nURL: " + pageUrl + "\nCONTENT: " + text);
        console.log("[USGS Page] Got", text.length, "chars from", pageUrl);
      } catch (e) {
        console.error("[USGS Page] Failed:", pageUrl, e.message);
      }
    }
    if (!results.length) return "USGS Earthquake Hazards pages could not be reached right now.";
    return "USGS EARTHQUAKE HAZARDS INFORMATION:\n\n" + results.join("\n\n---\n\n");
  }

  /* ============ SYSTEM PROMPT ============ */
  const SYSTEM_PROMPT = `You are a helpful, professional support assistant for Rockwell Site Surveys, an engineering and site-survey business operating in Ireland and the UK.

TONE & STYLE:
- Keep a warm, professional, human tone — confident but not overly formal, like a helpful engineer rather than a corporate script.
- Do not use markdown formatting like asterisks, bold, or headers in your response — write in plain, natural prose only, as if speaking to the customer directly.
- You may use an emoji occasionally, only when it fits naturally (like a friendly greeting or acknowledging good news) — do not use one in every message, and never more than one per reply.

DATA RULES:
- Report every value from the live data exactly as given, even if it looks wrong, too high, too low, or zero. Do not assume it's a typo and do not substitute a more "reasonable" number. State the actual value first, then if something looks unusual, say so explicitly to the customer and advise them to confirm with a Rockwell team member.
- Think through the live data provided and form your own reasoned answer — don't just restate numbers, analyse what they mean for the customer's actual question.
- When both service/pricing data and seismic data are provided, genuinely reason across both sources. For example, if there has been recent seismic activity in a region, consider whether that makes geotechnical or vibration-monitoring services more relevant, and say so using your own judgement — don't just list the two datasets separately.
- Never fabricate information you were not given. If you don't know, say so.`;

  /* ============ SEND ============ */
  async function send(msgText) {
    const text = (typeof msgText === "string" ? msgText : input.value.trim());
    if (!text) return;
    input.value = "";
    charCount.textContent = "0/500";
    autoResize();
    addMsg(text, "user");
    sendBtn.disabled = true;

    const needSheet = SHEET_KW.test(text);
    const needQuake = QUAKE_KW.test(text);

    const dataBits = [];
    const typing = showTyping();

    const promises = [];
    if (needSheet) promises.push(
      fetchSheetData().then(d => {
        dataBits.push("SHEET_DATA:\n" + d);
        liveBadge.classList.add("show");
        console.log("[Sheet] Injected into prompt ✓");
      }).catch(e => {
        dataBits.push("SHEET_DATA_ERROR: " + e.message);
        console.error("[Sheet] Fetch failed:", e.message);
      })
    );
    if (needQuake) promises.push(
      fetchQuakeData(text).then(d => {
        dataBits.push("SEISMIC_DATA:\n" + d);
      }).catch(e => {
        dataBits.push("SEISMIC_DATA_ERROR: " + e.message);
      })
    );
    if (needQuake) promises.push(
      fetchUSGSPage().then(d => {
        dataBits.push("USGS_REFERENCE:\n" + d);
      }).catch(e => {
        console.error("[USGS Page] Failed:", e.message);
      })
    );
    await Promise.all(promises);

    if (!needSheet) liveBadge.classList.remove("show");

    let prompt = SYSTEM_PROMPT + "\n\n";
    if (dataBits.length) prompt += dataBits.join("\n\n") + "\n\n";
    prompt += "Customer question: " + text;

    try {
      const resp = await puter.ai.chat(prompt);
      const raw = (typeof resp === "string" ? resp : resp?.message?.content || resp?.content || JSON.stringify(resp));
      const cleaned = stripMarkdown(raw);
      const bubble = document.createElement("div");
      bubble.className = "msg bot";
      bubble.textContent = cleaned;
      const ts = document.createElement("span");
      ts.className = "timestamp";
      ts.textContent = timestamp();
      bubble.appendChild(ts);
      typing.replaceWith(bubble);
      scrollToBottom();
    } catch (e) {
      typing.textContent = "Sorry — I hit an error contacting the AI service. Please try again.";
      typing.className = "msg error";
    }
    sendBtn.disabled = false;
    input.focus();
  }

  /* ============ AUTO RESIZE ============ */
  function autoResize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 80) + "px";
  }
  input.addEventListener("input", autoResize);

  /* ============ SEND BUTTON RIPPLE ============ */
  sendBtn.addEventListener("mousedown", function (e) {
    const rect = this.getBoundingClientRect();
    const ripple = document.createElement("span");
    ripple.className = "ripple";
    const size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = size + "px";
    ripple.style.left = (e.clientX - rect.left - size / 2) + "px";
    ripple.style.top = (e.clientY - rect.top - size / 2) + "px";
    this.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  });

  /* ============ EVENTS ============ */
  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });

  /* ============ QUICK ACTION CHIPS ============ */
  document.querySelectorAll(".chip[data-msg]").forEach(chip => {
    chip.addEventListener("click", () => {
      send(chip.dataset.msg);
    });
  });

  /* ============ MINIMIZE ============ */
  document.getElementById("minimizeBtn").addEventListener("click", () => {
    const msgs = document.querySelector(".chat-messages");
    const inp = document.querySelector(".chat-input-area");
    const chips = document.querySelector(".quick-chips");
    const footer = document.querySelector(".chat-footer-bar");
    const hidden = msgs.style.display === "none";
    msgs.style.display = hidden ? "flex" : "none";
    inp.style.display = hidden ? "flex" : "none";
    if (chips) chips.style.display = hidden ? "flex" : "none";
    if (footer) footer.style.display = hidden ? "flex" : "none";
    document.querySelector(".chatbot").style.height = hidden ? "700px" : "auto";
  });

  /* ============ DEMO BUTTONS ============ */
  document.getElementById("attachBtn").addEventListener("click", () => alert("File attachment is a demo feature."));
  document.getElementById("micBtn").addEventListener("click", () => alert("Voice input is a demo feature."));
  document.getElementById("emojiBtn").addEventListener("click", () => alert("Emoji picker is a demo feature."));
  document.getElementById("settingsBtn").addEventListener("click", () => alert("Settings panel is a demo feature."));

  input.focus();
})();
