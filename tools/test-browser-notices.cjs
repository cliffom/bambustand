// Run with: node --test tools/test-browser-notices.cjs
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function inspector() {
  const elements = new Map();
  const listeners = {};
  const document = {
    hidden: true,
    activeElement: null,
    querySelector: (selector) => elements.get(selector) || null,
    addEventListener: (name, callback) => { listeners[name] = callback; },
  };
  function element(selector, dataset = {}) {
    const value = {
      id: selector.slice(1), dataset, scrollTop: 0, open: false,
      addEventListener() {},
      setAttribute(name, value) { this[name] = value; },
      focus(options) {
        document.activeElement = value;
        // Close is at the dialog header; ordinary focus scrolls it into view.
        if (selector === "#close-detail" && !options?.preventScroll)
          elements.get("#detail").scrollTop = 0;
      },
      showModal() { value.open = true; },
      close() { value.open = false; },
    };
    elements.set(selector, value);
    return value;
  }
  for (const id of ["detail", "detail-title", "detail-model", "detail-artwork", "detail-body", "close-detail",
    "detail-tab-status", "detail-tab-filament", "detail-tab-notices",
    "search", "sort", "mobile-filter",
    "review", "about", "close-about", "settings", "settings-dialog", "close-settings"]) element("#" + id);
  let html = "";
  Object.defineProperty(elements.get("#detail-body"), "innerHTML", {
    get: () => html,
    set(value) {
      html = value;
      if (document.activeElement?.dataset.dismiss || document.activeElement?.dataset.slotKey ||
          ["toggle-hidden-messages", "reading-summary", "slot-inspection"].includes(document.activeElement?.id))
        document.activeElement = null;
      for (const key of elements.keys())
        if (key.startsWith("[data-dismiss=") || key.startsWith("[data-slot-key=") || ["#toggle-hidden-messages", "#reading-summary", "#slot-inspection"].includes(key))
          elements.delete(key);
      for (const id of ["reading-summary", "slot-inspection"])
        if (value.includes(`id="${id}"`)) element("#" + id);
      for (const match of value.matchAll(/data-slot-key="([^"]+)"/g))
        element('[data-slot-key="' + match[1] + '"]', {slotKey: match[1]});
      if (value.includes('id="toggle-hidden-messages"')) element("#toggle-hidden-messages");
      for (const match of value.matchAll(/data-dismiss="([^"]+)"/g))
        element('[data-dismiss="' + match[1] + '"]', {dismiss: match[1]});
    },
  });
  const context = vm.createContext({
    document, CSS: {escape: (s) => s}, Date, setInterval() {}, clearTimeout() {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,
    "../internal/webserver/assets/app.js"), "utf8"), context);
  const run = (code) => vm.runInContext(code, context);
  run(`snapshot = {at: new Date().toISOString(), decisions: "saved", printers: [{
    id: "printer", name: "Synthetic printer", fresh: true, connection: "Live",
    state: "IDLE", nozzles: [], ams: [], external: [], conditions: [
      {id: "visible", text: "Visible condition", hidden: false},
      {id: "hidden", text: "Hidden condition", hidden: true, reviewed: true}
    ]}]}; inspect("printer", "notices");`);
  return {
    run, html: () => html,
    focus(selector) { elements.get(selector).focus(); },
    focused: () => document.activeElement?.id,
    selectSlot(key) {
      const target = elements.get(`[data-slot-key="${key}"]`);
      target.focus();
      listeners.click({target: {closest: selector => selector === "[data-slot-key]" ? target : null}});
    },
    toggleCard(id) {
      listeners.click({target: {closest: selector => selector === ".card-toggle" ? {dataset: {open: id}} : null}});
    },
    toggle() {
      const target = elements.get("#toggle-hidden-messages");
      listeners.click({target: {closest: (selector) =>
        selector === "#toggle-hidden-messages" ? target : null}});
    },
  };
}

test("shared cancellation summary retains FAILED and per-occurrence controls with one next step", () => {
  const view = inspector();
  view.run(`snapshot.printers[0].state = "FAILED";
    snapshot.printers[0].print_summary = "Task canceled";
    snapshot.printers[0].print_guidance = "Check the print and restart only when ready.";
    snapshot.printers[0].conditions[0].guidance = "Inspect physical fault";
    renderDetail();`);
  assert.match(view.html(), /Task canceled/);
  assert.match(view.html(), /Reported state: FAILED/);
  assert.equal((view.html().match(/<strong>Next:/g) || []).length, 1);
  assert.doesNotMatch(view.html(), /Inspect physical fault/);
  view.focus('[data-dismiss="visible"]');
  view.run(`snapshot.printers[0].print_summary = "Task canceled · updated"; renderDetail()`);
  assert.equal(view.focused(), 'data-dismiss="visible"]');
  view.run(`feedError = true; renderDetail()`);
  assert.match(view.html(), /current state unconfirmed/);
  assert.doesNotMatch(view.html(), /<strong>Next:/);
  assert.match(view.html(), /data-dismiss="visible"/);
});

