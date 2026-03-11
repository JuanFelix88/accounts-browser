export type CredentialStatus =
  | "unverified"
  | "enabled"
  | "disabled"
  | "expired"
  | "error";

export interface Credential {
  id: string;
  label: string;
  username: string;
  password: string;
  status: CredentialStatus;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const STATUSES: CredentialStatus[] = [
  "unverified",
  "enabled",
  "disabled",
  "expired",
  "error",
];
