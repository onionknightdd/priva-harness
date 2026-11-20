#!/bin/sh
set -eu
cd "$(dirname "$0")"
# The Command Line Tools omit Swift Testing and XCTest. Compile the same cases with a small CLI runner.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
swiftc -swift-version 6 -parse-as-library Sources/PrivaComputerTray/Protocol.swift \
    Sources/PrivaComputerTray/Transport.swift tests/PrivaComputerTrayTests/ProtocolCases.swift \
    tests/cli/RunTests.swift -o "$tmp/tray-tests"
"$tmp/tray-tests"
