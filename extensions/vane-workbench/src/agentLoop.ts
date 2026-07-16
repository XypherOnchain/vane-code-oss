/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { completeWithTools, type ChatMessage, type ToolCall } from './modelGateway';
import { runTool, isSafeTool, workspaceRoot, type ToolResult } from './tools';
import { redactSecrets } from './redact';

const SYSTEM = `You are Vane Agent inside Vane AI - a crypto-native app for builders of all skill levels.

Rules:
- Speak in plain English. Avoid jargon unless the user uses it first.
- Call project_overview early when a folder is open so you understand the project kind (Foundry, Hardhat, Next, etc.).
- Use tools to list/read/search files before guessing.
- Prefer small, correct edits. When writing files, explain what changed in simple terms.
- Never ask for or echo private keys, seed phrases, or API secrets.
- Never enable Live mode. Never claim you can sign transactions or move funds in this phase.
- Wallets, trade, and token launch are not available yet - say so clearly if asked.
- Cite file paths you used.
- Be concise: plan briefly, act with tools, summarize results.`;

export type AgentEvent =
	| { type: 'error'; message: string }
	| { type: 'status'; message: string }
	| { type: 'delta'; text: string }
	| { type: 'final'; text: string }
	| { type: 'tool_start'; name: string; args: Record<string, unknown> }
	| { type: 'tool_end'; name: string; ok: boolean; summary: string };

export interface RunAgentTurnOpts {
	apiKey: string;
	provider: string;
	model: string;
	userText: string;
	history: ChatMessage[];
	onEvent: (e: AgentEvent) => void;
}

export async function runAgentTurn(opts: RunAgentTurnOpts): Promise<{ history: ChatMessage[] }> {
	const root = workspaceRoot();
	if (!root) {
		opts.onEvent({ type: 'error', message: 'Open a folder first (File -> Open Folder).' });
		return { history: opts.history };
	}

	const cfg = vscode.workspace.getConfiguration('vane');
	const autoSafe = cfg.get('agent.autoRunSafeTools') !== false;
	const mode = cfg.get('operatingMode') || 'code_only';
	const editor = vscode.window.activeTextEditor;
	const openPath = editor
		? vscode.workspace.asRelativePath(editor.document.uri)
		: '(none)';
	const selection = editor?.document.getText(editor.selection) || '';

	const { text: safeUser, redacted } = redactSecrets(opts.userText);
	let contextNote = `\n\n[Workspace: ${root}]\n[Mode: ${mode}]\n[Active file: ${openPath}]`;
	if (selection.trim()) {
		const sel = redactSecrets(selection.slice(0, 2000));
		contextNote += `\n[Selection]\n${sel.text}`;
	}
	if (redacted) {
		contextNote += `\n[Note: secrets redacted from your message]`;
	}

	const history: ChatMessage[] = [...opts.history];
	history.push({ role: 'user', content: safeUser + contextNote });

	opts.onEvent({ type: 'status', message: 'Thinking...' });

	let rounds = 0;
	while (rounds < 8) {
		rounds++;
		const result = await completeWithTools({
			provider: opts.provider,
			model: opts.model,
			apiKey: opts.apiKey,
			system: SYSTEM,
			messages: toProviderMessages(history, opts.provider),
			onDelta: (s) => opts.onEvent({ type: 'delta', text: s }),
		});

		if (!result.toolCalls.length) {
			history.push({ role: 'assistant', content: result.content || '(no response)' });
			opts.onEvent({ type: 'final', text: result.content || '' });
			return { history };
		}

		history.push({
			role: 'assistant',
			content: result.content || '',
			tool_calls: result.toolCalls,
		});

		for (const tc of result.toolCalls) {
			opts.onEvent({
				type: 'tool_start',
				name: tc.name,
				args: tc.arguments,
			});

			let toolResult: ToolResult;
			try {
				const skipConfirm = autoSafe && isSafeTool(tc.name);
				toolResult = await runTool(tc.name, tc.arguments || {}, { skipConfirm });
			} catch (e) {
				toolResult = { error: e instanceof Error ? e.message : String(e) };
			}

			const payload = JSON.stringify(toolResult).slice(0, 20_000);
			history.push({
				role: 'tool',
				tool_call_id: tc.id,
				name: tc.name,
				content: payload,
			});
			opts.onEvent({
				type: 'tool_end',
				name: tc.name,
				ok: !toolResult.error && toolResult.ok !== false,
				summary: summarizeTool(tc.name, toolResult),
			});
		}
	}

	opts.onEvent({ type: 'final', text: 'Stopped after multiple tool rounds. Ask me to continue.' });
	return { history };
}

function toProviderMessages(history: ChatMessage[], provider: string): unknown[] {
	if (provider === 'anthropic') {
		return history.map((m) => {
			if (m.role === 'tool') {
				return {
					role: 'tool',
					tool_call_id: m.tool_call_id,
					content: m.content,
				};
			}
			if (m.role === 'assistant' && m.tool_calls) {
				return {
					role: 'assistant',
					content: m.content,
					tool_calls: m.tool_calls.map((tc: ToolCall) => ({
						id: tc.id,
						name: tc.name,
						arguments: tc.arguments,
					})),
				};
			}
			return { role: m.role, content: m.content };
		});
	}

	return history.map((m) => {
		if (m.role === 'tool') {
			return {
				role: 'tool',
				tool_call_id: m.tool_call_id,
				content: m.content,
			};
		}
		if (m.role === 'assistant' && m.tool_calls) {
			return {
				role: 'assistant',
				content: m.content || null,
				tool_calls: m.tool_calls.map((tc: ToolCall) => ({
					id: tc.id,
					type: 'function',
					function: {
						name: tc.name,
						arguments: JSON.stringify(tc.arguments || {}),
					},
				})),
			};
		}
		return { role: m.role, content: m.content };
	});
}

function summarizeTool(name: string, result: ToolResult): string {
	if (!result) {
		return name;
	}
	if (result.error) {
		return `${name}: ${String(result.error)}`;
	}
	if (name === 'workspace_list') {
		return `listed ${((result.entries as unknown[]) || []).length} entries`;
	}
	if (name === 'workspace_read') {
		return `read ${String(result.path)}${result.redacted ? ' (redacted)' : ''}`;
	}
	if (name === 'workspace_search') {
		return `${((result.matches as unknown[]) || []).length} matches`;
	}
	if (name === 'workspace_write') {
		return result.ok ? `wrote ${String(result.path)}` : 'write denied';
	}
	if (name === 'terminal_run') {
		return result.ok ? `ran: ${String(result.command)}` : 'cmd failed/denied';
	}
	if (name === 'project_overview') {
		return result.ok ? `project: ${String(result.kindLabel || result.name)}` : 'no project open';
	}
	return name;
}
