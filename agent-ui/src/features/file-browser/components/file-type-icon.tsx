import cssIcon from "material-icon-theme/icons/css.svg?url"
import dockerIcon from "material-icon-theme/icons/docker.svg?url"
import defaultFileIcon from "material-icon-theme/icons/file.svg?url"
import gitIcon from "material-icon-theme/icons/git.svg?url"
import htmlIcon from "material-icon-theme/icons/html.svg?url"
import imageIcon from "material-icon-theme/icons/image.svg?url"
import javascriptIcon from "material-icon-theme/icons/javascript.svg?url"
import jsonIcon from "material-icon-theme/icons/json.svg?url"
import licenseIcon from "material-icon-theme/icons/license.svg?url"
import markdownIcon from "material-icon-theme/icons/markdown.svg?url"
import nodeIcon from "material-icon-theme/icons/nodejs.svg?url"
import reactIcon from "material-icon-theme/icons/react.svg?url"
import reactTypescriptIcon from "material-icon-theme/icons/react_ts.svg?url"
import readmeIcon from "material-icon-theme/icons/readme.svg?url"
import tsconfigIcon from "material-icon-theme/icons/tsconfig.svg?url"
import tuneIcon from "material-icon-theme/icons/tune.svg?url"
import typescriptIcon from "material-icon-theme/icons/typescript.svg?url"
import viteIcon from "material-icon-theme/icons/vite.svg?url"
import yamlIcon from "material-icon-theme/icons/yaml.svg?url"

import { cn } from "@/lib/utils"

const iconByFileName: Record<string, string> = {
  ".gitignore": gitIcon,
  ".npmrc": nodeIcon,
  ".env": tuneIcon,
  ".env.example": tuneIcon,
  "dockerfile": dockerIcon,
  "license": licenseIcon,
  "package-lock.json": nodeIcon,
  "package.json": nodeIcon,
  "readme.md": readmeIcon,
  "tsconfig.json": tsconfigIcon,
  "vite.config.js": viteIcon,
  "vite.config.ts": viteIcon,
  "vite.config.tsx": viteIcon,
}

const iconByExtension: Record<string, string> = {
  css: cssIcon,
  gif: imageIcon,
  htm: htmlIcon,
  html: htmlIcon,
  jpeg: imageIcon,
  jpg: imageIcon,
  js: javascriptIcon,
  jsx: reactIcon,
  json: jsonIcon,
  jsonc: jsonIcon,
  md: markdownIcon,
  mdx: markdownIcon,
  png: imageIcon,
  svg: imageIcon,
  ts: typescriptIcon,
  tsx: reactTypescriptIcon,
  webp: imageIcon,
  yaml: yamlIcon,
  yml: yamlIcon,
}

function getMaterialFileIcon(name: string) {
  const normalizedName = name.toLocaleLowerCase()
  const exactMatch = iconByFileName[normalizedName]

  if (exactMatch) {
    return exactMatch
  }

  const extension = normalizedName.split(".").at(-1)

  return (extension && iconByExtension[extension]) || defaultFileIcon
}

export function FileTypeIcon({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  return (
    <img
      src={getMaterialFileIcon(name)}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("size-4 shrink-0", className)}
    />
  )
}
