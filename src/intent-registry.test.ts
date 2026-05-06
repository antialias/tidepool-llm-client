import { describe, expect, expectTypeOf, it } from "vitest";
import { defineIntentRegistry } from "./intent-registry.js";

describe("defineIntentRegistry", () => {
  it("preserves literal intent names and freezes the registry", () => {
    const registry = defineIntentRegistry({
      scout: {
        kind: "text-object",
        defaultModel: "openai/gpt-test",
        requiredCapabilities: ["jsonSchema", "text"],
      },
      embedText: {
        kind: "embedding",
        defaultModel: { provider: "openai", model: "text-embedding-test" },
      },
    });

    expectTypeOf<keyof typeof registry>().toEqualTypeOf<
      "scout" | "embedText"
    >();
    expect(registry.scout.kind).toBe("text-object");
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.scout)).toBe(true);
    expect(Object.isFrozen(registry.scout.requiredCapabilities)).toBe(true);
    expect(() => {
      (
        registry as unknown as { scout: { kind: string } }
      ).scout.kind = "text";
    }).toThrow(TypeError);
  });
});
