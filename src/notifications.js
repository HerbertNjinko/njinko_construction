import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import nodemailer from "nodemailer";

import { pool } from "./postgres.js";

const OUTBOX_DIR = join(process.cwd(), "data", "email_outbox");

function nowTimestamp() {
  return new Date().toISOString();
}

function createNotificationId() {
  return `email-${randomUUID()}`;
}

function normalizeConfigValue(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+#.*$/, "")
    .trim();
}

function resolveLoginUrl() {
  const explicit = normalizeConfigValue(process.env.APP_URL);

  if (explicit) {
    return explicit;
  }

  return `http://localhost:${process.env.PORT ?? 3000}`;
}

function buildCredentialBody({ fullName, email, temporaryPassword, role }) {
  return [
    `Hello ${fullName},`,
    "",
    "A new Njinko Construction portal account has been created for you.",
    "",
    `Role: ${role}`,
    `Login URL: ${resolveLoginUrl()}`,
    `Email: ${email}`,
    `Temporary password: ${temporaryPassword}`,
    "",
    "For security, you will be required to change your password the first time you log in.",
    "",
    "If you were not expecting this message, please contact the Njinko team."
  ].join("\n");
}

function buildIssueCreatedBody({
  fullName,
  dealName,
  issueTitle,
  issueDescription,
  approvalThreshold,
  closesOn,
  weightPct
}) {
  return [
    `Hello ${fullName},`,
    "",
    `A new investor voting issue has been opened for ${dealName}.`,
    "",
    `Issue: ${issueTitle}`,
    `Approval required: ${Math.round(approvalThreshold * 100)}%`,
    `Your voting weight: ${Math.round(weightPct * 1000) / 10}%`,
    `Vote closes: ${closesOn || "Open ended"}`,
    "",
    "Issue details:",
    issueDescription,
    "",
    `Log in to review and vote: ${resolveLoginUrl()}`,
    "",
    "If you have questions, contact the Njinko team."
  ].join("\n");
}

function getSmtpConfig() {
  const host = normalizeConfigValue(process.env.SMTP_HOST);
  const user = normalizeConfigValue(process.env.SMTP_USER);
  const pass = normalizeConfigValue(process.env.SMTP_PASS);

  if (!host || !user || !pass) {
    return null;
  }

  const port = Number(normalizeConfigValue(process.env.SMTP_PORT) || 465);
  const secureValue = normalizeConfigValue(process.env.SMTP_SECURE).toLowerCase();
  const secure = secureValue ? secureValue === "true" : port === 465;

  return {
    host,
    port,
    secure,
    auth: {
      user,
      pass
    },
    from:
      normalizeConfigValue(process.env.SMTP_FROM) ||
      normalizeConfigValue(process.env.EMAIL_FROM) ||
      user
  };
}

async function saveLocalOutbox(notificationId, payload, errorMessage = null) {
  await mkdir(OUTBOX_DIR, { recursive: true });

  const fileName = `${notificationId}.json`;
  const absolutePath = join(OUTBOX_DIR, fileName);
  const localPath = `data/email_outbox/${fileName}`;

  await writeFile(
    absolutePath,
    JSON.stringify(
      {
        ...payload,
        createdAt: nowTimestamp(),
        errorMessage
      },
      null,
      2
    )
  );

  return {
    status: "saved_local",
    provider: "local_outbox",
    localPath,
    sentAt: nowTimestamp(),
    errorMessage
  };
}

async function deliverWithResend(payload) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [payload.recipientEmail],
      subject: payload.subject,
      text: payload.bodyText
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Resend request failed with status ${response.status}.`);
  }

  return {
    status: "sent",
    provider: "resend",
    localPath: null,
    sentAt: nowTimestamp(),
    errorMessage: null
  };
}

async function deliverWithSmtp(payload) {
  const smtp = getSmtpConfig();

  if (!smtp) {
    throw new Error("SMTP is not fully configured.");
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    auth: smtp.auth
  });

  await transporter.sendMail({
    from: smtp.from,
    to: payload.recipientEmail,
    subject: payload.subject,
    text: payload.bodyText
  });

  return {
    status: "sent",
    provider: "smtp",
    localPath: null,
    sentAt: nowTimestamp(),
    errorMessage: null
  };
}

async function deliverNotification(notificationId, payload) {
  if (getSmtpConfig()) {
    try {
      return await deliverWithSmtp(payload);
    } catch (error) {
      return saveLocalOutbox(notificationId, payload, `SMTP fallback: ${error.message}`);
    }
  }

  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
    try {
      return await deliverWithResend(payload);
    } catch (error) {
      return saveLocalOutbox(notificationId, payload, `Resend fallback: ${error.message}`);
    }
  }

  return saveLocalOutbox(notificationId, payload);
}

async function queueAndDeliverNotification({
  userId,
  participantId,
  recipientEmail,
  subject,
  bodyText,
  persist = true
}) {
  const notificationId = createNotificationId();
  const payload = {
    recipientEmail,
    subject,
    bodyText
  };
  const createdAt = nowTimestamp();

  if (persist) {
    await pool.query(
      `
        INSERT INTO email_notifications (
          id,
          user_id,
          participant_id,
          recipient_email,
          subject,
          body_text,
          status,
          provider,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        notificationId,
        userId,
        participantId,
        payload.recipientEmail,
        payload.subject,
        payload.bodyText,
        "queued",
        "pending",
        createdAt
      ]
    );
  }

  const delivery = await deliverNotification(notificationId, payload);

  if (persist) {
    await pool.query(
      `
        UPDATE email_notifications
        SET
          status = $1,
          provider = $2,
          local_path = $3,
          error_message = $4,
          sent_at = $5
        WHERE id = $6
      `,
      [
        delivery.status,
        delivery.provider,
        delivery.localPath,
        delivery.errorMessage,
        delivery.sentAt,
        notificationId
      ]
    );
  }

  return {
    id: notificationId,
    ...delivery
  };
}

export async function sendCredentialNotification({
  userId,
  participantId,
  fullName,
  email,
  role,
  temporaryPassword
}) {
  const payload = {
    recipientEmail: email,
    subject: "Your Njinko Construction portal login",
    bodyText: buildCredentialBody({
      fullName,
      email,
      temporaryPassword,
      role
    })
  };
  return queueAndDeliverNotification({
    userId,
    participantId,
    recipientEmail: payload.recipientEmail,
    subject: payload.subject,
    bodyText: payload.bodyText,
    persist: true
  });
}

export async function sendIssueCreatedNotification({
  userId,
  participantId,
  fullName,
  email,
  dealName,
  issueTitle,
  issueDescription,
  approvalThreshold,
  closesOn,
  weightPct
}) {
  return queueAndDeliverNotification({
    userId,
    participantId,
    recipientEmail: email,
    subject: `New investor vote for ${dealName}`,
    bodyText: buildIssueCreatedBody({
      fullName,
      dealName,
      issueTitle,
      issueDescription,
      approvalThreshold,
      closesOn,
      weightPct
    }),
    persist: false
  });
}
