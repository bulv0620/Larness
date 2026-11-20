import { z } from "zod";
import type { DbExecutor } from "../../db/client.js";
import { getMeta, setMeta } from "../../db/repositories/meta.js";

export const WEB_SEARCH_SETTINGS_KEY = "web_search.settings";

export const WebSearchSettingsSchema = z
  .object({
    version: z.literal(1),
    activeConnectionId: z.string().min(1).max(128).nullable(),
    maxResults: z.number().int().min(1).max(10),
    maxSearchesPerTurn: z.number().int().min(0).max(50),
    maxFetchesPerTurn: z.number().int().min(0).max(50),
  })
  .strict();

export type WebSearchSettings = z.infer<typeof WebSearchSettingsSchema>;

export const DEFAULT_WEB_SEARCH_SETTINGS: WebSearchSettings = {
  version: 1,
  activeConnectionId: null,
  maxResults: 5,
  maxSearchesPerTurn: 6,
  maxFetchesPerTurn: 4,
};

export function getWebSearchSettings(db: DbExecutor): WebSearchSettings {
  const raw = getMeta(db, WEB_SEARCH_SETTINGS_KEY);

  if (raw === null) {
    return { ...DEFAULT_WEB_SEARCH_SETTINGS };
  }

  try {
    const parsed = WebSearchSettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : { ...DEFAULT_WEB_SEARCH_SETTINGS };
  } catch {
    return { ...DEFAULT_WEB_SEARCH_SETTINGS };
  }
}

export function setWebSearchSettings(
  db: DbExecutor,
  input: WebSearchSettings,
  now = Date.now(),
): WebSearchSettings {
  const settings = WebSearchSettingsSchema.parse(input);
  setMeta(db, WEB_SEARCH_SETTINGS_KEY, JSON.stringify(settings), now);
  return settings;
}
