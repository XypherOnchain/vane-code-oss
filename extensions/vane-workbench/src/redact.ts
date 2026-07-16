/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

interface Pattern {
	re: RegExp;
	label: string;
	test?: (full: string) => boolean;
}

const PATTERNS: Pattern[] = [
	{ re: /\b(0x[a-fA-F0-9]{64})\b/g, label: 'EVM_PRIVATE_KEY' },
	{
		re: /\b([a-z]+(?:\s+[a-z]+){11,23})\b/gi,
		label: 'MNEMONIC',
		test: (m) => m.split(/\s+/).length >= 12,
	},
	{
		re: /(?:api[_-]?key|secret|token|password|private[_-]?key)\s*[:=]\s*["']?([^\s"']{8,})["']?/gi,
		label: 'SECRET_ASSIGNMENT',
	},
	{ re: /\b(sk-[a-zA-Z0-9_-]{20,})\b/g, label: 'API_KEY' },
	{ re: /\b(sk-ant-[a-zA-Z0-9_-]{20,})\b/g, label: 'ANTHROPIC_KEY' },
	{ re: /\b(\d{8,12}:[A-Za-z0-9_-]{30,})\b/g, label: 'TELEGRAM_BOT_TOKEN' },
];

const NEVER_SEND = [/\.env($|\.)/i, /keystore/i, /\.pem$/i, /id_rsa/i, /wallet\.json$/i];

export function shouldNeverSendPath(filePath: string): boolean {
	return NEVER_SEND.some((re) => re.test(filePath));
}

export function redactSecrets(text: string | undefined | null): {
	text: string;
	redacted: boolean;
	kinds: string[];
} {
	if (!text) {
		return { text: '', redacted: false, kinds: [] };
	}
	let out = String(text);
	const kinds = new Set<string>();
	for (const p of PATTERNS) {
		out = out.replace(p.re, (full: string) => {
			if (p.test && !p.test(full)) {
				return full;
			}
			kinds.add(p.label);
			return `<VANE_REDACTED:${p.label}>`;
		});
	}
	return { text: out, redacted: kinds.size > 0, kinds: [...kinds] };
}
