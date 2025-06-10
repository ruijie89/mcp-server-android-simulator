#!/usr/bin/env node

import axios from 'axios';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

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

interface EmulatorDevice {
    name: string;
    target: string;
    sdk: string;
    abi: string;
}

const execAsync = promisify(exec);

class OllamaMCPServer {
    private server: Server;
    private ollamaUrl: string;
    private defaultModel: string;
    private androidHome: string;
    private androidPaths: {
        avdManager: string;
        emulator: string;
        adb: string;
    };

    constructor(ollamaUrl = 'http://localhost:11434', defaultModel = 'llama2') {
        this.ollamaUrl = ollamaUrl;
        this.defaultModel = defaultModel;

        // Initialize Android SDK paths
        this.androidHome =
            process.env.ANDROID_HOME ||
            `${process.env.HOME}/Library/Android/sdk`;
        this.androidPaths = {
            avdManager: `${this.androidHome}/cmdline-tools/latest/bin/avdmanager`,
            emulator: `${this.androidHome}/emulator/emulator`,
            adb: `${this.androidHome}/platform-tools/adb`,
        };

        this.server = new Server(
            {
                name: 'ollama-android-mcp-server',
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
                    {
                        name: 'list_emulators',
                        description:
                            'List all available Android emulators (AVDs)',
                        inputSchema: {
                            type: 'object',
                            properties: {},
                        },
                    },
                    {
                        name: 'start_emulator',
                        description: 'Start an Android emulator',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                avd_name: {
                                    type: 'string',
                                    description: 'Name of the AVD to start',
                                },
                                cold_boot: {
                                    type: 'boolean',
                                    description:
                                        'Perform a cold boot (optional, default: false)',
                                },
                                wipe_data: {
                                    type: 'boolean',
                                    description:
                                        'Wipe user data before starting (optional, default: false)',
                                },
                                gpu: {
                                    type: 'string',
                                    description:
                                        'GPU acceleration mode (auto, host, swiftshader_indirect, angle_indirect, guest)',
                                },
                                port: {
                                    type: 'number',
                                    description:
                                        'Console port number (optional)',
                                },
                            },
                            required: ['avd_name'],
                        },
                    },
                    {
                        name: 'stop_emulator',
                        description: 'Stop a running Android emulator',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                port: {
                                    type: 'string',
                                    description:
                                        'Port number of emulator to stop (e.g., "5554")',
                                },
                            },
                            required: ['port'],
                        },
                    },
                    {
                        name: 'list_running_emulators',
                        description: 'List currently running Android emulators',
                        inputSchema: {
                            type: 'object',
                            properties: {},
                        },
                    },
                    {
                        name: 'create_avd',
                        description:
                            'Create a new Android Virtual Device (AVD)',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                name: {
                                    type: 'string',
                                    description: 'Name for the new AVD',
                                },
                                package: {
                                    type: 'string',
                                    description:
                                        'System image package (e.g., "system-images;android-34;google_apis;x86_64")',
                                },
                                device: {
                                    type: 'string',
                                    description:
                                        'Device profile (optional, e.g., "pixel_7")',
                                },
                            },
                            required: ['name', 'package'],
                        },
                    },
                    {
                        name: 'get_emulator_info',
                        description:
                            'Get detailed information about a specific emulator',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                port: {
                                    type: 'string',
                                    description:
                                        'Port number of the emulator (e.g., "5554")',
                                },
                            },
                            required: ['port'],
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
                        case 'list_emulators':
                            return await this.listEmulators();
                        case 'start_emulator':
                            return await this.startEmulator(args);
                        case 'stop_emulator':
                            return await this.stopEmulator(args);
                        case 'list_running_emulators':
                            return await this.listRunningEmulators();
                        case 'create_avd':
                            return await this.createAVD(args);
                        case 'get_emulator_info':
                            return await this.getEmulatorInfo(args);
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
                    {
                        uri: 'android://emulators',
                        mimeType: 'application/json',
                        name: 'Android Emulators',
                        description:
                            'List of all available Android Virtual Devices',
                    },
                    {
                        uri: 'android://running',
                        mimeType: 'application/json',
                        name: 'Running Emulators',
                        description:
                            'List of currently running Android emulators',
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
                        case 'android://emulators':
                            const emulators = await this.getEmulators();
                            return {
                                contents: [
                                    {
                                        uri,
                                        mimeType: 'application/json',
                                        text: JSON.stringify(
                                            emulators,
                                            null,
                                            2,
                                        ),
                                    },
                                ],
                            };
                        case 'android://running':
                            const running = await this.getRunningEmulators();
                            return {
                                contents: [
                                    {
                                        uri,
                                        mimeType: 'application/json',
                                        text: JSON.stringify(running, null, 2),
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

    // Android Emulator Methods
    private async listEmulators() {
        const emulators = await this.getEmulators();
        const emulatorList = emulators
            .map(
                (emulator: EmulatorDevice) =>
                    `${emulator.name} (Target: ${emulator.target}, ABI: ${emulator.abi})`,
            )
            .join('\n');

        return {
            content: [
                {
                    type: 'text',
                    text: `Available Android Emulators:\n${emulatorList}`,
                },
            ],
        };
    }

    private getAndroidEnv(): NodeJS.ProcessEnv {
        return {
            ...process.env,
            ANDROID_HOME: this.androidHome,
            PATH: `${this.androidHome}/platform-tools:${this.androidHome}/cmdline-tools/latest/bin:${this.androidHome}/emulator:${process.env.PATH}`,
        };
    }

    private async startEmulator(args: any) {
        const {
            avd_name,
            cold_boot = false,
            wipe_data = false,
            gpu,
            port,
        } = args;

        try {
            // Start emulator in background
            const emulatorArgs = [
                '-avd',
                avd_name,
                ...(cold_boot ? ['-no-snapshot-load'] : []),
                ...(wipe_data ? ['-wipe-data'] : []),
                ...(gpu ? ['-gpu', gpu] : []),
                ...(port ? ['-port', port.toString()] : []),
            ];

            const child = spawn(this.androidPaths.emulator, emulatorArgs, {
                detached: true,
                stdio: 'ignore',
                env: this.getAndroidEnv(),
            });

            child.unref();

            return {
                content: [
                    {
                        type: 'text',
                        text: `Starting emulator "${avd_name}"... It may take a few moments to fully boot.`,
                    },
                ],
            };
        } catch (error) {
            throw new Error(
                `Failed to start emulator: ${
                    error instanceof Error ? error.message : 'Unknown error'
                }`,
            );
        }
    }

    private async stopEmulator(args: any) {
        const {port} = args;

        try {
            const {stdout} = await execAsync(
                `${this.androidPaths.adb} -s emulator-${port} emu kill`,
                {
                    env: this.getAndroidEnv(),
                },
            );

            return {
                content: [
                    {
                        type: 'text',
                        text: `Emulator on port ${port} has been stopped.`,
                    },
                ],
            };
        } catch (error) {
            throw new Error(
                `Failed to stop emulator: ${
                    error instanceof Error ? error.message : 'Unknown error'
                }`,
            );
        }
    }

    private async listRunningEmulators() {
        const running = await this.getRunningEmulators();
        const runningList = running
            .map((device: any) => `${device.name} (Port: ${device.port})`)
            .join('\n');

        return {
            content: [
                {
                    type: 'text',
                    text: runningList
                        ? `Running Emulators:\n${runningList}`
                        : 'No emulators currently running.',
                },
            ],
        };
    }

    private async createAVD(args: any) {
        const {name, package: pkg, device} = args;

        try {
            const avdArgs = [
                'create',
                'avd',
                '-n',
                name,
                '-k',
                `"${pkg}"`,
                ...(device ? ['-d', device] : []),
            ];

            const {stdout} = await execAsync(
                `${this.androidPaths.avdManager} ${avdArgs.join(' ')}`,
                {
                    env: this.getAndroidEnv(),
                },
            );

            return {
                content: [
                    {
                        type: 'text',
                        text: `AVD "${name}" created successfully.\n${stdout}`,
                    },
                ],
            };
        } catch (error) {
            throw new Error(
                `Failed to create AVD: ${
                    error instanceof Error ? error.message : 'Unknown error'
                }`,
            );
        }
    }

    private async getEmulatorInfo(args: any) {
        const {port} = args;

        try {
            const {stdout} = await execAsync(
                `${this.androidPaths.adb} -s emulator-${port} shell getprop`,
                {
                    env: this.getAndroidEnv(),
                },
            );
            const lines = stdout.split('\n');

            const info = {
                port,
                build_version: this.extractProperty(
                    lines,
                    'ro.build.version.release',
                ),
                api_level: this.extractProperty(lines, 'ro.build.version.sdk'),
                device_name: this.extractProperty(lines, 'ro.product.model'),
                manufacturer: this.extractProperty(
                    lines,
                    'ro.product.manufacturer',
                ),
                architecture: this.extractProperty(lines, 'ro.product.cpu.abi'),
            };

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(info, null, 2),
                    },
                ],
            };
        } catch (error) {
            throw new Error(
                `Failed to get emulator info: ${
                    error instanceof Error ? error.message : 'Unknown error'
                }`,
            );
        }
    }

    private extractProperty(lines: string[], property: string): string {
        const line = lines.find((l) => l.includes(`[${property}]`));
        return line
            ? line.split(']: [')[1]?.replace(']', '') || 'Unknown'
            : 'Unknown';
    }

    private async getEmulators(): Promise<EmulatorDevice[]> {
        try {
            const {stdout} = await execAsync(
                `${this.androidPaths.avdManager} list avd`,
                {
                    env: this.getAndroidEnv(),
                },
            );

            const emulators: EmulatorDevice[] = [];
            const avdBlocks = stdout.split('Name: ').slice(1);

            for (const block of avdBlocks) {
                const lines = block.split('\n');
                const name = lines[0].trim();
                const target =
                    lines
                        .find((l) => l.includes('Target:'))
                        ?.split('Target: ')[1]
                        ?.trim() || 'Unknown';
                const abi =
                    lines
                        .find((l) => l.includes('ABI:'))
                        ?.split('ABI: ')[1]
                        ?.trim() || 'Unknown';

                emulators.push({
                    name,
                    target,
                    sdk: target,
                    abi,
                });
            }

            return emulators;
        } catch (error) {
            console.error('Error listing emulators:', error);
            return [];
        }
    }

    private async getRunningEmulators(): Promise<any[]> {
        try {
            const {stdout} = await execAsync(
                `${this.androidPaths.adb} devices`,
                {
                    env: this.getAndroidEnv(),
                },
            );
            const lines = stdout.split('\n').slice(1);
            const running = [];

            for (const line of lines) {
                if (line.includes('emulator-') && line.includes('device')) {
                    const port = line.split('emulator-')[1]?.split('\t')[0];
                    if (port) {
                        running.push({
                            name: `emulator-${port}`,
                            port: port,
                        });
                    }
                }
            }

            return running;
        } catch (error) {
            console.error('Error listing running emulators:', error);
            return [];
        }
    }

    public async start(): Promise<void> {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('Ollama MCP Server started');
    }
}

// Start the server
const mcpServer = new OllamaMCPServer();
mcpServer.start().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
