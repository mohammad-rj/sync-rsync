'use strict';
const { spawn } = require('child_process');

// Handles \r (carriage return) from tsh scp progress bars:
// \r resets the current line; \n flushes it — so only the final state shows.
function makeLineWriter(out) {
  let cur = '';
  return (chunk) => {
    const parts = chunk.split(/(\r|\n)/);
    for (const p of parts) {
      if (p === '\n') { out.appendLine(cur); cur = ''; }
      else if (p === '\r') { cur = ''; }
      else { cur += p; }
    }
  };
}
const path = require('path');
const vscode = require('vscode');
const { getRemoteHost, localToRemote, toWindowsPath } = require('./config');

let outputChannel;

function setOutputChannel(ch) {
  outputChannel = ch;
}

function tshScp(args) {
  return new Promise((resolve, reject) => {
    const cfg = vscode.workspace.getConfiguration('sync-rsync');
    const tsh = cfg.get('tshPath') || 'tsh.exe';
    const isScp = path.basename(tsh).replace('.exe', '').toLowerCase() === 'scp';
    const cmdArgs = isScp ? args : ['scp', ...args];

    outputChannel.appendLine(`> ${path.basename(tsh)} ${isScp ? '' : 'scp '}${args.join(' ')}`);

    const proc = spawn(tsh, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    const handleData = makeLineWriter(outputChannel);
    proc.stdout.on('data', d => handleData(d.toString()));
    proc.stderr.on('data', d => handleData(d.toString()));
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`tsh scp exited with code ${code}`));
    });
    proc.on('error', err => reject(new Error(`tsh spawn error: ${err.message}`)));
  });
}

// Retry tshScp with exponential backoff up to maxMinutes
async function tshScpWithRetry(args, maxMinutes = 10) {
  const maxMs = maxMinutes * 60 * 1000;
  const start = Date.now();
  let delay = 2000;
  let attempt = 0;
  while (true) {
    try {
      await tshScp(args);
      return;
    } catch (err) {
      attempt++;
      const elapsed = Date.now() - start;
      if (elapsed + delay > maxMs) throw err;
      outputChannel.appendLine(`  ↻ retry ${attempt} in ${delay / 1000}s... (${err.message})`);
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(delay * 2, 60000);
    }
  }
}

// Ensure remote directory exists via tsh ssh mkdir -p
// Also detects if path exists as a file (not dir) and throws a clear error
function ensureRemoteDir(host, remoteDir) {
  return new Promise((resolve, reject) => {
    const cfg = vscode.workspace.getConfiguration('sync-rsync');
    const tsh = cfg.get('tshPath') || 'tsh.exe';
    const stripped = remoteDir.replace(/\/$/, '');
    const cmd = `if [ -f "${stripped}" ]; then if [ -s "${stripped}" ]; then echo "IS_FILE"; else rm "${stripped}" && mkdir -p "${stripped}"; fi; else mkdir -p "${stripped}"; fi`;
    const proc = spawn(tsh, ['ssh', host, cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    proc.stdout.on('data', d => stdout += d.toString());
    proc.on('close', code => {
      if (stdout.includes('IS_FILE'))
        reject(new Error(`Remote path exists as a FILE, not a directory: ${remoteDir}\nDelete it manually on the server first.`));
      else if (code === 0) resolve();
      else reject(new Error(`mkdir -p failed (code ${code})`));
    });
    proc.on('error', err => reject(err));
  });
}

async function deleteRemote(site, localFilePath) {
  if (!site || !site.deleteRemoteOnLocal) return;

  const remoteHost = getRemoteHost(site);
  const remoteFile = localToRemote(site, localFilePath);

  return new Promise((resolve) => {
    const cfg = vscode.workspace.getConfiguration('sync-rsync');
    const tsh = cfg.get('tshPath') || 'tsh.exe';
    const isSsh = path.basename(tsh).replace('.exe', '').toLowerCase() !== 'scp';

    outputChannel.appendLine(`> ${path.basename(tsh)} ssh ${remoteHost} rm -f "${remoteFile}"`);
    const cmdArgs = isSsh
      ? ['ssh', remoteHost, `rm -f "${remoteFile}"`]
      : [remoteHost, `rm -f "${remoteFile}"`];

    const proc = spawn(tsh, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.on('close', () => resolve());
  });
}

async function uploadFile(site, fsPath) {
  const remoteHost = getRemoteHost(site);
  const remotePath = localToRemote(site, fsPath);
  const remoteDir = remotePath.substring(0, remotePath.lastIndexOf('/') + 1);
  await ensureRemoteDir(remoteHost, remoteDir);
  await tshScp([toWindowsPath(fsPath), `${remoteHost}:${remotePath}`]);
}

// Upload multiple files to the same site.
// Groups by remote parent dir → one tsh scp call per group, all groups in parallel.
async function uploadBatch(site, fsPaths) {
  const remoteHost = getRemoteHost(site);
  const groups = new Map();
  for (const f of fsPaths) {
    const remotePath = localToRemote(site, f);
    const remoteDir = remotePath.substring(0, remotePath.lastIndexOf('/') + 1);
    if (!groups.has(remoteDir)) groups.set(remoteDir, []);
    groups.get(remoteDir).push(f);
  }
  await Promise.all(
    [...groups.entries()].map(async ([remoteDir, files]) => {
      await ensureRemoteDir(remoteHost, remoteDir);
      await tshScpWithRetry([...files.map(toWindowsPath), `${remoteHost}:${remoteDir}`]);
    })
  );
}

async function uploadFolder(site, fsPath) {
  const remoteHost = getRemoteHost(site);
  const remotePath = localToRemote(site, fsPath);
  await tshScpWithRetry(['-r', toWindowsPath(fsPath), `${remoteHost}:${remotePath}`]);
}

async function downloadFile(site, fsPath) {
  const remoteHost = getRemoteHost(site);
  const remotePath = localToRemote(site, fsPath);
  await tshScp([`${remoteHost}:${remotePath}`, toWindowsPath(fsPath)]);
}

async function downloadFolder(site, fsPath) {
  const remoteHost = getRemoteHost(site);
  const remotePath = localToRemote(site, fsPath);
  await tshScp(['-r', `${remoteHost}:${remotePath}`, toWindowsPath(fsPath)]);
}

module.exports = { setOutputChannel, tshScp, deleteRemote, uploadFile, uploadBatch, uploadFolder, downloadFile, downloadFolder };
