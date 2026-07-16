/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AgentViewProvider, SECRET_KEY } from './agentView';
import { HomeView } from './homeView';
import { modeLabel, walletLabel } from './projectIntel';
import { ProjectViewProvider } from './projectView';

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
	const wallet = walletLabel(String(cfg.get('placeholderWallet') || 'None'));
	const mode = modeLabel(String(cfg.get('operatingMode') || 'code_only'));
	const labels = [
		`$(hubot) ${provider}/${model}`,
		`$(comment-discussion) Agent`,
		`$(globe) ${chain}`,
		`$(key) ${wallet}`,
		`$(shield) ${mode}`,
		`$(lock) Vault locked`,
	];
	for (let i = 0; i < statusItems.length; i++) {
		statusItems[i].text = labels[i];
		statusItems[i].show();
	}
}

async function demoteStockChat(): Promise<void> {
	const hideCommands = [
		'workbench.action.closeAuxiliaryBar',
		'workbench.action.chat.close',
		'workbench.panel.chat.view.copilot.focus',
	];
	for (const cmd of ['workbench.action.closeAuxiliaryBar', 'workbench.action.chat.close']) {
		try {
			await vscode.commands.executeCommand(cmd);
		} catch {
			/* command may not exist in this build */
		}
	}
	void hideCommands;
}

export function activate(context: vscode.ExtensionContext): void {
	const home = new HomeView(context);
	const agentView = new AgentViewProvider(context);
	const projectView = new ProjectViewProvider();

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('vane.agent', agentView, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
		vscode.window.registerTreeDataProvider('vane.project', projectView),
	);

	const walletsProvider = new PlaceholderProvider([
		{
			label: 'Connect a wallet',
			description: 'soon',
			tooltip: 'MetaMask and other wallets come after Safe mode feels solid. No keys in the Agent.',
		},
		{
			label: 'Vault locked',
			description: 'local security',
			tooltip: 'Encrypted local vault arrives in a later phase. Nothing can send funds from chat.',
		},
		{
			label: 'Practice with simulation first',
			description: 'safe',
			tooltip: 'When wallets land, start in simulation - not mainnet.',
		},
	]);
	const txProvider = new PlaceholderProvider([
		{
			label: 'Propose, then simulate, then you approve',
			description: 'soon',
			tooltip: 'Every money move will require your explicit approval.',
		},
		{
			label: 'Trade and token launch',
			description: 'soon',
			tooltip: 'Swaps, bridges, and launches are planned - not available yet.',
		},
		{
			label: 'Agent cannot sign or send funds',
			description: 'security',
			tooltip: 'The AI is blocked from Live mode and signing.',
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
				void home.pushState();
			}
		}),
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			projectView.refresh();
			void home.pushState();
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
		vscode.commands.registerCommand('vane.openHome', () => home.show(true)),
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
		vscode.commands.registerCommand('vane.openProjectOverview', async () => {
			try {
				await vscode.commands.executeCommand('vane.project.focus');
			} catch {
				await vscode.commands.executeCommand('workbench.view.extension.vane');
			}
		}),
		vscode.commands.registerCommand('vane.refreshProject', () => {
			projectView.refresh();
			void home.pushState();
		}),
		vscode.commands.registerCommand('vane.showMode', () => {
			const mode = vscode.workspace.getConfiguration('vane').get('operatingMode');
			void vscode.window.showInformationMessage(
				`Vane is in ${modeLabel(String(mode))}. The Agent cannot turn on Live or send funds.`,
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
			void vscode.window.showInformationMessage('API key saved securely on this computer.');
			await agentView.pushConfig();
		}),
		vscode.commands.registerCommand('vane.agent.clearApiKey', async () => {
			await context.secrets.delete(SECRET_KEY);
			void vscode.window.showInformationMessage('API key cleared.');
			await agentView.pushConfig();
		}),
		vscode.commands.registerCommand('vane.agent.newChat', () => {
			agentView.history = [];
			agentView.post({ type: 'cleared' });
		}),
	);

	void (async () => {
		await demoteStockChat();
		await home.show(true);
		try {
			await vscode.commands.executeCommand('workbench.view.extension.vane');
		} catch {
			/* ignore */
		}
	})();
}

export function deactivate(): void {
	statusItems = [];
}
