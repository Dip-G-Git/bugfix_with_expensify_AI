import { prisma } from '../../src/db/client.js';

export async function cleanDatabase() {
  await prisma.notificationRecord.deleteMany();
  await prisma.config.deleteMany();
}

export async function seedConfig(overrides: Record<string, unknown> = {}) {
  return prisma.config.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      notificationEmail: 'sandghos1987@gmail.com',
      watchedRepo: 'Expensify/App',
      watchedLabel: 'Help Wanted',
      issueLimit: 4,
      isRunning: false,
      dailySelectedCount: 0,
      dailyResetDate: '',
      pollIntervalSeconds: 60,
      ...overrides,
    },
    update: overrides,
  });
}

let issueCounter = 90000;

export async function seedNotification(overrides: Record<string, unknown> = {}) {
  issueCounter++;
  return prisma.notificationRecord.create({
    data: {
      githubIssueNumber: issueCounter,
      title: `Test Issue #${issueCounter}`,
      url: `https://github.com/Expensify/App/issues/${issueCounter}`,
      repoFullName: 'Expensify/App',
      matchedLabel: 'Help Wanted',
      status: 'PENDING',
      ...overrides,
    },
  });
}