test("header settings opens and closes independently of live printer inspection", () => {
  const view = inspector();
  view.run('$("#settings").onclick()');
  assert.equal(view.run('$("#settings-dialog").open'), true);
  view.run('snapshot.printers[0].conditions[0].text = "Updated while settings open"; renderDetail()');
  assert.equal(view.run('$("#settings-dialog").open'), true);
  view.run('$("#close-settings").onclick()');
  assert.equal(view.run('$("#settings-dialog").open'), false);
  assert.match(view.html(), /Updated while settings open/);
});

test("dismissed conditions are hidden by default and inspectable without changing decisions", () => {
  const view = inspector();
  assert.match(view.html(), /Visible condition/);
  assert.doesNotMatch(view.html(), /Hidden condition/);
  assert.match(view.html(), /View hidden messages \(1\)/);
  view.focus("#toggle-hidden-messages");
  view.toggle();
  assert.match(view.html(), /Hidden condition/);
  assert.match(view.html(), /aria-pressed="true"/);
  assert.equal(view.focused(), "toggle-hidden-messages");
  view.run("renderDetail()");
  assert.match(view.html(), /Hidden condition/);
  assert.equal(view.focused(), "toggle-hidden-messages");
  assert.equal(view.run("snapshot.printers[0].conditions[1].hidden"), true);
  view.toggle();
  assert.doesNotMatch(view.html(), /Hidden condition/);
  view.toggle();
  view.run('inspect("printer", "notices")');
  assert.doesNotMatch(view.html(), /Hidden condition/);
});

test("all-hidden and empty views differ; new conditions remain visible", () => {
  const view = inspector();
  view.run("snapshot.printers[0].conditions[0].hidden = true; renderDetail()");
  assert.match(view.html(), /All reported messages are hidden locally/);
  assert.match(view.html(), /View hidden messages \(2\)/);
  view.run('snapshot.printers[0].conditions.push({id:"new", text:"New occurrence", hidden:false}); renderDetail()');
  assert.match(view.html(), /New occurrence/);
  view.run("snapshot.printers[0].conditions = []; renderDetail()");
  assert.match(view.html(), /No active notices in this snapshot/);
  assert.doesNotMatch(view.html(), /toggle-hidden-messages/);
});

test("live dismissals preserve scroll and fall back to Close; disappearing toggle does too", () => {
  const view = inspector();
  view.focus('[data-dismiss="visible"]');
  view.run('$("#detail-body").scrollTop = 120; snapshot.printers[0].conditions[0].hidden = true; renderDetail()');
  assert.equal(view.focused(), "close-detail");
  assert.equal(view.run('$("#detail-body").scrollTop'), 120);
  view.focus("#toggle-hidden-messages");
  view.run("snapshot.printers[0].conditions = []; renderDetail()");
  assert.equal(view.focused(), "close-detail");
  assert.equal(view.run('$("#detail-body").scrollTop'), 120);
});

test("telemetry removal of a focused condition preserves inspector scroll", () => {
  const view = inspector();
  view.focus('[data-dismiss="visible"]');
  view.run('$("#detail-body").scrollTop = 120; snapshot.printers[0].conditions = []; renderDetail()');
  assert.equal(view.focused(), "close-detail");
  assert.equal(view.run('$("#detail-body").scrollTop'), 120);
});

test("ongoing estimate updates retain action focus and inspector scroll", () => {
  const view = inspector();
  view.focus('[data-dismiss="visible"]');
  view.run('$("#detail-body").scrollTop = 120; snapshot.printers[0].conditions[0].text = "Estimated filament 8%"; renderDetail()');
  assert.match(view.html(), /Estimated filament 8%/);
  assert.equal(view.run("document.activeElement?.dataset.dismiss"), "visible");
  assert.equal(view.run('$("#detail-body").scrollTop'), 120);
});

test("failed-save retry remains available through hidden messages, including feed outages", () => {
  const view = inspector();
  view.run('snapshot.decisions = "failed"; renderDetail()');
  assert.match(view.html(), /Local decision storage: failed/);
  view.toggle();
  assert.match(view.html(), /data-dismiss="hidden" data-retry="true"/);
  view.run("feedError = true; renderDetail()");
  assert.match(view.html(), /data-retry="true" aria-disabled="true"/);
  view.toggle();
  assert.doesNotMatch(view.html(), /Hidden condition/);
});

