/*---------------------------------------------------------------------------------------------
 * Vane Workbench — Phase 1 placeholders (no vault, no signing).
 *--------------------------------------------------------------------------------------------*/
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = require("vscode");

class PlaceholderProvider {
  constructor(items) {
    this.items = items;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }
  getTreeItem(element) {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.description = element.description;
    item.tooltip = element.tooltip;
    return item;
  }
  getChildren() {
    return this.items;
  }
}

/** @type {vscode.StatusBarItem[]} */
let statusItems = [];

function refreshStatusBar() {
  const cfg = vscode.workspace.getConfiguration("vane");
  const model = cfg.get("placeholderModel") || "Claude";
  const chain = cfg.get("placeholderChain") || "Base Sepolia";
  const wallet = cfg.get("placeholderWallet") || "None";
  const mode = cfg.get("operatingMode") || "code_only";
  const labels = [
    `$(hubot) ${model}`,
    `$(robot) Agent: Builder`,
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

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const agentProvider = new PlaceholderProvider([
    {
      label: "Agent (Phase 2)",
      description: "placeholder",
      tooltip: "Model gateway, tools, and diffs land in Phase 2. No financial signing here.",
    },
    {
      label: "Ask · Plan · Build · Debug · Review",
      description: "modes",
      tooltip: "Agent modes will appear here.",
    },
  ]);
  const walletsProvider = new PlaceholderProvider([
    {
      label: "No vault — Phase 5",
      description: "vane-walletd",
      tooltip: "Encrypted local vault and READY wallets are not implemented in Phase 1.",
    },
    {
      label: "Keys never enter the renderer",
      description: "security",
      tooltip: "See docs/architecture/security-boundaries.md in Vane-AI monorepo.",
    },
  ]);
  const txProvider = new PlaceholderProvider([
    {
      label: "No signing — Phase 6",
      description: "placeholder",
      tooltip: "Transaction propose → simulate → approve → local sign lands later.",
    },
    {
      label: "Live mode disabled for AI",
      description: "policy",
      tooltip: "Only the user can enable Live mode via UI in a later phase.",
    },
  ]);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("vane.agent", agentProvider),
    vscode.window.registerTreeDataProvider("vane.wallets", walletsProvider),
    vscode.window.registerTreeDataProvider("vane.transactions", txProvider),
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
      if (e.affectsConfiguration("vane")) {
        refreshStatusBar();
      }
    }),
  );

  async function focusView(viewId) {
    try {
      await vscode.commands.executeCommand(`${viewId}.focus`);
    } catch {
      await vscode.commands.executeCommand("workbench.view.extension.vane");
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("vane.openAgent", () => focusView("vane.agent")),
    vscode.commands.registerCommand("vane.openWallets", () => focusView("vane.wallets")),
    vscode.commands.registerCommand("vane.openTransactions", () => focusView("vane.transactions")),
    vscode.commands.registerCommand("vane.showMode", () => {
      const mode = vscode.workspace.getConfiguration("vane").get("operatingMode");
      void vscode.window.showInformationMessage(
        `Vane operating mode: ${mode}. Live cannot be enabled by the AI agent.`,
      );
    }),
  );
}

function deactivate() {
  statusItems = [];
}

module.exports = { activate, deactivate };
