import { z } from 'zod'
import { BUILTIN_PLUGIN_IDS } from '../../../core/plugin/builtin-plugins.js'

export const enabledPluginIdsSchema = z.array(z.enum(BUILTIN_PLUGIN_IDS)).default([]).transform((ids) => [...new Set(ids)])
