import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import nodemailer from "nodemailer";

import { pool } from "./postgres.js";

const OUTBOX_DIR = join(process.cwd(), "data", "email_outbox");
const COMPANY_NAME = "Njinko Development Group LLC";
const DEFAULT_APP_URL = "https://investors.njinkofarm.com/";

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

  return DEFAULT_APP_URL;
}

function buildCredentialBody({ fullName, email, temporaryPassword, role }) {
  return [
    `Hello ${fullName},`,
    "",
    `A new ${COMPANY_NAME} portal account has been created for you.`,
    "",
    `Role: ${role}`,
    `Login URL: ${resolveLoginUrl()}`,
    `Email: ${email}`,
    `Temporary password: ${temporaryPassword}`,
    "",
    "For security, you will be required to change your password the first time you log in.",
    "After that, submit your contact details, ID document, and required legal acknowledgements for manager approval.",
    "",
    `If you were not expecting this message, please contact ${COMPANY_NAME}.`
  ].join("\n");
}

function buildAccountApprovedBody({ fullName }) {
  return [
    `Hello ${fullName},`,
    "",
    `Your ${COMPANY_NAME} portal account has been approved.`,
    "",
    `You can now log in here: ${resolveLoginUrl()}`,
    "",
    `If you have questions, contact ${COMPANY_NAME}.`
  ].join("\n");
}

function buildAccountRejectedBody({ fullName, managerComment }) {
  return [
    `Hello ${fullName},`,
    "",
    `More information is needed before your ${COMPANY_NAME} portal account can be approved.`,
    "",
    `Manager comment: ${managerComment}`,
    "",
    `Log in here to update and resubmit your information: ${resolveLoginUrl()}`,
    "",
    `If you have questions, contact ${COMPANY_NAME}.`
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
    `A new major voting issue has been opened for ${dealName}.`,
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
    `If you have questions, contact ${COMPANY_NAME}.`
  ].join("\n");
}

function buildNewDealAnnouncementBody({
  fullName,
  dealName,
  location,
  currentPhase,
  investmentCloseOn
}) {
  return [
    `Hello ${fullName},`,
    "",
    `A new project, ${dealName}, is now available in the ${COMPANY_NAME} portal.`,
    "",
    `Location: ${location}`,
    `Current phase: ${currentPhase}`,
    `Investment window closes: ${investmentCloseOn || "Not set"}`,
    "",
    "If you have proceeds from a closed project and want to reinvest into this new deal, log in to review the opportunity and update your elections early.",
    "",
    `Portal link: ${resolveLoginUrl()}`,
    "",
    `If you have questions, contact ${COMPANY_NAME}.`
  ].join("\n");
}

