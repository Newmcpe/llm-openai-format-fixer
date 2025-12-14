export interface EnvConfig {
  serviceName: string;
  serviceVersion: string;
  models: string[];
  port: number;
}

const parseString = (value: string | undefined, fallback: string): string => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseModels = (value: string | undefined, fallback: string[]): string[] => {
  const models = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return models && models.length > 0 ? models : fallback;
};

export const loadEnvConfig = (
  env: Record<string, string | undefined> = process.env,
): EnvConfig => {
  return {
    serviceName: parseString(env.SERVICE_NAME, "llm-openai-proxy"),
    serviceVersion: parseString(env.SERVICE_VERSION, "v1"),
    models: parseModels(env.MODELS, ["custom-llm"]),
    port: parseNumber(env.PORT, 3000),
  };
};
