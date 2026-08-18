import * as React from "react"

type BinaryPreviewState =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: ArrayBuffer; error: null }
  | { status: "error"; data: null; error: string }

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function useBinaryPreview(source: string) {
  const [state, setState] = React.useState<BinaryPreviewState>({
    status: "loading",
    data: null,
    error: null,
  })

  React.useEffect(() => {
    const controller = new AbortController()
    let active = true

    setState({ status: "loading", data: null, error: null })

    void fetch(source, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            response.statusText || `HTTP ${response.status}`
          )
        }

        return response.arrayBuffer()
      })
      .then((data) => {
        if (active) {
          setState({ status: "ready", data, error: null })
        }
      })
      .catch((error: unknown) => {
        if (active && !controller.signal.aborted) {
          setState({
            status: "error",
            data: null,
            error: errorMessage(error),
          })
        }
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [source])

  return state
}
