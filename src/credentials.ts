import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { getCredsPath } from "./config";
import type { Credential, CredentialStatus } from "./types";

export class CredentialStore {
  private filePath: string;
  private credentials: Credential[] = [];

  constructor() {
    this.filePath = getCredsPath();
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(raw);
        this.credentials = Array.isArray(parsed) ? parsed : [];
      }
    } catch {
      this.credentials = [];
    }
  }

  private save(): void {
    fs.writeFileSync(
      this.filePath,
      JSON.stringify(this.credentials, null, 2),
      "utf-8",
    );
  }

  public getAll(): Credential[] {
    return [...this.credentials];
  }

  public getById(id: string): Credential | undefined {
    return this.credentials.find((c) => c.id === id);
  }

  public add(
    label: string,
    username: string,
    password: string,
    expiresAt: string | null = null,
  ): Credential {
    const now = new Date().toISOString();
    const cred: Credential = {
      id: randomUUID(),
      label,
      username,
      password,
      status: "unverified",
      expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    this.credentials.push(cred);
    this.save();
    return cred;
  }

  public update(
    id: string,
    data: Partial<
      Pick<
        Credential,
        "label" | "username" | "password" | "status" | "expiresAt" | "createdAt"
      >
    >,
  ): Credential | null {
    const idx = this.credentials.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    this.credentials[idx] = {
      ...this.credentials[idx],
      ...data,
      updatedAt: new Date().toISOString(),
    };
    this.save();
    return this.credentials[idx];
  }

  public remove(id: string): boolean {
    const len = this.credentials.length;
    this.credentials = this.credentials.filter((c) => c.id !== id);
    if (this.credentials.length < len) {
      this.save();
      return true;
    }
    return false;
  }

  public setStatus(id: string, status: CredentialStatus): Credential | null {
    return this.update(id, { status });
  }
}
