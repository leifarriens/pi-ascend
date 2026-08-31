import type { AscendConfig, ModelTier } from "./types.ts";

export const DEFAULT_MAX_TIERS = 4;
export const HARD_MAX_TIERS = 8;
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
export const HARD_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_OUTPUT_LIMIT_BYTES = 8 * 1024 * 1024;
export const HARD_OUTPUT_LIMIT_BYTES = 32 * 1024 * 1024;
export const MIN_TIMEOUT_MS = 1_000;
export const MIN_OUTPUT_LIMIT_BYTES = 64 * 1024;

export type Environment = Record<string, string | undefined>;

function parseBoundedInteger(
  environment: Environment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = environment[name];
  if (value === undefined || value.trim() === "") return fallback;

  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function parseBoolean(environment: Environment, name: string): boolean {
  const value = environment[name]?.trim().toLowerCase();
  if (value === undefined || value === "") return false;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error(`${name} must be one of: 1, 0, true, false, yes, no, on, off`);
}

function validateModelReference(value: string): string {
  const model = value.trim();
  if (!model || /\s/.test(model) || !model.includes("/")) {
    throw new Error(
      `PI_ASCEND_MODELS entries must be explicit provider/model identifiers: ${JSON.stringify(value)}`,
    );
  }
  return model;
}

function parseModels(environment: Environment): string[] {
  const raw = environment.PI_ASCEND_MODELS;
  if (raw === undefined || raw.trim() === "") return [];

  const models = raw.split(",").map(validateModelReference);
  return [...new Set(models)];
}

export function loadConfig(environment: Environment = process.env): AscendConfig {
  return {
    models: parseModels(environment),
    maxTiers: parseBoundedInteger(
      environment,
      "PI_ASCEND_MAX_TIERS",
      DEFAULT_MAX_TIERS,
      1,
      HARD_MAX_TIERS,
    ),
    timeoutMs: parseBoundedInteger(
      environment,
      "PI_ASCEND_TIMEOUT_MS",
      DEFAULT_TIMEOUT_MS,
      MIN_TIMEOUT_MS,
      HARD_TIMEOUT_MS,
    ),
    outputLimitBytes: parseBoundedInteger(
      environment,
      "PI_ASCEND_OUTPUT_LIMIT_BYTES",
      DEFAULT_OUTPUT_LIMIT_BYTES,
      MIN_OUTPUT_LIMIT_BYTES,
      HARD_OUTPUT_LIMIT_BYTES,
    ),
    debug: parseBoolean(environment, "PI_ASCEND_DEBUG"),
  };
}

export function buildModelTiers(activeModel: string, config: AscendConfig): ModelTier[] {
  const models = [activeModel, ...config.models];
  const uniqueModels: string[] = [];
  const seen = new Set<string>();

  for (const model of models) {
    if (seen.has(model)) continue;
    seen.add(model);
    uniqueModels.push(model);
  }

  return uniqueModels.slice(0, config.maxTiers).map((model, tier) => ({ tier, model }));
}
