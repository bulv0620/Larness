import { describe, expect, it } from "vitest";
import {
  DEEPSEEK_PROFILE_ID,
  defaultModelProfile,
  FAKE_PROFILE_ID,
  findModelProfile,
  listModelProfiles,
} from "../../src/modules/models/profiles.js";

describe("model profiles", () => {
  it("exposes deepseek-chat and the fake provider without secrets", () => {
    const profiles = listModelProfiles();

    expect(profiles).toHaveLength(2);
    expect(profiles.map((profile) => profile.id)).toEqual([DEEPSEEK_PROFILE_ID, FAKE_PROFILE_ID]);
    expect(defaultModelProfile()).toMatchObject({
      provider: "deepseek",
      model: "deepseek-chat",
      credentialProfileId: null,
    });

    for (const profile of profiles) {
      expect(profile).not.toHaveProperty("apiKey");
      expect(profile).not.toHaveProperty("secret");
    }
  });

  it("resolves known profiles to copies and returns null for unknown ids", () => {
    const fake = findModelProfile(FAKE_PROFILE_ID);
    expect(fake).toMatchObject({ provider: "fake" });

    if (fake !== null) {
      fake.model = "mutated";
      expect(findModelProfile(FAKE_PROFILE_ID)?.model).toBe("fake");
    }

    expect(findModelProfile("mdl_missing")).toBeNull();
    expect(findModelProfile(null)).toBeNull();
  });
});
