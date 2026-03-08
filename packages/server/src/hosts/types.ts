export type AuthMethod = "password" | "privateKey";

export interface RemoteHost {
  id: number;
  label: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  /** Encrypted password or private key content */
  credential: string;
  created_at: string;
  last_scan_at: string | null;
  last_scan_error: string | null;
}

export interface RemoteHostRow {
  id: number;
  label: string;
  host: string;
  port: number;
  username: string;
  auth_method: AuthMethod;
  credential_enc: string;
  created_at: string;
  last_scan_at: string | null;
  last_scan_error: string | null;
}

export interface CreateHostInput {
  label: string;
  host: string;
  port?: number;
  username: string;
  authMethod: AuthMethod;
  credential: string;
}
