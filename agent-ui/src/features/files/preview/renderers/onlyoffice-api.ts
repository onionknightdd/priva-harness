type DocsEditor = {
  destroyEditor: () => void
}

type DocsApi = {
  DocEditor: new (placeholderId: string, config: OnlyOfficeEditorConfig) => DocsEditor
}

export type OnlyOfficeEditorConfig = {
  documentType: "cell"
  width: string
  height: string
  document: {
    fileType: string
    key: string
    title: string
    url: string
    permissions: {
      comment: false
      download: true
      edit: false
      print: true
      review: false
    }
  }
  editorConfig: {
    mode: "view"
    lang: string
    callbackUrl: string
    user: {
      id: string
      name: string
    }
    customization: {
      anonymous: { request: false }
      compactHeader: true
      compactToolbar: true
      hideRightMenu: true
      hideRulers: true
      toolbarNoTabs: true
    }
  }
  events: {
    onAppReady?: () => void
    onDocumentReady?: () => void
    onError?: (event: {
      data?: number | { errorCode?: number; errorDescription?: string }
    }) => void
  }
}

declare global {
  interface Window {
    DocsAPI?: DocsApi
  }
}

const loadedScripts = new Map<string, Promise<DocsApi>>()

export function loadOnlyOfficeApi(documentServerUrl: string): Promise<DocsApi> {
  const origin = documentServerUrl.replace(/\/+$/, "")
  const src = `${origin}/web-apps/apps/api/documents/api.js`
  const existing = loadedScripts.get(src)
  if (existing) {
    return existing
  }

  const pending = new Promise<DocsApi>((resolve, reject) => {
    const script = document.createElement("script")
    script.src = src
    script.async = true
    script.onload = () => {
      if (!window.DocsAPI) {
        reject(new Error("OnlyOffice DocsAPI did not load"))
        return
      }

      resolve(window.DocsAPI)
    }
    script.onerror = () => {
      loadedScripts.delete(src)
      reject(new Error("Unable to load OnlyOffice DocsAPI"))
    }
    document.head.append(script)
  })

  loadedScripts.set(src, pending)
  return pending
}

export function createOnlyOfficeEditor(
  docsApi: DocsApi,
  placeholderId: string,
  config: OnlyOfficeEditorConfig
) {
  return new docsApi.DocEditor(placeholderId, config)
}
