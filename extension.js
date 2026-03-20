'use strict';
// sync-rsync v0.1.0 — skeleton
// See PLAN.md for full architecture and implementation details
// Status: Phase 1 pending implementation

const vscode = require('vscode');
const { spawn } = require('child_process');
const path = require('path');

let outputChannel;
let statusBar;
const recentlySaved = new Map(); // dedup: skip watcher if onSave just fired

// ─── Path Utils ──────────────────────────────────────────────────────────────

function toWindowsPath(p) {
  // tsh scp needs uppercase drive letter + backslash: C:\Users\...
  return p.replace(/\//g, '\\').replace(/^([a-z]):/, (_, d) => d.toUpperCase() + ':');
}

function normalizeLocalPath(p) {
  // /mnt/c/Users/... → c:/Users/...
  // C:\Users\... → c:/Users/...
  return p.replace(/\\/g, '/').replace(/^\/mnt\/([a-z])\//, '$1:/').toLowerCase();
}

function matchSite(fsPath) {
  const cfg = vscode.workspace.getConfiguration('sync-rsync');
  const sites = cfg.get('sites') || [];
  const normalized = normalizeLocalPath(fsPath);
  return sites.find(s =>
    s.enabled !== false &&
    normalized.startsWith(normalizeLocalPath(s.localPath))
  );
}

function getRemoteHost(site) {
  // "root@db:/opt/docker/" → "root@db"
  return site.remotePath.split(':')[0];
}

function getRemoteBasePath(site) {
  // "root@db:/opt/docker/" → "/opt/docker/"
  return site.remotePath.split(':')[1];
}

function localToRemote(site, localFilePath) {
  const base = normalizeLocalPath(site.localPath).replace(/\/$/, '');
  const file = normalizeLocalPath(localFilePath);
  const relative = file.slice(base.length).replace(/^\//, '');
  return getRemoteBasePath(site) + relative;
}

function isExcluded(site, fsPath) {
  const excludes = site.exclude || ['.git', 'node_modules', '__pycache__', '*.pyc'];
  const normalized = fsPath.replace(/\\/g, '/');
  return excludes.some(pattern => {
    const rx = pattern.replace('.', '\\.').replace('*', '.*');
    return new RegExp(rx).test(normalized);
  });
}

// ─── Transfer ─────────────────────────────────────────────────────────────────

function tshScp(args) {
  return new Promise((resolve, reject) => {
    const cfg = vscode.workspace.getConfiguration('sync-rsync');
    const tsh = cfg.get('tshPath') || 'tsh.exe';
    const isScp = path.basename(tsh).replace('.exe','').toLowerCase() === 'scp';
    const cmd = isScp ? [tsh, args] : [tsh, ['scp', ...args]];

    outputChannel.appendLine(`> ${path.basename(tsh)} scp ${args.join(' ')}`);

    const proc = spawn(cmd[0], cmd[1], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    proc.stdout.on('data', d => outputChannel.append(d.toString()));
    proc.stderr.on('data', d => outputChannel.append(d.toString()));

    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`tsh scp exited with code ${code}`));
    });

    proc.on('error', err => reject(new Error(`tsh spawn error: ${err.message}`)));
  });
}

