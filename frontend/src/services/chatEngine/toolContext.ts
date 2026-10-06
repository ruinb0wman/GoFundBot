import type { AppSettings } from '../../composables/useAppSettings'

/** Shared tool-handler context (search settings come from the frontend store). */
export interface ToolContext {
  searchSettings?: AppSettings
}
