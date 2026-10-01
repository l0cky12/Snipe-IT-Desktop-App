import { createTransport } from 'nodemailer'
import type { MailInput } from './config'

export type Mail = { to: string; subject: string; text: string; attachments?: { filename: string; content: string; contentType: string }[] }

// The only code that touches the mail library. Sends one message and closes the connection.
export async function sendMail(server: MailInput, mail: Mail) {
  const transport = createTransport({
    host: server.host, port: server.port, secure: server.security === 'ssl', requireTLS: server.security === 'starttls',
    auth: { user: server.username, pass: server.password },
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
  })
  try { await transport.sendMail({ from: server.sender, ...mail }) }
  catch (e) { throw new Error(mailError(e as Error & { code?: string; response?: string }, server)) }
  finally { transport.close() }
}

/** What the Operator can do about a failed send. Gmail answers 534 5.7.9 when the account needs an app password. */
export function mailError(e: Error & { code?: string; response?: string }, { host, port }: Pick<MailInput, 'host' | 'port'>): string {
  const said = e.response || e.message
  if (e.code === 'EAUTH' && /5\.7\.9|application-specific/i.test(said))
    return 'The mail server needs an app password, not your normal password. Turn on 2-Step Verification for the account, create an app password, and enter it here. If app passwords are turned off for your Google Workspace account, ask its admin.'
  if (e.code === 'EAUTH' || e.code === 'ENOAUTH')
    return `The mail server rejected the username or password. Check both; for Gmail, use an app password. If app passwords are turned off for your Google Workspace account, ask its admin. (${said})`
  if (e.code === 'EDNS') return `Can't find the mail server ${host}. Check the SMTP host.`
  if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ETLS', 'ECONNREFUSED'].includes(e.code ?? ''))
    return `Can't connect to ${host}:${port}. Check the host, the port and the security: 465 uses SSL/TLS, 587 uses STARTTLS. Check your network connection too.`
  if (e.code === 'EENVELOPE') return `The mail server refused the sender or recipient address. Gmail only sends from your own address or an alias. (${said})`
  return `The mail server refused to send: ${said}`
}
