import assert from "node:assert/strict"
import { test } from "node:test"

import { dashboardImageUrl } from "../../../src/features/agent-message/a2ui/image-source"

test("resolves absolute sandbox image references through the existing file API", () => {
  const resolved = new URL(dashboardImageUrl("sandbox:/workspace/images/销售%20报告.png"), "https://app.example")
  assert.equal(resolved.pathname, "/api/sandbox/files/download")
  assert.equal(resolved.searchParams.get("path"), "/workspace/images/销售 报告.png")
  assert.equal(new URL(dashboardImageUrl("sandbox:C:/reports/chart.png"), "https://app.example").searchParams.get("path"), "C:/reports/chart.png")
})

test("keeps HTTP(S) image sources and their signed query parameters intact", () => {
  const source = "https://images.example/chart.png?signature=a%2Bb&version=2#preview"
  assert.equal(dashboardImageUrl(source), source)
  assert.equal(dashboardImageUrl("http://localhost:8080/chart.png"), "http://localhost:8080/chart.png")
})

test("rejects ambiguous paths and unsupported image schemes before any request", () => {
  for (const source of ["", "chart.png", "/workspace/chart.png", "//host/image.png", "file:///workspace/chart.png", "data:image/png;base64,AAA", "blob:https://app.example/id", "javascript:alert(1)", "https:example.com/chart.png", "https://", " https://example.com/chart.png", "https://example.com/\nchart.png", "sandbox://host/chart.png", "sandbox:relative.png", "sandbox:/bad%ZZ.png", "sandbox:%2F%2Fhost/chart.png", "sandbox:/bad%00.png"]) {
    assert.throws(() => dashboardImageUrl(source), /HTTP\(S\).*sandbox:/, source)
  }
})
