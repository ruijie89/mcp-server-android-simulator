#!/usr/bin/env node

import axios from 'axios';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	ListResourcesRequestSchema,
	ListToolsRequestSchema,
	ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

interface OllamaResponse {
    model: string;
    response: string;
    done: boolean;
    context?: number[];
}

interface OllamaModel {
    name: string;
    modified_at: string;
    size: number;
}

class OllamaMCPServer {
    private server: Server;
    private ollamaUrl: string;
    private defaultModel: string;

    constructor(ollamaUrl = 'http://localhost:11434', defaultModel = 'llama2') {
        this.ollamaUrl = ollamaUrl;
        this.defaultModel = defaultModel;

        this.server = new Server(
            {
                name: 'ollama-mcp-server',
                version: '1.0.0',
            },
            {
                capabilities: {
                    resources: {},
                    tools: {},
                },
            },
        );

        this.setupHandlers();
    }

    private setupHandlers() {
        // List available tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: 'generate_text',
                        description: 'Generate text using Ollama LLM',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                prompt: {
                                    type: 'string',
                                    description:
                                        'The prompt to send to the LLM',
                                },
                                model: {
                                    type: 'string',
                                    description:
                                        'The model to use (optional, defaults to configured model)',
                                },
                                temperature: {
                                    type: 'number',
                                    description:
                                        'Temperature for response generation (0.0 to 1.0)',
                                    minimum: 0,
                                    maximum: 1,
                                },
                                max_tokens: {
                                    type: 'number',
                                    description:
                                        'Maximum number of tokens to generate',
                                },
                            },
                            required: ['prompt'],
                        },
                    },
                    {
                        name: 'list_models',
                        description: 'List all available Ollama models',
                        inputSchema: {
                            type: 'object',
                            properties: {},
                        },
                    },
                    {
                        name: 'chat',
                        description: 'Have a conversation with the LLM',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                messages: {
                                    type: 'array',
                                    description: 'Array of chat messages',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            role: {
                                                type: 'string',
                                                enum: [
                                                    'user',
                                                    'assistant',
                                                    'system',
                                                ],
                                            },
                                            content: {
                                                type: 'string',
                                            },
                                        },
                                        required: ['role', 'content'],
                                    },
                                },
                                model: {
                                    type: 'string',
                                    description: 'The model to use (optional)',
                                },
                            },
                            required: ['messages'],
                        },
                    },
                ],
            };
        });

        // Handle tool calls
        this.server.setRequestHandler(
            CallToolRequestSchema,
            async (request) => {
                const {name, arguments: args} = request.params;

                try {
                    switch (name) {
                        case 'generate_text':
                            return await this.generateText(args);
                        case 'list_models':
                            return await this.listModels();
                        case 'chat':
                            return await this.chat(args);
                        default:
                            throw new Error(`Unknown tool: ${name}`);
                    }
                } catch (error) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Error: ${
                                    error instanceof Error
                                        ? error.message
                                        : 'Unknown error'
                                }`,
                            },
                        ],
                        isError: true,
                    };
                }
            },
        );

        // List resources
        this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
            return {
                resources: [
                    {
                        uri: 'ollama://status',
                        mimeType: 'application/json',
                        name: 'Ollama Server Status',
                        description: 'Current status of the Ollama server',
                    },
                    {
                        uri: 'ollama://models',
                        mimeType: 'application/json',
                        name: 'Available Models',
                        description: 'List of all available models in Ollama',
                    },
                ],
            };
        });

        // Read resources
        this.server.setRequestHandler(
            ReadResourceRequestSchema,
            async (request) => {
                const {uri} = request.params;

                try {
                    switch (uri) {
                        case 'ollama://status':
                            return await this.getServerStatus();
                        case 'ollama://models':
                            const models = await this.getModels();
                            return {
                                contents: [
                                    {
                                        uri,
                                        mimeType: 'application/json',
                                        text: JSON.stringify(models, null, 2),
                                    },
                                ],
                            };
                        default:
                            throw new Error(`Unknown resource: ${uri}`);
                    }
                } catch (error) {
                    throw new Error(
                        `Failed to read resource ${uri}: ${
                            error instanceof Error
                                ? error.message
                                : 'Unknown error'
                        }`,
                    );
                }
            },
        );
    }

    private async generateText(args: any) {
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

        return {
            content: [
                {
                    type: 'text',
                    text: data.response,
                },
            ],
        };
    }

    private async chat(args: any) {
        const {messages, model = this.defaultModel} = args;

        const response = await axios.post(`${this.ollamaUrl}/api/chat`, {
            model,
            messages,
            stream: false,
        });

        return {
            content: [
                {
                    type: 'text',
                    text: response.data.message.content,
                },
            ],
        };
    }

    private async listModels() {
        const models = await this.getModels();
        const modelList = models
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

        return {
            content: [
                {
                    type: 'text',
                    text: `Available Ollama Models:\n${modelList}`,
                },
            ],
        };
    }

    private async getModels(): Promise<OllamaModel[]> {
        const response = await axios.get(`${this.ollamaUrl}/api/tags`);
        return response.data.models || [];
    }

    private async getServerStatus() {
        try {
            const response = await axios.get(`${this.ollamaUrl}/api/tags`);
            const models = response.data.models || [];

            return {
                contents: [
                    {
                        uri: 'ollama://status',
                        mimeType: 'application/json',
                        text: JSON.stringify(
                            {
                                status: 'online',
                                url: this.ollamaUrl,
                                models_count: models.length,
                                default_model: this.defaultModel,
                                timestamp: new Date().toISOString(),
                            },
                            null,
                            2,
                        ),
                    },
                ],
            };
        } catch (error) {
            return {
                contents: [
                    {
                        uri: 'ollama://status',
                        mimeType: 'application/json',
                        text: JSON.stringify(
                            {
                                status: 'offline',
                                url: this.ollamaUrl,
                                error:
                                    error instanceof Error
                                        ? error.message
                                        : 'Unknown error',
                                timestamp: new Date().toISOString(),
                            },
                            null,
                            2,
                        ),
                    },
                ],
            };
        }
    }

    async start() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('Ollama MCP Server started');
    }
}

// Start the server
const server = new OllamaMCPServer();
server.start().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
