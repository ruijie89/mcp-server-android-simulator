# MCP Ollama Server

A Model Context Protocol (MCP) server that provides integration with local Ollama LLM instances.

## Features

- **Text Generation**: Generate text using any Ollama model
- **Chat Interface**: Have conversations with LLMs
- **Model Management**: List and switch between available models
- **Server Status**: Monitor Ollama server health
- **Resource Access**: Access server status and model information as resources

## Prerequisites

1. **Ollama**: Install Ollama on your system

   ```bash
   # On macOS
   brew install ollama
   
   # On Linux
   curl -fsSL https://ollama.ai/install.sh | sh
   ```

2. **Node.js**: Version 18 or higher

3. **Pull a model**: Download at least one model in Ollama

   ```bash
   ollama pull llama2
   # or
   ollama pull codellama
   # or
   ollama pull mistral
   ```

## Installation

1. Clone or create the project directory
2. Install dependencies:

   ```bash
   npm install
   ```

3. Build the TypeScript:

   ```bash
   npm run build
   ```

## Usage

### Starting the Server

```bash
npm start
```

The server communicates via stdio and is designed to be used with MCP-compatible clients.

### Available Tools

1. **generate_text**
   - Generate text from a prompt
   - Parameters: `prompt` (required), `model` (optional), `temperature` (optional), `max_tokens` (optional)

2. **chat**
   - Have a conversation with the LLM
   - Parameters: `messages` (array of {role, content}), `model` (optional)

3. **list_models**
   - List all available Ollama models
   - No parameters required

### Available Resources

1. **ollama://status** - Current server status and configuration
2. **ollama://models** - Detailed list of available models

## Configuration

You can customize the server by modifying the constructor parameters in `src/index.ts`:

```typescript
// Change Ollama URL (default: http://localhost:11434)
// Change default model (default: llama2)
const server = new OllamaMCPServer('http://localhost:11434', 'your-preferred-model');
```

## Example Usage with MCP Client

```javascript
// Generate text
{
  "method": "tools/call",
  "params": {
    "name": "generate_text",
    "arguments": {
      "prompt": "Explain quantum computing in simple terms",
      "model": "llama2",
      "temperature": 0.7
    }
  }
}

// Chat conversation
{
  "method": "tools/call",
  "params": {
    "name": "chat",
    "arguments": {
      "messages": [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "What is the capital of France?"}
      ],
      "model": "llama2"
    }
  }
}
```

## Development

- **Build**: `npm run build`
- **Watch mode**: `npm run watch`
- **Development**: `npm run dev`

## Troubleshooting

1. **"Connection refused" errors**:
   - Make sure Ollama is running: `ollama serve`
   - Check if Ollama is accessible at `http://localhost:11434`

2. **"Model not found" errors**:
   - List available models: `ollama list`
   - Pull a model if needed: `ollama pull llama2`

3. **Permission errors**:
   - Make sure the built file is executable: `chmod +x dist/index.js`

## Architecture

The server implements the MCP protocol and acts as a bridge between MCP clients and your local Ollama instance. It provides:

- **Tools**: Interactive functions that can be called by MCP clients
- **Resources**: Static or dynamic content that can be read by clients
- **Stdio Transport**: Communication via standard input/output for integration with MCP clients

## License

MIT
