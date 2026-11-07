// Synthetic inspector interactions against serve --demo, using real browser focus/layout.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const {chromium} = require("playwright");
(async () => {
  const url = process.env.DEMO_URL || "http://127.0.0.1:8080";
  const seed = await (await fetch(new URL("/api/snapshot", url))).json();
  assert.equal(seed.demo, true);
  assert.ok(seed.printers.length);
  const browser = await chromium.launch({headless: true,
    ...(process.env.BROWSER_PATH ? {executablePath: process.env.BROWSER_PATH} : {})});
  try {
    for (const [width, height, scale] of [[1280,800,1], [1920,1080,1], [390,844,1],
      [320,568,1], [568,320,1], [1280,240,1], [320,568,2], [390,844,2],
      [780,844,2], [568,320,2], [1280,240,2]]) {
      const page = await browser.newPage({viewport: {width,height}});
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      const printer = {...structuredClone(seed.printers[0]), id: "inspection", name: "Inspection fixture",
        state: "PAUSE", print_summary: "Print paused · AI monitoring detected possible spaghetti; inspect print quality",
        print_guidance: "Inspect print quality and follow the printer's instructions before continuing.",
        attention: true, conditions: Array.from({length: 12}, (_,i) => ({id: `notice-${i}`,
          text: `Synthetic condition ${i}`, guidance: "Inspect the printer before using Bambu's applications.",
          level: "warning", hidden: false, since: new Date().toISOString()})),
        ams: Array.from({length: 6}, (_,i) => ({id: i, label: `AMS ${i + 1}`, humidity: 30, temperature: null,
          drying_current: i < 2,
          model: i === 0 ? "AMS 2 Pro" : i === 1 ? "AMS HT" : "AMS",
          drying: i === 0 ? "Drying · 95 min remaining" : i === 1 ? "Not drying · 0 min remaining" : "Unsupported (no active dryer)",
          drying_settings: i === 0 ? "55°C target · 4 h duration" : "",
          slots: [{id: 0, material: "PLA", present: true, color: "AABBCC", remaining: 0},
            {id: 1, material: "", present: false, color: "", remaining: null}]})),
        external: [{id: 0, material: "PETG", present: true, color: "112233", remaining: null}]};
      let decisions = "saved", writes = 0;
      await page.route("**/api/snapshot", route => route.fulfill({json: {...seed,
        at: new Date().toISOString(), decisions, printers: [printer],
        summary: {total:1, printing:1, attention:1, unavailable:0}}}));
      await page.route("**/api/session", route => route.fulfill({json: {token: "synthetic"}}));
      await page.route("**/api/dismiss", route => {
        writes++;
        const {target} = route.request().postDataJSON();
        printer.conditions.find(c => c.id === target).hidden = true;
        decisions = "failed";
        return route.fulfill({json: {}});
      });
      await page.goto(url);
      await page.evaluate(scale => { document.documentElement.style.fontSize = `${16 * scale}px`; }, scale);
      const card = page.locator('[data-id="inspection"]');
      await card.focus();
      await page.keyboard.press("Enter");
      const body = page.locator("#detail-body");
      const tabs = page.getByRole("tab");
      assert.deepEqual(await tabs.allTextContents(), ["Overview", "Filament", "Notices"]);
      assert.equal(await page.getByRole("tab", {selected:true}).textContent(), "Overview");
      await page.locator("#reading-summary").click();
      await page.evaluate(() => poll());
      assert.equal(await page.locator("#reading-details").getAttribute("open"), "");
      assert.equal(await page.locator("#reading-summary").evaluate(el => el === document.activeElement), true);
      for (const name of ["Overview", "Filament", "Notices"]) {
        const tab = page.getByRole("tab", {name, exact:true});
        await tab.click();
        assert.equal(await body.getAttribute("aria-labelledby"), await tab.getAttribute("id"));
        assert.equal(await page.locator('[role="tab"][tabindex="0"]').count(), 1);
        await body.evaluate(el => { el.scrollTop = 100; });
        const before = await body.evaluate(el => el.scrollTop);
        await page.evaluate(() => poll());
        assert.equal(await body.evaluate(el => el.scrollTop), before, `${name}: polling keeps reading position`);
        assert.equal(await tab.evaluate(el => el === document.activeElement), true);
        const bounds = await page.locator("#detail").evaluate(el => {
          const body = el.querySelector('[role="tabpanel"]'), tabs = el.querySelector('[role="tablist"]');
          const close = el.querySelector("#close-detail"), r = el.getBoundingClientRect();
          return {top:r.top, bottom:r.bottom, overflow:el.scrollWidth > el.clientWidth || body.scrollWidth > body.clientWidth,
            panel:body.clientHeight, line:parseFloat(getComputedStyle(body).lineHeight), tabBottom:tabs.getBoundingClientRect().bottom,
            panelTop:body.getBoundingClientRect().top, closeBottom:close.getBoundingClientRect().bottom};
        });
        assert.ok(bounds.top >= 0 && bounds.bottom <= height && !bounds.overflow && bounds.panel >= bounds.line &&
          bounds.tabBottom <= bounds.panelTop && bounds.closeBottom <= height,
          `${width}x${height} ${scale}x ${name}: usable panel and fixed controls ${JSON.stringify(bounds)}`);
        if (process.env.SCREENSHOT_DIR) {
          fs.mkdirSync(process.env.SCREENSHOT_DIR, {recursive: true});
          await page.locator("#detail").screenshot({path: path.join(process.env.SCREENSHOT_DIR,
            `inspector-${width}-${height}-${scale}x-${name}.png`)});
        }
        await body.focus();
        await page.keyboard.press("Control+End");
        await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
        assert.equal(await tab.isVisible(), true);
        if (name === "Filament") {
          assert.match(await body.textContent(), /Reported empty/);
          assert.match(await body.textContent(), /0% est\./);
          assert.match(await body.textContent(), /External filament/);
          assert.match(await body.textContent(), /Drying · 95 min remaining/);
          assert.match(await body.textContent(), /Not drying · 0 min remaining/);
          assert.match(await body.textContent(), /Unsupported \(no active dryer\)/);
          const slot = page.locator('[data-slot-key="ams:4:0"]');
          await slot.click();
          assert.match(await page.locator("#slot-inspection").textContent(), /AMS 5 · Slot 0 · selected/);
          assert.match(await page.locator("#slot-inspection").textContent(), /0% est\./);
          assert.equal(await slot.getAttribute("aria-pressed"), "true");
          const slotScroll = await body.evaluate(el => el.scrollTop);
          printer.ams.reverse();
          await page.evaluate(() => poll());
          assert.equal(await slot.evaluate(el => el === document.activeElement), true);
          assert.equal(await body.evaluate(el => el.scrollTop), slotScroll);
          const removed = printer.ams.splice(printer.ams.findIndex(u => u.id === 4), 1)[0];
          await page.evaluate(() => poll());
          assert.match(await page.locator("#slot-inspection").textContent(), /Selected slot unavailable/);
          assert.equal(await page.locator("#slot-inspection").evaluate(el => el === document.activeElement), true);
          assert.equal(await page.locator('[data-slot-key][aria-pressed="true"]').count(), 0);
          printer.ams.push(removed);
          printer.ams.sort((a,b) => a.id - b.id);
          await page.evaluate(() => poll());
          assert.match(await page.locator("#slot-inspection").textContent(), /AMS 5 · Slot 0 · selected/);
          printer.ams[0].drying_current = false;
          printer.ams[0].drying = "Last-known · Drying · 95 min remaining";
          await page.evaluate(() => poll());
          assert.match(await body.textContent(), /Last-known · Drying · 95 min remaining/);
        }
      }
      // Shared outcomes consolidate guidance while retaining independent notice controls.
      await page.getByRole("tab", {name:"Notices", exact:true}).click();
      assert.match(await body.textContent(), /Print paused.*spaghetti/s);
      assert.equal(await body.locator("strong").filter({hasText:"Next:"}).count(), 1);
      const action = page.locator('[data-dismiss="notice-1"]');
      await action.focus();
      const noticeScroll = await body.evaluate(el => el.scrollTop);
      Object.assign(printer, {state:"FAILED", print_summary:"Task canceled",
        print_guidance:"Check the print before restarting using the printer or Bambu app."});
      await page.evaluate(() => poll());
      assert.match(await body.textContent(), /Task canceled.*Reported state: FAILED/s);
      assert.equal(await action.evaluate(el => el === document.activeElement), true);
      assert.equal(await body.evaluate(el => el.scrollTop), noticeScroll);
      assert.equal(await page.locator('[data-dismiss]').count(), 12);
      assert.equal(await body.locator("strong").filter({hasText:"Next:"}).count(), 1);
      await page.evaluate(() => {feedError=true; renderDetail();});
      assert.match(await body.textContent(), /Last-known: Task canceled; current state unconfirmed/);
      assert.equal(await body.locator("strong").filter({hasText:"Next:"}).count(), 0);
      await page.evaluate(() => poll());
      if (process.env.SCREENSHOT_DIR) {
        await body.evaluate(el => {el.scrollTop=0;});
        await page.locator("#detail").screenshot({path:path.join(process.env.SCREENSHOT_DIR,
          `inspector-${width}-${height}-${scale}x-canceled.png`)});
      }
      // Long identities and unknown progress must leave the panel and Close usable.
      printer.name = "Inspection fixture · North workshop · Long printer name for accessible inspection";
      printer.job = "A long synthetic job name with multiple parts and material descriptions";
      printer.progress = null;
      await page.getByRole("tab", {name:"Overview", exact:true}).click();
      await page.evaluate(() => poll());
      assert.equal(await page.locator("#detail-title").textContent(), printer.name);
      assert.match(await page.locator(".progress-ring").textContent(), /Unknown/);
      assert.ok(await body.evaluate(el => el.clientHeight >= parseFloat(getComputedStyle(el).lineHeight) &&
        el.scrollWidth <= el.clientWidth), "long names and unknown progress retain a usable panel without overflow");
      const title = page.locator("#detail-title");
      await title.focus();
      await title.evaluate(el => { el.scrollTop = el.scrollHeight; });
      const titleScroll = await title.evaluate(el => el.scrollTop);
      await page.evaluate(() => poll());
      assert.equal(await title.evaluate(el => el === document.activeElement), true);
      assert.equal(await title.evaluate(el => el.scrollTop), titleScroll,
        "full printer name remains keyboard reachable and retains its reading position");
      if (process.env.SCREENSHOT_DIR) {
        await body.evaluate(el => { el.scrollTop = 0; });
        await page.locator("#detail").screenshot({path: path.join(process.env.SCREENSHOT_DIR,
          `inspector-${width}-${height}-${scale}x-long-name.png`)});
      }
      assert.equal(writes, 0, "tab switching makes no decisions");
      await page.getByRole("tab", {name:"Overview", exact:true}).click();
      assert.equal(await page.locator("#reading-details").getAttribute("open"), "", "Reading details remains expanded across tabs");
      for (const state of ["RUNNING", "PAUSE", "FAILED", "IDLE", "FINISH", "UNKNOWN"]) {
        Object.assign(printer, {state, online:true, fresh:true, progress:0, remaining:0,
          print_summary: state === "FINISH" ? "Print finished" : state === "PAUSE" ? "Print paused · reason not reported" : state === "FAILED" ? "Print stopped · reason not reported" : "",
          print_guidance: "",
          remaining_reported:new Date().toISOString(), eta_current:true});
        await page.evaluate(() => poll());
        assert.match(await page.locator(".progress-ring").getAttribute("aria-label"), /Reported progress: 0 percent/);
        assert.equal(await page.locator(".job-facts").textContent().then(t => t.includes("No running finish estimate")), state !== "RUNNING");
      }
      Object.assign(printer, {state:"RUNNING", eta_current:false});
      await page.evaluate(() => poll());
      assert.match(await page.locator(".job-facts").textContent(), /Last-known finish estimate/);
      // Missing extruder.state yields two false flags; neither proves inactivity.
      printer.nozzles = [
        {id:0, active:false, temperature:{current:210, target:220}},
        {id:1, active:false, temperature:{current:180, target:190}}
      ];
      await page.getByRole("tab", {name:"Overview", exact:true}).focus();
      await body.evaluate(el => { el.scrollTop = 100; });
      const nozzleScroll = await body.evaluate(el => el.scrollTop);
      await page.evaluate(() => poll());
      assert.equal(await page.locator(".nozzle-activity").count(), 0);
      assert.doesNotMatch(await body.textContent(), /Reported inactive/);
      assert.match(await page.locator(".temperature-grid").textContent(), /210.*180/s);
      assert.equal(await body.evaluate(el => el.scrollTop), nozzleScroll);
      assert.equal(await page.getByRole("tab", {name:"Overview", exact:true}).evaluate(el => el === document.activeElement), true);
      printer.nozzles[1].active = true;
      await page.evaluate(() => poll());
      assert.equal(await page.locator(".nozzle-activity").textContent(), "Reported active");
      assert.equal(await page.locator(".active-nozzle").count(), 1);
      Object.assign(printer, {fresh:false, connection:"Stale", progress:null, nozzles:[], bed:{}, chamber:{}});
      await page.evaluate(() => poll());
      assert.match(await body.textContent(), /Current state is unconfirmed/);
      assert.match(await page.locator(".progress-ring").getAttribute("aria-label"), /Unknown/);
      await page.evaluate(() => {feedError = true; renderDetail();});
      assert.match(await body.textContent(), /Monitor unavailable/);
      await page.evaluate(() => poll());
      await page.getByRole("tab", {name:"Overview", exact:true}).focus();
      await page.keyboard.press("ArrowLeft");
      assert.equal(await page.getByRole("tab", {selected:true}).textContent(), "Notices");
      await page.keyboard.press("Home");
      await page.keyboard.press("ArrowRight");
      assert.equal(await page.getByRole("tab", {selected:true}).textContent(), "Filament");
      await page.keyboard.press("End");
      await page.keyboard.press("Tab");
      assert.equal(await body.evaluate(el => el === document.activeElement), true);
      await page.locator('[data-dismiss="notice-0"]').click();
      await page.waitForFunction(() => document.querySelector("#detail-body").textContent.includes("Applied locally"));
      await page.evaluate(() => poll());
      assert.equal(await page.getByRole("tab", {selected:true}).textContent(), "Notices");
      assert.equal(await page.locator("#close-detail").evaluate(el => el === document.activeElement), true);
      await page.locator("#toggle-hidden-messages").click();
      assert.match(await body.textContent(), /Hidden locally/);
      assert.equal(await page.locator('[data-dismiss="notice-0"][data-retry="true"]').count(), 1);
      await page.getByRole("tab", {name:"Filament", exact:true}).click();
      await page.getByRole("tab", {name:"Notices", exact:true}).click();
      assert.match(await body.textContent(), /Hidden locally/);
      for (const c of printer.conditions) c.hidden = true;
      await page.locator("#toggle-hidden-messages").click();
      await page.evaluate(() => poll());
      assert.match(await body.textContent(), /All reported messages are hidden locally/);
      printer.conditions = [];
      await page.evaluate(() => poll());
      assert.match(await body.textContent(), /No active notices in this snapshot/);
      Object.assign(printer, {fresh:false, online:false, connection:"Offline", ams:[], external:[]});
      await page.evaluate(() => poll());
      await page.getByRole("tab", {name:"Filament", exact:true}).click();
      assert.match(await body.textContent(), /Inventory unavailable · reported offline/);
      await page.getByRole("tab", {name:"Overview", exact:true}).click();
      assert.match(await body.textContent(), /Reported offline/);
      await page.keyboard.press("Escape");
      assert.equal(await card.evaluate(el => el === document.activeElement), true);
      await page.keyboard.press("Enter");
      assert.equal(await page.getByRole("tab", {selected:true}).textContent(), "Overview");
      assert.equal(await body.evaluate(el => el.scrollTop), 0);
      await page.keyboard.press("Escape");
      await page.locator("#review").click();
      assert.equal(await page.getByRole("tab", {selected:true}).textContent(), "Notices");
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`PASS inspector ${width}x${height} ${scale * 100}% text`);
    }
    console.log(`Browser: ${await browser.version()}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
