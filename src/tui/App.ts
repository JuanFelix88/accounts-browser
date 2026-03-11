import blessed from "blessed";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import AdmZip from "adm-zip";
import { CredentialStore } from "../credentials";
import { launchBrowser } from "../browser";
import { getCredsPath, getDataDir } from "../config";
import type { Credential, CredentialStatus } from "../types";
import { STATUSES } from "../types";

const STATUS_COLORS: Record<CredentialStatus, string> = {
  unverified: "cyan",
  enabled: "green",
  disabled: "yellow",
  expired: "red",
  error: "red",
};

const STATUS_ICONS: Record<CredentialStatus, string> = {
  unverified: "?",
  enabled: "●",
  disabled: "○",
  expired: "◌",
  error: "✗",
};

export class App {
  private screen: blessed.Widgets.Screen;
  private store: CredentialStore;
  private table: blessed.Widgets.ListTableElement;
  private helpBar: blessed.Widgets.BoxElement;
  private statusMessage: blessed.Widgets.BoxElement;
  private modalOpen = false;
  private runningBrowsers = new Set<string>();

  constructor() {
    this.store = new CredentialStore();

    this.screen = blessed.screen({
      smartCSR: true,
      title: "Accounts Browser",
      fullUnicode: true,
    });

    this.createTitleBar();
    this.table = this.createTable();
    this.helpBar = this.createHelpBar();
    this.statusMessage = this.createStatusMessage();

    this.bindKeys();
    this.refresh();
  }

  /* ------------------------------------------------------------------ */
  /*  UI SETUP                                                          */
  /* ------------------------------------------------------------------ */

