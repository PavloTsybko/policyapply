import type { JsonValue } from "@policyapply/contracts";

export class CanonicalJsonError extends Error {
  constructor(readonly path: string) {
    super(`invalid_json_value:${path}`);
    this.name = "CanonicalJsonError";
  }
}

const normalize = (
  value: unknown,
  path: string,
  ancestors: Set<object>,
): JsonValue => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
      throw new CanonicalJsonError(path);
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (typeof value !== "object") {
    throw new CanonicalJsonError(path);
  }

  if (ancestors.has(value)) {
    throw new CanonicalJsonError(path);
  }

  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    const keys = Object.keys(value);
    if (
      Object.getOwnPropertySymbols(value).length > 0 ||
      keys.length !== value.length ||
      keys.some((key, index) => key !== String(index))
    ) {
      throw new CanonicalJsonError(path);
    }
    ancestors.add(value);
    const result = keys.map((key, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        throw new CanonicalJsonError(`${path}[${index}]`);
      }
      return normalize(descriptor.value, `${path}[${index}]`, ancestors);
    });
    ancestors.delete(value);
    return result;
  }

  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalJsonError(path);
  }

  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new CanonicalJsonError(path);
  }

  ancestors.add(value);
  const result: Record<string, JsonValue> = Object.create(null) as Record<
    string,
    JsonValue
  >;
  for (const key of Object.keys(value).sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new CanonicalJsonError(`${path}.${key}`);
    }
    result[key] = normalize(
      descriptor.value,
      `${path}.${key}`,
      ancestors,
    );
  }
  ancestors.delete(value);
  return result;
};

export const normalizeJson = (value: unknown): JsonValue =>
  normalize(value, "$", new Set());

export const canonicalJson = (value: unknown): string =>
  JSON.stringify(normalizeJson(value));

export const deepFreezeJson = (value: JsonValue): JsonValue => {
  if (value !== null && typeof value === "object") {
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      deepFreezeJson(child);
    }
    Object.freeze(value);
  }
  return value;
};
