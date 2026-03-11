# Accounts Browser

TUI-based credential manager with per-profile Puppeteer browser launcher.

## Requirements

- **Node.js** >= 18
- **Bun** >= 1.0 (optional, for compilation to binary)
- **pnpm** (package manager)

## Setup

```bash
pnpm install
```

Optionally create a `.env` file (see `.env.example`):

```bash
cp .env.example .env
```

Without `.env`, the application defaults to `./creds.json` for credentials and `./data` for browser profiles.

## Running

### With Node.js (via tsx)

```bash
pnpm dev
```

### With Node.js (compiled)

```bash
pnpm build
pnpm start
```

### With Bun

```bash
pnpm bun:start
```

## Building a Binary with Bun

Compile the project into a standalone executable:

```bash
pnpm bun:build
```

This produces an `accounts-browser` (or `accounts-browser.exe` on Windows) binary in the project root. Run it directly:

```bash
# Linux / macOS
./accounts-browser

# Windows
accounts-browser.exe
```

> **Note:** Puppeteer requires a Chromium installation. The binary will still need access to the browser binaries at runtime. Ensure Chromium is installed (`npx puppeteer browsers install chrome`) before running the compiled binary.

## TUI Keyboard Shortcuts

| Key     | Action                                        |
| ------- | --------------------------------------------- |
| `↑` `↓` | Navigate credentials list                     |
| `Enter` | Launch Puppeteer browser for selected account |
| `F1`    | Add new credential (modal form)               |
| `F2`    | Edit selected credential                      |
| `F3`    | Change status of selected credential          |
| `DEL`   | Delete selected credential (with confirm)     |
| `q`     | Quit                                          |

## Credential Statuses

| Status     | Description                      |
| ---------- | -------------------------------- |
| `enabled`  | Ready to use, can launch browser |
| `disabled` | Temporarily disabled             |
| `expired`  | Credential has expired           |
| `error`    | Credential has an issue          |

Only credentials with `enabled` status can launch a browser session.

## Data Storage

- **Credentials** are stored in `creds.json` (path configurable via `.env`).
- **Browser profiles** (cookies, local storage, cache) are stored per-account in `./data/<credential-id>/`.

Each credential gets its own isolated browser context, behaving like separate Chrome profiles.

## Project Structure

```
accounts-browser/
├── src/
│   ├── index.ts          Entry point
│   ├── types.ts          Type definitions
│   ├── config.ts         Configuration loader (.env / defaults)
│   ├── credentials.ts    Credential CRUD store
│   ├── browser.ts        Puppeteer browser launcher
│   └── tui/
│       └── App.ts        Terminal UI application
├── data/                 Browser profiles (auto-created)
├── creds.json            Credentials file (auto-created)
├── .env.example          Environment config example
├── tsconfig.json
├── package.json
└── README.md
```
