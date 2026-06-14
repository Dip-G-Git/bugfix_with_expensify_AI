import { logger } from '../utils/logger.js';
import { EventsPollerService } from '../services/events-poller.service.js';
import { NotificationSenderService } from '../services/notification-sender.service.js';

const EMAIL_SENDER_INTERVAL_MS = 20_000;

let emailSenderTimer: ReturnType<typeof setInterval> | null = null;
let pollerTimer: ReturnType<typeof setTimeout> | null = null;

export function startSchedulers(): void {
  startEventsPoller();
  startEmailSender();
  logger.info('Schedulers started (Events poller: dynamic interval, Email sender: 20s)');
}

function startEventsPoller(): void {
  async function runAndReschedule() {
    try {
      const nextIntervalSeconds = await EventsPollerService.poll();
      logger.debug({ nextIntervalSeconds }, 'Events poller cycle complete, rescheduling');
      pollerTimer = setTimeout(runAndReschedule, nextIntervalSeconds * 1000);
    } catch (err) {
      logger.error(err, 'Unhandled error in events poller, retrying in 60s');
      pollerTimer = setTimeout(runAndReschedule, 60_000);
    }
  }

  // First run after a short delay to let the server finish starting
  pollerTimer = setTimeout(runAndReschedule, 2_000);
}

function startEmailSender(): void {
  emailSenderTimer = setInterval(async () => {
    try {
      await NotificationSenderService.send();
    } catch (err) {
      logger.error(err, 'Unhandled error in email sender');
    }
  }, EMAIL_SENDER_INTERVAL_MS);
}

export function stopSchedulers(): void {
  if (pollerTimer) {
    clearTimeout(pollerTimer);
    pollerTimer = null;
  }
  if (emailSenderTimer) {
    clearInterval(emailSenderTimer);
    emailSenderTimer = null;
  }
  logger.info('Schedulers stopped');
}
