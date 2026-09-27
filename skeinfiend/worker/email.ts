/** Sending email, through Resend's API. */
export interface EmailEnv {
  readonly RESEND_API_KEY?: string
  /**
   * Who it's from: an address on a domain verified in Resend. Until there is
   * one, Resend's own test sender, which only delivers to the Resend
   * account's own email.
   */
  readonly EMAIL_FROM?: string
}

export async function sendEmail(env: EmailEnv, message: { to: string; subject: string; text: string; html: string }): Promise<void> {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY isn’t set: email can’t be sent.')
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM ?? 'SkeinFiend <onboarding@resend.dev>', ...message }),
  })
  if (!response.ok) throw new Error(`Resend: ${response.status} ${await response.text()}`)
}
