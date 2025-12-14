import { EnvModelRepository, type ModelRepository } from "./modelRepository";

export const createModelRepository = (models: string[]): ModelRepository =>
  new EnvModelRepository(models);
