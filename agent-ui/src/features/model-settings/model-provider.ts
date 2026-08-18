export type KnownModelProviderId =
  | "openai"
  | "anthropic"
  | "qwen"
  | "google"
  | "deepseek"
  | "meta"
  | "mistral"
  | "xai"
  | "cohere"
  | "microsoft"
  | "amazon"
  | "nvidia"
  | "minimax"
  | "kimi"
  | "z-ai"
  | "baidu"
  | "bytedance"
  | "tencent"
  | "perplexity"
  | "ibm"
  | "ai21"
  | "zeroone"
  | "openrouter"
  | "groq"
  | "ollama"
  | "huggingface"
  | "together"
  | "fireworks"
  | "replicate"
  | "siliconflow"
  | "cerebras"
  | "sambanova"

type ProviderKeyword = {
  value: string
  boundary?: boolean
}

type ProviderRule = {
  id: KnownModelProviderId
  label: string
  modelKeywords?: readonly ProviderKeyword[]
  firstSegmentAliases: readonly string[]
}

export type ModelIdGroup = {
  value: string
  label: string
  providerId: KnownModelProviderId | null
  items: string[]
}

const PROVIDER_RULES: readonly ProviderRule[] = [
  {
    id: "openai",
    label: "OpenAI",
    modelKeywords: [
      { value: "gpt" },
      { value: "chatgpt" },
      { value: "codex" },
      { value: "dall-e" },
      { value: "whisper" },
      { value: "o1", boundary: true },
      { value: "o3", boundary: true },
      { value: "o4", boundary: true },
    ],
    firstSegmentAliases: ["openai"],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    modelKeywords: [{ value: "claude" }],
    firstSegmentAliases: ["anthropic", "claude"],
  },
  {
    id: "qwen",
    label: "Qwen",
    modelKeywords: [{ value: "qwen" }, { value: "qwq" }],
    firstSegmentAliases: ["qwen", "alibaba", "dashscope"],
  },
  {
    id: "google",
    label: "Google",
    modelKeywords: [
      { value: "gemini" },
      { value: "gemma" },
      { value: "palm" },
    ],
    firstSegmentAliases: ["google", "google-ai", "vertex", "vertexai"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    modelKeywords: [{ value: "deepseek" }],
    firstSegmentAliases: ["deepseek"],
  },
  {
    id: "meta",
    label: "Meta",
    modelKeywords: [{ value: "llama" }],
    firstSegmentAliases: ["meta", "meta-llama"],
  },
  {
    id: "mistral",
    label: "Mistral",
    modelKeywords: [
      { value: "mistral" },
      { value: "mixtral" },
      { value: "codestral" },
      { value: "ministral" },
      { value: "pixtral" },
    ],
    firstSegmentAliases: ["mistral", "mistralai"],
  },
  {
    id: "xai",
    label: "xAI",
    modelKeywords: [{ value: "grok" }],
    firstSegmentAliases: ["xai", "x-ai"],
  },
  {
    id: "cohere",
    label: "Cohere",
    modelKeywords: [
      { value: "command-r" },
      { value: "aya", boundary: true },
    ],
    firstSegmentAliases: ["cohere"],
  },
  {
    id: "microsoft",
    label: "Microsoft",
    modelKeywords: [{ value: "phi", boundary: true }],
    firstSegmentAliases: ["microsoft", "azure", "azureai"],
  },
  {
    id: "amazon",
    label: "Amazon",
    modelKeywords: [
      { value: "nova", boundary: true },
      { value: "titan" },
    ],
    firstSegmentAliases: ["amazon", "aws", "bedrock"],
  },
  {
    id: "nvidia",
    label: "NVIDIA",
    modelKeywords: [{ value: "nemotron" }],
    firstSegmentAliases: ["nvidia"],
  },
  {
    id: "minimax",
    label: "MiniMax",
    modelKeywords: [{ value: "minimax" }, { value: "abab" }],
    firstSegmentAliases: ["minimax"],
  },
  {
    id: "kimi",
    label: "Kimi",
    modelKeywords: [{ value: "kimi" }, { value: "moonshot" }],
    firstSegmentAliases: ["kimi", "moonshot", "moonshotai"],
  },
  {
    id: "z-ai",
    label: "Z.ai",
    modelKeywords: [
      { value: "glm", boundary: true },
      { value: "codegeex" },
    ],
    firstSegmentAliases: ["z.ai", "zai", "zhipu", "zhipuai", "bigmodel"],
  },
  {
    id: "baidu",
    label: "Baidu",
    modelKeywords: [{ value: "ernie" }, { value: "wenxin" }],
    firstSegmentAliases: ["baidu", "qianfan"],
  },
  {
    id: "bytedance",
    label: "ByteDance",
    modelKeywords: [{ value: "doubao" }, { value: "seed" }],
    firstSegmentAliases: ["bytedance", "volcengine", "volc", "ark"],
  },
  {
    id: "tencent",
    label: "Tencent",
    modelKeywords: [{ value: "hunyuan" }],
    firstSegmentAliases: ["tencent", "tencentcloud"],
  },
  {
    id: "perplexity",
    label: "Perplexity",
    modelKeywords: [{ value: "sonar" }],
    firstSegmentAliases: ["perplexity"],
  },
  {
    id: "ibm",
    label: "IBM",
    modelKeywords: [{ value: "granite" }],
    firstSegmentAliases: ["ibm", "watsonx"],
  },
  {
    id: "ai21",
    label: "AI21",
    modelKeywords: [{ value: "jamba" }],
    firstSegmentAliases: ["ai21", "ai21labs"],
  },
  {
    id: "zeroone",
    label: "01.AI",
    modelKeywords: [{ value: "yi", boundary: true }],
    firstSegmentAliases: ["01.ai", "01ai", "zeroone", "lingyiwanwu"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    firstSegmentAliases: ["openrouter"],
  },
  { id: "groq", label: "Groq", firstSegmentAliases: ["groq"] },
  { id: "ollama", label: "Ollama", firstSegmentAliases: ["ollama"] },
  {
    id: "huggingface",
    label: "Hugging Face",
    firstSegmentAliases: ["huggingface", "hf"],
  },
  {
    id: "together",
    label: "Together AI",
    firstSegmentAliases: ["together", "togetherai"],
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    firstSegmentAliases: ["fireworks", "fireworksai"],
  },
  {
    id: "replicate",
    label: "Replicate",
    firstSegmentAliases: ["replicate"],
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    firstSegmentAliases: ["siliconflow", "siliconcloud"],
  },
  {
    id: "cerebras",
    label: "Cerebras",
    firstSegmentAliases: ["cerebras"],
  },
  {
    id: "sambanova",
    label: "SambaNova",
    firstSegmentAliases: ["sambanova"],
  },
]

export function groupModelIds(modelIds: readonly string[]): ModelIdGroup[] {
  const groups = new Map<string, ModelIdGroup>()

  for (const modelId of modelIds) {
    const segments = modelId
      .split("/")
      .map((segment) => segment.trim().toLocaleLowerCase())
      .filter(Boolean)
    const firstSegment = segments[0] ?? modelId.trim().toLocaleLowerCase()
    const lastSegment = segments.at(-1) ?? firstSegment
    const provider =
      findProviderByModelName(lastSegment) ??
      findProviderByFirstSegment(firstSegment)
    const value = provider?.id ?? `unknown:${firstSegment}`
    const existing = groups.get(value)

    if (existing) {
      existing.items.push(modelId)
      continue
    }

    groups.set(value, {
      value,
      label: provider?.label ?? capitalize(firstSegment),
      providerId: provider?.id ?? null,
      items: [modelId],
    })
  }

  return [...groups.values()]
}

function findProviderByModelName(modelName: string) {
  return PROVIDER_RULES.find((provider) =>
    provider.modelKeywords?.some((keyword) =>
      matchesKeyword(modelName, keyword)
    )
  )
}

function findProviderByFirstSegment(firstSegment: string) {
  return PROVIDER_RULES.find((provider) =>
    provider.firstSegmentAliases.includes(firstSegment)
  )
}

function matchesKeyword(value: string, keyword: ProviderKeyword) {
  if (!keyword.boundary) {
    return value.includes(keyword.value)
  }

  const escapedKeyword = keyword.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(^|[^a-z0-9])${escapedKeyword}([^a-z0-9]|$)`, "u").test(
    value
  )
}

function capitalize(value: string) {
  return value
    ? `${value[0].toLocaleUpperCase()}${value.slice(1)}`
    : value
}
