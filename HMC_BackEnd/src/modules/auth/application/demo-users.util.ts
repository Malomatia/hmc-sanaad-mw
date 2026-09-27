/** True when `username` is one of the configured DEMO_USERS (stored upper-cased). */
export function isDemoUser(username: string, demoUsers: readonly string[]): boolean {
  return demoUsers.includes(username.trim().toUpperCase());
}
