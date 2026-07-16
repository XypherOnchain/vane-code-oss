/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { redactSecrets, shouldNeverSendPath } from './redact';
import { analyzeWorkspace } from './projectIntel';

const execFileAsync = promisify(execFile);

export interface ToolDef {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

export const TOOL_DEFS: ToolDef[] = [
	{
		name: 'workspace_list',
		description: 'List files and folders under a relative path in the workspace.',
		parameters: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Relative directory path (default .)' },
			},
		},
	},
	{
		name: 'workspace_read',
		description: 'Read a text file from the workspace (secrets are redacted).',
		parameters: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Relative file path' },
			},
			required: ['path'],
		},
	},
	{
		name: 'workspace_search',
		description: 'Search file contents for a query string (simple scan).',
		parameters: {
			type: 'object',
			properties: {
				query: { type: 'string' },
				path: { type: 'string', description: 'Optional subdirectory' },
				maxResults: { type: 'number' },
			},
			required: ['query'],
		},
	},
	{
		name: 'workspace_write',
		description: 'Create or overwrite a text file. Requires user approval.',
		parameters: {
			type: 'object',
			properties: {
				path: { type: 'string' },
				content: { type: 'string' },
			},
			required: ['path', 'content'],
		},
	},
	{
		name: 'terminal_run',
		description: 'Run a shell command in the workspace root. Requires user approval. Not for signing or live chain ops.',
		parameters: {
			type: 'object',
			properties: {
				command: { type: 'string' },
				cwd: { type: 'string', description: 'Optional relative cwd' },
			},
			required: ['command'],
		},
	},
	{
		name: 'project_overview',
		description: 'Summarize the open crypto/project folder: kind (Foundry/Hardhat/Next/etc), contracts, scripts, README, suggested next steps.',
		parameters: {
			type: 'object',
			properties: {},
		},
	},
];

export type ToolArgs = Record<string, unknown>;
export type ToolResult = Record<string, unknown>;

export function workspaceRoot(): string | null {
	const folder = vscode.workspace.workspaceFolders?.[0];
	return folder ? folder.uri.fsPath : null;
}

function resolveSafe(rel: unknown): { root: string; full: string; rel: string } {
	const root = workspaceRoot();
	if (!root) {
		throw new Error('Open a folder first (File -> Open Folder).');
	}
	const cleaned = String(rel || '.').replace(/^\/+/, '');
	const full = path.resolve(root, cleaned);
	if (!full.startsWith(path.resolve(root))) {
		throw new Error('Path escapes workspace');
	}
	return { root, full, rel: path.relative(root, full) || '.' };
}

async function confirmRisky(title: string, detail: string): Promise<boolean> {
	const pick = await vscode.window.showWarningMessage(
		title,
		{ modal: true, detail },
		'Allow',
		'Deny',
	);
	return pick === 'Allow';
}

