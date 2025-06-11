import axios from 'axios';

import {
	ChatArgs,
	GenerateTextArgs,
	OllamaModel,
	OllamaResponse,
} from './types';

export class OllamaManager {
    private ollamaUrl: string;
    private defaultModel: string;

    constructor(ollamaUrl = 'http://localhost:11434', defaultModel = 'llama2') {
        this.ollamaUrl = ollamaUrl;
        this.defaultModel = defaultModel;
    }

    async generateText(args: GenerateTextArgs): Promise<string> {
        const {
            prompt,
            model = this.defaultModel,
            temperature,
            max_tokens,
        } = args;

        const response = await axios.post(`${this.ollamaUrl}/api/generate`, {
            model,
            prompt,
            stream: false,
            options: {
                ...(temperature !== undefined && {temperature}),
                ...(max_tokens !== undefined && {num_predict: max_tokens}),
            },
        });

        const data: OllamaResponse = response.data;
        return data.response;
    }

    async chat(args: ChatArgs): Promise<string> {
        const {messages, model = this.defaultModel} = args;

        const response = await axios.post(`${this.ollamaUrl}/api/chat`, {
            model,
            messages,
            stream: false,
        });

        return response.data.message.content;
    }

    async listModels(): Promise<string> {
        const models = await this.getModels();
        return models
            .map(
                (model: OllamaModel) =>
                    `${model.name} (Size: ${(
                        model.size /
                        1024 /
                        1024 /
                        1024
                    ).toFixed(2)}GB, Modified: ${model.modified_at})`,
            )
            .join('\n');
    }

    async getServerStatus(): Promise<object> {
        try {
            const response = await axios.get(`${this.ollamaUrl}/api/tags`);
            const models = response.data.models || [];

            return {
                status: 'online',
                url: this.ollamaUrl,
                models_count: models.length,
                default_model: this.defaultModel,
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            return {
                status: 'offline',
                url: this.ollamaUrl,
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date().toISOString(),
            };
        }
    }

    private async getModels(): Promise<OllamaModel[]> {
        const response = await axios.get(`${this.ollamaUrl}/api/tags`);
        return response.data.models || [];
    }
}
