/* CBG Truck Tracker: trip log form, shared dashboard and Excel export. */
(function () {
  "use strict";
  const CFG = window.TRACKER_CONFIG || {};
  const STORE = "cbgTruckTrips_v2";
  const QUEUE = "cbgTruckQueue_v2";
  const SLOT_COLORS = ["#0B5CA8", "#E0A21B", "#2E9E8F"];
  const SLOTS = (CFG.slots || []).map((s, i) => ({ ...s, startM: toMin(s.start), endM: toMin(s.end), color: SLOT_COLORS[i % 3] }));
  const OUT = { id: "OUT", label: "Outside time slots", color: "#9A9AA3" };

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = n => Math.round(n).toLocaleString("en-US");

  // ---------- helpers ----------
  function toMin(t) { if (!t) return null; const m = /^(\d{1,2}):(\d{2})/.exec(t); return m ? +m[1] * 60 + +m[2] : null; }
  function pad(n) { return String(n).padStart(2, "0"); }
  function isoDate(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function today() { return isoDate(new Date()); }
  function nowHM() { const d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function addDays(iso, n) { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return isoDate(d); }
  function prettyDate(iso) { return new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }); }
  function time12(t) { if (!t) return ""; let [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return h + ":" + pad(m) + ap; }
  function diffMin(a, b) { const x = toMin(a), y = toMin(b); if (x == null || y == null) return null; let d = y - x; if (d < 0) d += 1440; return d; }
  function durText(m) { if (m == null) return ""; const h = Math.floor(m / 60); return h ? (m % 60 ? h + "h " + pad(m % 60) + "m" : h + (h === 1 ? " hour" : " hours")) : m + " min"; }
  const roundTrip = t => diffMin(t.left, t.back);
  const WARN_MIN = +CFG.longTripMinutes || 120;
  // Returns a sentence when a return time looks unusual, or "" when it looks fine.
  function returnWarning(left, back) {
    const rt = diffMin(left, back);
    if (rt == null) return null;
    if (rt === 0) return { msg: "The return time is the same as the time leaving.", long: false };
    if (rt < 10) return { msg: "That's only " + durText(rt) + " after the truck left.", long: false };
    if (rt > WARN_MIN) return { msg: "Round trip of " + durText(rt) + " (left " + time12(left) + ", back " + time12(back) + (toMin(back) < toMin(left) ? " the next day" : "") + "). That's over " + durText(WARN_MIN) + ".", long: true };
    return null;
  }
  const avg = arr => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null;
  function hourLabel(h) { return (h % 12 || 12) + (h >= 12 ? "pm" : "am"); }

  function slotIdFor(t) {
    const m = toMin(t.left);
    if (m == null) return "OUT";
    const s = SLOTS.find(s => m >= s.startM && m < s.endM);
    return s ? s.id : "OUT";
  }
  const slotById = id => SLOTS.find(s => s.id === id) || OUT;

  // ---------- storage ----------
  // Shared mode: trips live in a Google Sheet (CFG.sheetUrl). Changes queue on the device
  // until the sheet confirms them, so nothing is lost if the signal drops.
  // Local mode (no sheetUrl): trips stay in this browser only.
  const SHEET_URL = (CFG.sheetUrl || "").trim();
  const SHARED = !!SHEET_URL;
  const readLS = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const writeLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked: keep in memory */ } };
  let base = readLS(STORE, []);
  let queue = readLS(QUEUE, []);   // {op:"up", trips:[...]} | {op:"del", ids:[...]}
  let trips = [];
  const ADMIN_KEY = "cbgTruckAdmin";
  let adminCode = (() => { try { return sessionStorage.getItem(ADMIN_KEY) || ""; } catch (e) { return ""; } })();
  function setAdmin(code) { adminCode = code; try { code ? sessionStorage.setItem(ADMIN_KEY, code) : sessionStorage.removeItem(ADMIN_KEY); } catch (e) {} }
  let lastSync = null, syncState = SHARED ? "loading" : "local", flushing = false;

  function compute() {
    const m = new Map(base.map(t => [t.id, t]));
    queue.forEach(q => {
      if (q.op === "del") q.ids.forEach(id => m.delete(id));
      else if (q.op === "ret") { const t = m.get(q.id); if (t) m.set(q.id, { ...t, back: q.back, delayNote: q.note || "", updatedAt: q.at }); }
      else q.trips.forEach(t => m.set(t.id, t));
    });
    trips = [...m.values()];
  }
  function applyTo(item) {
    if (item.op === "del") base = base.filter(t => !item.ids.includes(t.id));
    else if (item.op === "ret") base = base.map(t => t.id === item.id ? { ...t, back: item.back, delayNote: item.note || "", updatedAt: item.at } : t);
    else item.trips.forEach(t => { const i = base.findIndex(x => x.id === t.id); if (i < 0) base.push(t); else base[i] = t; });
  }
  function commit(item) {
    if (SHARED) { queue.push(item); writeLS(QUEUE, queue); }
    else { applyTo(item); writeLS(STORE, base); }
    compute(); renderAll();
    if (SHARED) flush();
  }
  const upsertTrips = list => commit({ op: "up", trips: list });
  const removeTrips = ids => commit({ op: "del", ids });
  const setReturn = (id, back, note) => commit({ op: "ret", id, back, note: note || "", at: new Date().toISOString() });
  const forSheet = t => { const rt = roundTrip(t); return { ...t, slot: slotById(slotIdFor(t)).label, roundTrip: rt == null ? "" : rt }; };

  async function api(body) {
    // text/plain keeps the request "simple" so Google Apps Script accepts it from another site.
    const r = await fetch(SHEET_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ ...body, code: adminCode || undefined }) });
    const j = await r.json();
    if (!j.ok) { const err = new Error(j.error || "Sheet refused the change"); err.locked = !!j.locked; throw err; }
    return j;
  }
  async function flush() {
    if (!SHARED || flushing) return;
    flushing = true;
    try {
      while (queue.length) {
        const q = queue[0];
        if (q.op === "del") await api({ action: "delete", ids: q.ids });
        else if (q.op === "ret") await api({ action: "setReturn", id: q.id, back: q.back, note: q.note || "", updatedAt: q.at });
        else await api({ action: "upsert", trips: q.trips.map(forSheet) });
        applyTo(q); queue.shift(); writeLS(QUEUE, queue); writeLS(STORE, base);
      }
      syncState = "ok";
    } catch (e) {
      if (e.locked) {
        // The sheet refused a change to a saved trip: drop it, so it doesn't block new trips behind it.
        queue.shift(); writeLS(QUEUE, queue); setAdmin(""); toast(e.message);
        flushing = false; route(); return flush();
      }
      syncState = navigator.onLine === false ? "offline" : "error";
    }
    flushing = false;
    if (!queue.length) await refresh(); else { compute(); renderAll(); }
  }
  async function refresh() {
    if (!SHARED) return;
    try {
      const r = await fetch(SHEET_URL + (SHEET_URL.includes("?") ? "&" : "?") + "action=list&t=" + Date.now());
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "bad reply");
      base = j.trips || [];
      writeLS(STORE, base); lastSync = new Date(); if (!queue.length) syncState = "ok";
    } catch (e) { syncState = navigator.onLine === false ? "offline" : "error"; }
    compute(); renderAll();
  }
  function renderSync() {
    const b = $("syncBadge"); b.className = "badge";
    const n = queue.reduce((s, q) => s + (q.op === "del" ? q.ids.length : q.op === "ret" ? 1 : q.trips.length), 0);
    if (!SHARED) { b.textContent = "This device only"; b.classList.add("warn"); b.title = "Add the Google Sheet link in config.js to share trips between devices."; return; }
    if (n) { b.textContent = n + " waiting to send"; b.classList.add("warn"); b.title = "Saved on this device. They will send when the connection is back."; return; }
    if (syncState === "loading") { b.textContent = "Loading trips…"; return; }
    if (syncState !== "ok") { b.textContent = "Can't reach the trip sheet"; b.classList.add("bad"); b.title = "Showing the last copy on this device."; return; }
    b.textContent = "Live · updated " + (lastSync ? time12(pad(lastSync.getHours()) + ":" + pad(lastSync.getMinutes())) : ""); b.classList.add("ok");
    b.title = "Trips from every device. Refreshes every minute.";
  }
  function newId(date, left) {
    return "T-" + date.replace(/-/g, "") + "-" + (left || "0000").replace(":", "") + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
  }

  // ---------- form ----------
  function updateSlotPreview() {
    const p = $("slotPreview"), v = $("f_left").value;
    if (!v) { p.textContent = "Time slot: add the time leaving plant"; return; }
    const s = slotById(slotIdFor({ left: v }));
    p.innerHTML = '<span class="dot" style="background:' + s.color + '"></span>' + esc(s.label);
  }
  function resetForm() {
    $("tripForm").reset();
    $("f_id").value = ""; $("f_date").value = today(); $("f_left").value = nowHM();
    $("formTitle").textContent = "New trip"; $("btnSave").textContent = "Save trip"; $("btnCancelEdit").hidden = true;
    $("formErr").textContent = "";
    document.querySelectorAll("#tripForm .invalid").forEach(e => e.classList.remove("invalid"));
    const last = readLS("cbgTruckLast", {});
    if (last.operator) $("f_operator").value = last.operator;
    if (last.truck) { ensureOption($("f_truck"), last.truck); $("f_truck").value = last.truck; }
    updateSlotPreview();
  }
  function ensureOption(sel, v) { if (v && ![...sel.options].some(o => o.value === v)) sel.add(new Option(v, v)); }
  function editTrip(id) {
    const t = trips.find(x => x.id === id); if (!t || !adminCode) return;
    location.hash = "#log";
    $("f_id").value = t.id; $("f_date").value = t.date; $("f_left").value = t.left || ""; $("f_back").value = t.back || "";
    ensureOption($("f_truck"), t.truck); $("f_truck").value = t.truck; $("f_operator").value = t.operator;
    $("formTitle").textContent = "Edit trip"; $("btnSave").textContent = "Save changes"; $("btnCancelEdit").hidden = false;
    updateSlotPreview(); window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function onSubmit(e) {
    e.preventDefault();
    document.querySelectorAll("#tripForm .invalid").forEach(x => x.classList.remove("invalid"));
    const t = { id: $("f_id").value, date: $("f_date").value, left: $("f_left").value, back: $("f_back").value, truck: $("f_truck").value, operator: $("f_operator").value.trim() };
    const errs = [];
    const bad = (id, msg) => { $(id).classList.add("invalid"); errs.push(msg); };
    if (!t.date) bad("f_date", "Pick the date.");
    if (!t.left) bad("f_left", "Add the time leaving plant.");
    if (!t.truck) bad("f_truck", "Pick the truck.");
    if (!t.operator) bad("f_operator", "Type the operator's name.");
    if (t.date && t.date > today()) bad("f_date", "The date is in the future.");
    if (errs.length) { $("formErr").textContent = errs.join(" "); return; }
    const prevTrip = t.id ? trips.find(x => x.id === t.id) : null;
    t.delayNote = prevTrip && prevTrip.back === t.back ? (prevTrip.delayNote || "") : "";
    const warn = t.back ? returnWarning(t.left, t.back) : null;
    if (warn && !(prevTrip && prevTrip.back === t.back)) {
      const note = await askOverride(warn.msg, warn.long);
      if (note === null) { $("f_back").classList.add("invalid"); $("f_back").focus(); return; }
      t.delayNote = note;
    }
    const now = new Date().toISOString();
    const prev = t.id ? trips.find(x => x.id === t.id) : null;
    if (prev && !adminCode) { $("formErr").textContent = "Editing a saved trip needs the admin code. Open All trips to unlock."; return; }
    const rec = prev ? { ...prev, ...t, updatedAt: now } : { ...t, id: newId(t.date, t.left), createdAt: now, updatedAt: now };
    writeLS("cbgTruckLast", { operator: t.operator, truck: t.truck });
    upsertTrips([rec]);
    toast((prev ? "Changes saved" : "Trip saved") + " · " + slotById(slotIdFor(rec)).label);
    resetForm();
  }

  function renderToday() {
    const d = today(); $("todayLabel").textContent = prettyDate(d);
    const tt = trips.filter(t => t.date === d).sort((a, b) => (b.left || "").localeCompare(a.left || ""));
    const ids = SLOTS.map(s => s.id).concat(tt.some(t => slotIdFor(t) === "OUT") ? ["OUT"] : []);
    $("todaySlots").innerHTML = ids.map(id => {
      const s = slotById(id), n = tt.filter(t => slotIdFor(t) === id).length;
      return '<div><small><span class="dot" style="background:' + s.color + '"></span>' + esc(s.label) + "</small><b>" + n + "</b><small>" + (n === 1 ? "trip" : "trips") + "</small></div>";
    }).join("");
    $("todaySlots").style.gridTemplateColumns = "repeat(" + ids.length + ",1fr)";
    $("todayList").innerHTML = tt.length ? tt.map(t =>
      '<div class="trip-row"><span class="dot" style="background:' + slotById(slotIdFor(t)).color + '"></span><strong>' + time12(t.left) + "</strong><span>" + esc(t.truck) + "</span><span class='muted'>" + esc(t.operator) + "</span><span class='rt'>" +
      (t.back ? "back " + time12(t.back) + " · " + durText(roundTrip(t)) + (t.delayNote ? " · " + esc(t.delayNote) : "") : "<span class='status open'>Out</span>") + "</span></div>").join("")
      : '<div class="empty">No trips logged today yet.</div>';
    renderOut();
  }
  // Trucks that left but have no return time yet (today and yesterday). Anyone can add the return time once.
  function renderOut() {
    const box = $("outList");
    if (box.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
    const from = addDays(today(), -1);
    const out = trips.filter(t => !t.back && t.date >= from).sort((a, b) => (a.date + a.left).localeCompare(b.date + b.left));
    $("outCount").textContent = out.length ? out.length + " out" : "";
    box.innerHTML = out.length ? out.map(t =>
      '<div class="out-item" data-id="' + esc(t.id) + '"><div><strong>' + esc(t.truck) + "</strong> <span class='muted'>· " + esc(t.operator) + "</span><div class='muted small'>Left " +
      (t.date === today() ? "" : prettyDate(t.date) + " ") + time12(t.left) + "</div></div>" +
      '<label>Time back<input type="time" class="o_back" value="' + nowHM() + '"></label><button type="button" class="btn dark small o_save">Save return</button></div>').join("")
      : '<div class="empty">All trucks are back at the plant.</div>';
    box.querySelectorAll(".out-item").forEach(el => {
      el.querySelector(".o_save").onclick = async () => {
        const t = trips.find(x => x.id === el.dataset.id), back = el.querySelector(".o_back").value;
        if (!t) return;
        if (!back) { toast("Add the time the truck got back."); return; }
        const rt = diffMin(t.left, back), warn = returnWarning(t.left, back);
        let note = "";
        if (warn) { note = await askOverride(warn.msg, warn.long); if (note === null) { el.querySelector(".o_back").focus(); return; } }
        setReturn(t.id, back, note); toast(t.truck + " back at " + time12(back) + " · round trip " + durText(rt) + (note ? " · " + note : ""));
      };
    });
  }

  // ---------- dashboard ----------
  let chDays, chHours;
  function periodRange() {
    const p = $("d_period").value, d = today();
    if (p === "today") return [d, d];
    if (p === "yesterday") { const y = addDays(d, -1); return [y, y]; }
    if (p === "week") { const dow = (new Date(d + "T12:00:00").getDay() + 6) % 7; return [addDays(d, -dow), d]; }
    if (p === "month") return [d.slice(0, 8) + "01", d];
    if (p === "custom") return [$("d_from").value || "0000-01-01", $("d_to").value || "9999-12-31"];
    const ds = trips.map(t => t.date).sort();
    return ds.length ? [ds[0], ds[ds.length - 1]] : [d, d];
  }
  function filtered() {
    const [a, b] = periodRange(), sl = $("d_slot").value, tr = $("d_truck").value, op = $("d_operator").value;
    return trips.filter(t => t.date >= a && t.date <= b && (!sl || slotIdFor(t) === sl) && (!tr || t.truck === tr) && (!op || t.operator === op));
  }
  function fillSelect(sel, values, allText) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">' + allText + "</option>" + values.map(v => '<option value="' + esc(v) + '">' + esc(v) + "</option>").join("");
    if (values.includes(cur)) sel.value = cur;
  }
  function groupTable(el, keyName, keyFn, list) {
    const g = {};
    list.forEach(t => { const k = keyFn(t); const o = g[k] || (g[k] = { n: 0, days: new Set(), rts: [] }); o.n++; o.days.add(t.date); if (roundTrip(t) != null) o.rts.push(roundTrip(t)); SLOTS.forEach(s => (o[s.id] = (o[s.id] || 0) + (slotIdFor(t) === s.id ? 1 : 0))); });
    const rows = Object.entries(g).sort((x, y) => y[1].n - x[1].n);
    el.innerHTML = "<thead><tr><th>" + keyName + "</th><th class='num'>Trips</th>" + SLOTS.map(s => "<th class='num'>" + esc(s.label) + "</th>").join("") + "<th class='num'>Avg round trip</th></tr></thead><tbody>" +
      (rows.length ? rows.map(([k, o]) => "<tr><td>" + esc(k) + "</td><td class='num'><b>" + o.n + "</b></td>" + SLOTS.map(s => "<td class='num'>" + (o[s.id] || 0) + "</td>").join("") + "<td class='num'>" + (o.rts.length ? durText(Math.round(avg(o.rts))) : "–") + "</td></tr>").join("")
        : "<tr><td colspan='" + (3 + SLOTS.length) + "' class='empty'>No trips in this period.</td></tr>") + "</tbody>";
  }
  function renderDashboard() {
    fillSelect($("d_truck"), [...new Set([...(CFG.trucks || []), ...trips.map(t => t.truck)])], "All trucks");
    fillSelect($("d_operator"), [...new Set(trips.map(t => t.operator))].sort(), "All operators");
    document.querySelectorAll(".filters .custom").forEach(l => (l.hidden = $("d_period").value !== "custom"));
    const [a, b] = periodRange();
    $("d_rangeText").textContent = a === b ? prettyDate(a) : prettyDate(a) + " to " + prettyDate(b);
    const list = filtered();

    // days in range (up to today)
    const days = [];
    const end = b > today() ? today() : b;
    let start = a;
    if ($("d_period").value === "custom" && list.length) start = [a, ...list.map(t => t.date)].sort()[a === "0000-01-01" ? 1 : 0];
    for (let d = start, g = 0; d <= end && g < 400; d = addDays(d, 1), g++) days.push(d);
    const activeDays = new Set(list.map(t => t.date)).size;

    const bySlot = {}; list.forEach(t => (bySlot[slotIdFor(t)] = (bySlot[slotIdFor(t)] || 0) + 1));
    const busiest = SLOTS.slice().sort((x, y) => (bySlot[y.id] || 0) - (bySlot[x.id] || 0))[0];
    const tiles = [
      ["Trips", fmt(list.length), "Plant to Frequente"],
      ["Average trips per day", activeDays ? (list.length / activeDays).toFixed(1) : "–", "Over " + activeDays + (activeDays === 1 ? " day" : " days") + " with trips"],
      ["Busiest time slot", list.length && busiest ? busiest.label : "–", list.length && busiest ? (bySlot[busiest.id] || 0) + " trips" : ""],
      ["Average round trip", (() => { const r = list.map(roundTrip).filter(x => x != null); return r.length ? durText(Math.round(avg(r))) : "–"; })(), "Leaving plant to back at plant"]
    ];
    $("tiles").innerHTML = tiles.map(x => '<div class="tile"><div class="k">' + x[0] + '</div><div class="v">' + x[1] + '</div><div class="sub">' + x[2] + "</div></div>").join("");

    const ids = SLOTS.map(s => s.id).concat(bySlot.OUT ? ["OUT"] : []);
    $("slotTiles").innerHTML = ids.map(id => {
      const s = slotById(id), n = bySlot[id] || 0;
      return '<div class="tile slot" style="--c:' + s.color + '"><div class="k">' + esc(s.label) + '</div><div class="v">' + n + '</div><div class="sub">' + (list.length ? Math.round(n / list.length * 100) : 0) + "% of trips</div></div>";
    }).join("");
    $("slotTiles").style.gridTemplateColumns = "repeat(" + ids.length + ",minmax(0,1fr))";

    $("dayLegend").innerHTML = ids.map(id => '<span><span class="dot" style="background:' + slotById(id).color + '"></span>' + esc(slotById(id).label) + "</span>").join("");
    if (window.Chart) {
      if (chDays) chDays.destroy();
      chDays = new Chart($("chartDays"), {
        type: "bar",
        data: { labels: days.map(prettyDate), datasets: ids.map(id => ({
          label: slotById(id).label, backgroundColor: slotById(id).color, borderColor: "#fff", borderWidth: { top: 2 }, borderRadius: 4, borderSkipped: "bottom", maxBarThickness: 36,
          data: days.map(d => list.filter(t => t.date === d && slotIdFor(t) === id).length) })) },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
          plugins: { legend: { display: false }, tooltip: { callbacks: { footer: it => "Total: " + it.reduce((s, i) => s + i.raw, 0) + " trips" } } },
          scales: { x: { stacked: true, grid: { display: false }, ticks: { color: "#6b6b72", maxRotation: 0, autoSkip: true } },
            y: { stacked: true, beginAtZero: true, ticks: { precision: 0, color: "#6b6b72" }, grid: { color: "#eeeef0" }, title: { display: true, text: "Trips", color: "#6b6b72" } } } }
      });
      // trips by hour: 6am to 11pm, colored by the slot each hour falls in
      const hours = []; for (let h = 6; h <= 23; h++) hours.push(h);
      const hc = hours.map(h => list.filter(t => toMin(t.left) != null && Math.floor(toMin(t.left) / 60) === h).length);
      const hcol = hours.map(h => slotById(slotIdFor({ left: pad(h) + ":00" })).color);
      if (chHours) chHours.destroy();
      chHours = new Chart($("chartHours"), {
        type: "bar",
        data: { labels: hours.map(hourLabel), datasets: [{ label: "Trips", data: hc, backgroundColor: hcol, borderRadius: 4, borderSkipped: "bottom", maxBarThickness: 28 }] },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { title: it => hourLabel(hours[it[0].dataIndex]) + " to " + hourLabel((hours[it[0].dataIndex] + 1) % 24), label: c => c.raw + " trips" } } },
          scales: { x: { grid: { display: false }, ticks: { color: "#6b6b72", maxRotation: 0, autoSkip: true } }, y: { beginAtZero: true, ticks: { precision: 0, color: "#6b6b72" }, grid: { color: "#eeeef0" } } } }
      });
    }
    groupTable($("opTable"), "Operator", t => t.operator, list);
    groupTable($("truckTable"), "Truck", t => t.truck, list);
  }

  // ---------- all trips ----------
  function renderTrips() {
    const q = ($("t_search").value || "").toLowerCase();
    const list = trips.filter(t => !q || [t.id, t.truck, t.operator].join(" ").toLowerCase().includes(q))
      .sort((a, b) => (b.date + b.left).localeCompare(a.date + a.left));
    $("tripTable").innerHTML = "<thead><tr><th>Date</th><th>Time leaving plant</th><th>Time back</th><th class='num'>Round trip</th><th>Time slot</th><th>Truck</th><th>Operator</th><th></th></tr></thead><tbody>" +
      (list.length ? list.map(t => { const s = slotById(slotIdFor(t));
        return "<tr><td>" + prettyDate(t.date) + "</td><td>" + time12(t.left) + "</td><td>" + (t.back ? time12(t.back) : "<span class='status open'>Out</span>") + "</td><td class='num'>" + durText(roundTrip(t)) + (t.delayNote ? "<div class='delay' title='Saved anyway'>" + esc(t.delayNote) + "</div>" : "") + "</td><td><span class='dot' style='background:" + s.color + "'></span>" + esc(s.label) + "</td><td>" + esc(t.truck) + "</td><td>" + esc(t.operator) +
          "</td><td class='actions'><button class='btn link' data-edit='" + esc(t.id) + "'>Edit</button><button class='btn link del' data-del='" + esc(t.id) + "'>Delete</button></td></tr>"; }).join("")
        : "<tr><td colspan='8' class='empty'>No trips yet.</td></tr>") + "</tbody>";
    $("tripTable").querySelectorAll("[data-edit]").forEach(b => (b.onclick = () => editTrip(b.dataset.edit)));
    $("tripTable").querySelectorAll("[data-del]").forEach(b => (b.onclick = async () => {
      const t = trips.find(x => x.id === b.dataset.del);
      if (!t || !await askConfirm("Delete the " + t.truck + " trip that left at " + time12(t.left) + " on " + prettyDate(t.date) + "? This can't be undone.")) return;
      removeTrips([t.id]); toast("Trip deleted.");
    }));
  }

  // ---------- Excel ----------
  async function exportExcel() {
    if (!await askCode("Generate Excel is locked")) return;
    if (!window.XLSX) { toast("The Excel tool didn't load. Check the internet connection and try again."); return; }
    if (!trips.length) { toast("No trips to export yet."); return; }
    const sorted = [...trips].sort((a, b) => (a.date + a.left).localeCompare(b.date + b.left));
    const frac = t => { const m = toMin(t); return m == null ? null : m / 1440; };
    const aoa = [["Trip ID", "Date", "Time Leaving Plant", "Time Back At Plant", "Round Trip (min)", "Time Slot", "Truck", "Operator", "Delay Note"]];
    sorted.forEach(t => aoa.push([t.id, new Date(t.date + "T00:00:00"), frac(t.left), frac(t.back), roundTrip(t), slotById(slotIdFor(t)).label, t.truck, t.operator, t.delayNote || ""]));
    const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
    for (let r = 1; r < aoa.length; r++) {
      const d = ws[XLSX.utils.encode_cell({ r, c: 1 })]; if (d) d.z = "yyyy-mm-dd";
      [2, 3].forEach(c => { const tm = ws[XLSX.utils.encode_cell({ r, c })]; if (tm && tm.v != null) tm.z = "hh:mm"; });
    }
    ws["!cols"] = [24, 12, 18, 18, 16, 20, 12, 22, 30].map(w => ({ wch: w }));
    ws["!autofilter"] = { ref: ws["!ref"] };
    const sum = [["Date", ...SLOTS.map(s => s.label), "Outside time slots", "Total trips"]];
    [...new Set(sorted.map(t => t.date))].forEach(d => {
      const dt = sorted.filter(t => t.date === d);
      sum.push([new Date(d + "T00:00:00"), ...SLOTS.map(s => dt.filter(t => slotIdFor(t) === s.id).length), dt.filter(t => slotIdFor(t) === "OUT").length, dt.length]);
    });
    const ws2 = XLSX.utils.aoa_to_sheet(sum, { cellDates: true });
    for (let r = 1; r < sum.length; r++) { const c = ws2[XLSX.utils.encode_cell({ r, c: 0 })]; if (c) c.z = "yyyy-mm-dd"; }
    ws2["!cols"] = sum[0].map(() => ({ wch: 16 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Trips");
    XLSX.utils.book_append_sheet(wb, ws2, "Daily_Summary");
    XLSX.writeFile(wb, "CBG_Truck_Trips_" + today() + ".xlsx");
    toast("Excel file created with " + trips.length + " trips.");
  }

  // ---------- views ----------
  const TITLES = { log: "Log a trip", dashboard: "Truck trips dashboard", trips: "All trips", settings: "Settings" };
  const view = () => { const v = (location.hash || "#log").slice(1); return TITLES[v] ? v : "log"; };
  const LOCKED_VIEWS = ["trips", "settings"];
  const isLocked = v => LOCKED_VIEWS.includes(v) && !adminCode;
  function route() {
    const v = view(), show = isLocked(v) ? "lock" : v;
    document.querySelectorAll(".view").forEach(s => (s.hidden = s.id !== "view-" + show));
    $("btnExport").classList.toggle("locked", !adminCode);
    document.querySelectorAll(".tab").forEach(a => { a.classList.toggle("active", a.dataset.view === v); if (a.classList.contains("locked") || LOCKED_VIEWS.includes(a.dataset.view)) a.classList.toggle("locked", !adminCode); });
    $("pageTitle").textContent = TITLES[v];
    if (show === "lock") { $("lockTitle").textContent = TITLES[v] + " is locked"; $("lockErr").textContent = ""; $("lockCode").value = ""; setTimeout(() => $("lockCode").focus(), 50); }
    renderAll();
  }
  async function verifyCode(code) {
    if (!code) return "Enter the admin code.";
    if (!SHARED) return code === String(CFG.localCode || "") && code ? "" : "That code isn't right.";
    const prev = adminCode;
    try { adminCode = code; await api({ action: "checkCode" }); return ""; }
    catch (err) { return err.locked ? err.message.replace("The admin code is needed to change or delete a saved trip.", "That code isn't right.") : "Can't reach the trip sheet to check the code. Check the connection."; }
    finally { adminCode = prev; }
  }
  async function unlock(e) {
    e.preventDefault();
    const code = $("lockCode").value.trim();
    $("btnUnlock").disabled = true; $("lockErr").textContent = "";
    const err = await verifyCode(code);
    $("btnUnlock").disabled = false;
    if (err) { $("lockErr").textContent = err; return; }
    setAdmin(code); toast("Unlocked until you close this tab."); route();
  }
  // Pop-up code box, used by Generate Excel. Resolves true once unlocked.
  function askCode(title) {
    if (adminCode) return Promise.resolve(true);
    return new Promise(res => {
      const d = document.createElement("div"); d.className = "modal";
      d.innerHTML = '<form class="modal-box" role="dialog" aria-modal="true" autocomplete="off"><h3></h3><p class="muted">Only supervisors can download the trip data.</p>' +
        '<label class="mlabel">Admin code<input type="password" class="m_code" placeholder="Enter the code"></label><div class="err m_err"></div>' +
        '<div class="form-actions"><button class="btn dark" type="submit">Unlock</button><button class="btn ghost" type="button" data-n>Cancel</button></div></form>';
      d.querySelector("h3").textContent = title;
      const done = v => { d.remove(); res(v); };
      d.querySelector("form").onsubmit = async e => {
        e.preventDefault();
        const code = d.querySelector(".m_code").value.trim(), btn = d.querySelector("[type=submit]");
        btn.disabled = true; const err = await verifyCode(code); btn.disabled = false;
        if (err) { d.querySelector(".m_err").textContent = err; return; }
        setAdmin(code); route(); done(true);
      };
      d.querySelector("[data-n]").onclick = () => done(false);
      d.onclick = e => { if (e.target === d) done(false); };
      document.body.appendChild(d); d.querySelector(".m_code").focus();
    });
  }
  function lockNow() { setAdmin(""); toast("Locked."); route(); }
  function renderSettings() {
    $("s_count").textContent = trips.length + " trips " + (SHARED ? "in the shared trip sheet." : "saved on this device only (no Google Sheet link set in config.js).");
  }
  function renderAll() {
    renderSync(); renderToday();
    const names = [...new Set([...(CFG.operators || []), ...trips.map(t => t.operator)])].filter(Boolean).sort();
    $("operatorList").innerHTML = names.map(n => '<option value="' + esc(n) + '">').join("");
    const v = view();
    if (v === "dashboard") renderDashboard();
    if (v === "trips" && !isLocked(v)) renderTrips();
    if (v === "settings" && !isLocked(v)) renderSettings();
  }

  // In-page yes/no box (works everywhere, including embedded previews where confirm() is blocked)
  // Unusual return time: let the clerk save anyway with a reason, or go back and fix it.
  // needReason = true for long (delayed) trips: a reason must be given before saving.
  // Resolves to the reason text to save, or null to go back.
  function askOverride(msg, needReason) {
    return new Promise(res => {
      const reasons = ["Traffic delay", "Waiting to offload", "Breakdown", "Refuelling", "Clerk logged late"];
      const d = document.createElement("div"); d.className = "modal";
      d.innerHTML = '<div class="modal-box" role="dialog" aria-modal="true"><h3></h3><p class="w"></p><p class="muted hint"></p>' +
        '<div class="chips">' + reasons.map(r => '<button type="button" class="chip">' + esc(r) + "</button>").join("") + "</div>" +
        '<label class="mlabel"><span class="lbl"></span><input type="text" class="m_reason" maxlength="120" placeholder="e.g. Breakdown on the road"></label>' +
        '<div class="err m_err"></div><div class="form-actions"><button class="btn dark" data-y>Yes, save it</button><button class="btn ghost" data-n>Go back and fix</button></div></div>';
      d.querySelector("h3").textContent = needReason ? "Reason for the delay" : "Check the return time";
      d.querySelector(".w").textContent = msg;
      d.querySelector(".hint").textContent = needReason ? "Trips over " + durText(WARN_MIN) + " need a reason. Pick one or type it, then save." : "If the time is right, you can still save it. Add a note if it helps.";
      d.querySelector(".lbl").textContent = needReason ? "Reason for delay (required)" : "Note (optional)";
      const inp = d.querySelector(".m_reason");
      d.querySelectorAll(".chip").forEach(c => (c.onclick = () => { inp.value = c.textContent; d.querySelector(".m_err").textContent = ""; d.querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x === c)); }));
      const done = v => { d.remove(); res(v); };
      d.querySelector("[data-y]").onclick = () => {
        const v = inp.value.trim();
        if (needReason && !v) { d.querySelector(".m_err").textContent = "Give a reason for the delay to save this trip."; inp.focus(); return; }
        done(v);
      };
      d.querySelector("[data-n]").onclick = () => done(null);
      d.onclick = e => { if (e.target === d) done(null); };
      document.body.appendChild(d); (needReason ? inp : d.querySelector("[data-n]")).focus();
    });
  }
  function askConfirm(msg) {
    return new Promise(res => {
      const d = document.createElement("div"); d.className = "modal";
      d.innerHTML = '<div class="modal-box" role="dialog" aria-modal="true"><p></p><div class="form-actions"><button class="btn danger" data-y>Delete</button><button class="btn ghost" data-n>Cancel</button></div></div>';
      d.querySelector("p").textContent = msg;
      const done = v => { d.remove(); res(v); };
      d.querySelector("[data-y]").onclick = () => done(true);
      d.querySelector("[data-n]").onclick = () => done(false);
      d.onclick = e => { if (e.target === d) done(false); };
      document.body.appendChild(d); d.querySelector("[data-n]").focus();
    });
  }
  let toastT;
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 3200); }

  // ---------- init ----------
  function init() {
    $("routeFrom").textContent = CFG.pickup || "Plant"; $("routeTo").textContent = CFG.dropoff || "Warehouse";
    $("f_truck").innerHTML = '<option value="">Choose truck</option>' + (CFG.trucks || []).map(t => "<option>" + esc(t) + "</option>").join("");
    SLOTS.forEach(s => $("d_slot").add(new Option(s.label, s.id)));
    $("d_slot").add(new Option(OUT.label, "OUT"));

    $("tripForm").addEventListener("submit", onSubmit);
    $("tripForm").addEventListener("input", e => { if (e.target.classList.contains("invalid")) { e.target.classList.remove("invalid"); if (!document.querySelector("#tripForm .invalid")) $("formErr").textContent = ""; } });
    $("f_left").addEventListener("input", updateSlotPreview);
    setInterval(() => { if (!$("view-log").hidden) renderOut(); }, 60000);
    $("btnCancelEdit").onclick = resetForm;
    ["d_period", "d_from", "d_to", "d_slot", "d_truck", "d_operator"].forEach(id => $(id).addEventListener("change", renderDashboard));
    $("t_search").addEventListener("input", renderTrips);
    $("btnExport").onclick = exportExcel;
    $("btnRefresh").hidden = !SHARED;
    $("btnRefresh").onclick = () => { if (!queue.length) syncState = "loading"; renderSync(); flush(); };
    window.addEventListener("hashchange", route);
    $("lockForm").addEventListener("submit", unlock);
    document.querySelectorAll("[data-lock]").forEach(b => (b.onclick = lockNow));

    compute();
    resetForm();
    route();
    if (SHARED) {
      flush();
      setInterval(flush, 60000);
      window.addEventListener("online", flush);
      document.addEventListener("visibilitychange", () => { if (!document.hidden) flush(); });
    }
  }
  init();
})();
