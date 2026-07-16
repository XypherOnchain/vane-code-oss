# Vane Workbench

Beginner-first **Home**, **Agent**, and **Project** overview for Vane AI (Code-OSS).

## Open Vane

1. Launch the desktop IDE (`./scripts/code.sh` from `apps/desktop-ide`).
2. You should land on **Vane Home** (not the VS Code welcome page).
3. **Open project** or **New project**, then use **Ask Agent**.

## Agent

1. Command Palette -> **Vane: Set Agent API Key**
2. Settings: `vane.agent.provider`, `vane.agent.model`
3. Rocket activity bar -> **Agent**
4. Ask in plain English (`Cmd/Ctrl+Enter` to send)

### Tools

| Tool | Approval |
|------|----------|
| `project_overview` / list / read / search | Auto (if enabled) |
| `workspace_write` | Always asks |
| `terminal_run` | Always asks |

Secrets are redacted. No vault, signing, or Live money movement.

## Project overview

Detects Foundry / Hardhat / Solidity / Next-style folders and lists contracts, scripts, and next steps.

## Wallets / Trade

Placeholders with clear "coming soon" copy until later phases.
