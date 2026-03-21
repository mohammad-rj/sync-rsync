'use strict';
const fs = require('fs');
const vscode = require('vscode');
const { matchSite, isExcluded, localToRemote } = require('./config');
const { uploadBatch, uploadFolder, downloadFile, downloadFolder } = require('./transfer');

let outputChannel;
let statusBar;

function setHandles(ch, sb) {
  outputChannel = ch;
  statusBar = sb;
}

// ── batch queue (200ms window) ──────────────────────────────────────────────
// key: `${siteName}:${remoteDir}` → { site, files: Set, timer }
const queue = new Map();

function remoteDir(site, fsPath) {
  const rp = localToRemote(site, fsPath);
  return rp.substring(0, rp.lastIndexOf('/') + 1);
}

async function flushBatch(site, files) {
  const existing = files.filter(f => fs.existsSync(f));
  if (existing.length === 0) return;
  const ts = new Date().toLocaleTimeString();
  outputChannel.appendLine(`\n[${ts}] Sync Up: ${existing.length} file(s)`);
  statusBar.text = '$(sync~spin) Sync Rsync...';
  try {
    await uploadBatch(site, existing);
    statusBar.text = '$(check) Sync Rsync';
    const cfg = vscode.workspace.getConfiguration('sync-rsync');
    if (cfg.get('notification')) {
      const names = existing.map(f => f.split(/[\\/]/).pop()).join(', ');
      vscode.window.setStatusBarMessage(`↑ ${names}`, 3000);
    }
  } catch (err) {
    statusBar.text = '$(error) Sync Rsync';
    if (vscode.workspace.getConfiguration('sync-rsync').get('autoShowOutputOnError'))
      outputChannel.show(true);
    vscode.window.showErrorMessage(`Sync Rsync: ${err.message}`);
  }
}

// on-save / watcher: enqueue with 200ms debounce
function syncUp(fsPath) {
  const site = matchSite(fsPath);
  if (!site || isExcluded(site, fsPath)) return;
  const key = `${site.name}:${remoteDir(site, fsPath)}`;
  if (!queue.has(key)) queue.set(key, { site, files: new Set(), timer: null });
  const batch = queue.get(key);
  batch.files.add(fsPath);
  clearTimeout(batch.timer);
  batch.timer = setTimeout(() => {
    queue.delete(key);
    flushBatch(site, [...batch.files]);
  }, 200);
}

// right-click multi-select: group by site+remoteDir → parallel immediate flush
async function syncUpMany(fsPaths) {
  const groups = new Map();
  for (const p of fsPaths) {
    const site = matchSite(p);
    if (!site || isExcluded(site, p)) continue;
    const key = `${site.name}:${remoteDir(site, p)}`;
    if (!groups.has(key)) groups.set(key, { site, files: [] });
    groups.get(key).files.push(p);
  }
  await Promise.all([...groups.values()].map(({ site, files }) => flushBatch(site, files)));
}

// ── download ────────────────────────────────────────────────────────────────
async function syncDown(fsPath) {
  const site = matchSite(fsPath);
  if (!site) return;
  outputChannel.appendLine(`\n[${new Date().toLocaleTimeString()}] Sync Down: ${fsPath}`);
  statusBar.text = '$(sync~spin) Sync Rsync...';
  try {
    await downloadFile(site, fsPath);
    statusBar.text = '$(check) Sync Rsync';
  } catch (err) {
    statusBar.text = '$(error) Sync Rsync';
    vscode.window.showErrorMessage(`Sync Rsync download: ${err.message}`);
  }
}

async function syncDownMany(fsPaths) {
  await Promise.all(fsPaths.map(p => syncDown(p)));
}

// ── folders ─────────────────────────────────────────────────────────────────
async function syncUpFolder(fsPath) {
  const site = matchSite(fsPath);
  if (!site) return;
  outputChannel.appendLine(`\nSync Up folder: ${fsPath}`);
  statusBar.text = '$(sync~spin) Sync Rsync...';
  try {
    await uploadFolder(site, fsPath);
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
    await downloadFolder(site, fsPath);
    statusBar.text = '$(check) Sync Rsync';
  } catch (err) {
    statusBar.text = '$(error) Sync Rsync';
    vscode.window.showErrorMessage(`Sync Rsync folder down: ${err.message}`);
  }
}

module.exports = { setHandles, syncUp, syncUpMany, syncDown, syncDownMany, syncUpFolder, syncDownFolder };
