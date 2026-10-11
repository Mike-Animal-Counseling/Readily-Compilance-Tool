export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { accessConfig } = await import('./lib/auth/session');
    accessConfig();
    if (process.env.NODE_ENV === 'production') {
      const { sharedClient } = await import('./lib/security/store');
      await sharedClient();
    }
  }
}
