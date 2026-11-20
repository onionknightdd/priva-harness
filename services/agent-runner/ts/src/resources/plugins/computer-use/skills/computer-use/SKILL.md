---
name: computer-use
description: Read and operate desktop applications on the computer this session runs on, through the cua_repl tool. Use it when a task needs a real application window and no dedicated tool, API or command line covers it.
---

# Computer Use

`cua_repl` controls the desktop of the computer running this session. In a hosted workspace that is the workspace's own desktop, the one shown in its Computer view. On a personal computer it is the user's own desktop and applications.

Prefer a dedicated tool, API or command line when one can do the task. Use Computer Use for work that only exists in an application's interface.

## Start

The first `cua_repl.js` call in a session, and the first after `js_reset`, runs exactly one entry call and nothing else. The inventory works on every platform:

```javascript
await cua.getState();
```

Its result contains the API documentation for this platform together with the applications and windows that exist. Read it before acting, and use only the APIs it describes. How an application is selected depends on the platform:

- macOS: by display name, bundle identifier or path, and this may be the entry call itself: `let app = await cua.getApp("Calculator");`
- Linux: by a window id from the inventory: `let app = await cua.getApp({ windowId: 44040195 });`. A name is rejected there, so list first and start the application if it has no window yet.

Bindings such as `app` persist across later `cua_repl.js` calls. `js_reset` discards them without closing any application.

## No approval prompt

Applications are used without asking the user first, including on a personal computer. Nothing stops you from opening an application the task did not call for, so the limits in this skill and the confirmation policy the tool returns are yours to keep. When a call fails because the computer does not allow an application to be used, tell the user and stop; do not retry the same application or reach it another way.

## Target

Act only on the application the task names or clearly requires. Identifiers for windows and interface elements belong to the state that returned them, so request fresh state after an action before choosing the next element.

## Verify the result

Sending input is not evidence that it worked. After acting, read the application's state again and confirm the outcome from what the application shows: the value in the field, the row in the list, the title of the saved document. Report what you observed. If the state does not show the expected result, say so instead of assuming success.

## Related tool

`node_repl` runs JavaScript in the session workspace with its own persistent bindings. It does not control the desktop.
