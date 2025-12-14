import type { AppDependencies } from "../app";
import { createModelRepository } from "../repositories/factory";
import { EchoLlmService, type LlmService } from "./llmService";

export const createLlmService = (dependencies: AppDependencies): LlmService => {
  const modelRepository = createModelRepository(dependencies.models);

  return new EchoLlmService(dependencies.serviceName, dependencies.version, modelRepository);
};
