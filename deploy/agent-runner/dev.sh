#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
RUNNER="$ROOT/services/agent-runner/ts"
PROFILE=${MINIKUBE_PROFILE:-minikube}
NAMESPACE=priva-harness-dev
IMAGE=priva-harness/agent-runner:debian13-dev
KUBE=(kubectl --context "$PROFILE" --namespace "$NAMESPACE")

case "${1:-help}" in
  build)
    # Build for the actual node architecture, independently of Docker's default.
    arch=$(kubectl --context "$PROFILE" get nodes -o jsonpath='{.items[0].status.nodeInfo.architecture}')
    docker build --platform "linux/$arch" \
      --build-arg "DEBIAN_MIRROR=${DEBIAN_MIRROR:-https://deb.debian.org}" \
      --build-arg "NPM_REGISTRY=${NPM_REGISTRY:-https://registry.npmjs.org}" \
      --tag "$IMAGE" "$RUNNER"
    ;;
  deploy)
    minikube --profile "$PROFILE" image load "$IMAGE" --overwrite=true
    kubectl --context "$PROFILE" apply -f "$ROOT/deploy/agent-runner/minikube.yaml"
    # Pods do not inherit the node's /etc/hosts. Resolve the documented minikube
    # host gateway on each deploy instead of baking a Docker Desktop IP into Git.
    host_ip=$(minikube --profile "$PROFILE" ssh -- 'getent ahostsv4 host.minikube.internal' | awk 'NR==1 {print $1}')
    if [[ ! "$host_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo 'Could not resolve host.minikube.internal in the minikube node.' >&2
      exit 1
    fi
    patch=$(printf '{"spec":{"template":{"metadata":{"annotations":{"priva-harness.dev/deployed-at":"%s"}},"spec":{"hostAliases":[{"ip":"%s","hostnames":["host.minikube.internal"]}]}}}}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$host_ip")
    "${KUBE[@]}" patch deployment agent-runner --type=merge --patch "$patch"
    "${KUBE[@]}" rollout status deployment/agent-runner --timeout=180s
    ;;
  sync)
    # Reject dependency changes: Linux node_modules must be rebuilt with npm ci.
    pod=$("${KUBE[@]}" get pods -l app=priva-harness-runner -o jsonpath='{.items[0].metadata.name}')
    local_hash=$(cat "$RUNNER/package.json" "$RUNNER/package-lock.json" | shasum -a 256 | awk '{print $1}')
    remote_hash=$("${KUBE[@]}" exec "$pod" -- sh -c 'cat /opt/agent-runner/package.json /opt/agent-runner/package-lock.json | sha256sum' | awk '{print $1}')
    if [[ "$local_hash" != "$remote_hash" ]]; then
      echo 'package.json or package-lock.json changed; run build and deploy before syncing.' >&2
      exit 1
    fi
    stage=$("${KUBE[@]}" exec "$pod" -- mktemp -d /tmp/runner-sync.XXXXXX)
    trap '"${KUBE[@]}" exec "$pod" -- rm -rf "$stage"' EXIT
    COPYFILE_DISABLE=1 tar --format=ustar -C "$RUNNER" --exclude='.env*' --exclude='*.local' --exclude='*.pem' --exclude='*.key' --exclude=node_modules -cf - src tests tsconfig.json tsconfig.build.json eslint.config.js |
      "${KUBE[@]}" exec -i "$pod" -- tar -xf - -C "$stage"
    "${KUBE[@]}" exec "$pod" -- sh -eu -c '
      rsync -rc --delete "$1/src/" /opt/agent-runner/src/
      rsync -rc --delete "$1/tests/" /opt/agent-runner/tests/
      rsync -c "$1/tsconfig.json" "$1/tsconfig.build.json" "$1/eslint.config.js" /opt/agent-runner/
    ' sh "$stage"
    echo 'Source synchronized; tsx watch reloads changed runtime modules.'
    ;;
  forward)
    # Forward to the Deployment so the debugger remains reachable while paused.
    forward_log=$(mktemp)
    trap 'rm -f "$forward_log"' EXIT
    trap 'exit 130' INT
    while true; do
      if "${KUBE[@]}" port-forward --address 127.0.0.1 deployment/agent-runner 18001:8001 19229:9229 2>"$forward_log"; then
        break
      else
        result=$?
      fi
      error=$(cat "$forward_log")
      printf '%s\n' "$error" >&2
      case "$error" in
        *'lost connection to pod'*|*'pod is not running'*|*'timed out waiting for the condition'*)
          echo 'Runner connection interrupted; reconnecting in 2 seconds.' >&2
          sleep 2
          ;;
        *) exit "$result" ;;
      esac
    done
    ;;
  watch)
    exec node "$ROOT/deploy/agent-runner/watch.mjs"
    ;;
  ui)
    cd "$ROOT/agent-ui"
    export AGENT_RUNNER_URL=http://127.0.0.1:18001
    exec npm run dev -- --host 127.0.0.1 --port 15173 --strictPort
    ;;
  shell)
    exec "${KUBE[@]}" exec -it deployment/agent-runner -- bash
    ;;
  logs)
    exec "${KUBE[@]}" logs -f deployment/agent-runner --tail=100
    ;;
  status)
    "${KUBE[@]}" get deployment,pod,service,pvc
    ;;
  verify)
    "${KUBE[@]}" exec deployment/agent-runner -- node --import tsx tests/deployment/debian-smoke.ts
    "${KUBE[@]}" exec deployment/agent-runner -- node --import tsx tests/deployment/desktop-smoke.ts
    ;;
  verify-desktop)
    "${KUBE[@]}" exec deployment/agent-runner -- node --import tsx tests/deployment/desktop-smoke.ts
    ;;
  verify-computer)
    "${KUBE[@]}" exec deployment/agent-runner -- node --import tsx tests/deployment/computer-mcp-smoke.ts
    ;;
  import-models)
    if [[ $# -lt 2 || $# -gt 3 ]]; then echo 'Usage: dev.sh import-models /path/to/bambuddy.settings.json [--connect-host-models]' >&2; exit 1; fi
    node "$ROOT/deploy/agent-runner/import-models.mjs" "$2" "$PROFILE" "$NAMESPACE" "${3:-}"
    ;;
  *)
    echo 'Usage: deploy/agent-runner/dev.sh {build|deploy|sync|watch|forward|ui|shell|logs|status|verify|verify-desktop|verify-computer|import-models FILE [--connect-host-models]}'
    ;;
esac
