"use strict";
const $ = (selector) => document.querySelector(selector);
const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const unknown = (value) =>
  value === null || value === undefined ? "Unknown" : escapeHTML(value);
const labels = {
  RUNNING: "Printing",
  PAUSE: "Paused",
  FAILED: "Failed",
  FINISH: "Finished",
  IDLE: "Idle",
  UNKNOWN: "Unknown",
  PREPARE: "Preparing",
  SLICING: "Slicing",
};
const stateLabel = (state) => labels[state] || state || "Unknown";
let commandPending = null, commandMessage = "";
let showHiddenMessages = false;
const detailTabs = ["status", "filament", "notices"];
let detailTab = "status", detailScroll = {};
let selectedSlot = null, readingExpanded = false, detailIdentity = "";
let restoringCardFocus = false;
// Browser-local presentation only; retained while filtering/sorting this page.
const expandedCards = new Set();
let detailOpener = null;
let csrfToken = null;
let snapshot = null,
  filter = "all",
  query = "",
  sort = "name",
  selected = null,
  feedError = false,
  timer,
  controller;
const feedDelayed = () =>
  snapshot && Date.now() - Date.parse(snapshot.at) > 10000;
const feedUnavailable = () => feedError || feedDelayed();
const current = (p) => p.fresh && !feedUnavailable();
const idleFinished = (p) => p.idle_finished === true && p.online === true && current(p) && snapshot?.connected === true;
const prefix = (p) => (current(p) ? "" : "Last-known · ");
const status = (p) =>
  feedUnavailable()
    ? "Monitor unavailable"
    : p.connection === "Live"
      ? stateLabel(p.state)
      : p.connection;
const temperature = (t) =>
  t?.current == null
    ? "Unknown"
    : `${escapeHTML(t.current)}${t.target == null ? "" : " / " + escapeHTML(t.target)}°C`;
const duration = (n) =>
  n == null
    ? "Unknown"
    : n >= 60
      ? `${Math.floor(n / 60)}h ${n % 60}m`
      : `${n}m`;
const localTime = (value) =>
  value ? new Date(value).toLocaleString() : "Unavailable";