// Minimal tree operations for card reconciliation; card() is replaced with a
// synthetic tree builder so these tests exercise identity/lifetime, not parsing.
function cardTree(name, attributes = {}, children = []) {
  const node = {
    nodeType: name === "#text" ? 3 : 1, nodeName: name,
    nodeValue: name === "#text" ? String(attributes) : null,
    attrs: name === "#text" ? {} : {...attributes}, childNodes: [], parent: null,
    attributeWrites: 0, moves: 0,
    get attributes() { return Object.entries(this.attrs).map(([name, value]) => ({name, value})); },
    get children() { return this.childNodes.filter((n) => n.nodeType === 1); },
    get dataset() { return {id: this.attrs["data-id"]}; },
    get firstElementChild() { return this.children[0] || null; },
    hasAttribute(name) { return Object.hasOwn(this.attrs, name); },
    getAttribute(name) { return this.attrs[name] ?? null; },
    setAttribute(name, value) { this.attrs[name] = value; this.attributeWrites++; },
    removeAttribute(name) { delete this.attrs[name]; this.attributeWrites++; },
    appendChild(child) { return this.insertBefore(child, null); },
    insertBefore(child, before) {
      child.moves++;
      child.remove();
      const index = before ? this.childNodes.indexOf(before) : this.childNodes.length;
      assert.notEqual(index, -1);
      this.childNodes.splice(index, 0, child);
      child.parent = this;
      return child;
    },
    remove() {
      if (!this.parent) return;
      this.parent.childNodes.splice(this.parent.childNodes.indexOf(this), 1);
      this.parent = null;
    },
    replaceWith(next) {
      const parent = this.parent;
      parent.insertBefore(next, this);
      this.remove();
    },
  };
  for (const child of children) node.appendChild(child);
  return node;
}
function cards() {
  const elements = new Map();
  const container = cardTree("DIV");
  Object.defineProperty(container, "innerHTML", {
    set(value) {
      for (const child of [...this.childNodes]) child.remove();
      this.appendChild(cardTree("DIV", {class: "empty"}, [cardTree("#text", value)]));
    },
  });
  const document = {
    hidden: true, activeElement: null, addEventListener() {},
    querySelector(selector) {
      if (selector === "#cards") return container;
      if (selector === ".shell") return null; // Card-only fixture; layout uses a real browser.
      if (!elements.has(selector)) elements.set(selector, {addEventListener() {}});
      return elements.get(selector);
    },
    createElement(name) {
      assert.equal(name, "template");
      return {content: {}, set innerHTML(printer) {
        this.content.firstElementChild = cardTree("BUTTON", {
          "data-id": printer.id, class: printer.attention ? "card warning" : "card",
          "aria-label": printer.name,
        }, [
          cardTree("H3", {}, [cardTree("#text", printer.name)]),
          cardTree("DIV", {class: "printer-view"}, [
            printer.image ? cardTree("IMG", {src: printer.image, loading: "lazy", decoding: "async"}) : cardTree("SVG"),
            cardTree("SPAN", {}, [cardTree("#text", printer.attention ? "INSPECT CONDITIONS" : "MONITORING")]),
          ]),
          cardTree("STRONG", {}, [cardTree("#text", printer.progress)]),
          ...(printer.attention ? [cardTree("P", {}, [cardTree("#text", "Action needed")])] : []),
        ]);
      }};
    },
  };
  const context = vm.createContext({document, setInterval() {}, clearTimeout() {}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,
    "../internal/webserver/assets/app.js"), "utf8"), context);
  vm.runInContext('card = (printer) => printer; snapshot = {printers: []}', context);
  return {container, update(printers) {
    context.printers = printers;
    vm.runInContext("snapshot.printers = printers; renderCards(printers)", context);
  }};
}

test("polls update telemetry without disconnecting cards or rewriting unchanged image attributes", () => {
  const view = cards();
  const printer = {id: "one", name: "Synthetic printer", image: "/printers/h2d.png", progress: 12};
  view.update([printer]);
  const card = view.container.children[0];
  const image = card.children[1].children[0];
  const moves = card.moves;
  for (let progress = 13; progress <= 20; progress++) {
    view.update([{...printer, name: "Updated name", progress, attention: progress % 2 === 0}]);
    assert.equal(view.container.children[0], card);
    assert.equal(card.children[1].children[0], image);
    assert.equal(image.attributeWrites, 0);
    assert.equal(card.moves, moves);
    assert.equal(image.parent.parent.parent, view.container);
    assert.equal(card.children[0].childNodes[0].nodeValue, "Updated name");
    assert.equal(card.children[2].childNodes[0].nodeValue, String(progress));
    assert.equal(card.children.length, progress % 2 === 0 ? 4 : 3);
    assert.equal(card.getAttribute("aria-label"), "Updated name");
    assert.equal(card.getAttribute("class"), progress % 2 === 0 ? "card warning" : "card");
  }
});

