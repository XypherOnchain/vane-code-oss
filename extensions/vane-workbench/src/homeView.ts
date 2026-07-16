/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { analyzeWorkspace, modeLabel, walletLabel } from './projectIntel';

type HomeMsg =
	| { type: 'ready' }
	| { type: 'action'; action: string; text?: string };

export class HomeView {
	private panel: vscode.WebviewPanel | undefined;

	constructor(private readonly context: vscode.ExtensionContext) { }

	async show(_force = false): Promise<void> {
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.One, false);
			await this.pushState();
			return;
		}

		this.panel = vscode.window.createWebviewPanel(
			'vane.home',
			'Vane AI',
			{ viewColumn: vscode.ViewColumn.One, preserveFocus: false },
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
			},
		);

		const htmlPath = path.join(this.context.extensionPath, 'media', 'home.html');
		const logoUri = this.panel.webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vane-logo.png'),
		);
		const raw = fs.readFileSync(htmlPath, 'utf8');
		this.panel.webview.html = raw
			.replaceAll('{{LOGO_URI}}', logoUri.toString())
			.replaceAll('{{CSP_SOURCE}}', this.panel.webview.cspSource);

		this.panel.webview.onDidReceiveMessage(async (msg: HomeMsg) => {
			if (msg.type === 'ready') {
				await this.pushState();
				return;
			}
			if (msg.type === 'action') {
				await this.handleAction(msg.action, msg.text);
			}
		});

		this.panel.onDidDispose(() => {
			this.panel = undefined;
		});

		await this.pushState();
	}

	async pushState(): Promise<void> {
		const cfg = vscode.workspace.getConfiguration('vane');
		const intel = analyzeWorkspace();
		const model = String(cfg.get('agent.model') || 'gpt-4o-mini');
		this.panel?.webview.postMessage({
			type: 'state',
			modeLabel: modeLabel(String(cfg.get('operatingMode') || 'code_only')),
			model,
			modelLabel: prettyModel(model),
			chain: String(cfg.get('placeholderChain') || 'Base Sepolia'),
			walletLabel: walletLabel(String(cfg.get('placeholderWallet') || 'None')) === 'No wallet yet'
				? 'No wallet connected'
				: walletLabel(String(cfg.get('placeholderWallet') || 'None')),
			hasProject: Boolean(intel),
			projectName: intel?.name,
			projectSummary: intel ? `${intel.summaryLine}. ${intel.readmeSummary}` : '',
			kindLabel: intel?.kindLabel,
			contractCount: intel?.contracts.length ?? 0,
		});
	}

	private async handleAction(action: string, text?: string): Promise<void> {
		switch (action) {
			case 'homeNav':
				await this.pushState();
				break;
			case 'openProject':
				await vscode.commands.executeCommand('vscode.openFolder');
				break;
			case 'newProject':
				await createGuidedProject();
				break;
			case 'askAgent':
			case 'askProject':
				await vscode.commands.executeCommand('vane.agent.askWithText', text || '');
				break;
			case 'openProjectView':
				try {
					await vscode.commands.executeCommand('vane.project.focus');
				} catch {
					await vscode.commands.executeCommand('workbench.view.extension.vane');
				}
				break;
			case 'wallets':
				await vscode.commands.executeCommand('vane.openWallets');
				void vscode.window.showInformationMessage(
					'Connect Wallet is next. Placeholder only for now - no keys in the Agent.',
				);
				break;
			case 'trade':
			case 'bridge':
				await vscode.commands.executeCommand('vane.openTransactions');
				void vscode.window.showInformationMessage(
					'Trade / bridge are not available yet. Stay in Safe mode.',
				);
				break;
			case 'deploy':
			case 'simulate':
				void vscode.window.showInformationMessage(
					'Deploy and Simulate land in later phases. Use Agent to prepare contracts for now.',
				);
				break;
			case 'settings':
				await vscode.commands.executeCommand('workbench.action.openSettings', 'vane.');
				break;
			default:
				break;
		}
	}
}

function prettyModel(model: string): string {
	if (model.includes('gpt-4o')) {
		return 'GPT-4o';
	}
	if (model.includes('claude')) {
		return 'Claude';
	}
	return model;
}

async function createGuidedProject(): Promise<void> {
	const name = await vscode.window.showInputBox({
		title: 'New Vane project',
		prompt: 'Name your project folder',
		placeHolder: 'my-crypto-app',
		validateInput: (v) => {
			if (!v.trim()) {
				return 'Enter a name';
			}
			if (!/^[A-Za-z0-9._-]+$/.test(v.trim())) {
				return 'Use letters, numbers, dots, dashes, or underscores only';
			}
			return undefined;
		},
	});
	if (!name) {
		return;
	}

	const parent = await vscode.window.showOpenDialog({
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
		openLabel: 'Create project here',
		title: 'Choose a parent folder',
	});
	if (!parent?.[0]) {
		return;
	}

	const root = path.join(parent[0].fsPath, name.trim());
	if (fs.existsSync(root)) {
		void vscode.window.showErrorMessage('That folder already exists. Pick another name.');
		return;
	}

	fs.mkdirSync(path.join(root, 'contracts'), { recursive: true });
	fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
	fs.writeFileSync(
		path.join(root, 'README.md'),
		[
			`# ${name.trim()}`,
			'',
			'Starter project created by Vane AI.',
			'',
			'## What to do next',
			'',
			'1. Open the **Agent** from Home.',
			'2. Ask: "Explain this project and help me add a simple Solidity token."',
			'3. Approve file edits when Vane asks.',
			'',
			'Wallets and live trading are not enabled in this starter. Stay in Safe mode.',
			'',
		].join('\n'),
		'utf8',
	);
	fs.writeFileSync(
		path.join(root, '.gitignore'),
		['node_modules/', 'out/', 'cache/', 'broadcast/', '.env', '.env.*', 'dist/'].join('\n') + '\n',
		'utf8',
	);
	fs.writeFileSync(path.join(root, 'contracts', '.gitkeep'), '', 'utf8');

	const open = await vscode.window.showInformationMessage(
		`Created ${name.trim()}. Open it now?`,
		'Open project',
		'Later',
	);
	if (open === 'Open project') {
		await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(root), false);
	}
}
