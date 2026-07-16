/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AgentViewProvider, SECRET_KEY } from './agentView';

interface PlaceholderItem {
	label: string;
	description?: string;
	tooltip?: string;
}

class PlaceholderProvider implements vscode.TreeDataProvider<PlaceholderItem> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<PlaceholderItem | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(private readonly items: PlaceholderItem[]) { }

	getTreeItem(element: PlaceholderItem): vscode.TreeItem {
		const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
		item.description = element.description;
		item.tooltip = element.tooltip;
		return item;
	}

	getChildren(): PlaceholderItem[] {
		return this.items;
	}
}

let statusItems: vscode.StatusBarItem[] = [];

function refreshStatusBar(): void {
	const cfg = vscode.workspace.getConfiguration('vane');
	const provider = cfg.get('agent.provider') || 'openai';
	const model = cfg.get('agent.model') || 'gpt-4o-mini';
	const chain = cfg.get('placeholderChain') || 'Base Sepolia';
	const wallet = cfg.get('placeholderWallet') || 'None';
	const mode = cfg.get('operatingMode') || 'code_only';
	const labels = [
		`$(hubot) ${provider}/${model}`,
		`$(comment-discussion) Agent`,
		`$(globe) ${chain}`,
		`$(key) ${wallet}`,
		`$(shield) ${String(mode).toUpperCase()}`,
		`$(lock) Vault: Locked`,
	];
	for (let i = 0; i < statusItems.length; i++) {
		statusItems[i].text = labels[i];
		statusItems[i].show();
	}
}

export function activate(context: vscode.ExtensionContext): void {
	const agentView = new AgentViewProvider(context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('vane.agent', agentView, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	);

	const walletsProvider = new PlaceholderProvider([
		{
			label: 'Connect wallet (soon)',
			description: 'simulation',
			tooltip: 'MetaMask / external wallet connection lands after agent core. No keys in the agent.',
		},
		{
			label: 'Vault locked - Phase 5',
			description: 'vane-walletd',
			tooltip: 'Local encrypted vault is not in this build.',
		},
	]);
	const txProvider = new PlaceholderProvider([
		{
			label: 'Propose -> simulate -> approve',
			description: 'soon',
			tooltip: 'Transaction panel after agent feels like Cursor.',
		},
		{
			label: 'No signing in Agent chat',
			description: 'security',
			tooltip: 'The model cannot sign or broadcast.',
		},
	]);

	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('vane.wallets', walletsProvider),
		vscode.window.registerTreeDataProvider('vane.transactions', txProvider),
	);

	const alignments = [
		vscode.StatusBarAlignment.Left,
		vscode.StatusBarAlignment.Left,
		vscode.StatusBarAlignment.Left,
		vscode.StatusBarAlignment.Left,
		vscode.StatusBarAlignment.Right,
		vscode.StatusBarAlignment.Right,
	];
	const priorities = [100, 99, 98, 97, 100, 99];
	statusItems = alignments.map((align, i) => {
		const item = vscode.window.createStatusBarItem(align, priorities[i]);
		context.subscriptions.push(item);
		return item;
	});
	refreshStatusBar();

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('vane')) {
				refreshStatusBar();
			}
		}),
	);

	async function focusAgent(): Promise<void> {
		try {
			await vscode.commands.executeCommand('vane.agent.focus');
		} catch {
			await vscode.commands.executeCommand('workbench.view.extension.vane');
		}
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('vane.openAgent', () => focusAgent()),
		vscode.commands.registerCommand('vane.openWallets', async () => {
			try {
				await vscode.commands.executeCommand('vane.wallets.focus');
			} catch {
				await vscode.commands.executeCommand('workbench.view.extension.vane');
			}
		}),
		vscode.commands.registerCommand('vane.openTransactions', async () => {
			try {
				await vscode.commands.executeCommand('vane.transactions.focus');
			} catch {
				await vscode.commands.executeCommand('workbench.view.extension.vane');
			}
		}),
		vscode.commands.registerCommand('vane.showMode', () => {
			const mode = vscode.workspace.getConfiguration('vane').get('operatingMode');
			void vscode.window.showInformationMessage(
				`Vane mode: ${mode}. The agent cannot enable Live or sign transactions.`,
			);
		}),
		vscode.commands.registerCommand('vane.agent.setApiKey', async () => {
			const provider = vscode.workspace.getConfiguration('vane').get('agent.provider') || 'openai';
			const value = await vscode.window.showInputBox({
				title: `Vane Agent - ${provider} API key`,
				password: true,
				placeHolder: provider === 'anthropic' ? 'sk-ant-...' : 'sk-...',
				ignoreFocusOut: true,
			});
			if (!value) {
				return;
			}
			await context.secrets.store(SECRET_KEY, value.trim());
			void vscode.window.showInformationMessage('Vane Agent API key saved to Secret Storage.');
			await agentView.pushConfig();
		}),
		vscode.commands.registerCommand('vane.agent.clearApiKey', async () => {
			await context.secrets.delete(SECRET_KEY);
			void vscode.window.showInformationMessage('Vane Agent API key cleared.');
			await agentView.pushConfig();
		}),
		vscode.commands.registerCommand('vane.agent.newChat', () => {
			agentView.history = [];
			agentView.post({ type: 'cleared' });
		}),
	);

	void focusAgent();
}

export function deactivate(): void {
	statusItems = [];
}
