import nodemailer from 'nodemailer';
import { env } from '../utils/env.js';
import { logger } from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
});

export interface IssueEmailData {
  to: string;
  issueTitle: string;
  issueUrl: string;
  issueNumber: number;
  matchedLabel: string;
  repoFullName: string;
  isUpdate?: boolean;
  updateCount?: number;
}

export async function sendIssueNotification(data: IssueEmailData): Promise<void> {
  const subject = data.isUpdate
    ? `[Update #${data.updateCount}] Issue #${data.issueNumber}: ${data.issueTitle}`
    : `[New Issue] #${data.issueNumber}: ${data.issueTitle}`;

  const headingText = data.isUpdate
    ? `Issue Update — ${data.repoFullName}`
    : `New Matching Issue — ${data.repoFullName}`;

  const badgeColor = data.isUpdate ? '#e36209' : '#0969da';
  const badgeText = data.isUpdate ? `Update #${data.updateCount}` : 'New Issue';

  await transporter.sendMail({
    from: `"GitHub Issue Notifier" <${env.SMTP_USER}>`,
    to: data.to,
    subject,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:${badgeColor};color:white;padding:4px 10px;border-radius:4px;display:inline-block;font-size:12px;font-weight:600;margin-bottom:12px;">${badgeText}</div>
        <h2 style="color:#1a1a1a;margin-top:0;">${headingText}</h2>
        <h3 style="margin:0 0 8px;">
          <a href="${data.issueUrl}" style="color:#0969da;text-decoration:none;">
            #${data.issueNumber}: ${data.issueTitle}
          </a>
        </h3>
        <p style="color:#555;margin:4px 0;">
          Label: <span style="background:#e1e4e8;border-radius:3px;padding:2px 8px;font-size:12px;">${data.matchedLabel}</span>
        </p>
        <p style="color:#555;margin:4px 0;">
          Repo: <strong>${data.repoFullName}</strong>
        </p>
        <a href="${data.issueUrl}" style="display:inline-block;background:${badgeColor};color:white;padding:8px 16px;border-radius:6px;text-decoration:none;margin-top:16px;">
          View on GitHub
        </a>
      </div>
    `,
    text: `${headingText}\n\n#${data.issueNumber}: ${data.issueTitle}\nLabel: ${data.matchedLabel}\nRepo: ${data.repoFullName}\n\n${data.issueUrl}`,
  });

  logger.info(
    { to: data.to, issueNumber: data.issueNumber, isUpdate: data.isUpdate },
    'Notification email sent'
  );
}
