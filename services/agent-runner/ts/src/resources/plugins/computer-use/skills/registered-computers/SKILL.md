---
name: registered-computers
description: Operate applications on a registered remote computer, such as the user's own Mac, through the registered_computers tools. Use it when the task names another computer or needs an application that only exists there.
---

# Registered computers

`registered_computers` reaches the desktop of computers their owners connected to this workspace. They are separate from the desktop this session runs on, which `cua_repl` controls. Read the `computer-use` skill first; the same API, targets and verification apply to a registered computer.

## Find the device

Call `list_devices`. It returns the computers connected right now, each with a `deviceId` and a display name. An empty list, or a message that there is no device service, means no registered computer can be used; say so and do not substitute the session's own desktop.

When several devices are connected, use the one the user named. If the request does not say which, ask before acting on any of them.

`device_status` tells whether a device can be operated: its console must be unlocked and its desktop runtime installed. A locked computer stays listed but cannot run applications until its owner unlocks it.

## Operate it

Every call names its device:

```javascript
// registered_computers.js with deviceId "office-mac"
let app = await cua.getApp("Calculator");
```

The first `js` call for a device, and the first after `js_reset`, runs exactly one entry call. Its result carries the API documentation for that computer's platform, which can differ from the session's own desktop. Bindings persist per device and never mix with `cua_repl` bindings.

Applications are used without asking the device's owner first. Act only on what the task calls for.

## When the device goes away

A device can lock, disconnect or close its connection at any moment. The call then fails with the reason.

- If it failed while an action was running, the action may or may not have happened. After the device is back, read the application's state before repeating anything.
- Its JavaScript bindings are gone. Start again with a new entry call.
- Do not continue the task on another device or on the session's own desktop unless the user asks for that.
