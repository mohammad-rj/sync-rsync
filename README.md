# Sync Rsync

Real-time file sync from VSCode to remote servers — works on **save**, watches **external edits** (AI agents, CLI tools), and supports right-click sync for files and folders.

No WSL. No Cygwin. No background daemons.

---

## Why this extension exists

Every other sync extension misses one or more of these:

| | SFTP | sync-rsync (old) | **Sync Rsync** |
|---|---|---|---|
| Sync on Ctrl+S | ✅ | ✅ | ✅ |
| Watch external edits (Claude Code, Cursor…) | ❌ | ❌ | ✅ |
| Right-click folder sync | ❌ | ❌ | ✅ |
| Teleport (tsh) native | ❌ | ✅ (WSL only) | ✅ native |
| Standard SSH / scp | ✅ | ✅ | ✅ |
| Windows — no WSL required | ❌ | ❌ | ✅ |

The **external file watcher** is the key feature. When an AI coding agent (Claude Code, Cursor, Copilot Workspace) edits files outside VSCode, this extension detects the change and syncs it to the server automatically — no manual trigger needed.

---

## Quick Start

### 1. Add sites to your workspace settings

```json
"sync-rsync.sites": [
  {
    "name": "my-server",
    "localPath": "C:/projects/myapp/",
    "remotePath": "root@myserver:/opt/myapp/"
  }
]
```

### 2. Configure your transfer binary

**Standard SSH (scp):**
```json
"sync-rsync.tshPath": "scp"
```

**Teleport (tsh):**
```json
"sync-rsync.tshPath": "tsh.exe"
```

That's it. Save a file — it syncs.

---

## Features

### Sync on Save
Every `Ctrl+S` uploads the saved file to the matching remote path. Scoped per site — saving a file in `myapp/` only syncs to `myserver`, not all sites.

### External File Watcher
Files modified by any tool outside VSCode — Claude Code, shell scripts, git operations — are detected and synced automatically. 400ms debounce prevents redundant transfers.

### Right-Click Sync
Right-click any **file or folder** in the Explorer:
- **Sync Up → Server** — upload to remote
- **Sync Down ← Server** — download from remote

Folder sync is recursive (`-r`).

### Delete Remote on Local Delete *(opt-in)*
When you delete a local file, it can be removed from the server too. **Disabled by default** — enable per site:

```json
{
  "name": "my-server",
  "localPath": "C:/projects/myapp/",
  "remotePath": "root@myserver:/opt/myapp/",
  "deleteRemoteOnLocal": true
}
```

---

## Configuration

### Global settings

| Setting | Default | Description |
|---------|---------|-------------|
| `sync-rsync.tshPath` | `tsh.exe` | Path to `tsh.exe`, `tsh` (Linux/Mac), or `scp` |
| `sync-rsync.nativeSyncOnSave` | `true` | Sync on Ctrl+S |
| `sync-rsync.watchExternal` | `true` | Watch external file changes |
| `sync-rsync.deleteRemoteOnLocal` | `false` | Delete remote on local delete |
| `sync-rsync.autoShowOutputOnError` | `true` | Show output panel on error |

### Site options

| Option | Default | Description |
|--------|---------|-------------|
| `name` | required | Display name |
| `localPath` | required | Local folder (`C:/...` or `/mnt/c/...`) |
| `remotePath` | required | `user@host:/path/` |
| `enabled` | `true` | Disable without removing |
| `deleteRemoteOnLocal` | `false` | Override global setting per site |
| `exclude` | `[".git", "node_modules", ...]` | Patterns to skip |

---

## Teleport Setup

If your servers are behind [Teleport](https://goteleport.com), set `tshPath` to your `tsh` binary and make sure you're logged in:

```bash
tsh login --proxy=your-teleport-proxy --user=youruser
```

No SSH config needed. No WSL. `tsh scp` handles authentication and routing.

---

## Compatibility

- **Windows** — native, no WSL required
- **macOS / Linux** — set `tshPath` to `tsh` or `scp`
- **localPath** — accepts both Windows (`C:/path/`) and WSL (`/mnt/c/path/`) formats
- **Config** — compatible with existing `sync-rsync` extension site definitions

---

## License

MIT
