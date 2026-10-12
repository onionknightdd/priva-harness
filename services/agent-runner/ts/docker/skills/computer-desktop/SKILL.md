---
name: computer-desktop
description: Operate the shared Debian Xfce desktop, browser, and graphical applications through the computer MCP server. Use for tasks that require seeing or interacting with this desktop.
---

# Desktop access

The `computer` MCP server controls the same Linux desktop shown in Agent UI's
Computer workspace. It does not control the person's Mac or their physical desktop.

```text
Claude / Pi -> computer MCP -> Xfce :99 <- noVNC <- Agent UI
```

Discover the server's available tools and their schemas before using them. In Pi,
the `mcp` tool can discover and call the server's tools. Observe the desktop or
target window before acting; use fresh screenshots and accessibility state to
check the result and refresh element handles when the interface changes.

Screenshot interpretation requires a model with image input. With a text-only
model, use `get_window_state(include_screenshot: false)` for accessibility state;
`get_desktop_state(screenshot_out_file: <workspace path>)` can save a PNG without
returning image content. Saving a PNG does not mean you have seen it. If a task
requires visual judgment unavailable from the tree, use an image-capable model.

This Xvfb session cannot provide Cua's background virtual input devices. Use
`delivery_mode: "foreground"` where supported or `scope: "desktop"`, and focus
the intended application first. A `background_unavailable` result does not mean
that the foreground action ran.

Cua Driver 0.34.1 can truncate non-ASCII text on the targeted AT-SPI path.
For Chinese or other non-ASCII input, first focus the field, then call `type_text`
without `element_token`. Setting foreground delivery while retaining
`element_token` does not avoid the affected path. Verify the inserted text from
the application or saved output before reporting success.

The desktop is shared. This deployment currently provides no automatic
Agent/human input lock or pause-and-resume mechanism. If the user asks to take
over, stop desktop tool calls until they return control, then observe again
before continuing. Do not claim that opening the Computer view pauses an agent
or that another chat is excluded from the desktop.