test("reordering, filtering, discovery, and empty views keep the correct printer identities", () => {
  const view = cards();
  const a = {id: 'a"quoted', name: "Alpha", image: "/a.png", progress: 0};
  const b = {id: "b", name: "Beta", image: "/b.png", progress: 0};
  view.update([a, b]);
  const [first, second] = view.container.children;
  view.update([b, a]);
  assert.deepEqual(view.container.children, [second, first]);
  const firstMoves = first.moves;
  view.update([a]);
  assert.equal(first.moves, firstMoves);
  assert.deepEqual(view.container.children, [first]);
  assert.equal(second.parent, null);
  view.update([a, b, {id: "c", name: "New", progress: 1}]);
  assert.equal(view.container.children[0], first);
  assert.equal(view.container.children.length, 3);
  view.update([]);
  assert.equal(first.parent, null);
  assert.equal(view.container.children[0].getAttribute("class"), "empty");
  view.update([b]);
  assert.equal(view.container.children.length, 1);
  assert.equal(view.container.children[0].dataset.id, "b");
});

test("changed model images and transitions to/from generic artwork update in place", () => {
  const view = cards();
  const printer = {id: "one", name: "Printer", progress: 1, image: "/a.png"};
  view.update([printer]);
  const card = view.container.children[0];
  const image = card.children[1].children[0];
  view.update([{...printer, image: "/b.png"}]);
  assert.equal(card.children[1].children[0], image);
  assert.equal(image.getAttribute("src"), "/b.png");
  assert.equal(image.attributeWrites, 1);
  view.update([{...printer, image: null}]);
  assert.equal(card.children[1].children[0].nodeName, "SVG");
  view.update([printer]);
  assert.equal(card.children[1].children[0].nodeName, "IMG");
  assert.equal(card.children[1].children[0].getAttribute("src"), "/a.png");
  assert.equal(view.container.children[0], card);
});

for (const mode of ["name", "attention", "state"]) {
  test(`${mode} sorting groups non-idle, idle/done, and offline devices with deterministic ties`, () => {
    const view = inspector();
    const printers = [
      {id: "offline-idle", name: "A", online: false, state: "IDLE", attention: true},
      {id: "idle", name: "A idle", online: true, state: "IDLE", attention: true},
      {id: "done", name: "B done", online: true, state: "FINISH"},
      {id: "b", name: "same", online: true, state: "RUNNING"},
      {id: "a", name: "Same", online: true, state: "RUNNING"},
      {id: "paused", name: "Z paused", online: true, state: "PAUSE", attention: true},
      {id: "offline-running", name: "B", online: false, state: "RUNNING"},
    ];
    view.run(`snapshot.printers = ${JSON.stringify(printers)}; sort = ${JSON.stringify(mode)}`);
    const ids = () => JSON.parse(view.run('JSON.stringify(visible().map(p => p.id))'));
    const want = mode === "name"
      ? ["a", "b", "paused", "idle", "done", "offline-idle", "offline-running"]
      : mode === "attention"
        ? ["paused", "a", "b", "idle", "done", "offline-idle", "offline-running"]
        : ["paused", "a", "b", "done", "idle", "offline-idle", "offline-running"];
    assert.deepEqual(ids(), want);
    // A cloud outage masks even offline devices' connection labels. Device
    // flags and last-known states must still control grouping, never freshness.
    view.run('feedError = true; snapshot.connected = false; for (const p of snapshot.printers) { p.connection = "Cloud disconnected"; p.fresh = false; }');
    assert.deepEqual(ids(), want);
    view.run('filter = "printing"');
    assert.deepEqual(ids(), ["a", "b", "offline-running"]);
    view.run('filter = "attention"');
    assert.deepEqual(ids(), ["paused", "idle", "offline-idle"]);
    view.run('filter = "all"; query = "same"');
    assert.deepEqual(ids(), ["a", "b"]);
    view.run('query = "no matches"');
    assert.deepEqual(ids(), []);
  });

  test(`${mode} sorting follows state/online changes without classifying unknown as idle`, () => {
    const view = inspector();
    for (const state of ["RUNNING", "PREPARE", "SLICING", "PAUSE", "FAILED", "UNKNOWN", "", "FUTURE_STATE", null]) {
      view.run(`sort = ${JSON.stringify(mode)}; snapshot.printers = [
        {id:"active", name:"Z", online:true, state:${JSON.stringify(state)}},
        {id:"idle", name:"A", online:true, state:"IDLE"},
        {id:"offline", name:"0", online:false, state:"RUNNING"}
      ]`);
      assert.equal(view.run('visible()[0].id'), "active");
      assert.equal(view.run('visible()[2].id'), "offline");
      view.run('snapshot.printers[0].state = "FINISH"');
      assert.equal(view.run('visible()[0].id'), mode === "state" ? "active" : "idle");
      view.run('snapshot.printers[0].online = false');
      assert.equal(view.run('visible()[0].id'), "idle");
      view.run('snapshot.printers[0].online = true; snapshot.printers[0].state = "RUNNING"');
      assert.equal(view.run('visible()[0].id'), "active");
    }
  });
}

