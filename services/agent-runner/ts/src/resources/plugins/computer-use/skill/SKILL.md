---
name: registered-computers
description: Discover registered desktop devices, check their availability, and use the desktop tools installed for the current Runner session.
---

# Computer Use

When the Runner exposes `registered_computers`, use it to list registered devices. Use the device the user selected. `device_status` reports the tray state. For the Calculator integration check, invoke `calculator_check` and inspect its expression and result. If the device disconnects while processing a request, report the outcome as unknown.

When the local runtime is configured, use `cua_repl.js` for the Runner's own desktop. Start with `cua.getApp(...)` or the platform-specific inventory call described by the tool. Read the returned instructions and current application state before sending input. Application bindings persist across calls. Request fresh state after acting and verify the result from the application. Use the runtime's completion summary at the end of the UI task.

`node_repl` runs JavaScript in the Runner workspace. Window and element identifiers belong to the desktop session that produced them. For deployments with the Xfce driver, the `computer` tools target the desktop visible in the Computer tab.
