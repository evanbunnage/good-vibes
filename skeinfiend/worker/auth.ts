import { betterAuth, type BetterAuthOptions } from 'better-auth'
import type { Pool } from 'pg'
import { sendEmail, type EmailEnv } from './email.ts'

export interface AuthEnv extends EmailEnv {
  /** Signs sessions: a long random string, kept secret (`.env` locally, `wrangler secret put` deployed). */
  readonly BETTER_AUTH_SECRET: string
  /** Where the app is served, e.g. https://skeinfiend.example.com. Locally, the dev server's address. */
  readonly BETTER_AUTH_URL?: string
}

/**
 * Sign-in, by Better Auth, with its tables in our Postgres: email and
 * password, with a reset link by email (Resend) for a forgotten password. The
 * same options create its tables (`scripts/migrate.ts`).
 */
export function authOptions(pool: Pool, env: AuthEnv): BetterAuthOptions {
  return {
    database: pool,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    // Counted in the database: a Worker keeps nothing in memory between requests. By the visitor's
    // address as Cloudflare sees it; Better Auth's defaults are stricter on sign-in and password reset.
    rateLimit: { enabled: true, storage: 'database' },
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      // The link goes through Better Auth, which checks it and sends them on to the app's /reset-password.
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(env, { to: user.email, ...resetPasswordEmail(url) })
      },
    },
  }
}

export const createAuth = (pool: Pool, env: AuthEnv) => betterAuth(authOptions(pool, env))

/** The password reset email, as Apple and most well-made apps write it: short, plain, one button (in the app's --primary), no greeting. */
export function resetPasswordEmail(url: string): { subject: string; text: string; html: string } {
  const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  return {
    subject: 'Reset your SkeinFiend password',
    text: `We received a request to reset the password for your SkeinFiend account.\n\nReset your password: ${url}\n\nThis link expires in 1 hour. If you didn't request a password reset, you can ignore this email.`,
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#2f332f;max-width:480px">
<p>We received a request to reset the password for your SkeinFiend account.</p>
<p style="margin:28px 0"><a href="${escapeHtml(url)}" style="display:inline-block;padding:11px 20px;border-radius:8px;background:#7e2419;color:#f6f1ea;font-weight:600;text-decoration:none">Reset Password</a></p>
<p style="color:#6f726d;font-size:13px">This link expires in 1 hour. If you didn't request a password reset, you can ignore this email.</p>
</div>`,
  }
}
