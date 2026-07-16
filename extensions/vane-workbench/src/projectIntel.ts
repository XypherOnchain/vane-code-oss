/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { workspaceRoot } from './tools';

export type ProjectKind =
	| 'foundry'
	| 'hardhat'
	| 'solidity'
	| 'next'
	| 'node'
	| 'empty'
	| 'unknown';

export interface ProjectIntel {
	root: string;
	name: string;
	kind: ProjectKind;
	kindLabel: string;
	contracts: string[];
	scripts: string[];
	readmeSummary: string;
	nextSteps: string[];
	summaryLine: string;
}

const SKIP = new Set([
	'node_modules',
	'.git',
	'out',
	'dist',
	'cache',
	'coverage',
	'.next',
	'lib',
	'broadcast',
	'.build',
]);

function exists(root: string, rel: string): boolean {
	return fs.existsSync(path.join(root, rel));
}

function walkFiles(root: string, maxFiles = 400): string[] {
	const out: string[] = [];
	function walk(dir: string, depth: number): void {
		if (out.length >= maxFiles || depth > 8) {
			return;
		}
		let names: string[];
		try {
			names = fs.readdirSync(dir);
		} catch {
			return;
		}
		for (const name of names) {
			if (SKIP.has(name) || name.startsWith('.')) {
				continue;
			}
			const full = path.join(dir, name);
			let st: fs.Stats;
			try {
				st = fs.statSync(full);
			} catch {
				continue;
			}
			if (st.isDirectory()) {
				walk(full, depth + 1);
			} else if (st.isFile()) {
				out.push(full);
			}
		}
	}
	walk(root, 0);
	return out;
}

function detectKind(root: string, files: string[]): ProjectKind {
	if (exists(root, 'foundry.toml') || exists(root, 'lib/forge-std')) {
		return 'foundry';
	}
	if (exists(root, 'hardhat.config.js') || exists(root, 'hardhat.config.ts')) {
		return 'hardhat';
	}
	if (files.some((f) => f.endsWith('.sol'))) {
		return 'solidity';
	}
	if (exists(root, 'next.config.js') || exists(root, 'next.config.ts') || exists(root, 'next.config.mjs')) {
		return 'next';
	}
	if (exists(root, 'package.json')) {
		return 'node';
	}
	try {
		if (fs.readdirSync(root).length === 0) {
			return 'empty';
		}
	} catch {
		/* ignore */
	}
	return 'unknown';
}

function kindLabel(kind: ProjectKind): string {
	switch (kind) {
		case 'foundry':
			return 'Foundry (Solidity)';
		case 'hardhat':
			return 'Hardhat (Solidity)';
		case 'solidity':
			return 'Solidity contracts';
		case 'next':
			return 'Next.js app';
		case 'node':
			return 'Node / JavaScript project';
		case 'empty':
			return 'Empty folder';
		default:
			return 'Project folder';
	}
}

function readmeSummary(root: string): string {
	for (const name of ['README.md', 'Readme.md', 'readme.md']) {
		const full = path.join(root, name);
		if (!fs.existsSync(full)) {
			continue;
		}
		try {
			const raw = fs.readFileSync(full, 'utf8').trim();
			const lines = raw.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
			const text = (lines[0] || raw.split(/\r?\n/)[0] || '').replace(/^#+\s*/, '').trim();
			return text.slice(0, 160) || 'README found.';
		} catch {
			return 'README found.';
		}
	}
	return 'No README yet - ask the Agent to write one.';
}

function nextSteps(kind: ProjectKind, contracts: string[]): string[] {
	const steps: string[] = [];
	if (kind === 'empty' || kind === 'unknown') {
		steps.push('Ask the Agent: "Help me start a simple crypto project."');
		steps.push('Or use Home -> New project for a starter folder.');
	} else {
		steps.push('Ask the Agent to explain this project in plain English.');
	}
	if (contracts.length) {
		steps.push(`Review contracts (${contracts.length} found) with the Agent.`);
	}
	if (kind === 'foundry' || kind === 'hardhat') {
		steps.push('Ask how to compile and run tests (you approve terminal commands).');
	}
	if (kind === 'next') {
		steps.push('Ask the Agent to outline pages and how to run the site locally.');
	}
	steps.push('Wallets and live trading come later - stay in Safe mode for now.');
	return steps.slice(0, 4);
}

export function analyzeWorkspace(): ProjectIntel | null {
	const root = workspaceRoot();
	if (!root) {
		return null;
	}
	const files = walkFiles(root);
	const kind = detectKind(root, files);
	const contracts = files
		.filter((f) => f.endsWith('.sol'))
		.map((f) => path.relative(root, f))
		.sort()
		.slice(0, 40);
	const scripts = files
		.filter((f) => {
			const rel = path.relative(root, f).replace(/\\/g, '/');
			return (
				rel.startsWith('script/') ||
				rel.startsWith('scripts/') ||
				rel.includes('/deploy') ||
				/(^|\/)deploy\.(ts|js|s\.sol)$/i.test(rel)
			);
		})
		.map((f) => path.relative(root, f))
		.sort()
		.slice(0, 20);

	const name = path.basename(root);
	const label = kindLabel(kind);
	const readme = readmeSummary(root);
	const steps = nextSteps(kind, contracts);
	const bits = [label];
	if (contracts.length) {
		bits.push(`${contracts.length} contract file${contracts.length === 1 ? '' : 's'}`);
	}
	if (scripts.length) {
		bits.push(`${scripts.length} deploy/script file${scripts.length === 1 ? '' : 's'}`);
	}
	return {
		root,
		name,
		kind,
		kindLabel: label,
		contracts,
		scripts,
		readmeSummary: readme,
		nextSteps: steps,
		summaryLine: bits.join(' - '),
	};
}

export function modeLabel(mode: string | undefined): string {
	switch (mode) {
		case 'simulation':
			return 'Simulation only';
		case 'testnet':
			return 'Testnet (careful)';
		case 'live':
			return 'Live (manual only)';
		case 'code_only':
		default:
			return 'Safe mode';
	}
}

export function walletLabel(raw: string | undefined): string {
	if (!raw || raw === 'None' || raw === 'none') {
		return 'No wallet yet';
	}
	return raw;
}
