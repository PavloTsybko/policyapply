import type { JsonValue } from "@policyapply/contracts";
import { describe, expect, it } from "vitest";
import {
  CanonicalJsonError,
  canonicalJson,
  deepFreezeJson,
  normalizeJson,
} from "./canonical-json.js";

describe("canonicalJson", () => {
  it("sorts object keys recursively while preserving array order", () => {
    expect(
      canonicalJson({ z: 1, a: { y: true, b: false }, list: [3, 2, 1] }),
    ).toBe('{"a":{"b":false,"y":true},"list":[3,2,1],"z":1}');
  });

  it("normalizes negative zero", () => {
    expect(canonicalJson({ decimal: 1.25, value: -0 })).toBe(
      '{"decimal":1.25,"value":0}',
    );
  });

  it("rejects unsupported and unsafe runtime values", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const sparse: unknown[] = [];
    sparse.length = 2;
    sparse[1] = "present";
    const withGetter = Object.defineProperty({}, "secret", {
      enumerable: true,
      get: () => "must-not-run",
    });
    const withSymbol = { visible: true } as Record<PropertyKey, unknown>;
    withSymbol[Symbol("hidden")] = true;
    const arrayWithGetter: unknown[] = [];
    Object.defineProperty(arrayWithGetter, "0", {
      enumerable: true,
      get: () => "must-not-run",
    });
    arrayWithGetter.length = 1;
    const arrayWithSymbol = ["visible"] as unknown[] &
      Record<symbol, unknown>;
    arrayWithSymbol[Symbol("hidden")] = true;

    for (const value of [
      undefined,
      1n,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      new Date("2026-08-11T00:00:00.000Z"),
      { nested: undefined },
      sparse,
      withGetter,
      withSymbol,
      arrayWithGetter,
      arrayWithSymbol,
      cyclic,
    ]) {
      expect(() => canonicalJson(value)).toThrow(CanonicalJsonError);
    }
  });

  it("returns a deeply frozen normalized JSON value", () => {
    const normalized = deepFreezeJson(normalizeJson({ nested: [{ b: 2 }] }));
    expect(Object.isFrozen(normalized)).toBe(true);
    if (normalized !== null && !Array.isArray(normalized) && typeof normalized === "object") {
      expect(
        Object.isFrozen((normalized as Record<string, JsonValue>).nested),
      ).toBe(true);
    }
  });
});
