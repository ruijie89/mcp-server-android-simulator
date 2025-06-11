export interface OllamaResponse {
    model: string;
    response: string;
    done: boolean;
    context?: number[];
}

export interface OllamaModel {
    name: string;
    modified_at: string;
    size: number;
}

export interface GenerateTextArgs {
    prompt: string;
    model?: string;
    temperature?: number;
    max_tokens?: number;
}

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface ChatArgs {
    messages: ChatMessage[];
    model?: string;
}
