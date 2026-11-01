import { DEEPSEEK_DEFAULT_MODEL, type ModelProfile } from "@larness/agent";

export const DEEPSEEK_PROFILE_ID = "deepseek-default";
export const FAKE_PROFILE_ID = "fake-default";

/**
 * Built-in profiles used until M1-7 adds model_profiles / credential_profiles
 * persistence. They contain no secrets; providers receive keys per call.
 */
export const DEFAULT_MODEL_PROFILES: readonly ModelProfile[] = [
  {
    id: DEEPSEEK_PROFILE_ID,
    label: "DeepSeek",
    provider: "deepseek",
    model: DEEPSEEK_DEFAULT_MODEL,
    endpoint: null,
    credentialProfileId: null,
  },
  {
    id: FAKE_PROFILE_ID,
    label: "FakeProvider",
    provider: "fake",
    model: "fake",
    endpoint: null,
    credentialProfileId: null,
  },
];

export function listModelProfiles(): ModelProfile[] {
  return DEFAULT_MODEL_PROFILES.map((profile) => ({ ...profile }));
}

export function findModelProfile(id: string | null | undefined): ModelProfile | null {
  if (id === null || id === undefined) {
    return null;
  }

  const profile = DEFAULT_MODEL_PROFILES.find((candidate) => candidate.id === id);
  return profile === undefined ? null : { ...profile };
}

export function defaultModelProfile(): ModelProfile {
  return { ...DEFAULT_MODEL_PROFILES[0] };
}
