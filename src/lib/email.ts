import { NotConfiguredError } from "./errors";

export type EmailMessage = { to: string; subject: string; text: string; link?: string | null };
export interface EmailAdapter {
  readonly name: string;
  send(msg: EmailMessage): Promise<{ id: string }>;
}

/** Development adapter: records the message in the delivery row; nothing leaves the server. */
export class OutboxEmailAdapter implements EmailAdapter {
  readonly name = "outbox";
  async send(msg: EmailMessage) {
    if (msg.to.endsWith(".invalid-bounce")) throw new Error("Simulated bounce");
    return { id: `outbox-${Date.now()}` };
  }
}

/**
 * Production adapter placeholder. Wire to the City/County mail relay or an approved service
 * (SMTP via nodemailer, Microsoft Graph sendMail, etc.). See docs/INTEGRATIONS.md.
 */
export class SmtpEmailAdapter implements EmailAdapter {
  readonly name = "smtp";
  async send(): Promise<{ id: string }> {
    throw new NotConfiguredError("SMTP email adapter is not configured. Set EMAIL_PROVIDER=outbox for development.");
  }
}

export function getEmailAdapter(): EmailAdapter {
  return process.env.EMAIL_PROVIDER === "smtp" ? new SmtpEmailAdapter() : new OutboxEmailAdapter();
}
