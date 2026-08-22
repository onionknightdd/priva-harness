import ai21Icon from "@lobehub/icons-static-svg/icons/ai21-brand-color.svg"
import anthropicIcon from "@lobehub/icons-static-svg/icons/anthropic.svg"
import baiduIcon from "@lobehub/icons-static-svg/icons/baidu-brand-color.svg"
import bedrockIcon from "@lobehub/icons-static-svg/icons/bedrock-color.svg"
import bytedanceIcon from "@lobehub/icons-static-svg/icons/bytedance-brand-color.svg"
import cerebrasIcon from "@lobehub/icons-static-svg/icons/cerebras-brand-color.svg"
import cohereIcon from "@lobehub/icons-static-svg/icons/cohere-color.svg"
import deepseekIcon from "@lobehub/icons-static-svg/icons/deepseek-color.svg"
import fireworksIcon from "@lobehub/icons-static-svg/icons/fireworks-color.svg"
import googleIcon from "@lobehub/icons-static-svg/icons/google-color.svg"
import groqIcon from "@lobehub/icons-static-svg/icons/groq.svg"
import huggingfaceIcon from "@lobehub/icons-static-svg/icons/huggingface-color.svg"
import ibmIcon from "@lobehub/icons-static-svg/icons/ibm.svg"
import kimiIcon from "@lobehub/icons-static-svg/icons/kimi.svg"
import metaIcon from "@lobehub/icons-static-svg/icons/meta-brand-color.svg"
import microsoftIcon from "@lobehub/icons-static-svg/icons/microsoft-color.svg"
import minimaxIcon from "@lobehub/icons-static-svg/icons/minimax-color.svg"
import mistralIcon from "@lobehub/icons-static-svg/icons/mistral-color.svg"
import nvidiaIcon from "@lobehub/icons-static-svg/icons/nvidia-color.svg"
import ollamaIcon from "@lobehub/icons-static-svg/icons/ollama.svg"
import openaiIcon from "@lobehub/icons-static-svg/icons/openai.svg"
import openrouterIcon from "@lobehub/icons-static-svg/icons/openrouter-color.svg"
import perplexityIcon from "@lobehub/icons-static-svg/icons/perplexity-color.svg"
import qwenIcon from "@lobehub/icons-static-svg/icons/qwen-color.svg"
import replicateIcon from "@lobehub/icons-static-svg/icons/replicate.svg"
import sambanovaIcon from "@lobehub/icons-static-svg/icons/sambanova-color.svg"
import siliconflowIcon from "@lobehub/icons-static-svg/icons/siliconcloud-color.svg"
import tencentIcon from "@lobehub/icons-static-svg/icons/tencent-brand-color.svg"
import togetherIcon from "@lobehub/icons-static-svg/icons/together-brand-color.svg"
import xaiIcon from "@lobehub/icons-static-svg/icons/xai.svg"
import zaiIcon from "@lobehub/icons-static-svg/icons/zai.svg"
import zerooneIcon from "@lobehub/icons-static-svg/icons/zeroone-color.svg"

import { cn } from "@/lib/utils"

import type { KnownModelProviderId } from "./model-provider"

const providerIcons: Partial<
  Record<KnownModelProviderId, { src: string; monochrome?: boolean }>
> = {
  openai: { src: openaiIcon, monochrome: true },
  anthropic: { src: anthropicIcon, monochrome: true },
  qwen: { src: qwenIcon },
  google: { src: googleIcon },
  deepseek: { src: deepseekIcon },
  meta: { src: metaIcon },
  mistral: { src: mistralIcon },
  xai: { src: xaiIcon, monochrome: true },
  cohere: { src: cohereIcon },
  microsoft: { src: microsoftIcon },
  amazon: { src: bedrockIcon },
  nvidia: { src: nvidiaIcon },
  minimax: { src: minimaxIcon },
  kimi: { src: kimiIcon, monochrome: true },
  "z-ai": { src: zaiIcon, monochrome: true },
  baidu: { src: baiduIcon },
  bytedance: { src: bytedanceIcon },
  tencent: { src: tencentIcon },
  perplexity: { src: perplexityIcon },
  ibm: { src: ibmIcon, monochrome: true },
  ai21: { src: ai21Icon },
  zeroone: { src: zerooneIcon },
  openrouter: { src: openrouterIcon },
  groq: { src: groqIcon, monochrome: true },
  ollama: { src: ollamaIcon, monochrome: true },
  huggingface: { src: huggingfaceIcon },
  together: { src: togetherIcon },
  fireworks: { src: fireworksIcon },
  replicate: { src: replicateIcon, monochrome: true },
  siliconflow: { src: siliconflowIcon },
  cerebras: { src: cerebrasIcon },
  sambanova: { src: sambanovaIcon },
}

export function ProviderIcon({
  className,
  providerId,
}: {
  className?: string
  providerId: KnownModelProviderId | null
}) {
  if (!providerId) {
    return null
  }

  const icon = providerIcons[providerId]

  if (!icon) {
    return null
  }

  return (
    <img
      src={icon.src}
      alt=""
      aria-hidden="true"
      className={cn(
        "size-4 shrink-0 object-contain",
        icon.monochrome && "dark:invert",
        className
      )}
    />
  )
}
