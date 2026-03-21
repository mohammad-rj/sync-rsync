'use strict';
const vscode = require('vscode');

function normalizeLocalPath(p) {
  return p.replace(/\\/g, '/')
          .replace(/^\/mnt\/([a-z])\//, '$1:/')
          .toLowerCase();
}

function toWindowsPath(p) {
  return p.replace(/\//g, '\\')
          .replace(/^([a-z]):/, (_, d) => d.toUpperCase() + ':');
}

function getConfig() {
  return vscode.workspace.getConfiguration('sync-rsync');
}

function getSites() {
  return getConfig().get('sites') || [];
}

function matchSite(fsPath) {
  const normalized = normalizeLocalPath(fsPath);
  return getSites().find(s =>
    s.enabled !== false &&
    normalized.startsWith(normalizeLocalPath(s.localPath))
  );
}

function getRemoteHost(site) {
  return site.remotePath.split(':')[0];
}

function getRemoteBasePath(site) {
  return site.remotePath.split(':')[1];
}

function localToRemote(site, localFilePath) {
  const base = normalizeLocalPath(site.localPath).replace(/\/$/, '');
  const file = normalizeLocalPath(localFilePath);
  const relative = file.slice(base.length).replace(/^\//, '');
  return getRemoteBasePath(site) + relative;
}

function isExcluded(site, fsPath) {
  const excludes = site.exclude || ['.git', 'node_modules', '__pycache__', '*.pyc', '*.tmp', '*.tmp.*'];
  const normalized = fsPath.replace(/\\/g, '/');
  return excludes.some(pattern => {
    const rx = pattern.replace('.', '\\.').replace('*', '.*');
    return new RegExp(rx).test(normalized);
  });
}

module.exports = {
  normalizeLocalPath, toWindowsPath, getConfig, getSites,
  matchSite, getRemoteHost, getRemoteBasePath, localToRemote, isExcluded
};
