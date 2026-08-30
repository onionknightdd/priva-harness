import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  captureExpandTrigger,
  isExpandScrollLocked,
  keepExpandTriggerInPlace,
  releaseThreadFollow,
  resetExpandAnchor,
} from "../../../src/features/agent-message/expand-down-anchor.ts"

describe("expand-down-anchor", () => {
  it("scrolls the viewport so an expanded trigger stays at the same screen position", () => {
    resetExpandAnchor()
    const trigger = {
      isConnected: true,
      top: 180,
      closest(selector: string) {
        return selector === "[aria-expanded]" ? this : null
      },
      getBoundingClientRect() {
        return { top: this.top }
      },
    }
    const viewport = { scrollTop: 640 }

    captureExpandTrigger(trigger as unknown as EventTarget)
    assert.equal(isExpandScrollLocked(), true)

    trigger.top = 96
    keepExpandTriggerInPlace(viewport as HTMLElement)

    assert.equal(viewport.scrollTop, 556)
  })

  it("ignores clicks that are not expand triggers", () => {
    resetExpandAnchor()
    captureExpandTrigger(null)
    assert.equal(isExpandScrollLocked(), false)
  })

  it("releases stick-to-bottom follow with a wheel event", () => {
    const types: string[] = []
    const viewport = {
      dispatchEvent(event: Event) {
        types.push(event.type)
        return true
      },
    }

    releaseThreadFollow(viewport as HTMLElement)

    assert.deepEqual(types, ["wheel"])
  })
})
