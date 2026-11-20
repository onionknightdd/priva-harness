# Priva Computer for macOS

The menu bar app connects a Mac to the Runner's SSH device service. While it is connected and the console is unlocked, a session with the `computer-use` plugin can read and operate applications on this Mac through `registered_computers`. The user starts and stops each connection.

```text
menu bar -> OpenSSH client -> Runner priva-computer subsystem
                <------------ status / open / close, and the worker's MCP messages
tray -> desktop worker (the plugin's cua-repl.mjs on the ChatGPT app's runtime) -> applications
```

The tray runs the same desktop worker a local session runs: the launcher `cua-repl.mjs` from the Runner's `computer-use` plugin, on the `cua_node` runtime of the ChatGPT desktop app installed on this Mac. The worker's MCP messages travel over the SSH channel unchanged, so the session gets the same `cua` API, documentation and screenshots as on its own desktop. One session uses the Mac at a time.

Applications are used without asking the Mac's owner for each one. Connecting is the consent: the menu says so before the first connection. A locked, sleeping, switched-out or otherwise unavailable console can still report status, but cannot start a worker, and a running worker is stopped the moment the console becomes unavailable. The status response includes the installed target and Node, CUA REPL, CUA and Sky versions when their package manifests can be read.

## TODO: run without ChatGPT

Not implemented yet. Today the tray is only the connection: the runtime, the desktop service and the Accessibility and Screen Recording permissions all belong to the ChatGPT desktop app. Quitting ChatGPT makes every desktop action fail with `Computer Use server error -10005: codex app-server exited before returning a response`, and a ChatGPT update replaces the runtime the tray is using.

The decided direction is for the tray to bundle the runtime and its own desktop service built on cua-driver, so the permissions are granted to Priva Computer and ChatGPT is not needed. The findings, the socket protocol the service has to speak and the checks to make first are in [待办：Mac 脱离 ChatGPT](../../docs/architecture/computer-use-migration.md#待办mac-脱离-chatgpt).

## Build and run

Use Swift 6.3 on macOS 14 or later, from the repository root.

```sh
apps/computer-tray-macos/build-app.sh
open 'apps/computer-tray-macos/dist/Priva Computer.app'
```

The script generates a locally ad-hoc-signed app in `dist/`. The app contains the Swift client and the plugin's `cua-repl.mjs`. The ChatGPT desktop app must be installed and running on the Mac: it provides the runtime at `/Applications/ChatGPT.app/Contents/Resources/cua_node` and the desktop service with its system permissions, and that service fails every request while ChatGPT is not running. Distribution with Developer ID signing and notarization would be a separate release step.

Configure a normal OpenSSH host alias for the Runner's device subsystem, including its port, registered private key and previously verified host key. In the menu bar, choose **Priva → Connect…**, enter the alias or `device@host`, and confirm. The client always requests the fixed `priva-computer` subsystem, strict host-key checking and batch mode. An empty port uses the SSH config. For a generated SSH configuration, enter its local path in **Optional SSH config file** and use the host alias defined in that file. The indicator shows **Active** when connected with an available console and **Paused** when the connected Mac cannot act. **Disconnect** stops the worker and closes SSH. **Last desktop worker error…** shows the latest bounded diagnostic on this Mac. The headless client writes the same diagnostic to local stderr. The Runner receives a fixed message for the failure category.

To open the visible tray and connect once using a prepared SSH alias, supply these launch arguments. The connection leaves the saved GUI connection settings alone. The menu retains its **Disconnect** and **Quit** controls.

```sh
open -n 'apps/computer-tray-macos/dist/Priva Computer.app' --args --connect \
  --host priva-device --ssh-config /absolute/path/to/ssh_config
```

## Verification

From the repository root, the fixture tests compile and run with just the macOS Command Line Tools.

```sh
swift build --package-path apps/computer-tray-macos
apps/computer-tray-macos/test.sh
```

With Xcode's Swift Testing framework installed, `swift test --package-path apps/computer-tray-macos` runs the same cases. The tests exercise protocol limits including screenshot-sized worker messages, strict SSH options, interpretation of console state, a worker message round trip over real pipes, a locked registration, a lock that stops a running worker and what it started, and keeping detailed worker errors on the Mac.

The following headless invocation uses the same connection, lock checks and worker as the app. Supply an existing local SSH configuration and the launcher. The connection stays open until stopped, and a line appears on stderr when the device registers.

```sh
apps/computer-tray-macos/.build/release/PrivaComputerTray --smoke \
  --host device@priva-runner --ssh-config /absolute/path/to/ssh_config \
  --launcher "$PWD/services/agent-runner/ts/src/resources/plugins/computer-use/mcp/cua-repl.mjs"
```

SIGINT and SIGTERM stop the headless client. A disconnected or failed SSH connection ends the headless run with exit status 1. The GUI stays available for a new manual connection. After an interrupted desktop action, the session must treat the previous result as unknown.
