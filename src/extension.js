'use strict';
const fs = require('fs');
const vscode = require('vscode');
const { matchSite } = require('./config');
const { setOutputChannel, deleteRemote } = require('./transfer');
const { setHandles, syncUp, syncUpMany, syncDown, syncDownMany, syncUpFolder, syncDownFolder } = require('./actions');

const recentlySaved = new Map();

function activate(context) {
  const outputChannel = vscode.window.createOutputChannel('Sync Rsync');
  outputChannel.appendLine('Sync Rsync started');

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  statusBar.text = '$(check) Sync Rsync';
  statusBar.tooltip = 'Sync Rsync — click to show output';
  statusBar.command = 'sync-rsync.showOutput';
  statusBar.show();

  setOutputChannel(outputChannel);
  setHandles(outputChannel, statusBar);

  const cfg = vscode.workspace.getConfiguration('sync-rsync');

  // ── on-save ──
  if (cfg.get('onSave') !== false) {
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument(doc => {
        recentlySaved.set(doc.uri.fsPath, Date.now());
        syncUp(doc.uri.fsPath);
      })
    );
  }

  // ── external watcher ──
  if (cfg.get('watchExternal') !== false) {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    const pending = new Map();

    const debounced = (uri) => {
      const key = uri.fsPath;
      try { if (fs.statSync(key).isDirectory()) return; } catch { return; }
      if (pending.has(key)) clearTimeout(pending.get(key));
      pending.set(key, setTimeout(() => {
        pending.delete(key);
        const last = recentlySaved.get(key);
        if (last && Date.now() - last < 1500) return;
        syncUp(key);
      }, 400));
    };

    watcher.onDidChange(debounced);
    watcher.onDidCreate(debounced);
    watcher.onDidDelete(uri => deleteRemote(matchSite(uri.fsPath), uri.fsPath).catch(() => {}));
    context.subscriptions.push(watcher);
  }

  // ── right-click commands ──
  context.subscriptions.push(
    vscode.commands.registerCommand('sync-rsync.syncUpContext', async (uri, allUris) => {
      const targets = allUris && allUris.length > 0 ? allUris : (uri ? [uri] : []);
      if (targets.length === 0) return;
      const files = [], folders = [];
      for (const t of targets) {
        const stat = await vscode.workspace.fs.stat(t);
        ((stat.type & vscode.FileType.Directory) ? folders : files).push(t.fsPath);
      }
      const ops = [];
      if (files.length > 0) ops.push(syncUpMany(files));
      folders.forEach(f => ops.push(syncUpFolder(f)));
      await Promise.all(ops);
    }),

    vscode.commands.registerCommand('sync-rsync.syncDownContext', async (uri, allUris) => {
      const targets = allUris && allUris.length > 0 ? allUris : (uri ? [uri] : []);
      if (targets.length === 0) return;
      const files = [], folders = [];
      for (const t of targets) {
        const stat = await vscode.workspace.fs.stat(t);
        ((stat.type & vscode.FileType.Directory) ? folders : files).push(t.fsPath);
      }
      const ops = [];
      if (files.length > 0) ops.push(syncDownMany(files));
      folders.forEach(f => ops.push(syncDownFolder(f)));
      await Promise.all(ops);
    }),

    vscode.commands.registerCommand('sync-rsync.showOutput', () => outputChannel.show())
  );

  context.subscriptions.push(outputChannel, statusBar);
}

function deactivate() {}

module.exports = { activate, deactivate };