function buildProjectAllocationBody({
  fullName,
  dealName,
  participantCategory,
  classType,
  contributionAmount,
  action
}) {
  const actionText = action === "increased" ? "updated" : "added";

  return [
    `Hello ${fullName},`,
    "",
    `You have been ${actionText} on ${dealName} in the ${COMPANY_NAME} portal.`,
    "",
    `Participant type: ${participantCategory}`,
    `Position class: ${classType}`,
    `Recorded amount: $${Number(contributionAmount ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    "",
    "Log in to review your project position and related records.",
    "",
    `Portal link: ${resolveLoginUrl()}`,
    "",
    `If you have questions, contact ${COMPANY_NAME}.`
  ].join("\n");
}

function buildPoolCommitmentBody({
  fullName,
  poolName,
  commitmentAmount,
  totalCommitted,
  poolStatus,
  action
}) {
  const actionText = action === "updated" ? "updated" : "added";

  return [
    `Hello ${fullName},`,
    "",
    `Your pooled capital commitment has been ${actionText} for ${poolName}.`,
    "",
    `Your commitment: $${Number(commitmentAmount ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    `Current pool total: $${Number(totalCommitted ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    `Pool status: ${poolStatus}`,
    "",
    "Log in to review the pooled capital group and vote when voting is open.",
    "",
    `Portal link: ${resolveLoginUrl()}`,
    "",
    `If you have questions, contact ${COMPANY_NAME}.`
  ].join("\n");
}

function buildCapitalDepositSubmittedAlertBody({
  managerName,
  investorName,
  investorEmail,
  amount,
  submittedAt
}) {
  return [
    `Hello ${managerName},`,
    "",
    `${investorName} submitted a new account-funds deposit for manager review.`,
    "",
    `Investor email: ${investorEmail || "Not recorded"}`,
    `Deposit amount: $${Number(amount ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    `Submitted at: ${submittedAt}`,
    "",
    `Review the deposit in the manager portal: ${resolveLoginUrl()}`,
    "",
    `This notice was generated by ${COMPANY_NAME}.`
  ].join("\n");
}

function buildCapitalDepositReviewedBody({
  fullName,
  amount,
  status,
  managerNotes
}) {
  const approved = status === "approved";

  return [
    `Hello ${fullName},`,
    "",
    approved
      ? "Your account-funds deposit has been approved and is now available for future project or pooled-capital allocation."
      : "Your account-funds deposit was not approved.",
    "",
    `Deposit amount: $${Number(amount ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    `Status: ${approved ? "Approved" : "Rejected"}`,
    managerNotes ? `Manager note: ${managerNotes}` : "Manager note: None provided.",
    "",
    `Portal link: ${resolveLoginUrl()}`,
    "",
    `If you have questions, contact ${COMPANY_NAME}.`
  ].join("\n");
}

function buildPoolVoteAlertBody({
  managerName,
  voterName,
  voterEmail,
  poolName,
  dealName,
  voteCount,
  memberCount,
  totalCommitted,
  readyToFund,
  submittedAt
}) {
  return [
    `Hello ${managerName},`,
    "",
    `${voterName} submitted a pooled capital vote for ${poolName}.`,
    "",
    `Voter email: ${voterEmail || "Not recorded"}`,
    `Selected project: ${dealName}`,
    `Votes recorded: ${voteCount} of ${memberCount}`,
    `Total committed capital: $${Number(totalCommitted ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    `Ready to fund: ${readyToFund ? "Yes" : "No"}`,
    `Submitted at: ${submittedAt}`,
    "",
    `Review and fund the pool group in the manager portal: ${resolveLoginUrl()}`,
    "",
    `This notice was generated by ${COMPANY_NAME}.`
  ].join("\n");
}

function buildPasswordResetBody({ fullName, resetUrl, expiresInMinutes }) {
  return [
    `Hello ${fullName},`,
    "",
    `A password reset was requested for your ${COMPANY_NAME} portal account.`,
    "",
    `Reset your password: ${resetUrl}`,
    `This link expires in ${expiresInMinutes} minutes and can only be used once.`,
    "",
    "If you did not request a password reset, you can ignore this message.",
    "",
    `If you need help, contact ${COMPANY_NAME}.`
  ].join("\n");
}

function buildDistributionElectionAlertBody({
  managerName,
  investorName,
  dealName,
  electionMode,
  cashPayoutAmount,
  reinvestAmount,
  rolloverTargetDealName,
  notes,
  submittedAt
}) {
  const modeLabels = {
    payout_all: "Cash out all proceeds",
    reinvest_all: "Reinvest all proceeds",
    split_percentage: "Split by percentage",
    split_amount: "Split by fixed amount"
  };

  return [
    `Hello ${managerName},`,
    "",
    `${investorName} submitted a distribution election for ${dealName}.`,
    "",
    `Instruction: ${modeLabels[electionMode] ?? electionMode}`,
    `Cash payout amount: $${Number(cashPayoutAmount ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    `Reinvested amount: $${Number(reinvestAmount ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    `Rollover target: ${rolloverTargetDealName || "No target selected"}`,
    `Submitted at: ${submittedAt}`,
    "",
    notes ? `Investor notes: ${notes}` : "Investor notes: None provided.",
    "",
    `Review or override the election in the manager portal: ${resolveLoginUrl()}`,
    "",
    `This notice was generated by ${COMPANY_NAME}.`
  ].join("\n");
}

function buildIdentityReviewAlertBody({ managerName, investorName, email, category, submittedAt }) {
  return [
    `Hello ${managerName},`,
    "",
    `${investorName} submitted identity information and legal acknowledgements for manager review.`,
    "",
    `Portal category: ${category}`,
    `Login email: ${email}`,
    `Submitted at: ${submittedAt}`,
    "",
    `Review the account in the manager portal: ${resolveLoginUrl()}`,
    "",
    `This notice was generated by ${COMPANY_NAME}.`
  ].join("\n");
}

function buildDistributionElectionRequestBody({
  fullName,
  dealName,
  dueOn,
  totalPayout,
  defaultTargetDealName
}) {
  return [
    `Hello ${fullName},`,
    "",
    `${dealName} has been marked closed, and your reinvestment or payout election is now required.`,
    "",
    `Total exit proceeds requiring an election: $${Number(totalPayout ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    `Election deadline: ${dueOn || "Not set"}`,
    "",
    "Log in and choose whether to receive a payout, reinvest all proceeds, or split the proceeds.",
    defaultTargetDealName
      ? `If no election is submitted by the deadline, the portal will reinvest all exit proceeds into ${defaultTargetDealName}.`
      : "If no election is submitted by the deadline, the portal will reinvest all exit proceeds into the next active project when one is available.",
    "",
    `Portal link: ${resolveLoginUrl()}`,
    "",
    `This notice was generated by ${COMPANY_NAME}.`
  ].join("\n");
}

function payoutMethodLabel(method) {
  const labels = {
    bank: "Bank account",
    zelle: "Zelle",
    cash_app: "Cash App",
    other: "Other instructions"
  };

  return labels[String(method ?? "").trim()] ?? "Saved payout instructions";
}

function buildDistributionElectionApprovedBody({
  fullName,
  dealName,
  electionMode,
  approvedAt,
  payoutExpectedOn,
  payoutMethod,
  cashPayoutAmount,
  reinvestAmount,
  rolloverTargetDealName,
  managerOverride,
  overrideNotes,
  notes
}) {
  const modeLabels = {
    payout_all: "Cash out all proceeds",
    reinvest_all: "Reinvest all proceeds",
    split_percentage: "Split by percentage",
    split_amount: "Split by fixed amount"
  };

  return [
    `Hello ${fullName},`,
    "",
    `Your reinvestment or payout election for ${dealName} has been approved.`,
    "",
    `Approved at: ${approvedAt}`,
    `Final instruction: ${modeLabels[electionMode] ?? electionMode}`,
    `Approved cash payout: $${Number(cashPayoutAmount ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    `Approved reinvestment: $${Number(reinvestAmount ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    `Reinvestment target: ${rolloverTargetDealName || "No target selected"}`,
    `Payout method: ${payoutMethodLabel(payoutMethod)}`,
    `Expected payout date: ${payoutExpectedOn || "No cash payout scheduled"}`,
    "",
    notes ? `Submitted notes: ${notes}` : "Submitted notes: None provided.",
    managerOverride && overrideNotes
      ? `Manager override notes: ${overrideNotes}`
      : managerOverride
        ? "Manager override notes: The manager approved a revised distribution instruction."
        : "Manager override notes: None.",
    "",
    `Log in to review the approved distribution plan: ${resolveLoginUrl()}`,
    "",
    `This notice was generated by ${COMPANY_NAME}.`
  ].join("\n");
}

function buildEarlyWithdrawalAlertBody({
  managerName,
  investorName,
  dealName,
  requestedCapitalAmount,
  penaltyRate,
  penaltyAmount,
  payoutAmount,
  payoutMethod,
  notes,
  submittedAt
}) {
  return [
    `Hello ${managerName},`,
    "",
    `${investorName} submitted an early withdrawal request for ${dealName}.`,
    "",
    `Requested capital withdrawal: $${Number(requestedCapitalAmount ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    `Penalty rate: ${Math.round(Number(penaltyRate ?? 0) * 1000) / 10}%`,
    `Forfeited capital: $${Number(penaltyAmount ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    `Estimated payout to investor: $${Number(payoutAmount ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    `Saved payout method: ${payoutMethodLabel(payoutMethod)}`,
    `Submitted at: ${submittedAt}`,
    "",
    notes ? `Investor notes: ${notes}` : "Investor notes: None provided.",
    "",
    `Review the request in the manager portal: ${resolveLoginUrl()}`,
    "",
    `This notice was generated by ${COMPANY_NAME}.`
  ].join("\n");
}

function buildEarlyWithdrawalApprovedBody({
  fullName,
  dealName,
  approvedAt,
  requestedCapitalAmount,
  penaltyRate,
  penaltyAmount,
  payoutAmount,
  payoutExpectedOn,
  payoutMethod,
  investorNotes,
  managerNotes
}) {
  return [
    `Hello ${fullName},`,
    "",
    `Your early withdrawal request for ${dealName} has been approved.`,
    "",
    `Approved at: ${approvedAt}`,
    `Original capital withdrawn: $${Number(requestedCapitalAmount ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    `Penalty rate applied: ${Math.round(Number(penaltyRate ?? 0) * 1000) / 10}%`,
    `Forfeited capital: $${Number(penaltyAmount ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    `Scheduled payout: $${Number(payoutAmount ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    `Payout method: ${payoutMethodLabel(payoutMethod)}`,
    `Expected payout date: ${payoutExpectedOn || "Not scheduled"}`,
    "",
    investorNotes ? `Your notes: ${investorNotes}` : "Your notes: None provided.",
    managerNotes ? `Manager notes: ${managerNotes}` : "Manager notes: None.",
    "",
    `Log in to review the request update: ${resolveLoginUrl()}`,
    "",
    `This notice was generated by ${COMPANY_NAME}.`
  ].join("\n");
}

function buildEarlyWithdrawalRejectedBody({
  fullName,
  dealName,
  reviewedAt,
  requestedCapitalAmount,
  penaltyRate,
  payoutAmount,
  investorNotes,
  managerNotes
}) {
  return [
    `Hello ${fullName},`,
    "",
    `Your early withdrawal request for ${dealName} was not approved.`,
    "",
    `Reviewed at: ${reviewedAt}`,
    `Requested capital withdrawal: $${Number(requestedCapitalAmount ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    `Policy penalty rate: ${Math.round(Number(penaltyRate ?? 0) * 1000) / 10}%`,
    `Estimated payout if approved: $${Number(payoutAmount ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    "",
    investorNotes ? `Your notes: ${investorNotes}` : "Your notes: None provided.",
    managerNotes ? `Manager notes: ${managerNotes}` : "Manager notes: No reason was recorded.",
    "",
    `Log in to review the request status or submit an updated request later: ${resolveLoginUrl()}`,
    "",
    `This notice was generated by ${COMPANY_NAME}.`
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
    subject: `${COMPANY_NAME} portal login`,
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

export async function sendAccountApprovedNotification({
  userId,
  participantId,
  fullName,
  email
}) {
  return queueAndDeliverNotification({
    userId,
    participantId,
    recipientEmail: email,
    subject: `${COMPANY_NAME} account approved`,
    bodyText: buildAccountApprovedBody({ fullName }),
    persist: true
  });
}

export async function sendAccountRejectedNotification({
  userId,
  participantId,
  fullName,
  email,
  managerComment
}) {
  return queueAndDeliverNotification({
    userId,
    participantId,
    recipientEmail: email,
    subject: `${COMPANY_NAME} account needs more information`,
    bodyText: buildAccountRejectedBody({ fullName, managerComment }),
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
    subject: `New major vote for ${dealName}`,
    bodyText: buildIssueCreatedBody({
      fullName,
      dealName,
      issueTitle,
      issueDescription,
      approvalThreshold,
      closesOn,
      weightPct
    }),
    persist: true
  });
}

export async function sendPasswordResetNotification({
  userId,
  participantId,
  fullName,
  email,
  resetUrl,
  expiresInMinutes
}) {
  return queueAndDeliverNotification({
    userId,
    participantId,
    recipientEmail: email,
    subject: `${COMPANY_NAME} password reset`,
    bodyText: buildPasswordResetBody({
      fullName,
      resetUrl,
      expiresInMinutes
    }),
    persist: true
  });
}

export async function sendNewDealAnnouncementNotification({
  userId,
  participantId,
  fullName,
  email,
  dealName,
  location,
  currentPhase,
  investmentCloseOn
}) {
  return queueAndDeliverNotification({
    userId,
    participantId,
    recipientEmail: email,
    subject: `New project available: ${dealName}`,
    bodyText: buildNewDealAnnouncementBody({
      fullName,
      dealName,
      location,
      currentPhase,
      investmentCloseOn
    }),
    persist: true
  });
}

export async function sendProjectAllocationNotification({
  userId,
  participantId,
  fullName,
  email,
  dealName,
  participantCategory,
  classType,
  contributionAmount,
  action
}) {
  return queueAndDeliverNotification({
    userId,
    participantId,
    recipientEmail: email,
    subject: `Project allocation recorded: ${dealName}`,
    bodyText: buildProjectAllocationBody({
      fullName,
      dealName,
      participantCategory,
      classType,
      contributionAmount,
      action
    }),
    persist: true
  });
}

export async function sendPoolCommitmentNotification({
  userId,
  participantId,
  fullName,
  email,
  poolName,
  commitmentAmount,
  totalCommitted,
  poolStatus,
  action
}) {
  return queueAndDeliverNotification({
    userId,
    participantId,
    recipientEmail: email,
    subject: `Pooled capital commitment recorded: ${poolName}`,
    bodyText: buildPoolCommitmentBody({
      fullName,
      poolName,
      commitmentAmount,
      totalCommitted,
      poolStatus,
      action
    }),
    persist: true
  });
}

export async function sendCapitalDepositSubmittedAlertNotification({
  userId,
  participantId,
  managerName,
  email,
  investorName,
  investorEmail,
  amount,
  submittedAt
}) {
  return queueAndDeliverNotification({
    userId,
    participantId,
    recipientEmail: email,
    subject: `Account funds deposit submitted: ${investorName}`,
    bodyText: buildCapitalDepositSubmittedAlertBody({
      managerName,
      investorName,
      investorEmail,
      amount,
      submittedAt
    }),
    persist: true
  });
}

export async function sendCapitalDepositReviewedNotification({
  userId,
  participantId,
  fullName,
  email,
  amount,
  status,
  managerNotes
}) {
  return queueAndDeliverNotification({
    userId,
    participantId,
    recipientEmail: email,
    subject:
      status === "approved"
        ? `${COMPANY_NAME} account funds approved`
        : `${COMPANY_NAME} account funds need review`,
    bodyText: buildCapitalDepositReviewedBody({
      fullName,
      amount,
      status,
      managerNotes
    }),
    persist: true
  });
}

export async function sendPoolVoteAlertNotification({
  userId,
  participantId,
  managerName,
  email,
  voterName,
  voterEmail,
  poolName,
  dealName,
  voteCount,
  memberCount,
  totalCommitted,
  readyToFund,
  submittedAt
}) {
  return queueAndDeliverNotification({
    userId,
    participantId,
    recipientEmail: email,
    subject: `Pool vote submitted: ${poolName}`,
    bodyText: buildPoolVoteAlertBody({
      managerName,
      voterName,
      voterEmail,
      poolName,
      dealName,
      voteCount,
      memberCount,
      totalCommitted,
      readyToFund,
      submittedAt
    }),
    persist: true
  });
}

export async function sendDistributionElectionAlertNotification({
  userId,
  participantId,
  managerName,
  email,
  investorName,
  dealName,
  electionMode,
  cashPayoutAmount,
  reinvestAmount,
  rolloverTargetDealName,
  notes,
  submittedAt
}) {
  return queueAndDeliverNotification({
    userId,
    participantId,
    recipientEmail: email,
    subject: `Investor distribution election submitted for ${dealName}`,
    bodyText: buildDistributionElectionAlertBody({
      managerName,
      investorName,
      dealName,
      electionMode,
      cashPayoutAmount,
      reinvestAmount,
      rolloverTargetDealName,
      notes,
      submittedAt
    }),
    persist: true
  });
}

export async function sendIdentityReviewAlertNotification({
  userId,
  participantId,
  managerName,
  email,
  investorName,
  investorEmail,
  category,
  submittedAt
}) {
  return queueAndDeliverNotification({
    userId,
    participantId,
    recipientEmail: email,
    subject: `Account approval requested: ${investorName}`,
    bodyText: buildIdentityReviewAlertBody({
      managerName,
      investorName,
      email: investorEmail,
      category,
      submittedAt
    }),
    persist: true
  });
}

export async function sendDistributionElectionRequestNotification({
  userId,
  participantId,
  fullName,
  email,
  dealName,
  dueOn,
  totalPayout,
  defaultTargetDealName
}) {
  return queueAndDeliverNotification({
    userId,
    participantId,
    recipientEmail: email,
    subject: `Election required for closed project: ${dealName}`,
    bodyText: buildDistributionElectionRequestBody({
      fullName,
      dealName,
      dueOn,
      totalPayout,
      defaultTargetDealName
    }),
    persist: true
  });
}

export async function sendDistributionElectionApprovedNotification({
  userId,
  participantId,
  fullName,
  email,
  dealName,
  electionMode,
  approvedAt,
  payoutExpectedOn,
  payoutMethod,
  cashPayoutAmount,
  reinvestAmount,
  rolloverTargetDealName,
  managerOverride,
  overrideNotes,
  notes
}) {
  return queueAndDeliverNotification({
    userId,
    participantId,
    recipientEmail: email,
    subject: `Distribution election approved for ${dealName}`,
    bodyText: buildDistributionElectionApprovedBody({
      fullName,
      dealName,
      electionMode,
      approvedAt,
      payoutExpectedOn,
      payoutMethod,
      cashPayoutAmount,
      reinvestAmount,
      rolloverTargetDealName,
      managerOverride,
      overrideNotes,
      notes
    }),
    persist: true
  });
}

export async function sendEarlyWithdrawalRequestAlertNotification({
  userId,
  participantId,
  managerName,
  email,
  investorName,
  dealName,
  requestedCapitalAmount,
  penaltyRate,
  penaltyAmount,
  payoutAmount,
  payoutMethod,
  notes,
  submittedAt
}) {
  return queueAndDeliverNotification({
    userId,
    participantId,
    recipientEmail: email,
    subject: `Early withdrawal request submitted for ${dealName}`,
    bodyText: buildEarlyWithdrawalAlertBody({
      managerName,
      investorName,
      dealName,
      requestedCapitalAmount,
      penaltyRate,
      penaltyAmount,
      payoutAmount,
      payoutMethod,
      notes,
      submittedAt
    }),
    persist: true
  });
}

export async function sendEarlyWithdrawalApprovedNotification({
  userId,
  participantId,
  fullName,
  email,
  dealName,
  approvedAt,
  requestedCapitalAmount,
  penaltyRate,
  penaltyAmount,
  payoutAmount,
  payoutExpectedOn,
  payoutMethod,
  investorNotes,
  managerNotes
}) {
  return queueAndDeliverNotification({
    userId,
    participantId,
    recipientEmail: email,
    subject: `Early withdrawal approved for ${dealName}`,
    bodyText: buildEarlyWithdrawalApprovedBody({
      fullName,
      dealName,
      approvedAt,
      requestedCapitalAmount,
      penaltyRate,
      penaltyAmount,
      payoutAmount,
      payoutExpectedOn,
      payoutMethod,
      investorNotes,
      managerNotes
    }),
    persist: true
  });
}

export async function sendEarlyWithdrawalRejectedNotification({
  userId,
  participantId,
  fullName,
  email,
  dealName,
  reviewedAt,
  requestedCapitalAmount,
  penaltyRate,
  payoutAmount,
  investorNotes,
  managerNotes
}) {
  return queueAndDeliverNotification({
    userId,
    participantId,
    recipientEmail: email,
    subject: `Early withdrawal request update for ${dealName}`,
    bodyText: buildEarlyWithdrawalRejectedBody({
      fullName,
      dealName,
      reviewedAt,
      requestedCapitalAmount,
      penaltyRate,
      payoutAmount,
      investorNotes,
      managerNotes
    }),
    persist: true
  });
}
