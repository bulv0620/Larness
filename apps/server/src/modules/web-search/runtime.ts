import type { Database } from "../../db/client.js";
import type { SecretStore } from "../../security/secretStore.js";
import {
  type ActiveWebSearchConnection,
  hasActiveWebSearchConnection,
  resolveActiveWebSearchConnection,
  type WebSearchConfigOptions,
} from "./connections.js";
import { WebSearchService } from "./service.js";
import { getWebSearchSettings, type WebSearchSettings } from "./settings.js";

export interface WebSearchRuntime {
  service: WebSearchService;
  settings(): WebSearchSettings;
  available(): boolean;
  resolveActive(): ActiveWebSearchConnection | null;
}

export interface CreateWebSearchRuntimeOptions {
  db: Database;
  secretStore: SecretStore;
  service?: WebSearchService;
  now?: () => number;
}

export function createWebSearchRuntime(options: CreateWebSearchRuntimeOptions): WebSearchRuntime {
  const config: WebSearchConfigOptions = {
    db: options.db,
    secretStore: options.secretStore,
    ...(options.now === undefined ? {} : { now: options.now }),
  };
  const service = options.service ?? new WebSearchService();

  return {
    service,
    settings: () => getWebSearchSettings(options.db),
    available: () => hasActiveWebSearchConnection(options.db),
    resolveActive: () => resolveActiveWebSearchConnection(config),
  };
}
