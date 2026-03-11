import blessed from "blessed";
import { execSync } from "node:child_process";
import { CredentialStore } from "../credentials";
import { launchBrowser } from "../browser";
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
        " {bold}F1{/bold}:Add  {bold}F2{/bold}:Edit  {bold}F3{/bold}:Status  {bold}F4{/bold}:Copy  {bold}DEL{/bold}:Delete  {bold}ENTER{/bold}:Launch  {bold}q{/bold}:Quit",
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
  /*  RUN                                                               */
  /* ------------------------------------------------------------------ */

  run(): void {
    this.screen.render();
  }
}
