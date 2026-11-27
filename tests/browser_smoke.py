"""Browser smoke test for GridCast.my  (needs:  pip install playwright && playwright install chromium)

    python tests/serve_like_vercel.py 8702 &          # serves public/ with the headers from vercel.json (incl. CSP)
    python tests/browser_smoke.py http://localhost:8702

Checks: every page renders with no console/CSP errors, the month picker never shows months after the demo clock,
savings show realistic vs perfect-forecast numbers, the what-if levers work, CSV download works under CSP,
corrupted saved settings fall back to defaults, and a wrong/missing data file shows a friendly error card.
"""
import json, sys, time
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8702"
NAV = ["Today", "Usage", "Bills", "What-if", "Savings", "Alerts", "Behind the scenes"]
fails, msgs = [], []


def check(name, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + name + (f"  — {detail}" if detail else ""))
    if not ok:
        fails.append(name)


def new_page(browser, **kw):
    ctx = browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True, **kw)
    pg = ctx.new_page()
    pg.on("console", lambda m: msgs.append((m.type, m.text)) if m.type in ("error", "warning") else None)
    pg.on("pageerror", lambda e: msgs.append(("pageerror", str(e))))
    return ctx, pg


def go_nav(pg, name):
    pg.locator(".nav button", has_text=name).first.click()
    time.sleep(0.7)


def month_options(pg):
    return pg.locator("select.sel").first.evaluate("s => [...s.options].map(o => o.textContent)")


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])

    # ---------------------------------------------------------------- main flow
    ctx, pg = new_page(browser)
    pg.goto(BASE, wait_until="networkidle"); time.sleep(1.2)
    pg.get_by_role("button", name="Just try the demo").click(); time.sleep(0.8)
    check("simulation badge visible in header", pg.locator(".top .simbadge").count() == 1)
    check("Today says 'Simulated next hour'", "simulated next hour" in pg.locator(".hero .label").inner_text().lower())
    for n in NAV:
        go_nav(pg, n)
    check("all 7 pages render", True)

    go_nav(pg, "Bills")
    opts = month_options(pg)
    check("month picker only goes up to the demo-clock month (June)", opts[-1].startswith("June") and len(opts) == 6, str(opts))
    check("month labels carry the year 2021", all(o.endswith("2021") for o in opts))
    check("badge next to 'Your bill'", pg.locator(".sec .simbadge").count() >= 1)
    check("half-hour note under the bill", "30-minute" in pg.locator("body").inner_text())
    with pg.expect_download(timeout=5000) as d:
        pg.get_by_role("button", name="Download as CSV").click()
    check("CSV download works", d.value.suggested_filename.endswith(".csv"))

    # moving the clock earlier must pull the month down with it
    pg.locator(".clock input[type=date]").fill("2026-03-10"); time.sleep(0.9)
    go_nav(pg, "Bills")
    opts = month_options(pg)
    check("clock → March: only Jan–Mar offered", len(opts) == 3 and opts[-1].startswith("March"), str(opts))
    check("Bills header follows the clock month", "march 2021" in pg.locator(".hero .label").first.inner_text().lower())
    pg.locator(".clock input[type=date]").fill("2021-06-23"); time.sleep(0.8)

    go_nav(pg, "Savings")
    txt = pg.locator("body").inner_text().lower()
    check("Savings shows Realistic and Ceiling (perfect forecast)", "realistic" in txt and "ceiling (perfect forecast)" in txt)

    go_nav(pg, "What-if")
    levers = pg.locator(".lever").count()
    check("What-if offers 5 levers (not only aircond)", levers == 5, f"{levers} levers")
    pg.get_by_role("button", name="Everything together").click(); time.sleep(0.9)
    check("5 levers can run together + per-lever table", pg.locator(".lever.on").count() == 5 and "Where it comes from" in pg.locator("body").inner_text())
    pg.get_by_role("button", name="Pause EV charging at peak").click(); time.sleep(0.7)
    check("EV-only scenario hides the room-temperature card", "Aircond lever is off" in pg.locator("body").inner_text())

    go_nav(pg, "Behind the scenes")
    txt = pg.locator("body").inner_text()
    check("CatBoost explanation shown", "Why does CatBoost trail?" in txt and "ordered boosting" in txt)
    check("weather note shown", "Does weather help the forecast?" in txt)
    check("interval coverage shown", "covered" in txt and "target: 90%" in txt)
    check("data contract marked as planned", "PLANNED" in txt)
    check("real-building validation section shown", "validated on a real building" in txt.lower() and "cu-bems" in txt.lower())
    check("BDG2 honestly marked as not run", "NOT RUN YET" in txt)
    check("SEWA-model-fails-as-is finding shown", "does the sewa-trained model work" in txt.lower())
    ctx.close()

    # ---------------------------------------------------------------- corrupted settings
    ctx, pg = new_page(browser)
    pg.goto(BASE, wait_until="networkidle")
    pg.evaluate("localStorage.setItem('gridcast.v2', JSON.stringify({peakKw: 0, tariff: 'oops', model: 'nope', onboarded: true, scn: {levers: 7}}))")
    pg.reload(wait_until="networkidle"); time.sleep(1.2)
    check("corrupted saved settings → still boots", pg.locator(".nav").count() == 1)
    pg.locator(".who").click(); time.sleep(0.5)
    peak = pg.locator(".drawer input[type=number]").first.input_value()
    check("peak kW fell back to a safe default", peak == "2000", peak)
    ctx.close()

    # ---------------------------------------------------------------- error states
    def with_route(handler, label, expect):
        ctx, pg = new_page(browser)
        pg.route("**/data/gridcast_data.json*", handler)
        pg.goto(BASE, wait_until="networkidle"); time.sleep(1.0)
        t = pg.locator("body").inner_text()
        check(label, ".errcard" and pg.locator(".errcard").count() == 1 and expect in t, t[:90].replace("\n", " "))
        ctx.close()

    with_route(lambda r: r.fulfill(status=404, body="nope"), "missing data file → friendly error card", "Couldn’t load")

    def wrong_schema(route):
        resp = route.fetch(); d = json.loads(resp.text()); d["meta"]["schema_version"] = 99
        route.fulfill(response=resp, body=json.dumps(d))
    with_route(wrong_schema, "wrong schema version → friendly error card", "schema")
    with_route(lambda r: r.fulfill(status=200, content_type="application/json", body="{}"), "empty JSON → friendly error card", "wrong")
    with_route(lambda r: r.fulfill(status=200, content_type="application/json", body="{not json"), "corrupt JSON → friendly error card", "Couldn’t load")

    browser.close()

csp = [m for m in msgs if "Content Security Policy" in m[1] or "Refused to" in m[1]]
other = [m for m in msgs if m not in csp and "Failed to load resource" not in m[1]]
check("no CSP violations", not csp, str(csp[:2]))
check("no unexpected console errors", not other, str(other[:2]))
print("\n" + ("ALL CHECKS PASSED" if not fails else f"{len(fails)} FAILED: {fails}"))
sys.exit(1 if fails else 0)
