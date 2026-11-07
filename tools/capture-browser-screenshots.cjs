// Capture documentation from the actual dashboard with synthetic display fixtures.
// See docs/development/contributing.md for the optional Playwright setup.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {chromium} = require("playwright");

(async () => {
  const url = process.env.DEMO_URL || "http://127.0.0.1:8080";
  const output = process.env.SCREENSHOT_DIR || path.join(__dirname, "../assets/screenshots");
  const seed = await (await fetch(new URL("/api/snapshot", url), {signal: AbortSignal.timeout(5000)})).json();
  assert.equal(seed.demo, true, "screenshots require a synthetic demo server");
  assert.ok(seed.printers.length >= 2, "wait for the demo's initial printer reports");
  fs.mkdirSync(output, {recursive: true});
  const art = fs.readdirSync(path.join(__dirname, "../internal/webserver/assets/printers"))
    .find(name => /^p1s-.*\.png$/.test(name));
  assert.ok(art, "P1S illustration must exist");
  const browser = await chromium.launch({headless: true,
    ...(process.env.BROWSER_PATH ? {executablePath: process.env.BROWSER_PATH} : {})});
  const errors = [];
  try {
    async function open(viewport = {width: 1280, height: 1200}, finished = false, canceled = false) {
      const page = await browser.newPage({viewport, locale: "en-US", timezoneId: "UTC"});
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/api/snapshot", route => {
        const at = new Date().toISOString();
        const first = {...structuredClone(seed.printers[0]), id: "screenshot-h2d", state: "RUNNING",
          online: true, fresh: true, connection: "Live", idle_finished: false, attention: false, print_summary: "", print_guidance: "",
          progress: 62, remaining: 63, eta_current: true, layer: 186,
          last_report: at, remaining_reported: at};
        const second = {...structuredClone(seed.printers[1]), id: "screenshot-x2d",
          state: finished ? "FINISH" : canceled ? "FAILED" : "PAUSE", online: true, fresh: true, connection: "Live",
          idle_finished: finished, progress: finished ? 100 : 71, remaining: finished ? 0 : 54,
          layer: finished ? 300 : 213, stage: finished ? "Finished" : canceled ? "Failed" : "Paused",
          attention: !finished, last_report: at, remaining_reported: at,
          print_summary: finished ? "Print finished" : canceled ? "Task canceled" : "Print paused · AI monitoring detected possible spaghetti; inspect print quality",
          print_guidance: finished ? "" : canceled ? "Check the print before restarting using the printer or Bambu app." : "Inspect print quality for possible spaghetti; follow the printer's instructions before continuing.",
          conditions: finished ? [] : canceled ? [
            {id:"synthetic-canceled", level:"error", text:"Task canceled", code:"0300_400C", since:at, reviewed:false, hidden:false},
            {id:"synthetic-failed", level:"warning", text:"Print failed", since:at, reviewed:false, hidden:false}] : [
            {id:"synthetic-spaghetti-hms", level:"warning", text:"Possible spaghetti detected; inspect print quality", code:"0C00_0300_0003_0008", since:at, reviewed:false, hidden:false},
            {id:"synthetic-spaghetti-error", level:"error", text:"AI monitoring detected possible spaghetti; inspect print quality", code:"0300_8003", since:at, reviewed:false, hidden:false},
            {id:"synthetic-paused", level:"warning", text:"Print paused", since:at, reviewed:false, hidden:false}]};
        const third = {...structuredClone(first), id: "screenshot-p1s", name: "P1S · Spare", model: "P1S",
          image: `/printers/${art}`, online: false, fresh: false, connection: "Offline",
          attention: false, conditions: [], eta_current: false};
        const printers = [first, second, third];
        route.fulfill({json: {...seed, demo: true, connected: true, at, decisions: "session-only", printers,
          summary: {total: printers.length, printing: printers.filter(p => p.state === "RUNNING").length,
            attention: printers.filter(p => p.attention).length, unavailable: printers.filter(p => !p.fresh).length}}});
      });
      // Capture only display interactions, never notice writes or notification requests.
      await page.route("**/api/**", route => route.request().method() === "GET" ? route.fallback() : route.abort());
      await page.goto(url);
      await page.waitForFunction(() => document.querySelectorAll(".card").length === 3 &&
        !document.querySelector("#theme-select").disabled);
      return page;
    }
    async function shot(page, name, target = page) {
      if (process.env.SCREENSHOT_FILTER && !new RegExp(process.env.SCREENSHOT_FILTER).test(name)) return;
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].filter(img => {
          const rect = img.getBoundingClientRect();
          return rect.bottom > 0 && rect.top < innerHeight;
        }).map(img => img.decode()));
      });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
        `${name}: horizontal page overflow`);
      await target.screenshot({path: path.join(output, name), animations: "disabled"});
      console.log(`Captured ${name}`);
    }
    async function theme(page, id) {
      await page.locator("#settings").click();
      await page.locator("#theme-select").selectOption(id);
      await page.keyboard.press("Escape");
      await page.evaluate(() => { document.querySelector(".shell").scrollTop = 0; scrollTo(0, 0); });
      await page.locator("#settings").blur();
    }
    const page = await open();
    assert.equal(await page.locator(".card.offline .metrics").count(), 0);
    assert.equal(await page.locator(".card").evaluateAll(cards => cards.some(card =>
      card.getBoundingClientRect().bottom > document.querySelector(".shell").getBoundingClientRect().bottom)), false,
      "overview must show complete printer cards");
    await shot(page, "browser.png");
    const catalog = await (await fetch(new URL("/api/themes", url))).json();
    for (const choice of catalog.themes.filter(t => !["host", "default"].includes(t.id))) {
      await theme(page, choice.id);
      await shot(page, `browser-theme-${choice.id}.png`);
    }
    await theme(page, "hotdog");
    await page.locator("#settings").click();
    assert.equal(await page.locator("#settings-dialog").isVisible(), true);
    await shot(page, "browser-themes.png", page.locator("#settings-dialog"));
    await page.keyboard.press("Escape");
    await theme(page, "default");
    await page.locator('[data-id="screenshot-x2d"]').click();
    await page.locator("#detail").waitFor({state: "visible"});
    assert.equal(await page.getByRole("tab", {selected: true}).textContent(), "Overview");
    await shot(page, "browser-printer-details.png", page.locator("#detail"));
    await page.getByRole("tab", {name: "Filament", exact: true}).click();
    assert.match(await page.locator("#detail-body").textContent(), /Drying · 95 min remaining/);
    assert.match(await page.locator("#detail-body").textContent(), /Not drying · 0 min remaining/);
    await page.locator("[data-slot-key]").first().click();
    assert.equal(await page.locator('#slot-inspection').isVisible(), true);
    await shot(page, "browser-filament.png", page.locator("#detail"));
    await page.getByRole("tab", {name: "Notices", exact: true}).click();
    assert.match(await page.locator("#detail-body").textContent(), /Possible spaghetti detected/);
    await shot(page, "browser-notices.png", page.locator("#detail"));
    await page.close();
    const canceled = await open({width:1280,height:1200}, false, true);
    await canceled.locator('[data-id="screenshot-x2d"]').click();
    await canceled.getByRole("tab", {name:"Notices", exact:true}).click();
    assert.match(await canceled.locator("#detail-body").textContent(), /Task canceled.*Reported state: FAILED/s);
    await shot(canceled, "browser-canceled.png", canceled.locator("#detail"));
    await canceled.close();
    const idle = await open({width: 1280, height: 1200}, true);
    await idle.locator('[data-filter="idle"]').click();
    assert.equal(await idle.locator(".card").count(), 1);
    await shot(idle, "browser-idle-filter.png");
    await idle.close();
    const scrolled = await open({width: 1280, height: 640});
    await scrolled.locator(".shell").evaluate(el => {
      el.scrollTop = document.querySelector(".fleet").getBoundingClientRect().top - el.getBoundingClientRect().top;
    });
    await scrolled.waitForFunction(() => document.querySelector("header").classList.contains("compact"));
    await scrolled.locator(".shell").evaluate(el => {
      el.scrollTop += document.querySelector(".fleet").getBoundingClientRect().top - el.getBoundingClientRect().top;
    });
    await scrolled.waitForFunction(() => Math.abs(document.querySelector(".toolbar").getBoundingClientRect().top -
      document.querySelector("header").getBoundingClientRect().bottom) < 1);
    await shot(scrolled, "browser-scrolled.png");
    await scrolled.close();
    const mobile = await open({width: 390, height: 844});
    await shot(mobile, "browser-mobile.png");
    await mobile.locator('.card.offline').focus();
    await shot(mobile, "browser-mobile-offline.png");
    await mobile.locator('[data-id="screenshot-x2d"]').click();
    await shot(mobile, "browser-printer-details-mobile.png", mobile.locator("#detail"));
    await mobile.getByRole("tab", {name: "Filament", exact: true}).click();
    await mobile.locator("[data-slot-key]").first().click();
    await shot(mobile, "browser-filament-mobile.png", mobile.locator("#detail"));
    await mobile.close();
    assert.deepEqual(errors, []);
    console.log(`Synthetic screenshots captured with Chromium ${await browser.version()}`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
