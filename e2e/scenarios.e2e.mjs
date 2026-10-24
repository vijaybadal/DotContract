/**
 * Browser end-to-end test: drives the real UI through the Phase 1 thin slice.
 *
 *   Create request (wizard) → Submit → Department → Purchasing / Finance / Security (parallel)
 *   → Legal review and clearance → Final approval → Authority check → Signature (mock provider)
 *   → Active contract → Renewal tracking
 *
 * Also exercises Scenario 2's guardrail: a signatory without authority is blocked in the UI.
 *
 * Requirements: a freshly seeded database (npm run db:reset), the app running at E2E_BASE_URL
 * (default http://localhost:3000) with AUTH_MODE=dev, and CHROME_PATH pointing at Chrome/Chromium.
 *   CHROME_PATH=/usr/bin/chromium npm run e2e
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import JSZip from "jszip";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const OUT = process.env.E2E_OUT ?? "e2e/artifacts";
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: (process.env.CHROME_ARGS ?? "--no-sandbox --disable-dev-shm-usage --headless=new").split(" "),
  defaultViewport: { width: 1360, height: 900 },
});
const page = await browser.newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

let step = 0;
const log = (m) => console.log(`  ✓ ${m}`);
const trace = (m) => process.env.E2E_TRACE && console.log(`    · ${m}`);
const shot = (name) => page.screenshot({ path: path.join(OUT, `${String(++step).padStart(2, "0")}-${name}.png`), fullPage: true });
const xField = (label) => `::-p-xpath(//label[contains(@class,'field')][span[starts-with(normalize-space(.),"${label}")]]//*[self::input or self::select or self::textarea])`;
const button = (text) => `::-p-xpath(//button[normalize-space(.)="${text}"])`;
async function expectText(text, timeout = 15000) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text).catch(async () => {
    await shot("FAILED");
    throw new Error(`Expected to see "${text}" on ${page.url()}`);
  });
}
async function signInAs(name) {
  await page.deleteCookie({ name: "clm_session", url: BASE });
  await page.goto(`${BASE}/login`);
  if (process.env.E2E_ACCESS_CODE && (await page.$('input[name="code"]'))) {
    await page.locator('input[name="code"]').fill(process.env.E2E_ACCESS_CODE);
    await page.locator(button("Continue")).click();
    await page.waitForSelector("::-p-xpath(//h1[normalize-space(.)='DOTComm Contracts'])");
    await page.waitForFunction(() => !document.querySelector('input[name="code"]'));
  }
  await page.locator(`::-p-xpath(//button[.//span[normalize-space(.)="${name}"]])`).click();
  await page.waitForFunction(() => location.pathname === "/");
}
async function retry(fn) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= 4 || !/detached|not attached|Cannot find context/i.test(String(e.message))) throw e;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}
async function select(label, optionText) {
  return retry(() => selectOnce(label, optionText));
}
async function selectOnce(label, optionText) {
  const handle = await page.waitForSelector(xField(label));
  const value = await handle.evaluate((el, t) => [...el.options].find((o) => o.text.startsWith(t))?.value, optionText);
  if (value == null) throw new Error(`No option "${optionText}" in ${label}`);
  await handle.select(value);
}
async function type(label, text) {
  await retry(() => page.locator(xField(label)).fill(text));
}
async function makeDocx(title, paragraphs) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${[title, ...paragraphs].map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);
  const file = path.resolve(OUT, `${title.replace(/\W+/g, "-")}.docx`);
  writeFileSync(file, await zip.generateAsync({ type: "nodebuffer" }));
  return file;
}
async function approveFirstTask(user) {
  await signInAs(user);
  await page.goto(`${BASE}/tasks`);
  await expectText("Data warehouse observability");
  const card = `::-p-xpath(//article[.//a[normalize-space(.)="Data warehouse observability"]])`;
  await page.$eval(card, (el) => el.scrollIntoView());
  await (await page.$(`${card.slice(0, -1)}//button[normalize-space(.)="Approve"])`)).click();
  await expectText("Approved. The next step has been notified.");
  log(`${user} approved`);
}

const iso = (d) => d.toISOString().slice(0, 10);
const start = new Date(Date.now() + 20 * 86400000);
const end = new Date(start.getTime() + 3 * 365 * 86400000);

try {
  console.log("Scenario 1 — new software contract through the UI");
  await signInAs("Priya Natarajan");
  log("demo sign-in");

  await page.goto(`${BASE}/requests/new`);
  await select("Contract category", "SaaS");
  await type("Short title", "Data warehouse observability");
  await select("Vendor", "Granite Help Desk Software");
  await type("Business purpose", "Monitor data pipeline freshness and quality for the data foundation program.");
  await page.locator(button("Save and continue")).click();
  await expectText("Draft saved as REQ-");
  await expectText("Benefiting agencies"); // continued to the Parties step after the first save
  log("draft saved from step 1");
  await page.locator(button("Save and continue")).click(); // parties: defaults
  await expectText("Estimated total value");
  await type("Estimated total value", "150000");
  await type("Annual value", "50000");
  await type("Funding source", "DOTComm operating budget");
  const setDate = (label, v) => retry(() => page.$eval(xField(label), (el, val) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; s.call(el, val); el.dispatchEvent(new Event("input", { bubbles: true })); }, v));
  await setDate("Expected start", iso(start));
  await setDate("Expected end", iso(end));
  await type("Non-renewal notice period", "60");
  await page.locator(button("Save and continue")).click();
  await expectText("Most sensitive data");
  await select("Most sensitive data", "Confidential");
  await page.locator(button("Save and continue")).click();
  await expectText("Attach the vendor agreement");
  const file = await makeDocx("Observability Subscription Agreement", ["1. Term. Three years.", "2. Fees. Annual in advance.", "3. Data. Customer owns its data."]);
  await (await page.$('input[type="file"]')).uploadFile(file);
  await page.locator(button("Upload")).click();
  await expectText("Uploaded as version 1. Malware scan passed.");
  log("agreement uploaded and scanned");
  await shot("wizard-ready");
  await page.locator(button("Submit for approval")).click();
  await expectText("Submitted for approval");
  log("submitted; workflow started");
  const requestUrl = page.url();

  for (const u of ["Marcus Hale", "Raymond Ortiz", "Grace Mbeki", "Aisha Rahman"]) await approveFirstTask(u);

  console.log("Legal review");
  await signInAs("Jonathan Pryce");
  await page.goto(`${BASE}/legal`);
  await page.locator(`::-p-xpath(//a[normalize-space(.)="Data warehouse observability"])`).click();
  await expectText("Legal comment");
  await page.locator(button("Start review")).click();
  await expectText("Review started.");
  await type("Legal comment", "Cleared on standard data-ownership terms.");
  await page.locator(button("Clear agreement")).click();
  await expectText("Cleared by Legal. Approval continues.");
  log("Legal cleared the exact agreement version");

  await approveFirstTask("Elaine Cho");

  console.log("Signature");
  await signInAs("Dana Whitfield");
  await page.goto(requestUrl);
  await page.locator(`::-p-xpath(//a[normalize-space(.)="Open contract record" or normalize-space(.)="contract record"])`).click();
  await page.waitForFunction(() => location.pathname.startsWith("/contracts/"));
  const contractUrl = page.url().split("?")[0];
  await page.goto(`${contractUrl}?tab=signature`);
  await expectText("Prepare the signature package");

  // Guardrail: the contract administrator is not a signatory
  await select("Agency signatory", "Dana Whitfield");
  await page.locator(button("Verify authority and send for signature")).click();
  await expectText("Signing is blocked");
  log("signing blocked for a user without authority");
  await shot("authority-blocked");

  await select("Agency signatory", "Elaine Cho");
  await page.locator(button("Verify authority and send for signature")).click();
  await expectText("Signature request sent.");
  await page.locator(button("Simulate next signature (demo)")).click();
  await expectText("Waiting on the next signer.");
  await page.locator(button("Simulate next signature (demo)")).click();
  await expectText("Contract is now active.");
  log("signed in order (vendor, then agency)");
  await page.goto(contractUrl);
  await expectText("Demo execution — this agreement has not been legally executed");
  await page.goto(`${contractUrl}?tab=renewals`);
  await expectText("Decide by");
  log("active; renewal tracking started");
  await shot("active-renewals");

  console.log("Read-only auditor");
  await signInAs("Owen Fitch");
  await page.goto(`${contractUrl}?tab=audit`);
  await expectText("Contract demo executed");
  await expectText("Signing authority blocked");
  log("audit history shows the blocked and successful authority checks");

  if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);
  console.log("\nAll browser scenarios passed.");
} catch (e) {
  console.error("\nE2E FAILED:", e.message);
  await shot("FAILED").catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
