/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TOOL_DEFS } from './tools';

export interface ToolCall {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export interface ChatMessage {
	role: string;
	content?: string | null;
	tool_call_id?: string;
	name?: string;
	tool_calls?: ToolCall[];
}

export interface CompleteResult {
	provider: string;
	content: string;
	toolCalls: ToolCall[];
	rawAssistant: unknown;
}

export interface CompleteRequest {
	provider: string;
	model: string;
	apiKey: string;
	system: string;
	messages: unknown[];
	onDelta?: (s: string) => void;
}

export async function completeWithTools(req: CompleteRequest): Promise<CompleteResult> {
	if (req.provider === 'anthropic') {
		return anthropicChat(req);
	}
	return openaiChat(req);
}

async function openaiChat(req: CompleteRequest): Promise<CompleteResult> {
	const tools = TOOL_DEFS.map((t) => ({
		type: 'function',
		function: {
			name: t.name,
			description: t.description,
			parameters: t.parameters,
		},
	}));

	const body = {
		model: req.model,
		messages: [{ role: 'system', content: req.system }, ...req.messages],
		tools,
		tool_choice: 'auto',
		temperature: 0.2,
	};

	const res = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${req.apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		const err = await res.text();
		throw new Error(`OpenAI ${res.status}: ${err.slice(0, 400)}`);
	}
	const json = (await res.json()) as {
		choices?: Array<{
			message?: {
				content?: string;
				tool_calls?: Array<{
					id: string;
					function?: {
						name?: string;
						arguments?: string;
					};
				}>;
			};
		}>;
	};
	const msg = json.choices?.[0]?.message;
	if (!msg) {
		throw new Error('Empty OpenAI response');
	}

	const toolCalls: ToolCall[] = (msg.tool_calls || []).map((tc) => ({
		id: tc.id,
		name: tc.function?.name || '',
		arguments: safeJson(tc.function?.arguments),
	}));

	if (msg.content && req.onDelta) {
		req.onDelta(msg.content);
	}

	return {
		provider: 'openai',
		content: msg.content || '',
		toolCalls,
		rawAssistant: msg,
	};
}

async function anthropicChat(req: CompleteRequest): Promise<CompleteResult> {
	const tools = TOOL_DEFS.map((t) => ({
		name: t.name,
		description: t.description,
		input_schema: t.parameters,
	}));

	const messages = (req.messages as ChatMessage[]).map((m) => {
		if (m.role === 'tool') {
			return {
				role: 'user' as const,
				content: [
					{
						type: 'tool_result',
						tool_use_id: m.tool_call_id,
						content: m.content,
					},
				],
			};
		}
		if (m.role === 'assistant' && m.tool_calls) {
			return {
				role: 'assistant' as const,
				content: [
					...(m.content ? [{ type: 'text', text: m.content }] : []),
					...m.tool_calls.map((tc) => ({
						type: 'tool_use',
						id: tc.id,
						name: tc.name,
						input: tc.arguments || {},
					})),
				],
			};
		}
		return {
			role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
			content: m.content,
		};
	});

	const merged: typeof messages = [];
	for (const m of messages) {
		const prev = merged[merged.length - 1];
		if (
			prev &&
			prev.role === 'user' &&
			m.role === 'user' &&
			Array.isArray(prev.content) &&
			Array.isArray(m.content)
		) {
			(prev.content as unknown[]).push(...(m.content as unknown[]));
		} else {
			merged.push(m);
		}
	}

	const res = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'x-api-key': req.apiKey,
			'anthropic-version': '2023-06-01',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			model: req.model,
			max_tokens: 4096,
			system: req.system,
			tools,
			messages: merged,
		}),
	});
	if (!res.ok) {
		const err = await res.text();
		throw new Error(`Anthropic ${res.status}: ${err.slice(0, 400)}`);
	}
	const json = (await res.json()) as {
		content?: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[];
	};
	const blocks = json.content || [];
	let content = '';
	const toolCalls: ToolCall[] = [];
	for (const b of blocks) {
		if (b.type === 'text' && b.text) {
			content += b.text;
			if (req.onDelta) {
				req.onDelta(b.text);
			}
		}
		if (b.type === 'tool_use' && b.id && b.name) {
			toolCalls.push({ id: b.id, name: b.name, arguments: b.input || {} });
		}
	}
	return {
		provider: 'anthropic',
		content,
		toolCalls,
		rawAssistant: { role: 'assistant', content, tool_calls: toolCalls },
	};
}

function safeJson(s: string | undefined | object): Record<string, unknown> {
	if (typeof s === 'object' && s) {
		return s as Record<string, unknown>;
	}
	try {
		return JSON.parse((s as string) || '{}') as Record<string, unknown>;
	} catch {
		return {};
	}
}
