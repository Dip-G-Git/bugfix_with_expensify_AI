import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Nodemailer mock (hoisted so it applies before email.service.ts loads) ---
const mockSendMail = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ messageId: '<test-message-id@ethereal>' })
);

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: mockSendMail })),
  },
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { sendIssueNotification } from '../../../src/services/email.service.js';

const BASE_PAYLOAD = {
  to: 'sandghos1987@gmail.com',
  issueTitle: 'Fix accessibility issue in ExpensifyCard form',
  issueUrl: 'https://github.com/Expensify/App/issues/47668',
  issueNumber: 47668,
  matchedLabel: 'Help Wanted',
  repoFullName: 'Expensify/App',
};

describe('sendIssueNotification()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── New issue email ──────────────────────────────────────────────────────

  it('sends email with [New Issue] subject for initial notification', async () => {
    await sendIssueNotification({ ...BASE_PAYLOAD, isUpdate: false });

    const [mail] = mockSendMail.mock.calls[0];
    expect(mail.subject).toBe('[New Issue] #47668: Fix accessibility issue in ExpensifyCard form');
  });

  it('includes issue URL in the email body (HTML)', async () => {
    await sendIssueNotification({ ...BASE_PAYLOAD });

    const [mail] = mockSendMail.mock.calls[0];
    expect(mail.html).toContain(BASE_PAYLOAD.issueUrl);
  });

  it('includes issue title in the email body', async () => {
    await sendIssueNotification({ ...BASE_PAYLOAD });

    const [mail] = mockSendMail.mock.calls[0];
    expect(mail.html).toContain(BASE_PAYLOAD.issueTitle);
  });

  it('includes issue number in the email body', async () => {
    await sendIssueNotification({ ...BASE_PAYLOAD });

    const [mail] = mockSendMail.mock.calls[0];
    expect(mail.html).toContain('#47668');
  });

  it('uses blue badge color for new issue notification', async () => {
    await sendIssueNotification({ ...BASE_PAYLOAD, isUpdate: false });

    const [mail] = mockSendMail.mock.calls[0];
    expect(mail.html).toContain('#0969da');
  });

  it('includes "New Issue" badge text for initial notification', async () => {
    await sendIssueNotification({ ...BASE_PAYLOAD, isUpdate: false });

    const [mail] = mockSendMail.mock.calls[0];
    expect(mail.html).toContain('New Issue');
  });

  it('sends plain text version with issue URL', async () => {
    await sendIssueNotification({ ...BASE_PAYLOAD });

    const [mail] = mockSendMail.mock.calls[0];
    expect(mail.text).toContain(BASE_PAYLOAD.issueUrl);
  });

  it('sends to the configured recipient email address', async () => {
    await sendIssueNotification({ ...BASE_PAYLOAD, to: 'sandghos1987@gmail.com' });

    const [mail] = mockSendMail.mock.calls[0];
    expect(mail.to).toBe('sandghos1987@gmail.com');
  });

  it('includes repo name in the heading', async () => {
    await sendIssueNotification({ ...BASE_PAYLOAD });

    const [mail] = mockSendMail.mock.calls[0];
    expect(mail.html).toContain('Expensify/App');
  });

  it('includes matched label in the email body', async () => {
    await sendIssueNotification({ ...BASE_PAYLOAD });

    const [mail] = mockSendMail.mock.calls[0];
    expect(mail.html).toContain('Help Wanted');
  });

  // ─── Update email ─────────────────────────────────────────────────────────

  it('sends email with [Update #N] subject for update notification', async () => {
    await sendIssueNotification({ ...BASE_PAYLOAD, isUpdate: true, updateCount: 1 });

    const [mail] = mockSendMail.mock.calls[0];
    expect(mail.subject).toBe('[Update #1] Issue #47668: Fix accessibility issue in ExpensifyCard form');
  });

  it('uses orange badge color for update notification', async () => {
    await sendIssueNotification({ ...BASE_PAYLOAD, isUpdate: true, updateCount: 1 });

    const [mail] = mockSendMail.mock.calls[0];
    expect(mail.html).toContain('#e36209');
  });

  it('includes "Update #N" badge text for update notification', async () => {
    await sendIssueNotification({ ...BASE_PAYLOAD, isUpdate: true, updateCount: 2 });

    const [mail] = mockSendMail.mock.calls[0];
    expect(mail.html).toContain('Update #2');
  });

  it('increments update count in subject correctly', async () => {
    await sendIssueNotification({ ...BASE_PAYLOAD, isUpdate: true, updateCount: 5 });

    const [mail] = mockSendMail.mock.calls[0];
    expect(mail.subject).toContain('[Update #5]');
  });

  it('uses "Issue Update" heading for update emails', async () => {
    await sendIssueNotification({ ...BASE_PAYLOAD, isUpdate: true, updateCount: 1 });

    const [mail] = mockSendMail.mock.calls[0];
    expect(mail.html).toContain('Issue Update');
  });

  it('uses "New Matching Issue" heading for initial emails', async () => {
    await sendIssueNotification({ ...BASE_PAYLOAD, isUpdate: false });

    const [mail] = mockSendMail.mock.calls[0];
    expect(mail.html).toContain('New Matching Issue');
  });

  // ─── Error handling ───────────────────────────────────────────────────────

  it('throws when SMTP sendMail rejects', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('SMTP connection refused'));

    await expect(sendIssueNotification({ ...BASE_PAYLOAD })).rejects.toThrow(
      'SMTP connection refused'
    );
  });

  it('calls sendMail exactly once per notification', async () => {
    await sendIssueNotification({ ...BASE_PAYLOAD });
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  // ─── From address ─────────────────────────────────────────────────────────

  it('sends from GitHub Issue Notifier display name', async () => {
    await sendIssueNotification({ ...BASE_PAYLOAD });

    const [mail] = mockSendMail.mock.calls[0];
    expect(mail.from).toContain('GitHub Issue Notifier');
  });
});