  private createTitleBar(): blessed.Widgets.BoxElement {
    return blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: "100%",
      height: 3,
      content: "{center}{bold} Accounts Browser {/bold}{/center}",
      tags: true,
      style: { fg: "white", bg: "blue" },
      border: { type: "line" },
    });
  }

  private createTable(): blessed.Widgets.ListTableElement {
    return blessed.listtable({
      parent: this.screen,
      top: 3,
      left: 0,
      width: "100%",
      height: "100%-6",
      border: { type: "line" },
      label: " Credentials ",
      tags: true,
      keys: true,
      vi: false,
      mouse: true,
      style: {
        header: { fg: "white", bold: true, bg: "black" },
        cell: { fg: "white", selected: { fg: "black", bg: "cyan" } },
        border: { fg: "cyan" },
      },
      align: "left",
      pad: 1,
      noCellBorders: true,
    });
  }

  private createHelpBar(): blessed.Widgets.BoxElement {
    return blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: "100%",
      height: 3,
      content:
        " {bold}F1{/bold}:Add {bold}F2{/bold}:Edit {bold}F3{/bold}:Status {bold}F4{/bold}:Copy {bold}F8{/bold}:Import {bold}F10{/bold}:Export {bold}DEL{/bold}:Del {bold}Enter{/bold}:Launch {bold}q{/bold}:Quit",
      tags: true,
      style: { fg: "white", bg: "gray" },
      border: { type: "line" },
    });
  }

  private createStatusMessage(): blessed.Widgets.BoxElement {
    return blessed.box({
      parent: this.screen,
      bottom: 3,
      left: 0,
      width: "100%",
      height: 1,
      content: "",
      tags: true,
      style: { fg: "green" },
    });
  }

  /* ------------------------------------------------------------------ */
  /*  HELPERS                                                           */
  /* ------------------------------------------------------------------ */

  private showMessage(text: string, timeout = 3000): void {
    this.statusMessage.setContent(` ${text}`);
    this.screen.render();
    setTimeout(() => {
      this.statusMessage.setContent("");
      this.screen.render();
    }, timeout);
  }

  private getSelectedCredential(): Credential | null {
    const creds = this.store.getAll();
    if (creds.length === 0) return null;
    const idx = ((this.table as any).selected as number) - 1; // offset header row
    return creds[idx] ?? null;
  }

  private formatStatus(status: CredentialStatus): string {
    const color = STATUS_COLORS[status];
    const icon = STATUS_ICONS[status];
    return `{${color}-fg}${icon} ${status}{/${color}-fg}`;
  }

  private refresh(): void {
    const creds = this.store.getAll();
    const rows: string[][] = [
      ["#", "Label", "Username", "Status", "Expires", "Created"],
    ];

    if (creds.length === 0) {
      rows.push(["", "", "No credentials. Press F1 to add.", "", "", ""]);
    } else {
      creds.forEach((cred, i) => {
        const expires = cred.expiresAt
          ? new Date(cred.expiresAt) < new Date()
            ? `{red-fg}${new Date(cred.expiresAt).toLocaleDateString("en-US")}{/red-fg}`
            : new Date(cred.expiresAt).toLocaleDateString("en-US")
          : "{gray-fg}—{/gray-fg}";
        rows.push([
          String(i + 1),
          this.runningBrowsers.has(cred.id)
            ? `{cyan-fg}▶ ${cred.label}{/cyan-fg}`
            : cred.label,
          cred.username,
          this.formatStatus(cred.status),
          expires,
          new Date(cred.createdAt).toLocaleDateString("en-US"),
        ]);
      });
    }

    this.table.setData(rows);
    if (creds.length > 0) {
      this.table.select(1); // select first data row, skipping header
    }
    this.screen.render();
  }

  /* ------------------------------------------------------------------ */
  /*  KEY BINDINGS                                                      */
  /* ------------------------------------------------------------------ */

  private bindKeys(): void {
    this.screen.key(["q", "C-c"], () => {
      if (this.modalOpen) return;
      this.screen.destroy();
      process.exit(0);
    });

    this.screen.key(["f1"], () => {
      if (this.modalOpen) return;
      this.showAddForm();
    });

    this.screen.key(["f2"], () => {
      if (this.modalOpen) return;
      this.showEditForm();
    });

    this.screen.key(["f3"], () => {
      if (this.modalOpen) return;
      this.showStatusModal();
    });

    this.screen.key(["f4"], () => {
      if (this.modalOpen) return;
      this.showCopyMenu();
    });

    this.screen.key(["delete"], () => {
      if (this.modalOpen) return;
      this.showDeleteConfirm();
    });

    this.table.key(["enter"], () => {
      if (this.modalOpen) return;
      this.handleLaunchBrowser();
    });

    this.screen.key(["f8"], () => {
      if (this.modalOpen) return;
      this.handleImport();
    });

    this.screen.key(["f10"], () => {
      if (this.modalOpen) return;
      this.handleExport();
    });

    this.table.focus();
  }

  /* ------------------------------------------------------------------ */
  /*  ADD / EDIT FORM                                                   */
  /* ------------------------------------------------------------------ */

  private showAddForm(): void {
    this.showCredentialForm(
      "Add Credential",
      null,
      (label, username, password, expiresAt, createdAt) => {
        this.store.add(label, username, password, expiresAt);
        if (createdAt) {
          const added = this.store.getAll().at(-1);
          if (added) this.store.update(added.id, { createdAt });
        }
        this.showMessage("{green-fg}Credential added successfully.{/green-fg}");
        this.refresh();
      },
    );
  }

  private showEditForm(): void {
    const cred = this.getSelectedCredential();
    if (!cred) {
      this.showMessage("{yellow-fg}No credential selected.{/yellow-fg}");
      return;
    }
    this.showCredentialForm(
      "Edit Credential",
      cred,
      (label, username, password, expiresAt, createdAt) => {
        this.store.update(cred.id, {
          label,
          username,
          expiresAt,
          ...(createdAt ? { createdAt } : {}),
          ...(password ? { password } : {}),
        });
        this.showMessage("{green-fg}Credential updated.{/green-fg}");
        this.refresh();
      },
    );
  }

  private showCredentialForm(
    title: string,
    existing: Credential | null,
    onSubmit: (
      label: string,
      username: string,
      password: string,
      expiresAt: string | null,
      createdAt: string | null,
    ) => void,
  ): void {
    this.modalOpen = true;

    const modal = blessed.box({
      parent: this.screen,
      top: "center",
      left: "center",
      width: 62,
      height: 21,
      border: { type: "line" },
      label: ` ${title} `,
      tags: true,
      style: { border: { fg: "cyan" }, bg: "black" },
      shadow: true,
    });

    const formatDate = (iso: string | null | undefined): string => {
      if (!iso) return "";
      const d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const yyyy = d.getFullYear();
      return `${mm}/${dd}/${yyyy}`;
    };

    const fieldDefs = [
      { name: "Label", defaultVal: existing?.label ?? "" },
      { name: "Username", defaultVal: existing?.username ?? "" },
      { name: "Password", defaultVal: "", censor: true },
      { name: "Expires", defaultVal: formatDate(existing?.expiresAt) },
      { name: "Created", defaultVal: formatDate(existing?.createdAt) },
    ];

    const inputs: blessed.Widgets.TextboxElement[] = [];

    fieldDefs.forEach((def, i) => {
      blessed.box({
        parent: modal,
        top: 1 + i * 3,
        left: 2,
        width: 11,
        height: 1,
        content: `${def.name}:`,
        style: { fg: "white", bg: "black" },
      });

      const input = blessed.textbox({
        parent: modal,
        top: 1 + i * 3,
        left: 14,
        width: 42,
        height: 1,
        inputOnFocus: true,
        style: { fg: "white", bg: "gray", focus: { bg: "blue" } },
        censor: def.censor,
      } as blessed.Widgets.TextboxOptions);

      if (def.defaultVal) {
        input.setValue(def.defaultVal);
      }

      inputs.push(input);
    });

    blessed.box({
      parent: modal,
      top: 16,
      left: 2,
      width: 56,
      height: 1,
      content:
        "{gray-fg}Dates: MM/DD/YYYY or empty" +
        (existing ? " | Password: empty keeps current" : "") +
        "{/gray-fg}",
      tags: true,
      style: { bg: "black" },
    });

    blessed.box({
      parent: modal,
      bottom: 0,
      left: 2,
      width: 56,
      height: 1,
      content:
        "{gray-fg}Tab/Enter: Next | Shift+Tab: Prev | Esc: Cancel{/gray-fg}",
      tags: true,
      style: { bg: "black" },
    });

    let currentField = 0;
    let closed = false;

    const closeModal = () => {
      if (closed) return;
      closed = true;
      this.modalOpen = false;
      modal.destroy();
      this.table.focus();
      this.screen.render();
    };

    const focusField = (idx: number) => {
      if (closed) return;
      currentField = idx;
      inputs[currentField].focus();
      this.screen.render();
    };

    const navigateForward = () => {
      if (closed) return;
      currentField++;

      if (currentField >= inputs.length) {
        const label = inputs[0].getValue().trim();
        const username = inputs[1].getValue().trim();
        const password = inputs[2].getValue().trim();
        const expiresRaw = inputs[3].getValue().trim();
        const createdRaw = inputs[4].getValue().trim();

        if (!label || !username || (!password && !existing)) {
          this.showMessage(
            "{red-fg}Label, Username and Password are required.{/red-fg}",
          );
          focusField(0);
          return;
        }

        const parseDate = (
          raw: string,
          fieldIdx: number,
        ): string | null | false => {
          if (!raw) return null;
          const parsed = new Date(raw);
          if (isNaN(parsed.getTime())) {
            this.showMessage(
              "{red-fg}Invalid date format. Use MM/DD/YYYY.{/red-fg}",
            );
            focusField(fieldIdx);
            return false;
          }
          return parsed.toISOString();
        };

        const expiresAt = parseDate(expiresRaw, 3);
        if (expiresAt === false) return;

        const createdAt = parseDate(createdRaw, 4);
        if (createdAt === false) return;

        onSubmit(label, username, password, expiresAt, createdAt);
        closeModal();
      } else {
        focusField(currentField);
      }
    };

    const navigateBack = () => {
      if (closed) return;
      if (currentField > 0) {
        currentField--;
        focusField(currentField);
      }
    };

    const stripTab = (input: blessed.Widgets.TextboxElement) => {
      const val = input.getValue();
      if (val.includes("\t")) {
        input.setValue(val.replace(/\t/g, ""));
      }
    };

    let navigating = false;

    inputs.forEach((input, i) => {
      input.on("submit", () => {
        if (navigating) return;
        currentField = i;
        navigateForward();
      });
      input.on("cancel", () => {
        if (navigating) return;
        closeModal();
      });
      input.key(["tab"], () => {
        navigating = true;
        input.cancel();
        navigating = false;
        stripTab(input);
        currentField = i;
        navigateForward();
      });
      input.key(["S-tab"], () => {
        if (i === 0) return;
        navigating = true;
        input.cancel();
        navigating = false;
        stripTab(input);
        currentField = i;
        navigateBack();
      });
    });

    this.screen.render();
    inputs[0].focus();
  }

  /* ------------------------------------------------------------------ */
  /*  STATUS MODAL                                                      */
  /* ------------------------------------------------------------------ */

  private showStatusModal(): void {
    const cred = this.getSelectedCredential();
    if (!cred) {
      this.showMessage("{yellow-fg}No credential selected.{/yellow-fg}");
      return;
    }

    this.modalOpen = true;

    const modal = blessed.list({
      parent: this.screen,
      top: "center",
      left: "center",
      width: 34,
      height: STATUSES.length + 4,
      border: { type: "line" },
      label: ` Status: ${cred.label} `,
      tags: true,
      keys: true,
      vi: false,
      mouse: true,
      style: {
        border: { fg: "cyan" },
        selected: { fg: "black", bg: "cyan" },
        item: { fg: "white" },
        bg: "black",
      },
      items: STATUSES.map((s) => {
        const marker = s === cred.status ? " ◀ current" : "";
        return `  ${STATUS_ICONS[s]} ${s}${marker}`;
      }),
      shadow: true,
    });

    const currentIdx = STATUSES.indexOf(cred.status);
    if (currentIdx >= 0) modal.select(currentIdx);

    modal.key(["escape"], () => {
      this.modalOpen = false;
      modal.destroy();
      this.table.focus();
      this.screen.render();
    });

    modal.key(["enter"], () => {
      const sel = (modal as any).selected as number;
      const status = STATUSES[sel];
      if (status) {
        this.store.setStatus(cred.id, status);
        this.showMessage(`{green-fg}Status changed to ${status}.{/green-fg}`);
        this.refresh();
      }
      this.modalOpen = false;
      modal.destroy();
      this.table.focus();
      this.screen.render();
    });

    modal.focus();
    this.screen.render();
  }

  /* ------------------------------------------------------------------ */
  /*  COPY CREDENTIALS                                                  */
  /* ------------------------------------------------------------------ */

  private copyToClipboard(text: string): boolean {
    try {
      const platform = process.platform;
      if (platform === "win32") {
        execSync("clip", { input: text });
      } else if (platform === "darwin") {
        execSync("pbcopy", { input: text });
      } else {
        execSync("xclip -selection clipboard", { input: text });
      }
      return true;
    } catch {
      return false;
    }
  }

  private showCopyMenu(): void {
    const cred = this.getSelectedCredential();
    if (!cred) {
      this.showMessage("{yellow-fg}No credential selected.{/yellow-fg}");
      return;
    }

    this.modalOpen = true;

    const items = [
      { label: "Username", value: cred.username },
      { label: "Password", value: cred.password },
      {
        label: "Username:Password",
        value: `${cred.username}:${cred.password}`,
      },
    ];

    const modal = blessed.list({
      parent: this.screen,
      top: "center",
      left: "center",
      width: 38,
      height: items.length + 4,
      border: { type: "line" },
      label: ` Copy: ${cred.label} `,
      tags: true,
      keys: true,
      vi: false,
      mouse: true,
      style: {
        border: { fg: "cyan" },
        selected: { fg: "black", bg: "cyan" },
        item: { fg: "white" },
        bg: "black",
      },
      items: items.map((it) => `  ${it.label}`),
      shadow: true,
    });

    modal.key(["escape"], () => {
      this.modalOpen = false;
      modal.destroy();
      this.table.focus();
      this.screen.render();
    });

    modal.key(["enter"], () => {
      const sel = (modal as any).selected as number;
      const item = items[sel];
      if (item) {
        const ok = this.copyToClipboard(item.value);
        this.showMessage(
          ok
            ? `{green-fg}${item.label} copied to clipboard.{/green-fg}`
            : "{red-fg}Failed to copy. Clipboard tool not found.{/red-fg}",
        );
      }
      this.modalOpen = false;
      modal.destroy();
      this.table.focus();
      this.screen.render();
    });

    modal.focus();
    this.screen.render();
  }

  /* ------------------------------------------------------------------ */
  /*  DELETE CONFIRM                                                     */
  /* ------------------------------------------------------------------ */

  private showDeleteConfirm(): void {
    const cred = this.getSelectedCredential();
    if (!cred) {
      this.showMessage("{yellow-fg}No credential selected.{/yellow-fg}");
      return;
    }

    this.modalOpen = true;

    const modal = blessed.box({
      parent: this.screen,
      top: "center",
      left: "center",
      width: 52,
      height: 7,
      border: { type: "line" },
      label: " Confirm Delete ",
      content: `\n  Delete "{bold}${cred.label}{/bold}" (${cred.username})?\n\n  {green-fg}Y{/green-fg}: Confirm    {red-fg}N / Esc{/red-fg}: Cancel`,
      tags: true,
      style: { border: { fg: "red" }, bg: "black" },
      shadow: true,
    });

    modal.key(["y"], () => {
      this.store.remove(cred.id);
      this.showMessage("{green-fg}Credential deleted.{/green-fg}");
      this.refresh();
      this.modalOpen = false;
      modal.destroy();
      this.table.focus();
      this.screen.render();
    });

    modal.key(["n", "escape"], () => {
      this.modalOpen = false;
      modal.destroy();
      this.table.focus();
      this.screen.render();
    });

    modal.focus();
    this.screen.render();
  }

  /* ------------------------------------------------------------------ */
  /*  BROWSER LAUNCH                                                    */
  /* ------------------------------------------------------------------ */

  private async handleLaunchBrowser(): Promise<void> {
    const cred = this.getSelectedCredential();
    if (!cred) {
      this.showMessage("{yellow-fg}No credential selected.{/yellow-fg}");
      return;
    }

    if (cred.status !== "enabled" && cred.status !== "unverified") {
      this.showMessage(
        `{yellow-fg}Cannot launch: "${cred.label}" status is ${cred.status}. Only enabled/unverified credentials can launch.{/yellow-fg}`,
      );
      return;
    }

    if (this.runningBrowsers.has(cred.id)) {
      this.showMessage(
        `{yellow-fg}Browser already running for ${cred.label}.{/yellow-fg}`,
      );
      return;
    }

    this.runningBrowsers.add(cred.id);
    this.refresh();
    this.showMessage(
      `{cyan-fg}Launching browser for ${cred.label}...{/cyan-fg}`,
    );

    try {
      await launchBrowser(cred, () => {
        this.runningBrowsers.delete(cred.id);
        this.refresh();
        this.showMessage(
          `{yellow-fg}Browser closed for ${cred.label}.{/yellow-fg}`,
        );
      });
      this.showMessage(
        `{green-fg}Browser launched for ${cred.label}.{/green-fg}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.runningBrowsers.delete(cred.id);
      this.refresh();
      this.showMessage(`{red-fg}Launch failed: ${msg}{/red-fg}`, 5000);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  FILE BROWSER DIALOG                                               */
  /* ------------------------------------------------------------------ */

  private showFileBrowser(
    mode: "save" | "open",
    options: {
      title?: string;
      defaultDir?: string;
      defaultFilename?: string;
      filter?: string;
    },
    callback: (filePath: string | null) => void,
  ): void {
    this.modalOpen = true;

    let currentDir = path.resolve(options.defaultDir || process.cwd());
    let entries: { name: string; isDir: boolean }[] = [];

    const modal = blessed.box({
      parent: this.screen,
      top: "center",
      left: "center",
      width: "80%",
      height: "80%",
      border: { type: "line" },
      label: ` ${options.title || (mode === "save" ? "Save As" : "Open File")} `,
      tags: true,
      style: { border: { fg: "cyan" }, bg: "black" },
      shadow: true,
    });

    const pathBox = blessed.box({
      parent: modal,
      top: 0,
      left: 1,
      width: "100%-4",
      height: 1,
      tags: true,
      style: { fg: "yellow", bg: "black" },
    });

    const fileList = blessed.list({
      parent: modal,
      top: 2,
      left: 1,
      width: "100%-4",
      height: mode === "save" ? "100%-8" : "100%-5",
      keys: true,
      vi: false,
      mouse: true,
      tags: true,
      style: {
        selected: { fg: "black", bg: "cyan" },
        item: { fg: "white" },
      },
      scrollbar: { ch: "\u2588", style: { bg: "cyan" } },
    });

    let filenameInput: blessed.Widgets.TextboxElement | null = null;
    if (mode === "save") {
      blessed.box({
        parent: modal,
        bottom: 3,
        left: 1,
        width: 10,
        height: 1,
        content: "Filename:",
        style: { fg: "white", bg: "black" },
      });

      filenameInput = blessed.textbox({
        parent: modal,
        bottom: 3,
        left: 12,
        width: "100%-16",
        height: 1,
        inputOnFocus: true,
        style: { fg: "white", bg: "gray", focus: { bg: "blue" } },
      } as blessed.Widgets.TextboxOptions);

      if (options.defaultFilename) {
        filenameInput.setValue(options.defaultFilename);
      }
    }

    blessed.box({
      parent: modal,
      bottom: 1,
      left: 1,
      width: "100%-4",
      height: 1,
      content:
        mode === "save"
          ? "{gray-fg}Enter:Open Dir | Tab:Filename | Esc:Cancel{/gray-fg}"
          : "{gray-fg}Enter:Open Dir/Select File | Esc:Cancel{/gray-fg}",
      tags: true,
      style: { bg: "black" },
    });

    let closed = false;

    const closeModal = () => {
      if (closed) return;
      closed = true;
      this.modalOpen = false;
      modal.destroy();
      this.table.focus();
      this.screen.render();
    };

    const loadDir = (dirPath: string) => {
      try {
        const raw = fs.readdirSync(dirPath, { withFileTypes: true });
        entries = [{ name: "..", isDir: true }];

        const dirs = raw
          .filter((e) => e.isDirectory())
          .sort((a, b) => a.name.localeCompare(b.name));
        const files = raw
          .filter((e) => e.isFile())
          .sort((a, b) => a.name.localeCompare(b.name));

        dirs.forEach((d) => entries.push({ name: d.name, isDir: true }));

        if (mode === "open" && options.filter) {
          files
            .filter((f) => f.name.toLowerCase().endsWith(options.filter!))
            .forEach((f) => entries.push({ name: f.name, isDir: false }));
        } else {
          files.forEach((f) => entries.push({ name: f.name, isDir: false }));
        }

        currentDir = path.resolve(dirPath);
        pathBox.setContent(`{yellow-fg}${currentDir}{/yellow-fg}`);
        fileList.setItems(
          entries.map((e) =>
            e.name === ".."
              ? "  {yellow-fg}<- ..{/yellow-fg}"
              : e.isDir
                ? `  {cyan-fg}[DIR]{/cyan-fg}  ${e.name}`
                : `         ${e.name}`,
          ),
        );
        fileList.select(0);
        this.screen.render();
      } catch {
        // Permission denied — stay in current dir
      }
    };

    fileList.key(["enter"], () => {
      if (closed) return;
      const sel = (fileList as any).selected as number;
      const entry = entries[sel];
      if (!entry) return;

      if (entry.isDir) {
        const newDir =
          entry.name === ".."
            ? path.dirname(currentDir)
            : path.join(currentDir, entry.name);
        loadDir(newDir);
      } else if (mode === "open") {
        const fullPath = path.join(currentDir, entry.name);
        closeModal();
        callback(fullPath);
      } else if (mode === "save" && filenameInput) {
        filenameInput.setValue(entry.name);
        filenameInput.focus();
        this.screen.render();
      }
    });

    fileList.key(["escape"], () => {
      closeModal();
      callback(null);
    });

    if (mode === "save" && filenameInput) {
      let navigating = false;

      fileList.key(["tab"], () => {
        if (closed) return;
        filenameInput!.focus();
        this.screen.render();
      });

      filenameInput.on("submit", (value: string) => {
        if (navigating || closed) return;
        const filename = value.trim();
        if (!filename) return;
        const fullPath = path.join(currentDir, filename);
        closeModal();
        callback(fullPath);
      });

      filenameInput.on("cancel", () => {
        if (navigating) return;
        closeModal();
        callback(null);
      });

      filenameInput.key(["tab"], () => {
        navigating = true;
        filenameInput!.cancel();
        navigating = false;
        const val = filenameInput!.getValue();
        if (val.includes("\t")) {
          filenameInput!.setValue(val.replace(/\t/g, ""));
        }
        fileList.focus();
        this.screen.render();
      });
    }

    loadDir(currentDir);
    fileList.focus();
  }

  /* ------------------------------------------------------------------ */
  /*  PROGRESS DIALOG                                                   */
  /* ------------------------------------------------------------------ */

  private showProgressDialog(title: string): {
    update: (percent: number, text: string) => void;
    close: () => void;
  } {
    const modal = blessed.box({
      parent: this.screen,
      top: "center",
      left: "center",
      width: 60,
      height: 9,
      border: { type: "line" },
      label: ` ${title} `,
      tags: true,
      style: { border: { fg: "cyan" }, bg: "black" },
      shadow: true,
    });

    const statusText = blessed.box({
      parent: modal,
      top: 1,
      left: 2,
      width: "100%-6",
      height: 1,
      content: "Preparing...",
      tags: true,
      style: { fg: "white", bg: "black" },
    });

    const progressBox = blessed.box({
      parent: modal,
      top: 3,
      left: 2,
      width: "100%-6",
      height: 1,
      tags: true,
      style: { bg: "black" },
    });

    const percentText = blessed.box({
      parent: modal,
      top: 5,
      left: 2,
      width: "100%-6",
      height: 1,
      content: "{center}0%{/center}",
      tags: true,
      style: { fg: "white", bg: "black" },
    });

    this.screen.render();

    return {
      update: (percent: number, text: string) => {
        const p = Math.min(100, Math.max(0, Math.round(percent)));
        statusText.setContent(text);
        const barWidth = 52;
        const filled = Math.round((barWidth * p) / 100);
        const empty = barWidth - filled;
        progressBox.setContent(
          `{green-fg}${"\u2588".repeat(filled)}{/green-fg}{gray-fg}${"\u2591".repeat(empty)}{/gray-fg}`,
        );
        percentText.setContent(`{center}${p}%{/center}`);
        this.screen.render();
      },
      close: () => {
        modal.destroy();
        this.screen.render();
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /*  EXPORT (F10)                                                      */
  /* ------------------------------------------------------------------ */

  private handleExport(): void {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const defaultFilename = `accounts-backup-${dateStr}.zip`;

    this.showFileBrowser(
      "save",
      { title: "Export: Choose Location", defaultFilename },
      async (filePath) => {
        if (!filePath) return;
        if (!filePath.toLowerCase().endsWith(".zip")) filePath += ".zip";

        this.modalOpen = true;
        const progress = this.showProgressDialog("Exporting");

        try {
          const credsPath = getCredsPath();
          const dataDir = getDataDir();

          let totalFiles = 0;
          if (fs.existsSync(credsPath)) totalFiles++;
          if (fs.existsSync(dataDir)) {
            const count = (dir: string): number => {
              let n = 0;
              for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
                n += ent.isDirectory() ? count(path.join(dir, ent.name)) : 1;
              }
              return n;
            };
            totalFiles += count(dataDir);
          }

          if (totalFiles === 0) {
            progress.close();
            this.modalOpen = false;
            this.table.focus();
            this.showMessage("{yellow-fg}No data to export.{/yellow-fg}");
            return;
          }

          progress.update(0, "Creating archive...");

          const output = fs.createWriteStream(filePath);
          const archive = archiver("zip", { zlib: { level: 9 } });
          let processed = 0;

          archive.on("entry", () => {
            processed++;
            const pct = Math.round((processed / totalFiles) * 100);
            progress.update(pct, `Compressing... (${processed}/${totalFiles})`);
          });

          await new Promise<void>((resolve, reject) => {
            output.on("close", resolve);
            archive.on("error", reject);
            archive.on("warning", (err) => {
              if (err.code !== "ENOENT") reject(err);
            });

            archive.pipe(output);

            if (fs.existsSync(credsPath)) {
              archive.file(credsPath, { name: "creds.json" });
            }
            if (fs.existsSync(dataDir)) {
              archive.directory(dataDir, "data");
            }

            archive.finalize();
          });

          progress.update(100, "Export complete!");
          await new Promise((r) => setTimeout(r, 1000));
          progress.close();
          this.modalOpen = false;
          this.table.focus();
          this.showMessage(
            `{green-fg}Exported to ${path.basename(filePath)}{/green-fg}`,
          );
        } catch (err) {
          progress.close();
          this.modalOpen = false;
          this.table.focus();
          const msg = err instanceof Error ? err.message : String(err);
          this.showMessage(`{red-fg}Export failed: ${msg}{/red-fg}`, 5000);
        }
      },
    );
  }

  /* ------------------------------------------------------------------ */
  /*  IMPORT (F8)                                                       */
  /* ------------------------------------------------------------------ */

  private handleImport(): void {
    this.showFileBrowser(
      "open",
      { title: "Import: Select ZIP File", filter: ".zip" },
      (filePath) => {
        if (!filePath) return;
        this.showImportConfirm(filePath);
      },
    );
  }

  private showImportConfirm(zipPath: string): void {
    this.modalOpen = true;

    const modal = blessed.box({
      parent: this.screen,
      top: "center",
      left: "center",
      width: 58,
      height: 9,
      border: { type: "line" },
      label: " Confirm Import ",
      content:
        `\n  Import from:\n  {bold}${path.basename(zipPath)}{/bold}\n\n` +
        `  {yellow-fg}This will overwrite current credentials and data.{/yellow-fg}\n\n` +
        `  {green-fg}Y{/green-fg}: Confirm    {red-fg}N / Esc{/red-fg}: Cancel`,
      tags: true,
      style: { border: { fg: "yellow" }, bg: "black" },
      shadow: true,
    });

    modal.key(["y"], () => {
      modal.destroy();
      this.screen.render();
      this.performImport(zipPath);
    });

    modal.key(["n", "escape"], () => {
      this.modalOpen = false;
      modal.destroy();
      this.table.focus();
      this.screen.render();
    });

    modal.focus();
    this.screen.render();
  }

  private async performImport(zipPath: string): Promise<void> {
    const progress = this.showProgressDialog("Importing");

    try {
      progress.update(0, "Reading ZIP file...");

      const zip = new AdmZip(zipPath);
      const zipEntries = zip.getEntries();
      const total = zipEntries.length;

      if (total === 0) {
        progress.close();
        this.modalOpen = false;
        this.table.focus();
        this.showMessage("{yellow-fg}ZIP file is empty.{/yellow-fg}");
        return;
      }

      const hasCreds = zipEntries.some((e) => e.entryName === "creds.json");
      if (!hasCreds) {
        progress.close();
        this.modalOpen = false;
        this.table.focus();
        this.showMessage(
          "{red-fg}Invalid backup: creds.json not found in ZIP.{/red-fg}",
        );
        return;
      }

      const credsPath = getCredsPath();
      const dataDir = getDataDir();
      let processed = 0;

      for (const entry of zipEntries) {
        processed++;
        progress.update(
          Math.round((processed / total) * 100),
          `Extracting... (${processed}/${total})`,
        );

        if (entry.isDirectory) continue;

        if (entry.entryName === "creds.json") {
          fs.writeFileSync(credsPath, entry.getData());
        } else if (entry.entryName.startsWith("data/")) {
          const rel = entry.entryName.substring(5);
          if (rel) {
            const target = path.join(dataDir, rel);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, entry.getData());
          }
        }
      }

      progress.update(100, "Import complete!");
      await new Promise((r) => setTimeout(r, 1000));
      progress.close();
      this.modalOpen = false;
      this.store = new CredentialStore();
      this.refresh();
      this.table.focus();
      this.showMessage("{green-fg}Import completed successfully!{/green-fg}");
    } catch (err) {
      progress.close();
      this.modalOpen = false;
      this.table.focus();
      const msg = err instanceof Error ? err.message : String(err);
      this.showMessage(`{red-fg}Import failed: ${msg}{/red-fg}`, 5000);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  RUN                                                               */
  /* ------------------------------------------------------------------ */

  run(): void {
    this.screen.render();
  }
}
