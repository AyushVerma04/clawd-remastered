import nodemailer from 'nodemailer';
import { config } from '../../config';
import { ExecutionResult } from '../../shared/types';
import logger from '../../shared/logger';

/**
 * Email Sender Module
 * Sends emails via SMTP using nodemailer.
 * Supports Gmail (with App Password), Outlook, and custom SMTP.
 */
export class EmailSender {
  private get isConfigured(): boolean {
    return !!(config.email.user && config.email.pass);
  }

  private createTransport() {
    return nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.port === 465,
      auth: {
        user: config.email.user,
        pass: config.email.pass,
      },
      tls: {
        // Allow self-signed certs in dev
        rejectUnauthorized: config.server.nodeEnv === 'production',
      },
    });
  }

  /** Send a plain text or HTML email. */
  async send(to: string, subject: string, body: string): Promise<ExecutionResult> {
    if (!this.isConfigured) {
      return {
        success: false,
        message:
          'Email is not configured. Set SMTP_USER and SMTP_PASS in your .env file.\n' +
          'For Gmail: use an App Password from https://myaccount.google.com/apppasswords',
      };
    }

    // Basic email address validation
    if (!this.isValidEmail(to)) {
      return { success: false, message: `Invalid email address: ${to}` };
    }

    try {
      const transport = this.createTransport();
      const info = await transport.sendMail({
        from: `"Clawd AI" <${config.email.from}>`,
        to,
        subject,
        text: body,
        html: this.textToHtml(body),
      });

      logger.info(`Email sent to ${to} (messageId: ${info.messageId})`);
      return { success: true, message: `✉️ Email sent to *${to}*\nSubject: ${subject}` };
    } catch (err) {
      const msg = (err as Error).message;
      logger.error(`Email send failed: ${msg}`);
      return { success: false, message: `Failed to send email: ${msg}` };
    }
  }

  /** Verify SMTP credentials are valid. */
  async verify(): Promise<ExecutionResult> {
    if (!this.isConfigured) {
      return { success: false, message: 'Email credentials not configured.' };
    }
    try {
      const transport = this.createTransport();
      await transport.verify();
      return { success: true, message: 'SMTP connection verified successfully.' };
    } catch (err) {
      return { success: false, message: `SMTP verification failed: ${(err as Error).message}` };
    }
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  private textToHtml(text: string): string {
    return `<html><body><pre style="font-family:sans-serif;white-space:pre-wrap;">${
      text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }</pre></body></html>`;
  }
}

export default new EmailSender();
