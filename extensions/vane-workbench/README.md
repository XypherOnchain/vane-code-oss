# Vane Workbench

Cursor-style **Agent** sidebar for Vane AI (Code—OSS).

## Agent (Phase 2)

1. **File → Open Folder** on a project.
2. Command Palette → **Vane: Set Agent API Key** (OpenAI or Anthropic).
3. Settings: `vane.agent.provider`, `vane.agent.model`.
4. Open the **Vane** activity bar → **Agent**.
5. Ask to find files, edit code, run tests (`Cmd/Ctrl+Enter` to send).

### Tools

| Tool | Approval |
|------|----------|
| `workspace_list` / `read` / `search` | Auto (if enabled) |
| `workspace_write` | Always asks |
| `terminal_run` | Always asks |

Secrets are redacted before model calls. No vault, signing, or Live money movement.

## Wallets / Transactions

Placeholders until later phases (MetaMask / sim portfolio / tx panel).
