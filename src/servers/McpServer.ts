#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	ListResourcesRequestSchema,
	ListToolsRequestSchema,
	ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';


import { AndroidManager } from '../android/AndroidManager.js';
import {
	CreateAVDArgs,
	LaunchAppArgs,
	StartEmulatorArgs,
} from '../android/types.js';

export class MCPServer {
  private server: Server;
  private androidManager: AndroidManager;

  constructor() {
      this.androidManager = new AndroidManager();

      this.server = new Server(
          {
              name: 'android-mcp-server',
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

  private isStartEmulatorArgs(args: unknown): args is StartEmulatorArgs {
      const obj = args as Record<string, unknown>;
      return obj && typeof obj.avd_name === 'string';
  }

  private isCreateAVDArgs(args: unknown): args is CreateAVDArgs {
      const obj = args as Record<string, unknown>;
      return (
          obj &&
          typeof obj.name === 'string' &&
          typeof obj.package === 'string'
      );
  }

  private getPortArg(args: unknown): string {
      const obj = args as Record<string, unknown>;
      if (!obj || typeof obj.port !== 'string') {
          throw new Error(
              'Invalid arguments: port is required and must be a string',
          );
      }
      return obj.port;
  }

  private setupHandlers() {
      // List available tools
      this.server.setRequestHandler(ListToolsRequestSchema, async () => {
          return {
              tools: [
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
                      name: 'fold_emulator',
                      description: 'Fold a running Android emulator',
                      inputSchema: {
                          type: 'object',
                          properties: {
                              port: {
                                  type: 'string',
                                  description:
                                      'Port number of emulator to fold (e.g., "5554")',
                              },
                          },
                          required: ['port'],
                      },
                  },
                  {
                      name: 'unfold_emulator',
                      description: 'Unfold a running Android emulator',
                      inputSchema: {
                          type: 'object',
                          properties: {
                              port: {
                                  type: 'string',
                                  description:
                                      'Port number of emulator to unfold (e.g., "5554")',
                              },
                          },
                          required: ['port'],
                      },
                  },
                  {
                      name: 'list_running_emulators',
                      description: 'List all currently running Android emulators',
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
                  {
                      name: 'list_sdks',
                      description:
                          'List installed and available Android SDK packages',
                      inputSchema: {
                          type: 'object',
                          properties: {},
                      },
                  },
                  {
                      name: 'launch_app',
                      description:
                          'Launch an app on a running Android emulator',
                      inputSchema: {
                          type: 'object',
                          properties: {
                              port: {
                                  type: 'string',
                                  description:
                                      'Port number of the target emulator (e.g., "5554")',
                              },
                              package_name: {
                                  type: 'string',
                                  description:
                                      'Package name of the app to launch (e.g., "com.android.settings")',
                              },
                          },
                          required: ['port', 'package_name'],
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
                      case 'list_emulators':
                          return this.wrapResponse(
                              await this.androidManager.listEmulators(),
                          );
                      case 'start_emulator':
                          if (!this.isStartEmulatorArgs(args)) {
                              throw new Error(
                                  'Invalid arguments: avd_name is required',
                              );
                          }
                          return this.wrapResponse(
                              await this.androidManager.startEmulator(args),
                          );
                      case 'stop_emulator':
                          return this.wrapResponse(
                              await this.androidManager.stopEmulator(
                                  this.getPortArg(args),
                              ),
                          );
                      case 'fold_emulator':
                          return this.wrapResponse(
                              await this.androidManager.foldEmulator(
                                  this.getPortArg(args),
                              ),
                          );
                      case 'unfold_emulator':
                          return this.wrapResponse(
                              await this.androidManager.unfoldEmulator(
                                  this.getPortArg(args),
                              ),
                          );
                      case 'list_running_emulators':
                          return this.wrapResponse(
                              await this.androidManager.listRunningEmulators(),
                          );
                      case 'create_avd':
                          if (!this.isCreateAVDArgs(args)) {
                              throw new Error(
                                  'Invalid arguments: name and package are required',
                              );
                          }
                          return this.wrapResponse(
                              await this.androidManager.createAVD(args),
                          );
                      case 'get_emulator_info':
                          return this.wrapResponse(
                              JSON.stringify(
                                  await this.androidManager.getEmulatorInfo(
                                      this.getPortArg(args),
                                  ),
                                  null,
                                  2,
                              ),
                          );
                      case 'launch_app':
                          if (!this.isLaunchAppArgs(args)) {
                              throw new Error(
                                  'Invalid arguments: port and package_name are required',
                              );
                          }
                          return this.wrapResponse(
                              await this.androidManager.launchApp(args),
                          );
                      case 'list_sdks':
                          return this.wrapResponse(
                              await this.androidManager.listSDKs(),
                          );
                      default:
                          throw new Error(`Unknown tool: ${name}`);
                  }
              } catch (error) {
                  throw new Error(
                      `Tool execution failed: ${
                          error instanceof Error
                              ? error.message
                              : 'Unknown error'
                      }`,
                  );
              }
          },
      );

      // List resources
      this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
          return {
              resources: [
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
                      case 'android://emulators':
                          return {
                              contents: [
                                  {
                                      uri,
                                      mimeType: 'application/json',
                                      text: await this.androidManager.listEmulators(),
                                  },
                              ],
                          };
                      case 'android://running':
                          return {
                              contents: [
                                  {
                                      uri,
                                      mimeType: 'application/json',
                                      text: await this.androidManager.listRunningEmulators(),
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

  private wrapResponse(text: string) {
      return {
          content: [
              {
                  type: 'text',
                  text,
              },
          ],
      };
  }

  private isLaunchAppArgs(args: any): args is LaunchAppArgs {
      return (
          typeof args === 'object' &&
          typeof args.port === 'string' &&
          typeof args.package_name === 'string'
      );
  }

  public async start(): Promise<void> {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error('MCP Server started');
  }
}