test("idle/finished trusts shared eligibility and requires current online telemetry and feed", () => {
  const view = inspector();
  const base = {online: true, fresh: true, idle_finished: true};
  const printers = [
    {...base, id: "idle", name: "Alpha", state: "IDLE", attention: true},
    {...base, id: "done", name: "Beta", state: "FINISH"},
    {...base, id: "offline", name: "Offline", state: "IDLE", online: false},
    {...base, id: "stale", name: "Stale", state: "FINISH", fresh: false},
    ...["RUNNING", "PAUSE", "FAILED", "PREPARE", "SLICING", "UNKNOWN", "FUTURE", ""].map(state =>
      ({...base, id: state, name: state, state, idle_finished: false, progress: 100, remaining: 0})),
    {...base, id: "missing", name: "No classification", state: "IDLE", idle_finished: undefined},
  ];
  view.run(`snapshot.connected = true; snapshot.printers = ${JSON.stringify(printers)}; filter = "idle"`);
  const ids = () => JSON.parse(view.run("JSON.stringify(visible().map(p => p.id))"));
  assert.deepEqual(ids(), ["idle", "done"]);
  view.run('sort = "attention"; query = "alpha"');
  assert.deepEqual(ids(), ["idle"]);
  view.run('query = "no match"');
  assert.deepEqual(ids(), []);
  view.run('query = ""; feedError = true');
  assert.deepEqual(ids(), []);
  view.run('feedError = false; snapshot.at = new Date(Date.now() - 11000).toISOString()');
  assert.deepEqual(ids(), []);
  view.run('snapshot.at = new Date().toISOString(); snapshot.connected = false');
  assert.deepEqual(ids(), []);
  view.run('snapshot.connected = true');
  assert.deepEqual(ids(), ["idle", "done"]);
  view.run('snapshot.printers[0].state = "RUNNING"; snapshot.printers[0].idle_finished = false');
  assert.deepEqual(ids(), ["done"]);
  view.run('snapshot.printers[0].state = "FINISH"; snapshot.printers[0].idle_finished = true');
  assert.deepEqual(ids(), ["idle", "done"]);
});

test("cards keep last-known scope and attention explicit without repeated metric prefixes", () => {
  const view = inspector();
  view.run('snapshot.printers[0].fresh = false; snapshot.printers[0].attention = true');
  const html = view.run('card(snapshot.printers[0])');
  assert.match(html, /Current state unconfirmed · readings are last-known; missing values remain unknown/);
  assert.match(html, /Attention · view notices/);
  assert.match(html, /Unknown material/);
  assert.doesNotMatch(html, /Last-known · (Nozzle|Bed|Reported progress|Unknown material)/);
  assert.doesNotMatch(html, /machine-state|MONITORING/);
});


test("every filter count matches search intersected with its membership, including overlapping and last-reported states", () => {
  const view = inspector();
  view.run(`snapshot.connected = true; snapshot.printers = [
    {id:"a",name:"Alpha",state:"IDLE",idle_finished:true,online:true,fresh:true,attention:true},
    {id:"b",name:"Beta",state:"RUNNING",online:true,fresh:true},
    {id:"c",name:"Offline",state:"RUNNING",online:false,fresh:false,attention:true},
    {id:"d",name:"Unknown",state:"UNKNOWN",online:true,fresh:true}
  ]; query = "no matches";`);
  const counts = () => JSON.parse(view.run('JSON.stringify(["all","printing","idle","attention","unavailable"].map(filterCount))'));
  assert.deepEqual(counts(), [0,0,0,0,0]);
  view.run('query = "Alpha"');
  assert.deepEqual(counts(), [1,0,1,1,0]);
  view.run('query = "no matches"');
  assert.equal(view.run('visible().length'), 0);
  view.run('query = ""');
  for (const choice of ["all","printing","idle","attention","unavailable"])
    assert.equal(view.run(`filter = "${choice}"; visible().length`), view.run(`filterCount("${choice}")`));
  view.run('feedError = true');
  assert.deepEqual(counts(), [4,2,0,2,1]);
  view.run('snapshot.printers = []');
  assert.deepEqual(counts(), [0,0,0,0,0]);
});


test("offline cards show identity and attention without last-known telemetry", () => {
  const view = inspector();
  view.run(`Object.assign(snapshot.printers[0], {
    online: false, fresh: false, connection: "Offline", model: "H2D",
    image: "/assets/printers/h2d.png", job: "Old job", progress: 42,
    remaining: 60, nozzles: [{temperature: {current: 220}}],
    bed: {current: 60}, external: [{material: "PLA", color: "FF0000"}], attention: true
  })`);
  for (const setup of ["", "feedError = true", "feedError = false; snapshot.connected = false"]) {
    view.run(setup);
    const html = view.run('card(snapshot.printers[0])');
    assert.match(html, /class="card warning offline"/);
    assert.match(html, /Synthetic printer/);
    assert.match(html, /H2D/);
    assert.match(html, /printer-sprite/);
    assert.match(html, /Inspect Synthetic printer, Offline/);
    assert.match(html, />Offline</);
    assert.match(html, /Attention · view notices/);
    assert.doesNotMatch(html, /Old job|progress|metrics|Nozzle|Bed|Finish estimate|swatches|PLA|telemetry-note|Last-known/);
  }
  view.run('snapshot.printers[0].image = null; snapshot.printers[0].model = null');
  assert.match(view.run('card(snapshot.printers[0])'), /Unknown model.*<svg/s);
  view.run('selectDetailTab("status")');
  assert.doesNotMatch(view.html(), /Old job/);
  assert.match(view.html(), /Reported offline/);
});

