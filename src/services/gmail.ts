/**
 * Gmail SMTP Client using App Passwords
 * Simple wrapper for sending emails via Gmail
 */

import nodemailer from "nodemailer";
import { createLogger } from "@/utils/logger";

const log = createLogger("gmail");

// ============================================================================
// Types
// ============================================================================

export interface EmailMessage {
  to: string;
  toName?: string;
  subject: string;
  textBody: string;
  customId?: string;
  attachments?: Array<{
    filename: string;
    path: string;
  }>;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  email: string;
  error?: string;
}

// ============================================================================
// Configuration
// ============================================================================

export function getGmailConfig() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  
  if (!user || !pass) {
    throw new Error(
      "Missing Gmail credentials: GMAIL_USER and GMAIL_APP_PASSWORD required"
    );
  }
  
  return { user, pass };
}

// ============================================================================
// Send Emails
// ============================================================================

/**
 * Send emails via Gmail SMTP
 * Sends emails one at a time for reliability
 */
export async function sendEmails(
  messages: EmailMessage[],
  onProgress?: (result: EmailResult, index: number, total: number) => void,
): Promise<EmailResult[]> {
  if (messages.length === 0) {
    log.warn("No messages to send");
    return [];
  }

  log.info("Preparing to send emails", {
    count: messages.length,
  });

  const config = getGmailConfig();
  
  // Create transporter
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: config,
  });

  const results: EmailResult[] = [];
  
  // Send emails one at a time
  for (const msg of messages) {
    const start = performance.now();
    
    try {
      log.debug("Sending email", {
        to: msg.to,
        subject: msg.subject,
      });
      
      const info = await transporter.sendMail({
        from: config.user,
        to: msg.toName ? `"${msg.toName}" <${msg.to}>` : msg.to,
        subject: msg.subject,
        text: msg.textBody,
        attachments: msg.attachments,
      });
      
      const duration = Math.round(performance.now() - start);
      
      log.info("Email sent successfully", {
        to: msg.to,
        messageId: info.messageId,
        durationMs: duration,
      });
      
      const result: EmailResult = {
        success: true,
        messageId: info.messageId,
        email: msg.to,
      };
      results.push(result);
      onProgress?.(result, results.length - 1, messages.length);
    } catch (error) {
      const duration = Math.round(performance.now() - start);
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      log.error("Failed to send email", {
        to: msg.to,
        error: errorMsg,
        durationMs: duration,
      });
      
      const result: EmailResult = {
        success: false,
        email: msg.to,
        error: errorMsg,
      };
      results.push(result);
      onProgress?.(result, results.length - 1, messages.length);
    }
  }

  log.info("Email send complete", {
    total: results.length,
    successful: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
  });

  return results;
}
