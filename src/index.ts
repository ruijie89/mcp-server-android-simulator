#!/usr/bin/env node

import { MCPServer } from './servers/McpServer.js';

// Start the server
const mcpServer = new MCPServer();
mcpServer.start().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