test("staleness and feed loss do not simplify online or unknown-connectivity cards", () => {
  const view = inspector();
  for (const online of [true, null, undefined]) {
    view.run(`Object.assign(snapshot.printers[0], {online: ${online}, fresh: false, connection: "Stale"})`);
    for (const feedError of [false, true]) {
      view.run(`feedError = ${feedError}; snapshot.connected = false`);
      const html = view.run('card(snapshot.printers[0])');
      assert.doesNotMatch(html, /class="card[^"<>]* offline/);
      assert.match(html, /Current state unconfirmed/);
      assert.match(html, /No active print/);
      assert.match(html, /Nozzle/);
      assert.match(html, /Unknown material/);
    }
  }
});

test("inspection defaults to Overview and remembers independent panel positions during updates", () => {
  const view = inspector();
  view.run('inspect("printer")');
  assert.equal(view.run('detailTab'), "status");
  assert.match(view.html(), /No reported job/);
  assert.doesNotMatch(view.html(), /Reported conditions|AMS configuration/);
  view.run('$("#detail-body").scrollTop = 80; selectDetailTab("filament", true)');
  assert.match(view.html(), /AMS configuration unknown/);
  assert.doesNotMatch(view.html(), /Reported conditions|No reported job/);
  assert.equal(view.focused(), "detail-tab-filament");
  view.run('$("#detail-body").scrollTop = 140; snapshot.decisions = "saving"; renderDetail()');
  assert.equal(view.run('detailTab'), "filament");
  assert.equal(view.run('$("#detail-body").scrollTop'), 140);
  assert.equal(view.focused(), "detail-tab-filament");
  view.run('selectDetailTab("notices"); selectDetailTab("status")');
  assert.equal(view.run('$("#detail-body").scrollTop'), 80);
  view.run('selectDetailTab("filament")');
  assert.equal(view.run('$("#detail-body").scrollTop'), 140);
  assert.equal(view.run('snapshot.printers[0].conditions[0].hidden'), false);
  view.run('inspect("printer")');
  assert.equal(view.run('detailTab'), "status");
  assert.equal(view.run('$("#detail-body").scrollTop'), 0);
});

test("review opens Notices and printer removal preserves tab with safe action focus", () => {
  const view = inspector();
  view.run('snapshot.printers[0].attention = true; inspect("printer", "notices")');
  assert.equal(view.run('detailTab'), "notices");
  view.focus('[data-dismiss="visible"]');
  view.run('snapshot.printers = []; renderDetail()');
  assert.match(view.html(), /no longer in the discovered farm/);
  assert.equal(view.focused(), "close-detail");
  assert.equal(view.run('detailTab'), "notices");
});

test("Filament drying updates preserve focus/scroll and qualify feed loss", () => {
  const view = inspector();
  view.run(`snapshot.printers[0].ams = [
    {label: "AMS 1", model: "AMS", humidity: 25, temperature: 28, slots: [], drying: "Unsupported (no active dryer)"},
    {label: "AMS 2", model: "AMS 2 Pro", humidity: 15, temperature: 48, slots: [], drying_current: true, drying: "Drying · 95 min remaining", drying_settings: "55°C target · 4 h duration"},
    {label: "AMS HT 1", model: "AMS HT", humidity: null, temperature: null, slots: [], drying: "Unknown"}
  ]; inspect("printer", "filament");`);
  assert.match(view.html(), /Unsupported \(no active dryer\)/);
  assert.match(view.html(), /Drying · 95 min remaining/);
  assert.match(view.html(), /Last reported drying settings: 55°C target · 4 h duration/);
  assert.match(view.html(), /AMS HT<.*Drying: Unknown/s);
  view.focus("#detail-tab-filament");
  view.run('$("#detail-body").scrollTop = 90; snapshot.printers[0].ams[1].drying = "Not drying · 0 min remaining"; renderDetail()');
  assert.match(view.html(), /Not drying · 0 min remaining/);
  assert.equal(view.focused(), "detail-tab-filament");
  assert.equal(view.run('$("#detail-body").scrollTop'), 90);
  view.run('feedError = true; renderDetail()');
  assert.match(view.html(), /Last-known · Not drying · 0 min remaining/);
  assert.doesNotMatch(view.html(), /Last-known · Unsupported/);
  view.run('feedError = false; snapshot.printers[0].ams[1].drying_current = false; snapshot.printers[0].ams[1].drying = "Last-known · Drying · 95 min remaining"; renderDetail()');
  assert.match(view.html(), /Last-known · Drying · 95 min remaining/);
});