export async function runTool(
	name: string,
	args: ToolArgs,
	opts: { skipConfirm?: boolean } = {},
): Promise<ToolResult> {
	switch (name) {
		case 'workspace_list': {
			const { full, rel } = resolveSafe(args.path || '.');
			const entries = fs.readdirSync(full, { withFileTypes: true }).slice(0, 200);
			return {
				path: rel,
				entries: entries.map((e) => ({
					name: e.name,
					type: e.isDirectory() ? 'dir' : 'file',
				})),
			};
		}
		case 'workspace_read': {
			const { full, rel } = resolveSafe(args.path);
			if (shouldNeverSendPath(rel)) {
				return { path: rel, error: 'File classified as Never send to model' };
			}
			const st = fs.statSync(full);
			if (st.size > 400_000) {
				return { path: rel, error: 'File too large (>400KB)' };
			}
			const raw = fs.readFileSync(full, 'utf8');
			const { text, redacted, kinds } = redactSecrets(raw);
			return { path: rel, content: text, redacted, kinds };
		}
		case 'workspace_search': {
			const { root, full } = resolveSafe(args.path || '.');
			const query = String(args.query || '');
			if (!query) {
				return { matches: [] };
			}
			const max = Math.min(Number(args.maxResults) || 30, 80);
			const matches: { path: string; line: number; preview: string }[] = [];
			const skip = new Set(['node_modules', '.git', 'out', 'dist', '.build']);
			function walk(dir: string, depth: number): void {
				if (matches.length >= max || depth > 8) {
					return;
				}
				let names: string[];
				try {
					names = fs.readdirSync(dir);
				} catch {
					return;
				}
				for (const name of names) {
					if (skip.has(name)) {
						continue;
					}
					const p = path.join(dir, name);
					let st: fs.Stats;
					try {
						st = fs.statSync(p);
					} catch {
						continue;
					}
					if (st.isDirectory()) {
						walk(p, depth + 1);
					} else if (st.isFile() && st.size < 500_000) {
						let body: string;
						try {
							body = fs.readFileSync(p, 'utf8');
						} catch {
							continue;
						}
						const lines = body.split(/\r?\n/);
						for (let i = 0; i < lines.length; i++) {
							if (lines[i].includes(query)) {
								const { text } = redactSecrets(lines[i].slice(0, 200));
								matches.push({
									path: path.relative(root, p),
									line: i + 1,
									preview: text,
								});
								if (matches.length >= max) {
									return;
								}
							}
						}
					}
				}
			}
			walk(full, 0);
			return { query, matches };
		}
		case 'workspace_write': {
			const { full, rel } = resolveSafe(args.path);
			if (shouldNeverSendPath(rel)) {
				return { ok: false, error: 'Refusing to write secret-class path' };
			}
			const ok =
				opts.skipConfirm ||
				(await confirmRisky(
					`Allow agent to write ${rel}?`,
					'The agent wants to create or overwrite this file.',
				));
			if (!ok) {
				return { ok: false, error: 'User denied write' };
			}
			fs.mkdirSync(path.dirname(full), { recursive: true });
			const uri = vscode.Uri.file(full);
			const enc = new TextEncoder();
			await vscode.workspace.fs.writeFile(uri, enc.encode(String(args.content ?? '')));
			const doc = await vscode.workspace.openTextDocument(uri);
			await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });
			return { ok: true, path: rel, bytes: String(args.content ?? '').length };
		}
		case 'terminal_run': {
			const cmd = String(args.command || '').trim();
			if (!cmd) {
				return { ok: false, error: 'Empty command' };
			}
			if (/\b(curl|wget)\b.*\b(private|key|secret)\b/i.test(cmd)) {
				return { ok: false, error: 'Blocked suspicious command' };
			}
			const mode = vscode.workspace.getConfiguration('vane').get('operatingMode');
			if (mode === 'live') {
				return { ok: false, error: 'Terminal tool blocked while mode is Live (agent cannot use Live).' };
			}
			const ok =
				opts.skipConfirm ||
				(await confirmRisky('Allow agent to run terminal command?', cmd));
			if (!ok) {
				return { ok: false, error: 'User denied command' };
			}
			const { root } = resolveSafe(args.cwd || '.');
			const cwd = args.cwd ? resolveSafe(args.cwd).full : root;
			try {
				const { stdout, stderr } = await execFileAsync(
					process.env.SHELL || '/bin/zsh',
					['-lc', cmd],
					{ cwd, timeout: 60_000, maxBuffer: 1024 * 512 },
				);
				const out = redactSecrets((stdout || '') + (stderr ? `\n${stderr}` : ''));
				return {
					ok: true,
					command: cmd,
					output: out.text.slice(0, 12_000),
					redacted: out.redacted,
				};
			} catch (e: unknown) {
				const err = e as { stdout?: string; stderr?: string; message?: string };
				const msg = redactSecrets(err.stdout || err.stderr || err.message || String(e));
				return { ok: false, command: cmd, output: msg.text.slice(0, 12_000), error: 'Command failed' };
			}
		}
		case 'project_overview': {
			const intel = analyzeWorkspace();
			if (!intel) {
				return { ok: false, error: 'Open a project folder first (Home -> Open project).' };
			}
			return { ok: true, ...intel };
		}
		default:
			return { error: `Unknown tool: ${name}` };
	}
}

export function isSafeTool(name: string): boolean {
	return (
		name === 'workspace_list' ||
		name === 'workspace_read' ||
		name === 'workspace_search' ||
		name === 'project_overview'
	);
}
