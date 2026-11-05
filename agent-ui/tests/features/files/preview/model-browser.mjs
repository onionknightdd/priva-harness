import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import { writeFile } from "node:fs/promises"
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright")
const url = process.env.TEST_URL ?? "http://127.0.0.1:5176/tests/features/files/preview/model-browser.html"
assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname))
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ["--enable-unsafe-swiftshader"] })
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, reducedMotion: process.env.REDUCED_MOTION === "1" ? "reduce" : "no-preference" })
const errors = []
page.on("pageerror", (error) => errors.push(String(error)))
const checks = []
const state = () => page.evaluate(() => window.modelFixture)
function check(name, value) { assert.ok(value, name); checks.push(name); console.log("PASS " + name) }
const ready = () => page.locator('[data-model-status="ready"]').waitFor({ timeout: 30000 })
try {
  await page.goto(url)
  await ready()
  await page.waitForFunction(() => window.modelFixture.frames > 0)
  check("model extensions select the 3D renderer without a source tab", await page.locator("canvas").count() === 1)
  const initial = await state()
  check("model rendered with real WebGL", initial.frames > 0)
  await page.waitForTimeout(500)
  const settled = (await state()).frames
  await page.waitForTimeout(500)
  check("static viewport renders on demand", (await state()).frames === settled)
  const canvas = page.locator("canvas")
  if (new URL(url).searchParams.has("colored")) {
    const suffix = new URL(url).searchParams.has("dark") ? "-dark" : ""
    const screenshot = await canvas.screenshot({ path: `/tmp/colored-stl-canvas${suffix}.png` })
    const pixels = await page.evaluate(async (base64) => {
      const image = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))], { type: "image/png" }))
      const surface = document.createElement("canvas")
      surface.width = image.width; surface.height = image.height
      const context = surface.getContext("2d")
      context.drawImage(image, 0, 0)
      image.close()
      const data = context.getImageData(0, 0, surface.width, surface.height).data
      const counts = { red: 0, green: 0, blue: 0 }
      for (let i = 0; i < data.length; i += 4) {
        const [red, green, blue] = [data[i], data[i + 1], data[i + 2]]
        // PBR lighting adds white reflections, so detect hue dominance rather than pure RGB.
        if (red > Math.max(green, blue) + 24) counts.red++
        if (green > Math.max(red, blue) + 24) counts.green++
        if (blue > Math.max(red, green) + 24) counts.blue++
      }
      return counts
    }, screenshot.toString("base64"))
    check(`colored STL renders red, green and blue faces (${JSON.stringify(pixels)})`, Object.values(pixels).every((count) => count > 500))
    await page.screenshot({ path: `/tmp/colored-stl-preview${suffix}.png` })
  }
  let bounds = await canvas.boundingBox()
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.getByRole("button", { name: "Add to chat", exact: true }).click()
  const selected = (await state()).annotations[0]?.annotation
  check("selection includes source coordinates, dependency revision and camera", selected?.kind === "model" && selected.fileRevision.length === 64 && selected.selection.anchors.length === 1 && selected.view.camera.position.length === 3)
  bounds = await canvas.boundingBox()
  await page.mouse.move(bounds.x + bounds.width * 0.4, bounds.y + bounds.height * 0.7)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.7, { steps: 8 })
  await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.2, { steps: 12 })
  await page.mouse.up()
  await page.getByRole("button", { name: "Add to chat", exact: true }).click()
  const rotated = (await state()).annotations.at(-1).annotation
  check("dragging freely changes camera up and preserves the selected source point", Math.hypot(...rotated.view.camera.up.map((value, i) => value - selected.view.camera.up[i])) > 0.1 && JSON.stringify(rotated.selection.anchors) === JSON.stringify(selected.selection.anchors))
  await page.getByRole("application").press("Home")
  await page.getByRole("button", { name: "Add to chat", exact: true }).click()
  check("Home restores the model's standard up direction after free rotation", (await state()).annotations.at(-1).annotation.view.camera.up.every((value, i) => Math.abs(value - selected.view.camera.up[i]) < 1e-8))
  await page.getByRole("button", { name: "Distance", exact: true }).click()
  bounds = await canvas.boundingBox()
  await page.mouse.click(bounds.x + bounds.width * 0.46, bounds.y + bounds.height * 0.48)
  await page.mouse.click(bounds.x + bounds.width * 0.54, bounds.y + bounds.height * 0.52)
  await page.locator("output").waitFor()
  check("distance uses explicit unknown units", (await page.locator("output").textContent()).includes("model units"))
  await page.getByRole("button", { name: "Section", exact: true }).click()
  await page.getByRole("switch").click()
  check("section control is enabled", await page.getByRole("switch").getAttribute("aria-checked") === "true")
  await page.getByRole("button", { name: "Close settings", exact: true }).click()
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "Save screenshot", exact: true }).click()
  check("screenshot produces a PNG", (await download).suggestedFilename().endsWith(".png"))
  await page.getByRole("button", { name: "Hide preview", exact: true }).click()
  await page.waitForTimeout(200)
  const hidden = await state()
  await page.waitForTimeout(500)
  check("hidden retained viewport stops rendering", (await state()).frames === hidden.frames)
  await page.getByRole("button", { name: "Show preview", exact: true }).click()
  await ready()
  check("visibility changes preserve loaded resources", (await state()).requests === initial.requests)
  await page.getByRole("button", { name: "Refresh", exact: true }).click()
  await page.waitForFunction((count) => window.modelFixture.requests > count, initial.requests)
  await ready()
  check("explicit refresh reloads model resources", (await state()).requests > initial.requests)
  const requestsBeforeRace = (await state()).requests
  await page.evaluate(() => { window.modelFixture.delayNextAssetMs = 300 })
  await page.getByRole("button", { name: "Refresh", exact: true }).click()
  await page.waitForFunction((count) => window.modelFixture.requests > count, requestsBeforeRace)
  await page.getByRole("button", { name: "Refresh", exact: true }).click()
  await ready()
  await page.waitForTimeout(400)
  bounds = await canvas.boundingBox()
  await page.getByRole("button", { name: "Select", exact: true }).click()
  bounds = await canvas.boundingBox()
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  check("late cancellation cannot clear the replacement scene", await page.getByRole("button", { name: "Add to chat", exact: true }).isEnabled())
  await page.getByRole("button", { name: "Close settings", exact: true }).click()
  await page.screenshot({ path: "/tmp/model-preview-desktop.png" })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("button", { name: "Tools", exact: true }).click()
  await page.getByRole("menuitem", { name: "Distance", exact: true }).click()
  check("narrow viewport uses compact toolbar and bottom settings", await page.getByRole("complementary", { name: "Distance", exact: true }).isVisible())
  check("narrow viewport has no horizontal overflow", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: "/tmp/model-preview-mobile.png" })
  await page.getByRole("button", { name: "Unmount", exact: true }).click()
  check("unmount releases the canvas", await page.locator("canvas").count() === 0)
  check("no runtime exceptions", errors.length === 0 && (await state()).errors.length === 0)
  await writeFile("/tmp/model-preview-browser-results.json", JSON.stringify({ checks, errors }, null, 2))
} catch (error) {
  console.error(await page.locator("body").innerText())
  await page.screenshot({ path: "/tmp/model-preview-failure.png" })
  throw error
} finally { await browser.close() }
