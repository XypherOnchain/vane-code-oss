/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { runAgentTurn, type AgentEvent } from './agentLoop';
import type { ChatMessage } from './modelGateway';

export const SECRET_KEY = 'vane.agent.apiKey';

type WebviewMsg =
	| { type: 'ready' }
	| { type: 'setKey' }
	| { type: 'newChat' }
	| { type: 'chat'; text: string };

export class AgentViewProvider implements vscode.WebviewViewProvider {
	private view: vscode.WebviewView | undefined;
	history: ChatMessage[] = [];
	private busy = false;

	constructor(private readonly context: vscode.ExtensionContext) { }

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.context.extensionUri],
		};
		webviewView.webview.html = this.getHtml();

		webviewView.webview.onDidReceiveMessage(async (msg: WebviewMsg) => {
			if (msg.type === 'ready') {
				await this.pushConfig();
				return;
			}
			if (msg.type === 'setKey') {
				await vscode.commands.executeCommand('vane.agent.setApiKey');
				await this.pushConfig();
				return;
			}
			if (msg.type === 'newChat') {
				this.history = [];
				this.post({ type: 'cleared' });
				return;
			}
			if (msg.type === 'chat' && msg.text) {
				await this.handleChat(String(msg.text));
			}
		});
	}

	post(msg: Record<string, unknown> | AgentEvent): void {
		void this.view?.webview.postMessage(msg);
	}

	async pushConfig(): Promise<void> {
		const cfg = vscode.workspace.getConfiguration('vane');
		const key = await this.context.secrets.get(SECRET_KEY);
		this.post({
			type: 'config',
			provider: cfg.get('agent.provider') || 'openai',
			model: cfg.get('agent.model') || 'gpt-4o-mini',
			mode: cfg.get('operatingMode') || 'code_only',
			hasKey: Boolean(key),
		});
	}

	async handleChat(text: string): Promise<void> {
		if (this.busy) {
			this.post({ type: 'error', message: 'Still working...' });
			return;
		}
		const apiKey = await this.context.secrets.get(SECRET_KEY);
		if (!apiKey) {
			this.post({
				type: 'error',
				message: 'Set an API key first (Vane: Set Agent API Key).',
			});
			return;
		}
		const cfg = vscode.workspace.getConfiguration('vane');
		const provider = String(cfg.get('agent.provider') || 'openai');
		const model = String(cfg.get('agent.model') || 'gpt-4o-mini');

		this.busy = true;
		this.post({ type: 'user', text });
		this.post({ type: 'assistant_start' });

		try {
			const { history } = await runAgentTurn({
				apiKey,
				provider,
				model,
				userText: text,
				history: this.history,
				onEvent: (e) => this.post(e),
			});
			this.history = history.slice(-40);
		} catch (e) {
			this.post({
				type: 'error',
				message: e instanceof Error ? e.message : String(e),
			});
		} finally {
			this.busy = false;
			this.post({ type: 'idle' });
		}
	}

	private getHtml(): string {
		const htmlPath = path.join(this.context.extensionPath, 'media', 'agent.html');
		return fs.readFileSync(htmlPath, 'utf8');
	}
}
