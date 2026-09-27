(() => {
  "use strict";

  const API_BASE = "https://student-wellness-analytics-4swo.onrender.com";

  // ---------------------------------------------------------
  // Dataset reference numbers 
  // ---------------------------------------------------------
  // score histogram, 0.5-wide bins from 3.5 to 9.5
  const HIST = [41, 344, 469, 713, 502, 840, 503, 638, 282, 421, 199, 48];
  // % of students scoring below x, for x = 3.5, 3.6, ... 9.5
  const CDF = [0.0, 0.0, 0.0, 0.2, 0.5, 0.8, 2.3, 3.9, 5.3, 6.6, 7.7, 9.0, 10.6, 12.3, 14.5, 17.1, 24.0, 26.3, 28.2, 29.8, 31.3, 32.8, 34.5, 36.4, 38.7, 41.4, 49.9, 52.2, 54.6, 56.4, 58.2, 59.9, 61.5, 63.6, 65.9, 68.2, 74.5, 76.8, 78.7, 80.0, 81.0, 82.1, 83.1, 83.9, 85.2, 86.6, 90.7, 91.8, 93.0, 94.2, 95.1, 96.1, 97.0, 97.6, 98.3, 99.0, 99.6, 99.8, 99.9, 100.0, 100.0];
  // averages among students scoring 7+
  const LEVERS = [
    { key: "sleep_hours_per_night",   name: "Sleep",            target: 7.9, better: "higher", unit: "h" },
    { key: "avg_daily_usage_hours",   name: "Screen time",      target: 3.4, better: "lower",  unit: "h" },
    { key: "daily_unlocks",           name: "Phone unlocks",    target: 128, better: "lower",  unit: "" },
    { key: "physical_activity_hours", name: "Physical activity",target: 2.2, better: "higher", unit: "h" },
    { key: "study_hours",             name: "Study time",       target: 4.6, better: "higher", unit: "h" },
  ];
  const CHOICE_FIELDS = ["gender", "country", "academic_level", "most_used_platform", "purpose_of_use", "stress_level"];
  const NUMERIC_FIELDS = ["avg_daily_usage_hours", "daily_unlocks", "study_hours", "physical_activity_hours", "sleep_hours_per_night"];

  const $ = (id) => document.getElementById(id);
  const form = $("predict-form");
  const panel = $("result-panel");
  const submitBtn = $("submit-btn");
  const scoreEl = $("score-number");
  const kickerEl = $("readout-kicker");
  const deltaEl = $("delta");
  const gaugeFill = $("gauge-fill");
  const needle = $("needle");
  const liveToggle = $("live-toggle");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let hasResult = false;
  let lastScore = null;
  let shownScore = 0;
  let requestSeq = 0;
  let inflight = null;
  let liveTimer = null;

  // ---------------------------------------------------------
  // Theme
  // ---------------------------------------------------------
  $("theme-toggle").addEventListener("click", () => {
    const root = document.documentElement;
    const current = root.dataset.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    const next = current === "light" ? "dark" : "light";
    root.dataset.theme = next;
    try { localStorage.setItem("mhs-theme", next); } catch (e) {}
  });

  // ---------------------------------------------------------
  // API health pill
  // ---------------------------------------------------------
  const apiPill = $("api-pill");
  function setApiStatus(status, text) {
    apiPill.dataset.status = status;
    apiPill.querySelector(".api-text").textContent = text;
    apiPill.title = `${text} · ${API_BASE}`;
  }
  (async function checkApi() {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(`${API_BASE}/`, { signal: ctrl.signal });
      setApiStatus(res.ok ? "online" : "offline", res.ok ? "Model online" : "Model error");
    } catch (e) {
      setApiStatus("offline", "Model offline");
    } finally {
      clearTimeout(t);
    }
  })();

  // ---------------------------------------------------------
  // Hero counters
  // ---------------------------------------------------------
  function tween(from, to, ms, onFrame) {
    if (reduceMotion) { onFrame(to); return; }
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      onFrame(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  document.querySelectorAll("[data-count]").forEach((el) => {
    const to = parseFloat(el.dataset.count);
    const dec = parseInt(el.dataset.decimals || "0", 10);
    tween(0, to, 1400, (v) => (el.textContent = v.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec })));
  });

  // ---------------------------------------------------------
  // Gauge ticks
  // ---------------------------------------------------------
  (function drawTicks() {
    const g = $("gauge-ticks");
    const NS = "http://www.w3.org/2000/svg";
    const cx = 150, cy = 150;
    for (let i = 0; i <= 10; i++) {
      const a = ((135 + 27 * i) * Math.PI) / 180;
      const major = i % 5 === 0;
      const r1 = 101, r2 = major ? 91 : 95;
      const line = document.createElementNS(NS, "line");
      line.setAttribute("x1", (cx + r1 * Math.cos(a)).toFixed(1));
      line.setAttribute("y1", (cy + r1 * Math.sin(a)).toFixed(1));
      line.setAttribute("x2", (cx + r2 * Math.cos(a)).toFixed(1));
      line.setAttribute("y2", (cy + r2 * Math.sin(a)).toFixed(1));
      if (major) line.classList.add("major");
      g.appendChild(line);
    }
    // scale labels just outside the arc ends and above the top
    [[0, 58, 256], [5, 150, 14], [10, 242, 256]].forEach(([label, x, y]) => {
      const txt = document.createElementNS(NS, "text");
      txt.setAttribute("x", x);
      txt.setAttribute("y", y);
      txt.textContent = label;
      g.appendChild(txt);
    });
  })();

  // ---------------------------------------------------------
  // Sliders + stepper
  // ---------------------------------------------------------
  function paintSlider(input) {
    const min = +input.min, max = +input.max, v = +input.value;
    const wrap = input.closest(".slider-field");
    const avg = parseFloat(wrap.dataset.avg);
    input.style.setProperty("--pct", `${((v - min) / (max - min)) * 100}%`);
    input.style.setProperty("--avg", `${((avg - min) / (max - min)) * 100}%`);
    const decimals = input.step.includes(".") ? 1 : 0;
    wrap.querySelector("output b").textContent = v.toFixed(decimals);
  }
  const sliders = [...form.querySelectorAll('input[type="range"]')];
  sliders.forEach((s) => {
    paintSlider(s);
    s.addEventListener("input", () => paintSlider(s));
  });

  function setSlider(key, value, flash) {
    const input = $(key);
    input.value = String(value);
    paintSlider(input);
    if (flash) {
      const wrap = input.closest(".slider-field");
      wrap.classList.remove("flash");
      void wrap.offsetWidth;
      wrap.classList.add("flash");
    }
  }

  form.querySelectorAll(".step-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = $(btn.dataset.target);
      const next = (parseInt(input.value, 10) || 0) + parseInt(btn.dataset.step, 10);
      input.value = String(Math.max(+input.min, Math.min(+input.max, next)));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });

  // ---------------------------------------------------------
  // Progress (six categorical choices)
  // ---------------------------------------------------------
  function updateProgress() {
    const fd = new FormData(form);
    const done = CHOICE_FIELDS.filter((k) => String(fd.get(k) || "").trim() !== "").length;
    $("progress-count").textContent = done;
    $("progress-bar").style.width = `${(done / CHOICE_FIELDS.length) * 100}%`;
  }

  // ---------------------------------------------------------
  // Errors
  // ---------------------------------------------------------
  function fieldOf(name) {
    const msg = form.querySelector(`.error-msg[data-for="${name}"]`);
    return msg ? { wrap: msg.closest(".field"), msg } : null;
  }
  function setFieldError(name, message) {
    const f = fieldOf(name);
    if (!f) return false;
    f.wrap.classList.add("field-error");
    f.msg.textContent = message;
    return true;
  }
  function clearFieldError(name) {
    const f = fieldOf(name);
    if (!f) return;
    f.wrap.classList.remove("field-error");
    f.msg.textContent = "";
  }
  function clearAllErrors() {
    form.querySelectorAll(".field-error").forEach((f) => f.classList.remove("field-error"));
    form.querySelectorAll(".error-msg").forEach((m) => (m.textContent = ""));
  }

  // ---------------------------------------------------------
  // Payload + validation (mirrors StudentData in main.py)
  // ---------------------------------------------------------
  function collectPayload() {
    const fd = new FormData(form);
    const num = (k, int) => {
      const raw = fd.get(k);
      if (raw === null || raw === "") return NaN;
      return int ? parseInt(raw, 10) : parseFloat(raw);
    };
    return {
      age: num("age", true),
      gender: fd.get("gender") || "",
      country: String(fd.get("country") || "").trim(),
      academic_level: fd.get("academic_level") || "",
      most_used_platform: fd.get("most_used_platform") || "",
      purpose_of_use: fd.get("purpose_of_use") || "",
      avg_daily_usage_hours: num("avg_daily_usage_hours"),
      daily_unlocks: num("daily_unlocks", true),
      study_hours: num("study_hours"),
      physical_activity_hours: num("physical_activity_hours"),
      sleep_hours_per_night: num("sleep_hours_per_night"),
      stress_level: fd.get("stress_level") || "",
    };
  }

  function validate(p) {
    const errors = [];
    if (Number.isNaN(p.age)) errors.push(["age", "Enter your age."]);
    else if (p.age < 10 || p.age > 100) errors.push(["age", "Age must be between 10 and 100."]);
    const pickMsg = {
      gender: "Pick one.", country: "Enter a country.", academic_level: "Pick your level.",
      most_used_platform: "Pick a platform.", purpose_of_use: "Pick a purpose.", stress_level: "Pick a stress level.",
    };
    CHOICE_FIELDS.forEach((k) => { if (!p[k]) errors.push([k, pickMsg[k]]); });
    NUMERIC_FIELDS.forEach((k) => { if (Number.isNaN(p[k])) errors.push([k, "Required."]); });
    return errors;
  }

  // ---------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------
  function setState(name) { panel.dataset.state = name; }

  function toneFor(score) {
    if (score < 4) return "var(--bad)";
    if (score < 5.5) return "var(--warn)";
    if (score < 7) return "var(--ok)";
    return "var(--good)";
  }

  function bandFor(score) {
    if (score < 4) return { label: "Signal: strained", context: "Your responses suggest elevated strain right now. Small shifts in sleep or screen time can go a long way." };
    if (score < 7) return { label: "Signal: balanced", context: "Your rhythm looks fairly steady, with some room to recover and reset." };
    return { label: "Signal: strong", context: "Your habits point to a well-supported, resilient baseline. Keep it up." };
  }

  function percentileFor(score) {
    if (score < 3.5) return 0;
    if (score > 9.5) return 100;
    return CDF[Math.round((score - 3.5) * 10)];
  }

  function drawHistogram(score) {
    const svg = $("histogram");
    const W = 300, H = 70, top = 8, n = HIST.length, gap = 3;
    const bw = W / n;
    const peak = Math.max(...HIST);
    const hitIdx = Math.max(0, Math.min(n - 1, Math.floor((score - 3.5) / 0.5)));
    let html = "";
    HIST.forEach((c, i) => {
      const h = Math.max(2, (c / peak) * (H - top));
      const cls = i === hitIdx ? "hit" : i < hitIdx ? "below" : "";
      html += `<rect class="${cls}" x="${(i * bw + gap / 2).toFixed(1)}" y="${(top + H - top - h).toFixed(1)}" width="${(bw - gap).toFixed(1)}" height="${h.toFixed(1)}" rx="3"/>`;
    });
    const x = (Math.max(3.5, Math.min(9.5, score)) - 3.5) / 6 * W;
    html += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="4" y2="${H + 4}"/><circle cx="${x.toFixed(1)}" cy="4" r="4"/>`;
    svg.innerHTML = html;

    const pct = percentileFor(score);
    $("percentile").innerHTML = `Higher than <b>${Math.round(pct)}%</b> of students`;
  }

  function fmt(v, unit) {
    return unit === "h" ? `${(+v).toFixed(1)}h` : String(Math.round(v));
  }

  function drawLevers(payload) {
    const list = $("levers");
    list.innerHTML = "";
    LEVERS.forEach((lv) => {
      const input = $(lv.key);
      const min = +input.min, max = +input.max, v = payload[lv.key];
      const pos = (x) => `${((Math.max(min, Math.min(max, x)) - min) / (max - min)) * 100}%`;
      const onTrack = lv.better === "higher" ? v >= lv.target - 0.05 : v <= lv.target + (lv.unit ? 0.05 : 2);
      const gap = Math.abs(v - lv.target);
      const arrow = lv.better === "higher" ? "↑" : "↓";

      const li = document.createElement("li");
      li.className = "lever";
      li.innerHTML = `
        <div class="lever-name">${lv.name}<small>you ${fmt(v, lv.unit)} · 7+ avg ${fmt(lv.target, lv.unit)}</small></div>
        ${onTrack
          ? `<span class="lever-status ok">✓ on track</span>`
          : `<button type="button" class="try-btn" data-key="${lv.key}" data-target="${lv.target}">Try ${arrow} ${fmt(gap, lv.unit)}</button>`}
        <div class="lever-track">
          ${onTrack ? "" : `<span class="lever-gap" style="left:${pos(Math.min(v, lv.target))};width:calc(${pos(Math.max(v, lv.target))} - ${pos(Math.min(v, lv.target))})"></span>`}
          <span class="lever-target" style="left:${pos(lv.target)}" title="Average of students scoring 7+"></span>
          <span class="lever-you" style="left:${pos(v)}" title="You"></span>
        </div>`;
      list.appendChild(li);
    });
  }

  $("levers").addEventListener("click", (e) => {
    const btn = e.target.closest(".try-btn");
    if (!btn) return;
    setSlider(btn.dataset.key, btn.dataset.target, true);
    liveToggle.checked = true;
    predict({ quiet: true });
  });

  function renderResult(score, payload) {
    const s = Math.max(0, Math.min(10, score));
    const { label, context } = bandFor(s);
    panel.style.setProperty("--score-color", toneFor(s));

    gaugeFill.style.strokeDashoffset = String(100 - s * 10);
    needle.style.transform = `rotate(${135 + 27 * s}deg)`;

    const from = shownScore;
    tween(from, score, 1100, (v) => (scoreEl.textContent = v.toFixed(2)));
    shownScore = score;

    if (lastScore !== null) {
      const d = score - lastScore;
      deltaEl.hidden = false;
      deltaEl.className = `delta ${Math.abs(d) < 0.005 ? "flat" : d > 0 ? "up" : "down"}`;
      deltaEl.textContent = Math.abs(d) < 0.005 ? "no change" : `${d > 0 ? "▲ +" : "▼ "}${d.toFixed(2)} vs last`;
      // re-trigger the pop animation
      deltaEl.style.animation = "none"; void deltaEl.offsetWidth; deltaEl.style.animation = "";
    } else {
      deltaEl.hidden = true;
    }
    lastScore = score;

    kickerEl.textContent = "Predicted score";
    $("score-band").textContent = label;
    $("score-context").textContent = context;
    drawHistogram(score);
    drawLevers(payload);
    setState("result");
  }

  function renderError(label, copy, showCmd) {
    $("error-label").textContent = label;
    $("error-copy").textContent = copy;
    $("error-cmd").hidden = !showCmd;
    kickerEl.textContent = "No signal";
    scoreEl.textContent = "–.–";
    shownScore = 0;
    lastScore = null;
    deltaEl.hidden = true;
    gaugeFill.style.strokeDashoffset = "100";
    needle.style.transform = "rotate(135deg)";
    hasResult = false;
    setState("error");
  }

  function applyServerValidationErrors(detail) {
    if (!Array.isArray(detail)) return false;
    let matched = false;
    detail.forEach((err) => {
      const field = Array.isArray(err.loc) ? err.loc[err.loc.length - 1] : null;
      if (field && setFieldError(field, err.msg || "Invalid value.")) matched = true;
    });
    return matched;
  }

  // ---------------------------------------------------------
  // Predict
  // ---------------------------------------------------------
  async function predict({ quiet = false } = {}) {
    clearAllErrors();
    const payload = collectPayload();
    const errors = validate(payload);
    if (errors.length) {
      if (quiet) return; // live mode: wait until the form is complete again
      errors.forEach(([k, m]) => setFieldError(k, m));
      const first = fieldOf(errors[0][0]);
      first?.wrap.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      first?.wrap.querySelector("input")?.focus({ preventScroll: true });
      return;
    }

    const seq = ++requestSeq;
    inflight?.abort();
    inflight = new AbortController();

    if (quiet && hasResult) {
      setState("updating");
    } else {
      submitBtn.disabled = true;
      submitBtn.classList.add("loading");
      kickerEl.textContent = "Reading…";
      setState("loading");
      if (window.innerWidth <= 1000) panel.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }

    try {
      const res = await fetch(`${API_BASE}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: inflight.signal,
      });
      if (seq !== requestSeq) return;

      if (res.status === 422) {
        const body = await res.json().catch(() => null);
        const matched = body && applyServerValidationErrors(body.detail);
        renderError("Check your inputs", matched
          ? "The model rejected a few fields — they're marked on the form."
          : "The model rejected this submission. Please review your inputs and try again.");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        renderError("Prediction failed", body && typeof body.detail === "string" ? body.detail : `The API responded with status ${res.status}.`);
        return;
      }
      const data = await res.json();
      if (typeof data.predicted_mental_health_score !== "number") {
        renderError("Unexpected response", "The API responded, but the score was missing or malformed.");
        return;
      }
      hasResult = true;
      setApiStatus("online", "Model online");
      renderResult(data.predicted_mental_health_score, payload);
    } catch (err) {
      if (err.name === "AbortError" || seq !== requestSeq) return;
      setApiStatus("offline", "Model offline");
      renderError("Can't reach the model", `Couldn't connect to ${API_BASE}. Start the backend from the project folder, then try again:`, true);
    } finally {
      if (seq === requestSeq) {
        submitBtn.disabled = false;
        submitBtn.classList.remove("loading");
      }
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    predict();
  });

  // live-clear errors, progress, and live re-prediction
  function onFormChange(e) {
    if (e.target.name) clearFieldError(e.target.name);
    updateProgress();
    if (hasResult && liveToggle.checked && e.target !== liveToggle) {
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => predict({ quiet: true }), 380);
    }
  }
  form.addEventListener("input", onFormChange);
  form.addEventListener("change", onFormChange);

  $("error-retry-btn").addEventListener("click", () => {
    kickerEl.textContent = "Awaiting input";
    setState("idle");
  });

  // ---------------------------------------------------------
  // Random profile
  // ---------------------------------------------------------
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const rnd = (min, max, dp = 1) => +(min + Math.random() * (max - min)).toFixed(dp);

  $("sample-btn").addEventListener("click", () => {
    ["gender", "academic_level", "most_used_platform", "purpose_of_use", "stress_level"].forEach((name) => {
      pick([...form.querySelectorAll(`input[name="${name}"]`)]).checked = true;
    });
    $("country").value = pick(["India", "USA", "Canada", "UK", "Australia", "Germany", "Japan", "Nepal", "Spain", "France"]);
    $("age").value = String(Math.round(rnd(18, 24, 0)));
    setSlider("avg_daily_usage_hours", rnd(1.5, 8.5), true);
    setSlider("daily_unlocks", Math.round(rnd(70, 270, 0)), true);
    setSlider("study_hours", rnd(0.5, 7), true);
    setSlider("physical_activity_hours", rnd(0.3, 3.5), true);
    setSlider("sleep_hours_per_night", rnd(4, 9.5), true);
    clearAllErrors();
    updateProgress();
    if (hasResult && liveToggle.checked) predict({ quiet: true });
  });

  updateProgress();
})();
