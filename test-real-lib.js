// Same checks as test-group-app.js, but loading the REAL supabase-js
// library (not a stand-in) — this is what actually caught the original
// "const supabase" naming collision bug, since a hand-written stand-in
// injected via addInitScript can never reproduce a var/const global
// redeclaration collision (see the naming-collision section of CLAUDE.md).
// Any future change to how this app creates or names its Supabase client
// should be re-checked with this test, not just the fast stand-in suite.
//
// This needs a bit of one-time setup, because the real supabase-js CDN
// (jsdelivr.net) isn't reachable from every sandbox, and this test
// deliberately avoids relying on it:
//
//   mkdir -p /tmp/reallib-test/site
//   cd /tmp/reallib-test && npm install @supabase/supabase-js@2
//   cp node_modules/@supabase/supabase-js/dist/umd/supabase.js site/
//   cp group-app/{index.html,app.js,parser.js,style.css} site/
//   # then edit site/index.html:
//   #   - point the supabase-js <script src> at "supabase.js" (the local copy)
//   #   - remove the pdf.js <script> tag (not needed for this test)
//   #   - replace the config.js <script> with inline fake SUPABASE_URL /
//   #     SUPABASE_ANON_KEY values (e.g. "https://fake-project.supabase.co")
//   cd site && python3 -m http.server 8768
//
// Then, from another terminal: node test-real-lib.js
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page = await browser.newPage();

  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // A blocked Google Fonts request is a sandbox network quirk, not an
    // app bug — everything else counts.
    if (/fonts\.googleapis\.com|ERR_TUNNEL_CONNECTION_FAILED/i.test(text)) return;
    pageErrors.push(text);
  });

  await page.route("https://fake-project.supabase.co/**", (route) => {
    const url = route.request().url();
    if (url.includes("/auth/v1/otp")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.goto("http://localhost:8768/index.html");
  await page.waitForTimeout(500);

  const check = async (label, fn) => {
    const ok = await fn();
    console.log((ok ? "PASS" : "FAIL") + " — " + label);
    return ok;
  };

  await check("no JavaScript errors on load (this is what the naming bug broke)", async () =>
    pageErrors.length === 0 || (console.log("  errors seen:", pageErrors), false));

  await check("starts on the sign-in screen", async () =>
    !(await page.locator("#screen-signin").isHidden()));

  await page.fill("#emailInput", "andy@example.com");

  const otpRequest = page.waitForRequest((req) => req.url().includes("/auth/v1/otp"), { timeout: 3000 }).catch(() => null);
  await page.click("#sendLinkBtn");
  const gotRequest = await otpRequest;

  await check("clicking the button actually sends a request to Supabase", async () => !!gotRequest);

  await page.waitForTimeout(300);
  await check('moves to "check your email" after a successful send', async () =>
    !(await page.locator("#screen-check-email").isHidden()));

  if (pageErrors.length) {
    console.log("\nJS errors encountered:");
    pageErrors.forEach((e) => console.log(" -", e));
  }

  await browser.close();
})();
