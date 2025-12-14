import type {AppDependencies} from "../app";
import {createModelRepository} from "../repositories/factory";
import {EchoLlmService, type LlmService, ProxyLlmService} from "./llmService";

export const createLlmService = (dependencies: AppDependencies): LlmService => {
  const modelRepository = createModelRepository(dependencies.models);

    if (dependencies.customLlmUrl) {
        return new ProxyLlmService(
            dependencies.serviceName,
            dependencies.version,
            modelRepository,
            dependencies.customLlmUrl,
            dependencies.customLlmKey,
        );
    }

  return new EchoLlmService(dependencies.serviceName, dependencies.version, modelRepository);
};
