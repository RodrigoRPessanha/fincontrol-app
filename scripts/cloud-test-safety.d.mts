import type { ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
export const STAGING_PROJECT_REF: string;
export const STAGING_URL: string;
export type CloudEnvironment = Record<string, string | undefined>;
export interface CloudOptions {
  root?: string;
  env?: CloudEnvironment;
  execute?: (file: string, args: string[], options: ExecFileSyncOptionsWithStringEncoding) => string;
}
export function loadCloudEnvironment(options?: Pick<CloudOptions, 'env' | 'root'>): CloudEnvironment;
export function assertStagingDatabase(connection: { host: string; port?: string | number; user?: string; database?: string }): void;
export function assertStagingTarget(env: CloudEnvironment, options?: { root?: string; requireApi?: boolean; requireLink?: boolean }): void;
export function runSupabaseCli(args: string[], options?: CloudOptions): string;
export function getStagingServiceRoleKey(env: CloudEnvironment, options?: Omit<CloudOptions, 'env'>): string;
