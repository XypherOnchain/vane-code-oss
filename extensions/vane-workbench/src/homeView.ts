/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { analyzeWorkspace, modeLabel } from './projectIntel';

type HomeMsg =
	| { type: 'ready' }
	| { type: 'action'; action: string };

export class HomeView {
	private panel: vscode.WebviewPanel | undefined;

	constructor(private readonly context: vscode.ExtensionContext) { }

	async show(force = false): Promise<void> {
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.One, false);
			await this.pushState();
			return;
		}
		if (!force) {
			const folders = vscode.workspace.workspaceFolders;
			if (folders?.length) {
				/* still show Home so beginners land on Vane, not Welcome */
			}
		}

		this.panel = vscode.window.createWebviewPanel(
			'vane.home',
			'Vane Home',
			{ viewColumn: vscode.ViewColumn.One, preserveFocus: false },
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
			},
		);

		const htmlPath = path.join(this.context.extensionPath, 'media', 'home.html');
		this.panel.webview.html = fs.readFileSync(htmlPath, 'utf8');

		this.panel.webview.onDidReceiveMessage(async (msg: HomeMsg) => {
			if (msg.type === 'ready') {
				await this.pushState();
				return;
			}
			if (msg.type === 'action') {
				await this.handleAction(msg.action);
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
		this.panel?.webview.postMessage({
			type: 'state',
			modeLabel: modeLabel(String(cfg.get('operatingMode') || 'code_only')),
			hasProject: Boolean(intel),
			projectName: intel?.name,
			projectSummary: intel ? `${intel.summaryLine}. ${intel.readmeSummary}` : '',
		});
	}

	private async handleAction(action: string): Promise<void> {
		switch (action) {
			case 'openProject':
				await vscode.commands.executeCommand('vscode.openFolder');
				break;
			case 'newProject':
				await createGuidedProject();
				break;
			case 'askAgent':
			case 'askProject':
				await vscode.commands.executeCommand('vane.openAgent');
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
					'Wallets are next. You can browse the placeholder now; connect comes in a later phase.',
				);
				break;
			case 'trade':
				await vscode.commands.executeCommand('vane.openTransactions');
				void vscode.window.showInformationMessage(
					'Trade and launch are not available yet. Safe mode only - the Agent cannot send funds.',
				);
				break;
			case 'home':
				await this.pushState();
				break;
			default:
				break;
		}
	}
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
			'1. Open the **Agent** panel (rocket icon on the left).',
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
	fs.writeFileSync(
		path.join(root, 'contracts', '.gitkeep'),
		'',
		'utf8',
	);

	const open = await vscode.window.showInformationMessage(
		`Created ${name.trim()}. Open it now?`,
		'Open project',
		'Later',
	);
	if (open === 'Open project') {
		await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(root), false);
	}
}