function remaining(p) {
  if (p.state !== "RUNNING") return "—";
  if (p.remaining == null) return "Unknown";
  return (
    (current(p) && p.eta_current ? "" : "Last-known: ") + duration(p.remaining)
  );
}
function swatch(color) {
  const match = /^(?:#)?([a-f\d]{6})(?:[a-f\d]{2})?$/i.exec(color || "");
  return match
    ? `<span class="swatch" style="background:#${match[1]}" title="#${match[1]}"></span>`
    : '<span class="swatch" title="Unknown color" style="border:1px solid var(--muted)"></span>';
}
function allSlots(p) {
  return [...p.ams.flatMap((unit) => unit.slots), ...p.external];
}
// Unknown states remain outside idle/done for ordering only. Neither freshness
// nor the cloud connection label establishes device connectivity or activity.
function printerGroup(p) {
  if (p.online === false) return 2;
  return p.state === "IDLE" || p.state === "FINISH" ? 1 : 0;
}
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function matchesFilter(p, choice) {
  return choice === "all" ||
    (choice === "printing" && p.state === "RUNNING") ||
    (choice === "idle" && idleFinished(p)) ||
    (choice === "attention" && p.attention) ||
    (choice === "unavailable" && !p.fresh);
}
const matchesSearch = p => `${p.name} ${p.model || ""}`.toLowerCase().includes(query.trim().toLowerCase());
function filterCount(choice) {
  return (snapshot?.printers || []).filter(p => matchesSearch(p) && matchesFilter(p, choice)).length;
}
function visible() {
  return (snapshot?.printers || [])
    .filter(
      (p) =>
        matchesFilter(p, filter) &&
        matchesSearch(p),
    )
    .sort((a, b) => {
      const group = printerGroup(a) - printerGroup(b);
      if (group) return group;
      if (sort === "attention" && a.attention !== b.attention)
        return a.attention ? -1 : 1;
      const state = sort === "state"
        ? compareText(stateLabel(a.state).toLowerCase(), stateLabel(b.state).toLowerCase())
        : 0;
      return state || compareText(a.name.toLowerCase(), b.name.toLowerCase()) || compareText(a.id, b.id);
    });
}
function machine(p) {
  if (p.image)
    return `<img class="printer-sprite" src="${escapeHTML(p.image)}" alt="" loading="lazy" decoding="async">`;

  const color = p.attention ? "#d5b17d" : "#b2d9b9";
  return `<svg viewBox="0 0 160 150" fill="none" aria-hidden="true"><path d="M25 132L82 144L142 127L84 116Z" fill="#0d110e"/><path d="M29 29L88 16L134 29V124L80 137L29 123Z" fill="#424e46" stroke="#68796c"/><path d="M35 34L81 44V128L35 118Z" fill="#222c25" stroke="#657569"/><path d="M81 44L127 34V118L81 128Z" fill="#101c14" stroke="#657569"/><path d="M29 29L81 41L134 29L88 16Z" fill="#657269"/><path d="M40 39L75 47V117L40 110Z" fill="#19261d"/><path d="M87 48L121 40V111L87 119Z" fill="#1a2920"/><path d="M45 98L84 106L119 97L80 90Z" fill="#66796b"/><path d="M45 98V103L84 112L119 102V97L84 106Z" fill="#3c5042"/><path d="M84 54V96M113 46V95M45 50V95" stroke="#536559" stroke-width="2"/><path d="M45 59L116 69M45 65L116 75" stroke="#66786b" stroke-width="2"/><path d="M75 63L88 66V81L75 78Z" fill="#b3c5b6"/><path d="M88 66L96 63V78L88 81Z" fill="#6d8574"/><path d="M69 89L85 85L99 89V99L84 103L69 99Z" fill="${color}"/><path d="M39 28L62 22L78 26L55 32Z" fill="#9aaba0"/></svg>`;
}
function card(p) {
  const offline = p.online === false;
  const label = offline ? "Offline" : status(p);
  const action = (text, kind = "name") => `<button data-action="${kind}" data-open="${escapeHTML(p.id)}" aria-haspopup="dialog"${kind === "notices" ? ' data-notices="true"' : ''}>${text}</button>`;
  const expanded = expandedCards.has(p.id);
  const bodyID = `card-body-${encodeURIComponent(p.id)}`;
  const toggle = `<button class="card-toggle" data-action="expand" data-open="${escapeHTML(p.id)}" aria-expanded="${expanded}" aria-controls="${escapeHTML(bodyID)} ${escapeHTML(bodyID)}-actions" aria-label="${expanded ? "Collapse" : "Expand"} ${escapeHTML(p.name)} card"><svg viewBox="0 0 12 8" aria-hidden="true"><path d="m1 1 5 5 5-5"/></svg></button>`;
  const heading = `<div class="card-head"><div class="card-identity"><h3>${action(escapeHTML(p.name))}</h3><div class="model">${escapeHTML(p.model || "Unknown model")}</div><span class="pill ${p.attention || !current(p) ? "warn" : p.state === "IDLE" ? "neutral" : ""}">${escapeHTML(label)}</span></div><div class="printer-view">${machine(p)}</div></div>`;
  const actions = `<div class="card-actions" id="${escapeHTML(bodyID)}-actions">${p.attention ? action('◇ Attention · view notices', 'notices') : `<span>${p.conditions.some(condition => !condition.hidden) ? 'Reported notices' : 'No active notices'}</span>`}${action('Details ↗', 'details')}</div>`;
  const opening = `<article class="card ${p.attention ? "warning" : ""}${offline ? " offline" : ""}${expanded ? " expanded" : ""}" data-id="${escapeHTML(p.id)}" tabindex="-1" aria-label="Inspect ${escapeHTML(p.name)}, ${escapeHTML(label)}">`;
  if (offline) return `${opening}${heading}<div class="card-body" id="${escapeHTML(bodyID)}"></div>${actions}${toggle}</article>`;
  const slots = allSlots(p).filter((s) => s.present !== false),
    nozzle = p.nozzles.find((n) => n.active) || p.nozzles[0];
  const progress = Number.isFinite(p.progress) ? Math.max(0, Math.min(100, p.progress)) : null;
  const idle = p.state === "IDLE";
  const finish = p.state === "RUNNING" && p.remaining != null && Number.isFinite(Date.parse(p.remaining_reported))
    ? new Date(Date.parse(p.remaining_reported) + p.remaining * 60000).toLocaleTimeString(undefined, {hour: "numeric", minute: "2-digit"}) : "Unavailable";
  return `${opening}${heading}${!current(p) ? '<p class="card-note telemetry-note">Current state unconfirmed · readings are last-known; missing values remain unknown.</p>' : ""}<div class="card-body" id="${escapeHTML(bodyID)}"><div class="job">${idle ? "No active print" : escapeHTML(p.job || "No reported job")}</div>${idle ? "" : `<div class="progress-label"><span>Reported progress</span><strong>${progress === null ? "Unknown" : progress + "%"}</strong></div><div class="progress-track"><span style="width:${progress || 0}%"></span></div><div class="metrics timing"><div>Remaining<strong>${escapeHTML(remaining(p))}</strong></div><div>Est. finish<strong>${finish !== "Unavailable" && (!current(p) || !p.eta_current) ? "Last-known: " : ""}${escapeHTML(finish)}</strong></div></div>`}<div class="metrics"><div>Nozzle<strong>${temperature(nozzle?.temperature)}</strong></div><div>Bed<strong>${temperature(p.bed)}</strong></div></div><div class="card-bottom"><div class="swatches">${slots.slice(0, 4).map(s => swatch(s.color)).join("")}<span>${escapeHTML(slots[0]?.material || "Unknown material")}</span></div><span>${current(p) ? '<i class="green"></i>Fresh' : "◷ Last-known"}</span></div></div>${actions}${toggle}</article>`;
}
// Keep connected card/image elements across polls. Replacing #cards.innerHTML
// recreates lazy, async-decoded images even when their immutable URL is unchanged.
function patchCardNode(current, next) {
  if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) {
    current.replaceWith(next);
    return;
  }
  if (current.nodeType !== 1) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return;
  }
  for (const {name} of Array.from(current.attributes))
    if (!next.hasAttribute(name)) current.removeAttribute(name);
  for (const {name, value} of next.attributes)
    if (current.getAttribute(name) !== value) current.setAttribute(name, value);
  const previous = Array.from(current.childNodes);
  const children = Array.from(next.childNodes);
  children.forEach((child, index) => {
    if (previous[index]) patchCardNode(previous[index], child);
    else current.appendChild(child);
  });
  for (const child of previous.slice(children.length)) child.remove();
}
function renderCards(list) {
  const container = $("#cards");
  if (!list.length) {
    container.innerHTML = `<div class="empty"><h2>${snapshot?.printers.length ? "No matching printers" : "No discovered printers yet"}</h2><p>${query.trim() ? `No printers in this status match “${escapeHTML(query.trim())}”.` : "No printers are in this status."}</p>${query.trim() ? '<button data-recovery="search">Clear search</button>' : ""}${filter !== "all" ? '<button data-recovery="filter">Show all statuses</button>' : ""}</div>`;
    return;
  }
  const ids = new Set(list.map((printer) => printer.id));
  const existing = new Map();
  // Remove filtered/disappeared cards first so remaining cards need no moves
  // when their relative order has not changed.
  for (const child of Array.from(container.children)) {
    if (ids.has(child.dataset.id)) existing.set(child.dataset.id, child);
    else child.remove();
  }
  list.forEach((printer, index) => {
    const template = document.createElement("template");
    template.innerHTML = card(printer);
    const next = template.content.firstElementChild;
    const current = existing.get(printer.id) || next;
    if (current !== next) patchCardNode(current, next);
    // Avoid moving already ordered cards: moving a connected image can itself
    // interrupt its presentation, and moving a button can disturb keyboard focus.
    if (container.children[index] !== current)
      container.insertBefore(current, container.children[index] || null);
  });
}
function render() {
  const list = visible(),
    focused = document.activeElement?.dataset.open || document.activeElement?.dataset.id,
    focusedAction = document.activeElement?.dataset.action,
    focusedCard = document.activeElement?.classList.contains("card");
  renderCards(list);
  if (focused) {
    const target = (focusedCard ? document.querySelector(`.card[data-id="${CSS.escape(focused)}"]`) : document.querySelector(`button[data-open="${CSS.escape(focused)}"]${focusedAction ? `[data-action="${focusedAction}"]` : ""}`))
      || activeFilterControl();
    // Moving a card can drop DOM focus. Restoring it is not navigation and
    // must not invoke the workspace's focused-card scroll clearance.
    restoringCardFocus = true;
    try {
      target?.focus({ preventScroll: true });
    } finally {
      restoringCardFocus = false;
    }
  }

  const total = snapshot?.summary.total || 0;
  const noun = total === 1 ? "printer" : "printers";
  $("#result-count").textContent = list.length === total
    ? `${total} ${noun}`
    : `${list.length} of ${total} ${noun}`;
  document.querySelectorAll(".filters button").forEach((b) => {
    b.classList.toggle("selected", b.dataset.filter === filter);
    b.setAttribute("aria-pressed", String(b.dataset.filter === filter));
  });
  if (!snapshot) return;
  for (const choice of ["all", "printing", "idle", "attention", "unavailable"]) {
    const count = $("#" + choice + "-count"), value = String(filterCount(choice));
    count.textContent = value;
    count.style.setProperty("--count-digits", value.length);
  }
  const selector = $("#mobile-filter");
  const options = Array.from(document.querySelectorAll(".filters button")).map(button =>
    `<option value="${button.dataset.filter}">${escapeHTML(button.textContent.trim())}</option>`).join("");
  if (selector.innerHTML !== options) selector.innerHTML = options;
  selector.value = filter;
  $("#idle-filter-help").hidden = filter !== "idle";
  $("#feed-state").textContent = feedUnavailable()
    ? "Dashboard disconnected"
    : snapshot.demo
      ? "● Demo monitoring"
      : snapshot.connected
        ? "● Monitor connected"
        : "Cloud disconnected";
  $("#feed-state").classList.toggle(
    "amber",
    feedUnavailable() || !snapshot.connected,
  );
  $("#updated").textContent = new Date(snapshot.at).toLocaleTimeString();
  if (selected && $("#detail").open) renderDetail();
}
// Slot identity includes inventory family and unit, never array position.
function inventorySlots(p) {
  return [...p.ams.flatMap(unit => unit.slots.map(slot => ({
    key: `ams:${unit.id}:${slot.id}`, label: `${unit.label} · Slot ${slot.id}`, slot,
  }))), ...p.external.map(slot => ({key: `external:${slot.id}`,
    label: `External · Slot ${slot.id}`, slot}))];
}
function slotMaterial(s) {
  return s.present === false ? "Reported empty" : s.material || "Unknown material";
}
function slotQuantity(s, external = false) {
  return s.present === false ? "Not applicable" : external ? "Unavailable" :
    s.remaining == null ? "Unknown" : `${s.remaining}% est.`;
}
function spool(s) {
  const color = /^(?:#)?([a-f\d]{6})(?:[a-f\d]{2})?$/i.exec(s.color || "");
  return `<span class="spool-art ${s.present === false ? "empty-spool" : ""}" aria-hidden="true"${color && s.present !== false ? ` style="--filament:#${color[1]}"` : ""}></span>`;
}
function slotCards(entries) {
  if (!entries.length) return "<p>Slot inventory unknown.</p>";
  return `<div class="spool-rack">${entries.map(({key, slot: s}) => `<button class="slot-card" data-slot-key="${escapeHTML(key)}" aria-pressed="${selectedSlot === key}" aria-controls="slot-inspection"><span class="slot-label">Slot ${unknown(s.id)}</span>${spool(s)}<strong>${escapeHTML(slotMaterial(s))}</strong><span>${s.present !== true && s.present !== false ? "Presence unknown · " : ""}${escapeHTML(slotQuantity(s, key.startsWith("external:")))}</span></button>`).join("")}</div>`;
}
function slotInspection(p) {
  if (!selectedSlot) return '<p id="slot-inspection" class="inspection-hint" tabindex="0">Select a slot to inspect its reported material.</p>';
  const entry = inventorySlots(p).find(entry => entry.key === selectedSlot);
  if (!entry || p.online === false) return '<section id="slot-inspection" class="inventory-unit" tabindex="0"><h3>Selected slot unavailable</h3><p>This entry is no longer available for inspection. No other slot has been selected.</p></section>';
  const s = entry.slot;
  return `<section id="slot-inspection" class="slot-inspection" tabindex="0" aria-label="Selected filament slot"><div class="slot-heading">${spool(s)}<div><h3>${escapeHTML(slotMaterial(s))}</h3><span>${escapeHTML(entry.label)} · selected</span></div></div><dl class="inspection-values"><div><dt>Reported presence</dt><dd>${s.present === false ? "Reported empty" : s.present === true ? "Spool present" : "Unknown"}</dd></div><div><dt>Color</dt><dd>${s.present === false ? "Not applicable" : escapeHTML(s.color || "Unknown")}</dd></div><div><dt>Remaining estimate</dt><dd>${escapeHTML(slotQuantity(s, selectedSlot.startsWith("external:")))}</dd></div></dl><p class="inspection-hint">Reported quantities are approximate. Selecting a slot only changes this inspection view.</p></section>`;
}
function filamentDetail(p) {
  if (p.online === false) return `<section class="unavailable-detail"><h2>Inventory unavailable · reported offline</h2><p>Missing readings do not establish that slots are empty.</p></section>${selectedSlot ? slotInspection(p) : ""}`;
  const entries = inventorySlots(p);
  const selectedEntry = entries.find(entry => entry.key === selectedSlot);
  const inspection = slotInspection(p);
  return `<div class="inspection-section-heading"><h2>AMS & filament</h2><span>Inventory · ${current(p) ? "last reported" : "last known"}</span></div>${!current(p) ? '<p class="inspection-warning">Current inventory is unconfirmed. Available readings are last-known; missing values remain unknown.</p>' : ""}${!selectedEntry ? inspection : ""}${p.ams.length ? p.ams.map(unit => `<section class="inventory-unit"><div class="inspection-section-heading"><h3>${escapeHTML(unit.label)}</h3><span>${escapeHTML(unit.model || "Unknown model")}</span></div><p class="unit-readings">Humidity: ${unit.humidity == null ? "Unknown" : unknown(unit.humidity) + "%"} · Temperature: ${unit.temperature == null ? "Unknown" : unknown(unit.temperature) + "°C"}</p>${dryingDetails(p, unit)}${slotCards(entries.filter(entry => entry.key.startsWith(`ams:${unit.id}:`)))}${selectedEntry?.key.startsWith(`ams:${unit.id}:`) ? inspection : ""}</section>`).join("") : "<p>AMS configuration unknown.</p>"}<section class="inventory-unit"><h3>External filament</h3>${slotCards(entries.filter(entry => entry.key.startsWith("external:")))}${selectedEntry?.key.startsWith("external:") ? inspection : ""}</section>`;
}
function detailTimestamp(value) {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString(undefined, {dateStyle: "medium", timeStyle: "long"}) : "Unavailable";
}
function readingDetails(p) {
  return `<details id="reading-details" class="reading-details"${readingExpanded ? " open" : ""}><summary id="reading-summary">Reading details <span>· report and estimate times</span></summary><dl class="inspection-values"><div><dt>Last telemetry report</dt><dd>${escapeHTML(detailTimestamp(p.last_report))}</dd></div><div><dt>Remaining-time report</dt><dd>${escapeHTML(detailTimestamp(p.remaining_reported))}</dd></div><div><dt>Last reported remaining</dt><dd>${escapeHTML(duration(p.remaining))}</dd></div><div><dt>Model</dt><dd>${escapeHTML(p.model || "Unknown model")}</dd></div><div><dt>Connection</dt><dd>${escapeHTML(status(p))}</dd></div></dl><p>Individual fields may be older than the latest report. Remaining time is a reported duration, not a local countdown, and may belong to a prior job. Estimates do not confirm completion; missing values stay unknown.</p></details>`;
}
function temperatureTile(label, value, activity = "") {
  return `<div class="temperature-tile${activity === "Reported active" ? " active-nozzle" : ""}"><span>${escapeHTML(label)}</span><strong>${unknown(value?.current)}${value?.current == null ? "" : ' <small>°C</small>'}</strong><span>Target ${unknown(value?.target)}${value?.target == null ? "" : " °C"}</span>${activity ? `<span class="nozzle-activity">${escapeHTML(activity)}</span>` : ""}</div>`;
}
// Outcomes are interpreted by farm/session; browser feed loss only qualifies freshness.
function printOutcomeDetail(p) {
  if (!p.print_summary) return "";
  const retained = !current(p) && p.fresh;
  const summary = retained ? "Last-known: " + p.print_summary + "; current state unconfirmed" : p.print_summary;
  return `<section class="print-outcome" aria-label="Reported print outcome"><h3>${escapeHTML(summary)}</h3>${current(p) && p.print_guidance ? `<p><strong>Next:</strong> ${escapeHTML(p.print_guidance)}</p>` : ""}<p class="meta">Reported state: ${escapeHTML(p.state || "Unknown")}.</p></section>`;
}
function overviewDetail(p) {
  if (p.online === false) return `<section class="unavailable-detail"><h2>Reported offline</h2><p>Current readings are unavailable. Reported conditions remain accessible in Notices; being offline does not confirm resolution.</p></section>${readingDetails(p)}`;
  const progress = Number.isFinite(p.progress) ? Math.max(0, Math.min(100, p.progress)) : null;
  const running = p.state === "RUNNING";
  const estimateCurrent = current(p) && p.eta_current;
  // Match farm.ETA: anchor to the independent remaining report, never poll time.
  const finish = running && p.remaining != null && Number.isFinite(Date.parse(p.remaining_reported))
    ? new Date(Date.parse(p.remaining_reported) + p.remaining * 60000) : null;
  const finishText = finish && Number.isFinite(finish.getTime()) ? finish.toLocaleString(undefined,
    {month: "short", day: "numeric", hour: "numeric", minute: "2-digit"}) : "Unknown";
  const stopped = p.state === "PAUSE" || p.state === "FAILED";
  return `${!current(p) ? '<p class="inspection-warning">Current state is unconfirmed. Available readings are last-known; missing values remain unknown.</p>' : ""}<section class="job-summary${stopped ? " stopped-job" : ""}${!current(p) ? " retained-job" : ""}" aria-label="Reported job summary"><div class="job-status"><strong>${escapeHTML(stateLabel(p.state))}${current(p) ? "" : " · last known"}</strong><span>${current(p) ? "Last reported" : escapeHTML(status(p))}</span></div><div class="job-heading"><div><span class="job-caption">Reported job</span><h2>${escapeHTML(p.job || (p.state === "IDLE" || p.state === "FINISH" ? "No reported job" : "Job unknown"))}</h2><p>Stage: ${escapeHTML(p.stage || "Unknown")}</p>${printOutcomeDetail(p)}</div><div class="progress-ring" role="img" aria-label="${current(p) ? "Reported" : "Last-known"} progress: ${progress == null ? "Unknown" : progress + " percent"}"><svg viewBox="0 0 106 106" aria-hidden="true"><circle class="ring-track" cx="53" cy="53" r="47"/><circle class="ring-value" cx="53" cy="53" r="47" pathLength="100" stroke-dasharray="${progress || 0} 100"/></svg><strong>${progress == null ? "Unknown" : progress + "%"}</strong></div></div><div class="job-facts"><div><strong>${running ? escapeHTML(duration(p.remaining)) : "—"}</strong><span>${running ? estimateCurrent ? "Reported remaining" : "Last-known remaining" : "No running time estimate"}</span></div><div><strong>${running ? escapeHTML(finishText) : "—"}</strong><span>${running ? estimateCurrent ? "Estimated finish" : "Last-known finish estimate" : "No running finish estimate"}</span></div><div><strong>${unknown(p.layer)} / ${unknown(p.total_layers)}</strong><span>Reported layer</span></div></div></section><div class="inspection-section-heading"><h2>Temperatures</h2><span>${current(p) ? "Last reported" : "Last known"} · °C</span></div><div class="temperature-grid">${p.nozzles.length ? p.nozzles.map(n => temperatureTile(n.id === 0 ? "Right nozzle" : n.id === 1 ? "Left nozzle" : "Nozzle " + n.id, n.temperature, n.active ? "Reported active" : "")).join("") : temperatureTile("Nozzle", null)}${temperatureTile("Bed", p.bed)}${temperatureTile("Chamber", p.chamber)}</div>${readingDetails(p)}`;
}
// The session interprets drying and its independent observation age. Browser
// feed failure additionally qualifies a previously current display snapshot.
function dryingDetails(p, unit) {
  let value = unit.drying || "Unknown";
  if (!current(p) && unit.drying_current) value = "Last-known · " + value;
  return `<p>${unit.model ? escapeHTML(unit.model) + " · " : ""}Drying: ${escapeHTML(value)}</p>` +
    (unit.drying_settings ? `<p>Last reported drying settings: ${escapeHTML(unit.drying_settings)}</p>` : "");
}

function renderDetail() {
  const p = snapshot.printers.find((p) => p.id === selected),
    body = $("#detail-body");
  const scroll = body.scrollTop;
  const focusedAction = document.activeElement?.dataset.dismiss;
  const focusedToggle = document.activeElement?.id === "toggle-hidden-messages";
  const focusedSlot = document.activeElement?.dataset.slotKey;
  const focusedReading = document.activeElement?.id === "reading-summary";
  const focusedInspection = document.activeElement?.id === "slot-inspection";
  if (!p) {
    $("#detail-title").textContent = "Printer unavailable";
    $("#detail-title").title = "Printer unavailable";
    $("#detail-model").textContent = "";
    $("#detail-artwork").innerHTML = "";
    detailIdentity = "";
    body.innerHTML =
      "<p>This printer is no longer in the discovered farm. Its removal does not confirm fault resolution.</p>";
    if (focusedAction || focusedToggle || focusedSlot || focusedReading || focusedInspection) $("#close-detail").focus({preventScroll: true});
    body.scrollTop = scroll;
    return;
  }
  const hiddenCount = p.conditions.filter((c) => c.hidden).length;
  const conditions = p.conditions.filter((c) => showHiddenMessages || !c.hidden);
  $("#detail-title").textContent = p.name;
  $("#detail-title").title = p.name;
  $("#detail-model").textContent = p.model || "Unknown model";
  const identity = machine(p);
  if (identity !== detailIdentity) {
    $("#detail-artwork").innerHTML = identity;
    detailIdentity = identity;
  }
  const content = {
    status: overviewDetail(p),
    filament: filamentDetail(p),
    notices: `<div class="conditions"><h2>Reported conditions</h2>${printOutcomeDetail(p)}<p role="status" aria-live="polite">${escapeHTML(commandMessage)}</p><p>Local decision storage: ${escapeHTML(snapshot.decisions || "Unknown")}. Local review does not confirm physical resolution; inspecting makes no local decision.</p>${hiddenCount ? `<p><button id="toggle-hidden-messages" aria-pressed="${showHiddenMessages}">${showHiddenMessages ? "Hide hidden messages" : "View hidden messages"} (${hiddenCount})</button></p>` : ""}${conditions.length ? conditions.map((c) => `<div class="condition"><h3>${escapeHTML(c.text)}</h3>${!p.print_summary && c.guidance ? `<p><strong>Next:</strong> ${escapeHTML(c.guidance)}</p>` : ""}<p class="meta">${escapeHTML(c.level)} · Code: ${escapeHTML(c.code || "Not provided")}<br>Local review: ${c.reviewed ? "Reviewed" : "Unreviewed"}${c.hidden ? " · Hidden locally" : ""}<br>First app-observed: ${escapeHTML(localTime(c.since))}</p>${!c.hidden ? `<button data-dismiss="${escapeHTML(c.id)}" aria-disabled="${Boolean(commandPending || feedUnavailable())}">${commandPending === c.id ? "Pending…" : "Hide notice locally"}</button>` : snapshot.decisions === "failed" ? `<button data-dismiss="${escapeHTML(c.id)}" data-retry="true" aria-disabled="${Boolean(commandPending || feedUnavailable())}">Retry saving local decisions</button>` : `<p>Applied locally · ${escapeHTML(snapshot.decisions || "storage unknown")}</p>`}</div>`).join("") : p.conditions.length ? "<p>All reported messages are hidden locally. Physical resolution remains unconfirmed.</p>" : "<p>No active notices in this snapshot. Missing or disconnected data does not confirm physical fault resolution.</p>"}</div>`,
  };
  body.innerHTML = content[detailTab];
  body.scrollTop = scroll;
  if (focusedAction) {
    const next = document.querySelector(`[data-dismiss="${CSS.escape(focusedAction)}"]`);
    if (next) next.focus({preventScroll: true});
    else $("#close-detail").focus({preventScroll: true});
  }
  if (focusedToggle) {
    ($("#toggle-hidden-messages") || $("#close-detail")).focus({preventScroll: true});
  }
  if (focusedSlot) {
    (document.querySelector(`[data-slot-key="${CSS.escape(focusedSlot)}"]`) || $("#slot-inspection") || $("#close-detail")).focus({preventScroll: true});
  }
  if (focusedReading) ($("#reading-summary") || $("#close-detail")).focus({preventScroll: true});
  if (focusedInspection) ($("#slot-inspection") || $("#close-detail")).focus({preventScroll: true});
}
function selectDetailTab(tab, focus = false) {
  if (!detailTabs.includes(tab)) return;
  const body = $("#detail-body");
  detailScroll[detailTab] = body.scrollTop;
  detailTab = tab;
  for (const choice of detailTabs) {
    const button = $("#detail-tab-" + choice);
    button.setAttribute("aria-selected", String(choice === tab));
    button.tabIndex = choice === tab ? 0 : -1;
  }
  body.setAttribute("aria-labelledby", "detail-tab-" + tab);
  renderDetail();
  body.scrollTop = detailScroll[tab] || 0;
  if (focus) $("#detail-tab-" + tab).focus({preventScroll: true});
  revealDetailTab();
}
function revealDetailTab() {
  if ($("#detail").open)
    $("#detail-tab-" + detailTab).scrollIntoView?.({block: "nearest", inline: "nearest"});
}
function inspect(id, tab = "status") {
  if (!$("#detail").open) {
    const opener = document.activeElement;
    detailOpener = {element: opener, printer: opener?.dataset.open || opener?.dataset.id,
      action: opener?.dataset.action};
  }
  showHiddenMessages = false;
  selected = id;
  selectedSlot = null;
  readingExpanded = false;
  detailScroll = {};
  $("#detail-body").scrollTop = 0;
  selectDetailTab(tab);
  $("#detail").showModal();
  $("#detail-body").scrollTop = 0;
  $("#detail").scrollTop = 0;
  revealDetailTab();
}
function updateFeedWarning(message) {
  $("#feed-warning").hidden = !message;
  $("#feed-warning").textContent = message;
}
async function poll() {
  clearTimeout(timer);
  if (document.hidden && !(typeof browserNotifications !== "undefined" && browserNotifications.enabled())) return;
  controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch("/api/snapshot", {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Snapshot unavailable");
    const data = await response.json();
    if (
      !Array.isArray(data.printers) ||
      !data.summary ||
      !data.at ||
      !Number.isFinite(Date.parse(data.at))
    )
      throw new Error("Invalid snapshot");
    snapshot = data;
    feedError = false;
    if (typeof browserNotifications !== "undefined") {
      if (!feedDelayed()) await browserNotifications.poll();
      else browserNotifications.disconnected();
    }
    updateFeedWarning(
      feedDelayed()
        ? "Monitoring snapshot is delayed. Current printer state is unconfirmed; readings below are last-known."
        : "",
    );
  } catch {
    feedError = true;
    if (typeof browserNotifications !== "undefined") browserNotifications.disconnected();
    updateFeedWarning(
      "Cannot reach the dashboard server. Current printer state is unconfirmed. Last-known data remains below. Check the monitoring process and configured web server port.",
    );
    $("#feed-state").textContent = "Dashboard disconnected";
    $("#feed-state").classList.add("amber");
  } finally {
    clearTimeout(timeout);
    controller = null;
    if (snapshot) render();
    timer = setTimeout(poll, 3000);
  }
}
async function dismissNotice(target, retry) {
  if (commandPending || feedUnavailable()) return;
  commandPending = target;
  commandMessage = "Pending local decision…";
  renderDetail();
  try {
    if (!csrfToken) {
      const session = await fetch("/api/session", {cache: "no-store", signal: AbortSignal.timeout(5000)});
      if (!session.ok) throw new Error();
      csrfToken = (await session.json()).token;
    }
    const response = await fetch("/api/dismiss", {
      method: "POST", headers: {"Content-Type": "application/json", "X-CSRF-Token": csrfToken},
      body: JSON.stringify({target, retry}), signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) {
      csrfToken = null;
      commandMessage = "Request failed or outcome unknown. Refresh the state before retrying; the notice may already be hidden.";
    } else {
      commandMessage = "Applied locally. Check storage status below for saving, saved, session-only, or failed. Physical resolution remains unconfirmed.";
    }
  } catch {
    commandMessage = "Outcome unknown. Refresh the state before retrying; this does not confirm a saved decision.";
  } finally {
    commandPending = null;
    if ($("#detail").open) renderDetail();
  }
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.matches?.(".card")) { inspect(event.target.dataset.id); return; }
  const tab = event.target.closest("[data-detail-tab]");
  if (!tab) return;
  const index = detailTabs.indexOf(tab.dataset.detailTab);
  const next = {ArrowRight: (index + 1) % 3, ArrowLeft: (index + 2) % 3,
    Home: 0, End: 2}[event.key];
  if (next === undefined) return;
  event.preventDefault();
  selectDetailTab(detailTabs[next], true);
});
document.addEventListener("click", (event) => {
  const toggle = event.target.closest(".card-toggle");
  if (toggle) {
    const id = toggle.dataset.open;
    if (expandedCards.has(id)) expandedCards.delete(id);
    else expandedCards.add(id);
    render();
    return;
  }
  const tab = event.target.closest("[data-detail-tab]");
  if (tab) { selectDetailTab(tab.dataset.detailTab, true); return; }
  const slot = event.target.closest("[data-slot-key]");
  if (slot) {
    selectedSlot = slot.dataset.slotKey;
    renderDetail();
    document.querySelector(`[data-slot-key="${CSS.escape(selectedSlot)}"]`)?.focus({preventScroll: true});
    return;
  }
  if (event.target.closest("#toggle-hidden-messages")) {
    showHiddenMessages = !showHiddenMessages;
    renderDetail();
    return;
  }
  const action = event.target.closest("[data-dismiss]");
  if (action) { dismissNotice(action.dataset.dismiss, action.dataset.retry === "true"); return; }
  const f = event.target.closest("[data-filter]");
  if (f) {
    filter = f.dataset.filter;
    render();
  }
  const card = event.target.closest("[data-id]");
  if (card) inspect(card.dataset.id, event.target.closest("[data-notices]") ? "notices" : "status");
  const recovery = event.target.closest("[data-recovery]");
  if (recovery) {
    if (recovery.dataset.recovery === "search") {
      query = "";
      $("#search").value = "";
    } else filter = "all";
    render();
    (recovery.dataset.recovery === "search" ? $("#search") : activeFilterControl())?.focus();
  }
});
document.addEventListener("toggle", (event) => {
  if (event.target.id === "reading-details" && event.target.isConnected)
    readingExpanded = event.target.open;
}, true);
function activeFilterControl() {
  return getComputedStyle($(".mobile-status")).display !== "none" ? $("#mobile-filter") : document.querySelector(`.filters [data-filter="${filter}"]`);
}
$("#mobile-filter").addEventListener("change", event => { filter = event.target.value; render(); });
$("#search").addEventListener("input", (event) => {
  query = event.target.value;
  render();
});
$("#sort").addEventListener("change", (event) => {
  sort = event.target.value;
  render();
});
$("#detail").addEventListener("close", () => {
  const opener = detailOpener;
  const target = opener?.printer
    ? document.querySelector(opener.action
      ? `button[data-open="${CSS.escape(opener.printer)}"][data-action="${CSS.escape(opener.action)}"]`
      : `.card[data-id="${CSS.escape(opener.printer)}"]`)
    : opener?.element?.isConnected ? opener.element : null;
  (target || activeFilterControl())?.focus({preventScroll: true});
  detailOpener = null;
});
$("#close-detail").onclick = () => $("#detail").close();
$("#settings").onclick = () => $("#settings-dialog").showModal();
$("#close-settings").onclick = () => $("#settings-dialog").close();
$("#about").onclick = () => $("#about-dialog").showModal();
$("#close-about").onclick = () => $("#about-dialog").close();
// The header sits outside the scrolling workspace. Keep the height it releases
// in the already-scrolled introduction, so collapse never shifts visible cards
// or changes the scroll range. No animation: geometry and focus stay in sync.
function setupWorkspaceLayout() {
  const shell = $(".shell");
  if (!shell) return;
  const header = $("header"), toolbar = $(".toolbar");
  let compact = false;
  let restoreAnchorFrame = 0;
  function measure() {
    const scrollTop = shell.scrollTop;
    const pageTop = window.scrollY;
    // Header resizing already compensates in the introduction. Suppress browser
    // anchoring through the compensated frame, not later telemetry reflow.
    cancelAnimationFrame(restoreAnchorFrame);
    shell.style.overflowAnchor = "none";
    header.classList.remove("compact");
    const expandedHeight = header.getBoundingClientRect().height;
    header.classList.toggle("compact", compact);
    const reclaimed = expandedHeight - header.getBoundingClientRect().height;
    shell.style.setProperty("--header-reclaimed", `${reclaimed}px`);
    const toolbarHeight = toolbar.getBoundingClientRect().height;
    const minimum = Math.min(12 * parseFloat(getComputedStyle(document.documentElement).fontSize), innerHeight / 2);
    const pin = shell.clientHeight >= toolbarHeight + minimum;
    shell.classList.toggle("toolbar-scrolls", !pin);
    // Header measurement can clamp either scroll container. Restore the page
    // where possible, transferring any lost page offset into the workspace.
    window.scrollTo(window.scrollX, pageTop);
    shell.scrollTop = scrollTop + pageTop - window.scrollY;
    restoreAnchorFrame = requestAnimationFrame(() => {
      restoreAnchorFrame = requestAnimationFrame(() => {
        shell.style.removeProperty("overflow-anchor");
      });
    });
  }
  shell.addEventListener("scroll", () => {
    const next = shell.scrollTop > 24;
    if (next === compact) return;
    compact = next;
    measure();
  }, {passive: true});
  // Reflow can change header, toolbar, and footer heights (including 200% text).
  const observer = new ResizeObserver(measure);
  for (const element of [shell, header, toolbar]) observer.observe(element);
  shell.addEventListener("focusin", event => {
    const card = event.target.closest(".card");
    if (!card || restoringCardFocus) return;
    requestAnimationFrame(() => {
      if (!card.contains(document.activeElement) || shell.classList.contains("toolbar-scrolls")) return;
      const top = shell.getBoundingClientRect().top + toolbar.getBoundingClientRect().height + 8;
      const focusedTop = document.activeElement.getBoundingClientRect().top;
      if (focusedTop < top) shell.scrollTop += focusedTop - top;
    });
  });
  measure();
}
setupWorkspaceLayout();
document.addEventListener("visibilitychange", () => {
  if (!controller) poll();
});
poll();