test("Overview anchors finish to the independent remaining report, preserving zero and stale estimates", () => {
  const view = inspector();
  view.run(`Object.assign(snapshot.printers[0], {online:true, state:"RUNNING", progress:0,
    remaining:42, remaining_reported:"2026-11-03T23:36:00Z", eta_current:true,
    last_report:"2026-11-03T23:37:00Z", layer:0, total_layers:300,
    nozzles:[{id:0, active:true, temperature:{current:0, target:0}}]}); inspect("printer");`);
  const finish = view.run('overviewDetail(snapshot.printers[0])');
  assert.match(finish, /Reported progress: 0 percent/);
  assert.match(finish, /0 <small>°C/);
  assert.match(finish, /Target 0 °C/);
  assert.match(finish, /Reported remaining/);
  assert.match(finish, /Estimated finish/);
  view.run('snapshot.printers[0].last_report = "2026-11-03T23:38:00Z"');
  // An unrelated telemetry update never moves the projected finish.
  assert.equal(view.run('overviewDetail(snapshot.printers[0])').split('Estimated finish')[0], finish.split('Estimated finish')[0]);
  view.run('snapshot.printers[0].eta_current = false; renderDetail()');
  assert.match(view.html(), /Last-known remaining/);
  assert.match(view.html(), /Last-known finish estimate/);
  assert.doesNotMatch(view.html(), /Current state is unconfirmed/);
  view.run('feedError = true; renderDetail()');
  assert.match(view.html(), /Current state is unconfirmed/);
  assert.match(view.html(), /Last-known progress: 0 percent/);
  view.run('feedError = false; snapshot.printers[0].remaining_reported = ""; renderDetail()');
  assert.match(view.html(), /<strong>Unknown<\/strong><span>Last-known finish estimate/);
});

test("Overview does not infer nozzle inactivity when the active nozzle is unreported", () => {
  const view = inspector();
  // extruder.info without extruder.state normalizes to active:false for both nozzles.
  view.run(`Object.assign(snapshot.printers[0], {online:true, nozzles:[
    {id:0, active:false, temperature:{current:210, target:220}},
    {id:1, active:false, temperature:{current:180, target:190}}
  ]}); inspect("printer");`);
  assert.match(view.html(), /Right nozzle/);
  assert.match(view.html(), /Left nozzle/);
  assert.match(view.html(), /210 <small>°C/);
  assert.match(view.html(), /180 <small>°C/);
  assert.doesNotMatch(view.html(), /nozzle-activity|active-nozzle|Reported inactive/);
  view.run('snapshot.printers[0].nozzles[1].active = true; renderDetail()');
  assert.equal((view.html().match(/Reported active/g) || []).length, 1);
  assert.equal((view.html().match(/active-nozzle/g) || []).length, 1);
  assert.doesNotMatch(view.html(), /Reported inactive/);
  view.run('snapshot.printers[0].nozzles[1].active = false; renderDetail()');
  assert.doesNotMatch(view.html(), /nozzle-activity|active-nozzle|Reported inactive/);
});

test("non-running states never present a running duration or finish and offline omits telemetry", () => {
  const view = inspector();
  view.run('Object.assign(snapshot.printers[0], {online:true, job:"Prior job", remaining:42, remaining_reported:new Date().toISOString(), eta_current:true})');
  for (const state of ["PAUSE", "FAILED", "IDLE", "FINISH", "UNKNOWN", "PREPARE", "SLICING"]) {
    view.run(`snapshot.printers[0].state = "${state}"; inspect("printer")`);
    assert.match(view.html(), /No running finish estimate/);
    assert.match(view.html(), /No running time estimate/);
    assert.doesNotMatch(view.html(), /<span>Estimated finish/);
  }
  view.run('snapshot.printers[0].online = false; renderDetail()');
  assert.match(view.html(), /Reported offline/);
  assert.doesNotMatch(view.html(), /Prior job|temperature-tile|progress-ring/);
  view.run('snapshot.printers[0].online = true; snapshot.printers[0].progress = null; snapshot.printers[0].state = "UNKNOWN"; renderDetail()');
  assert.match(view.html(), /Reported progress: Unknown/);
  assert.doesNotMatch(view.html(), /Reported progress: 0 percent/);
});