async function deleteRemote(site, localFilePath) {
  if (!site.deleteRemoteOnLocal) return;

  const remoteHost = getRemoteHost(site);
  const remoteFile = localToRemote(site, localFilePath);

  return new Promise((resolve, reject) => {
    const cfg = vscode.workspace.getConfiguration('sync-rsync');
    const tsh = cfg.get('tshPath') || 'tsh.exe';

    outputChannel.appendLine(`> tsh ssh ${remoteHost} rm -f "${remoteFile}"`);
    const proc = spawn(tsh, ['ssh', remoteHost, `rm -f "${remoteFile}"`], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    proc.on('close', code => code === 0 ? resolve() : reject());
  });
}

// ─── Sync Actions ─────────────────────────────────────────────────────────────

async function syncUp(fsPath) {
  const site = matchSite(fsPath);
  if (!site) return;
  if (isExcluded(site, fsPath)) return;

  const ts = new Date().toLocaleTimeString();
  outputChannel.appendLine(`\n[${ts}] Sync Up: ${fsPath}`);
  statusBar.text = '$(sync~spin) Sync Rsync...';

  try {
    const remoteHost = getRemoteHost(site);
    const remotePath = localToRemote(site, fsPath);
    await tshScp([toWindowsPath(fsPath), `${remoteHost}:${remotePath}`]);
    statusBar.text = '$(check) Sync Rsync';
  } catch (err) {
    statusBar.text = '$(error) Sync Rsync';
    const cfg = vscode.workspace.getConfiguration('sync-rsync');
    if (cfg.get('autoShowOutputOnError')) outputChannel.show(true);
    vscode.window.showErrorMessage(`Sync Rsync: ${err.message}`);
  }
}

async function syncDown(fsPath) {
  const site = matchSite(fsPath);
  if (!site) return;

  const ts = new Date().toLocaleTimeString();
  outputChannel.appendLine(`\n[${ts}] Sync Down: ${fsPath}`);
  statusBar.text = '$(sync~spin) Sync Rsync...';

  try {
    const remoteHost = getRemoteHost(site);
    const remotePath = localToRemote(site, fsPath);
    await tshScp([`${remoteHost}:${remotePath}`, toWindowsPath(fsPath)]);
    statusBar.text = '$(check) Sync Rsync';
  } catch (err) {
    statusBar.text = '$(error) Sync Rsync';
    vscode.window.showErrorMessage(`Sync Rsync download: ${err.message}`);
  }
}

async function syncUpFolder(fsPath) {
  const site = matchSite(fsPath);
  if (!site) return;

  outputChannel.appendLine(`\nSync Up folder: ${fsPath}`);
  statusBar.text = '$(sync~spin) Sync Rsync...';

  try {
    const remoteHost = getRemoteHost(site);
    const remotePath = localToRemote(site, fsPath);
    await tshScp(['-r', toWindowsPath(fsPath), `${remoteHost}:${remotePath}`]);
    statusBar.text = '$(check) Sync Rsync';
  } catch (err) {
    statusBar.text = '$(error) Sync Rsync';
    vscode.window.showErrorMessage(`Sync Rsync folder: ${err.message}`);
  }
}

async function syncDownFolder(fsPath) {
  const site = matchSite(fsPath);
  if (!site) return;

  outputChannel.appendLine(`\nSync Down folder: ${fsPath}`);
  statusBar.text = '$(sync~spin) Sync Rsync...';

  try {
    const remoteHost = getRemoteHost(site);
    const remotePath = localToRemote(site, fsPath);
    await tshScp(['-r', `${remoteHost}:${remotePath}`, toWindowsPath(fsPath)]);
    statusBar.text = '$(check) Sync Rsync';
  } catch (err) {
    statusBar.text = '$(error) Sync Rsync';
    vscode.window.showErrorMessage(`Sync Rsync folder down: ${err.message}`);
  }
}

// ─── Activate ─────────────────────────────────────────────────────────────────

function activate(context) {
  outputChannel = vscode.window.createOutputChannel('Sync Rsync');
  outputChannel.appendLine('Sync Rsync started');

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  statusBar.text = '$(check) Sync Rsync';
  statusBar.tooltip = 'Sync Rsync — click to show output';
  statusBar.command = 'sync-rsync.showOutput';
  statusBar.show();

  // ── on-save ──
  const cfg = vscode.workspace.getConfiguration('sync-rsync');
  if (cfg.get('nativeSyncOnSave') !== false) {
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument(doc => {
        recentlySaved.set(doc.uri.fsPath, Date.now());
        syncUp(doc.uri.fsPath);
      })
    );
  }

  // ── external watcher (Claude Code, etc.) ──
  if (cfg.get('watchExternal') !== false) {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    const pending = new Map();
    const debounced = (uri) => {
      const key = uri.fsPath;
      if (pending.has(key)) clearTimeout(pending.get(key));
      pending.set(key, setTimeout(() => {
        pending.delete(key);
        const last = recentlySaved.get(key);
        if (last && Date.now() - last < 1500) return; // skip: onSave already handled
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
    vscode.commands.registerCommand('sync-rsync.syncUpContext', async (uri) => {
      if (!uri) return;
      const stat = await vscode.workspace.fs.stat(uri);
      const isDir = (stat.type & vscode.FileType.Directory) !== 0;
      isDir ? syncUpFolder(uri.fsPath) : syncUp(uri.fsPath);
    }),

    vscode.commands.registerCommand('sync-rsync.syncDownContext', async (uri) => {
      if (!uri) return;
      const stat = await vscode.workspace.fs.stat(uri);
      const isDir = (stat.type & vscode.FileType.Directory) !== 0;
      isDir ? syncDownFolder(uri.fsPath) : syncDown(uri.fsPath);
    }),

    vscode.commands.registerCommand('sync-rsync.showOutput', () => outputChannel.show())
  );

  context.subscriptions.push(outputChannel, statusBar);
}

function deactivate() {}

module.exports = { activate, deactivate };
