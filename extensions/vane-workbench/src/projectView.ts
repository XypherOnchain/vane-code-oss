/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { analyzeWorkspace, type ProjectIntel } from './projectIntel';

interface Row {
	label: string;
	description?: string;
	tooltip?: string;
	command?: string;
}

export class ProjectViewProvider implements vscode.TreeDataProvider<Row> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<Row | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: Row): vscode.TreeItem {
		const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
		item.description = element.description;
		item.tooltip = element.tooltip;
		if (element.command) {
			item.command = { command: element.command, title: element.label };
		}
		return item;
	}

	getChildren(): Row[] {
		const intel = analyzeWorkspace();
		if (!intel) {
			return [
				{
					label: 'No project open',
					description: 'start here',
					tooltip: 'Open Home and choose Open project or New project.',
					command: 'vane.openHome',
				},
				{
					label: 'Open Vane Home',
					command: 'vane.openHome',
				},
			];
		}
		return rowsFromIntel(intel);
	}
}

function rowsFromIntel(intel: ProjectIntel): Row[] {
	const rows: Row[] = [
		{
			label: intel.name,
			description: intel.kindLabel,
			tooltip: intel.root,
		},
		{
			label: intel.readmeSummary,
			description: 'about',
			tooltip: intel.readmeSummary,
		},
		{
			label: `${intel.contracts.length} contract file(s)`,
			description: 'solidity',
			tooltip: intel.contracts.slice(0, 12).join('\n') || 'None yet',
		},
		{
			label: `${intel.scripts.length} script/deploy file(s)`,
			description: 'scripts',
			tooltip: intel.scripts.slice(0, 12).join('\n') || 'None yet',
		},
	];
	for (const step of intel.nextSteps) {
		rows.push({
			label: step,
			description: 'next',
			command: step.toLowerCase().includes('agent') ? 'vane.openAgent' : undefined,
		});
	}
	rows.push({
		label: 'Ask Agent about this project',
		description: 'chat',
		command: 'vane.openAgent',
	});
	return rows;
}
