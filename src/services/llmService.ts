import type { ModelRepository } from "../repositories/modelRepository";
import {
  buildChatCompletionResponse,
  buildResponseOutput,
  buildModelsList,
  formatEchoContent,
  type ChatCompletionResponse,
  type ModelListResponse,
  type ResponseResponse,
  type StatusResponse,
} from "../utils/responses";
import { pickString, pickValue } from "../utils/validation";

export interface LlmService {
  getStatus(): StatusResponse;
  listModels(): ModelListResponse;
  createResponse(body: unknown): ResponseResponse;
  createChatCompletion(body: unknown): ChatCompletionResponse;
}

export class EchoLlmService implements LlmService {
  constructor(
    private readonly serviceName: string,
    private readonly version: string,
    private readonly modelRepository: ModelRepository,
  ) {}

  getStatus(): StatusResponse {
    return { status: "ok", service: this.serviceName, version: this.version };
  }

  listModels(): ModelListResponse {
    return {
      object: "list",
      data: buildModelsList(this.modelRepository.listModels(), this.serviceName),
    };
  }

  createResponse(body: unknown): ResponseResponse {
    const model = pickString(
      pickValue<string | undefined>(body, "model", undefined),
      this.modelRepository.defaultModel(),
    );

    const input = pickValue(body, "input", null);
    const messageContent = formatEchoContent(input);

    return buildResponseOutput("resp", model, messageContent);
  }

  createChatCompletion(body: unknown): ChatCompletionResponse {
    const model = pickString(
      pickValue<string | undefined>(body, "model", undefined),
      this.modelRepository.defaultModel(),
    );

    const messages = pickValue(body, "messages", [] as unknown);
    const messageContent = formatEchoContent(messages);

    return buildChatCompletionResponse("chatcmpl", model, messageContent);
  }
}
