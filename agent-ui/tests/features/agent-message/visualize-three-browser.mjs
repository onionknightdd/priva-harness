import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright")
const url = process.env.TEST_URL ?? "http://127.0.0.1:5174/tests/features/agent-message/visualize-three-browser.html?auto"
assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname))
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ["--enable-unsafe-swiftshader"] })
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
const errors = []
page.on("pageerror", (error) => errors.push(String(error)))
try {
  await page.goto(url)
  await page.waitForFunction(() => /PASS|FAIL/.test(document.querySelector("#results").textContent), {}, { timeout: 30000 })
  const result = await page.locator("#results").innerText()
  assert.match(result, /^PASS/)
  assert.deepEqual(errors, [])
  console.log(result)
} finally { await browser.close() }