test("filament selection uses family/unit/slot identities and survives reordering, updates, removal and return", () => {
  const view = inspector();
  view.run(`Object.assign(snapshot.printers[0], {online:true, ams:[
    {id:0,label:"AMS 1",slots:[{id:0,present:true,material:"PLA",remaining:0,color:"AABBCC"}]},
    {id:128,label:"AMS HT 1",slots:[{id:0,present:true,material:"PETG",remaining:null,color:"invalid;color:red"}]}],
    external:[{id:0,present:null,material:"",remaining:80}]}); inspect("printer", "filament")`);
  assert.equal(view.run('inventorySlots(snapshot.printers[0]).length'), 3);
  assert.match(view.html(), /0% est\./);
  assert.doesNotMatch(view.html(), /--filament:#invalid/);
  view.selectSlot("ams:128:0");
  assert.match(view.html(), /AMS HT 1 · Slot 0 · selected/);
  assert.match(view.html(), /Remaining estimate<\/dt><dd>Unknown/);
  view.run('$("#detail-body").scrollTop = 90; snapshot.printers[0].ams.reverse(); snapshot.printers[0].ams[0].slots[0].remaining = 12; renderDetail()');
  assert.equal(view.run('selectedSlot'), "ams:128:0");
  assert.equal(view.run('document.activeElement.dataset.slotKey'), "ams:128:0");
  assert.equal(view.run('$("#detail-body").scrollTop'), 90);
  assert.match(view.html(), /Remaining estimate<\/dt><dd>12% est\./);
  view.run('snapshot.printers[0].ams.shift(); renderDetail()');
  assert.match(view.html(), /Selected slot unavailable/);
  assert.equal(view.focused(), "slot-inspection");
  assert.equal(view.run('selectedSlot'), "ams:128:0");
  view.run('selectDetailTab("notices"); selectDetailTab("filament")');
  assert.match(view.html(), /Selected slot unavailable/);
  view.selectSlot("external:0");
  assert.match(view.html(), /Reported presence<\/dt><dd>Unknown/);
  assert.match(view.html(), /Remaining estimate<\/dt><dd>Unavailable/);
  assert.doesNotMatch(view.html(), /80%/);
  view.run('snapshot.printers[0].online = false; renderDetail()');
  assert.match(view.html(), /Inventory unavailable · reported offline/);
  assert.doesNotMatch(view.html(), /data-slot-key=/);
  view.run('inspect("printer", "filament")');
  assert.equal(view.run('selectedSlot'), null);
});

test("empty presence wins over retained material and quantity without changing an explicit zero estimate", () => {
  const view = inspector();
  assert.equal(view.run('slotMaterial({present:false, material:"Prior material"})'), "Reported empty");
  assert.equal(view.run('slotQuantity({present:false, remaining:20})'), "Not applicable");
  assert.equal(view.run('slotQuantity({present:true, remaining:0})'), "0% est.");
  assert.equal(view.run('slotQuantity({present:null, remaining:null})'), "Unknown");
});

test("opening and reopening reveal the selected inspector tab after the dialog is visible", () => {
  const view = inspector();
  view.run(`$("#detail").close();
    for (const tab of detailTabs) $("#detail-tab-" + tab).scrollIntoView = function() {
      this.revealedWhileOpen = $("#detail").open;
    };
    inspect("printer", "notices");`);
  assert.equal(view.run('$("#detail-tab-notices").revealedWhileOpen'), true);
  view.run('$("#detail").close(); inspect("printer")');
  assert.equal(view.run('$("#detail-tab-status").revealedWhileOpen'), true);
  assert.equal(view.run('detailTab'), "status");
});

test("notification re-entry retains the original opener until the inspector closes", () => {
  const view = inspector();
  view.focus("#search");
  view.run('$("#detail").close(); inspect("printer")');
  view.focus("#detail-tab-filament");
  view.run('inspect("printer", "notices"); inspect("printer", "notices")');
  assert.equal(view.run('detailOpener.element.id'), "search");
  assert.equal(view.run('detailTab'), "notices");
  view.run('$("#detail").close()');
  view.focus("#sort");
  view.run('inspect("printer")');
  assert.equal(view.run('detailOpener.element.id'), "sort");
});


test("card disclosure toggles only its printer without opening inspection or changing telemetry", () => {
  const view = inspector();
  view.run('$("#detail").close(); let disclosureRenders = 0; render = () => { disclosureRenders++; }');
  const before = view.run('JSON.stringify(snapshot.printers)');
  const markup = view.run('card(snapshot.printers[0])');
  for (const id of /aria-controls="([^"]+)"/.exec(markup)[1].split(" "))
    assert.ok(markup.includes(`id="${id}"`), "disclosure references telemetry and revealed actions");
  assert.match(view.run('card(snapshot.printers[0])'), /aria-expanded="false"/);
  view.toggleCard("printer");
  assert.equal(view.run('$("#detail").open'), false);
  assert.match(view.run('card(snapshot.printers[0])'), /aria-expanded="true"/);
  view.toggleCard("another");
  assert.equal(view.run('expandedCards.has("printer")'), true);
  view.toggleCard("printer");
  assert.match(view.run('card(snapshot.printers[0])'), /aria-expanded="false"/);
  assert.equal(view.run('expandedCards.has("another")'), true);
  assert.equal(view.run('disclosureRenders'), 3);
  assert.equal(view.run('JSON.stringify(snapshot.printers)'), before);
});
