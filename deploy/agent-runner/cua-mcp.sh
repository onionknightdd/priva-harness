#!/usr/bin/env bash
set -euo pipefail

# Keep stdout exclusively for MCP. The Driver is pinned in the Runner image.
exec kubectl --context "${MINIKUBE_PROFILE:-minikube}" \
  --namespace "${RUNNER_NAMESPACE:-priva-harness-dev}" \
  exec -i deployment/agent-runner -- \
  /usr/local/bin/cua-driver mcp --direct
