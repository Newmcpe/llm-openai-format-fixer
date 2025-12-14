export interface ModelRepository {
  listModels(): string[];
  defaultModel(): string;
}

export class EnvModelRepository implements ModelRepository {
  constructor(private readonly models: string[]) {}

  listModels(): string[] {
    return this.models;
  }

  defaultModel(): string {
    return this.models[0];
  }
}
