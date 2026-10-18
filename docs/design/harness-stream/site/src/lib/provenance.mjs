const originLabels = {
  a2a: 'A2A 标准',
  harness: '自定义扩展',
  transport: 'HTTP / SSE 标准',
}

export function fieldProvenance(field, sources) {
  const provenance = field.provenance
  const label = originLabels[provenance?.origin]
  const source = sources?.[provenance?.ref]
  if (!label || !source?.title || !source?.url) {
    throw new TypeError(`字段来源不完整：${field.path}`)
  }
  return { ...provenance, label, source }
}

export function provenanceText(field, sources) {
  const { label, source, convention, note } = fieldProvenance(field, sources)
  return [
    `来源：[${label} · ${source.title}](${source.url})。`,
    convention && `平台映射/约定：${convention}`,
    note,
  ].filter(Boolean).join(' ')
}
