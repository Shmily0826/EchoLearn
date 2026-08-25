export function shouldAutoSyncUser(user: { uid?: string | null; emailVerified?: boolean } | null | undefined): boolean {
  return Boolean(user?.uid && user.emailVerified);
}
