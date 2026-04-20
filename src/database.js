import { createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";

import { calculateWaterfall } from "./calculations.js";
import { seedData } from "./data.js";
import { assertDatabaseReady } from "./migrations.js";
import {
  sendCredentialNotification,
  sendDistributionElectionApprovedNotification,
  sendDistributionElectionAlertNotification,
  sendIssueCreatedNotification,
  sendNewDealAnnouncementNotification,
  sendPasswordResetNotification
} from "./notifications.js";
import { pool, queryAll, queryOne, withTransaction } from "./postgres.js";

const PASSWORD_RESET_TTL_MINUTES = 60;
const RESOURCE_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

function nowTimestamp() {
  return new Date().toISOString();
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

function normalizeOptionalText(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeOptionalDateInput(value, fieldLabel) {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`${fieldLabel} must use the YYYY-MM-DD format.`);
  }

  return normalized;
}

function isInvestmentWindowClosed(investmentCloseOn, asOfDate = todayStamp()) {
  const normalizedCloseDate = normalizeOptionalText(investmentCloseOn);
  return Boolean(normalizedCloseDate && normalizedCloseDate < asOfDate);
}

function normalizeConfigValue(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+#.*$/, "")
    .trim();
}

function roundNumber(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function computeDistributionAmounts(election, totalPayout) {
  const normalizedTotalPayout = roundNumber(Math.max(0, Number(totalPayout ?? 0)));
  let reinvestAmount = 0;

  if (election?.electionMode === "reinvest_all") {
    reinvestAmount = normalizedTotalPayout;
  } else if (election?.electionMode === "split_percentage") {
    reinvestAmount = roundNumber(normalizedTotalPayout * Number(election?.reinvestPercent ?? 0));
  } else if (election?.electionMode === "split_amount") {
    reinvestAmount = roundNumber(Number(election?.reinvestAmount ?? 0));
  }

  reinvestAmount = roundNumber(Math.max(0, Math.min(reinvestAmount, normalizedTotalPayout)));
  const cashPayoutAmount = roundNumber(normalizedTotalPayout - reinvestAmount);

  return {
    totalPayout: normalizedTotalPayout,
    reinvestAmount,
    cashPayoutAmount
  };
}

function createId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

async function getArchiveActorSnapshot(userId, executor = pool) {
  const normalizedUserId = String(userId ?? "").trim();

  if (!normalizedUserId) {
    return null;
  }

  return queryOne(
    `
      SELECT
        users.id AS id,
        users.role AS role,
        users.email AS email,
        participants.name AS name
      FROM users
      LEFT JOIN participants ON participants.id = users.participant_id
      WHERE users.id = $1
    `,
    [normalizedUserId],
    executor
  );
}

function hashResetToken(token) {
  return createHash("sha256").update(String(token ?? "")).digest("hex");
}

function buildPasswordResetUrl(token) {
  const appUrl =
    normalizeConfigValue(process.env.APP_URL) || "https://investors.njinkofarm.com/";
  const separator = appUrl.includes("?") ? "&" : "?";
  return `${appUrl}${separator}resetToken=${encodeURIComponent(token)}`;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");

  return {
    salt,
    hash
  };
}

function splitName(name) {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) {
    return {
      firstName: "",
      middleName: "",
      lastName: ""
    };
  }

  if (parts.length === 1) {
    return {
      firstName: parts[0],
      middleName: "",
      lastName: ""
    };
  }

  return {
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(" "),
    lastName: parts.at(-1)
  };
}

function buildFullName(firstName, middleName, lastName, fallbackName = "") {
  const parts = [firstName, middleName, lastName]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  return parts.join(" ") || String(fallbackName ?? "").trim();
}

function normalizeIdCardFile(file) {
  if (!file || typeof file !== "object") {
    return null;
  }

  const fileName = normalizeOptionalText(file.name);
  const mimeType = normalizeOptionalText(file.type);
  const dataUrl = normalizeOptionalText(file.dataUrl);
  const size = Number(file.size ?? 0);

  if (!fileName || !mimeType || !dataUrl) {
    throw new Error("ID card uploads must include a file name, mime type, and file data.");
  }

  if (!dataUrl.startsWith("data:")) {
    throw new Error("ID card uploads must be sent as a data URL.");
  }

  if (!Number.isFinite(size) || size <= 0 || size > 3_000_000) {
    throw new Error("ID card uploads must be smaller than 3 MB.");
  }

  return {
    fileName,
    mimeType,
    dataUrl
  };
}

function normalizeResourceFile(file) {
  if (!file || typeof file !== "object") {
    return null;
  }

  const fileName = normalizeOptionalText(file.name);
  const mimeType = normalizeOptionalText(file.type);
  const dataUrl = normalizeOptionalText(file.dataUrl);
  const size = Number(file.size ?? 0);

  if (!fileName || !mimeType || !dataUrl) {
    throw new Error("Uploads must include a file name, mime type, and file data.");
  }

  if (!dataUrl.startsWith("data:")) {
    throw new Error("Uploads must be sent as a data URL.");
  }

  if (!Number.isFinite(size) || size <= 0 || size > RESOURCE_UPLOAD_MAX_BYTES) {
    throw new Error("Uploads must be smaller than 100 MB.");
  }

  return {
    fileName,
    mimeType,
    dataUrl
  };
}

function normalizeCategory(category) {
  return String(category ?? "").trim();
}

function normalizePersonInput(input) {
  const firstName = String(input.firstName ?? "").trim();
  const middleName = String(input.middleName ?? "").trim();
  const lastName = String(input.lastName ?? "").trim();
  const email = normalizeEmail(input.email ?? "");
  const password = String(input.password ?? "");
  const contactPhone = normalizeOptionalText(input.contactPhone ?? input.contact);
  const currentAddress = normalizeOptionalText(input.currentAddress);
  const mailingAddress = normalizeOptionalText(input.mailingAddress);
  const driverLicenseNumber = normalizeOptionalText(input.driverLicenseNumber);
  const payoutMethod = normalizeOptionalText(input.payoutMethod);
  const bankAccountName = normalizeOptionalText(input.bankAccountName);
  const bankName = normalizeOptionalText(input.bankName);
  const bankRoutingNumber = normalizeOptionalText(input.bankRoutingNumber);
  const bankAccountNumber = normalizeOptionalText(input.bankAccountNumber);
  const zelleDetails = normalizeOptionalText(input.zelleDetails);
  const cashAppHandle = normalizeOptionalText(input.cashAppHandle);
  const payoutNotes = normalizeOptionalText(input.payoutNotes);
  const idCardFile = normalizeIdCardFile(input.idCardFile);

  return {
    firstName,
    middleName,
    lastName,
    fullName: buildFullName(firstName, middleName, lastName),
    email,
    password,
    contactPhone,
    currentAddress,
    mailingAddress,
    driverLicenseNumber,
    payoutMethod,
    bankAccountName,
    bankName,
    bankRoutingNumber,
    bankAccountNumber,
    zelleDetails,
    cashAppHandle,
    payoutNotes,
    idCardFile
  };
}

function validateUserProfileForCreation(profile, category) {
  if (!["investor", "contractor", "manager"].includes(category)) {
    throw new Error("User category must be investor, contractor, or manager.");
  }

  if (profile.firstName.length < 2) {
    throw new Error("First name must be at least 2 characters.");
  }

  if (profile.lastName.length < 2) {
    throw new Error("Last name must be at least 2 characters.");
  }

  if (!profile.email.includes("@")) {
    throw new Error("A valid email is required.");
  }

  if (profile.password.length < 8) {
    throw new Error("Temporary password must be at least 8 characters.");
  }
}

function mapParticipantRow(row) {
  const fallback = splitName(row.name);

  return {
    id: row.id,
    name: row.name,
    category: row.category,
    firstName: row.firstName ?? fallback.firstName,
    middleName: row.middleName ?? fallback.middleName,
    lastName: row.lastName ?? fallback.lastName,
    driverLicenseNumber: row.driverLicenseNumber ?? "",
    idCardFileName: row.idCardFileName ?? "",
    hasIdCard: Boolean(row.hasIdCard ?? row.idCardFileName),
    currentAddress: row.currentAddress ?? "",
    mailingAddress: row.mailingAddress ?? "",
    contactPhone: row.contactPhone ?? "",
    payoutMethod: row.payoutMethod ?? "",
    bankAccountName: row.bankAccountName ?? "",
    bankName: row.bankName ?? "",
    bankRoutingNumber: row.bankRoutingNumber ?? "",
    bankAccountNumber: row.bankAccountNumber ?? "",
    zelleDetails: row.zelleDetails ?? "",
    cashAppHandle: row.cashAppHandle ?? "",
    payoutNotes: row.payoutNotes ?? ""
  };
}

function mapUserRow(row) {
  if (!row) {
    return null;
  }

  const fallback = splitName(row.name);

  return {
    id: row.id,
    participantId: row.participantId,
    role: row.role,
    name: row.name,
    email: row.email,
    category: row.category,
    firstName: row.firstName ?? fallback.firstName,
    middleName: row.middleName ?? fallback.middleName,
    lastName: row.lastName ?? fallback.lastName,
    currentAddress: row.currentAddress ?? "",
    mailingAddress: row.mailingAddress ?? "",
    contactPhone: row.contactPhone ?? "",
    driverLicenseNumber: row.driverLicenseNumber ?? "",
    idCardFileName: row.idCardFileName ?? "",
    passwordSalt: row.passwordSalt,
    passwordHash: row.passwordHash,
    isActive: Boolean(row.isActive),
    mustChangePassword: Boolean(row.mustChangePassword),
    lastLoginAt: row.lastLoginAt ?? null,
    notificationStatus: row.notificationStatus ?? null,
    notificationProvider: row.notificationProvider ?? null,
    notificationLocalPath: row.notificationLocalPath ?? null
  };
}

async function syncDealEquity(dealId, executor = pool) {
  const result = await queryOne(
    `
      SELECT COALESCE(SUM(contribution_amount), 0)::float AS "totalEquity"
      FROM positions
      WHERE deal_id = $1
    `,
    [dealId],
    executor
  );

  await executor.query(
    `
      UPDATE deals
      SET total_equity = $1, updated_at = $2
      WHERE id = $3
    `,
    [roundNumber(result?.totalEquity ?? 0), nowTimestamp(), dealId]
  );
}

async function insertSeedData(executor) {
  const timestamp = nowTimestamp();

  for (const participant of seedData.participants) {
    await executor.query(
      `
        INSERT INTO participants (id, name, category, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [participant.id, participant.name, participant.category, timestamp, timestamp]
    );
  }

  for (const user of seedData.users) {
    await executor.query(
      `
        INSERT INTO users (
          id,
          participant_id,
          role,
          email,
          password_salt,
          password_hash,
          is_active,
          must_change_password,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        user.id,
        user.participantId,
        user.role,
        normalizeEmail(user.email),
        user.passwordSalt,
        user.passwordHash,
        1,
        0,
        timestamp,
        timestamp
      ]
    );
  }

  for (const deal of seedData.deals) {
    await executor.query(
      `
        INSERT INTO deals (
          id,
          name,
          location,
          total_equity,
          debt,
          tax_expense,
          debt_interest_rate,
          total_interest_paid,
          total_project_cost,
          sale_price,
          hold_months,
          pref_rate,
          status,
          current_phase,
          funded_on,
          investment_close_on,
          projected_exit_on,
          actual_exit_on,
          timeline_progress,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          $16,
          $17,
          $18,
          $19,
          $20,
          $21
        )
      `,
      [
        deal.id,
        deal.name,
        deal.location,
        deal.totalEquity,
        deal.debt,
        deal.taxExpense ?? 0,
        deal.debtInterestRate ?? 0,
        deal.totalInterestPaid ?? 0,
        deal.totalProjectCost,
        deal.salePrice,
        deal.holdMonths,
        deal.prefRate,
        deal.status,
        deal.currentPhase,
        deal.fundedOn,
        deal.investmentCloseOn ?? null,
        deal.projectedExitOn ?? null,
        deal.actualExitOn ?? null,
        deal.timelineProgress,
        timestamp,
        timestamp
      ]
    );

    for (const [index, tier] of deal.promoteTiers.entries()) {
      await executor.query(
        `
        INSERT INTO promote_tiers (
          id,
          deal_id,
          label,
          hurdle,
          investor_share,
          sponsor_share,
          is_enabled,
          sort_order,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        createId("tier"),
        deal.id,
        tier.label,
        tier.hurdle,
        tier.investorShare,
        tier.sponsorShare,
        tier.isEnabled === false ? 0 : 1,
        index + 1,
        timestamp,
        timestamp
      ]
      );
    }

    for (const [index, milestone] of deal.timeline.entries()) {
      await executor.query(
        `
          INSERT INTO deal_timeline_items (
            id,
            deal_id,
            label,
            milestone_date,
            status,
            sort_order,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          createId("timeline"),
          deal.id,
          milestone.label,
          milestone.date,
          milestone.status,
          index + 1,
          timestamp,
          timestamp
        ]
      );
    }
  }

  for (const position of seedData.positions) {
    await executor.query(
      `
        INSERT INTO positions (
          id,
          deal_id,
          participant_id,
          class_type,
          contribution_type,
          contribution_amount,
          distributions_to_date,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        position.id,
        position.dealId,
        position.participantId,
        position.classType,
        position.contributionType,
        position.contributionAmount,
        position.distributionsToDate ?? 0,
        timestamp,
        timestamp
      ]
    );
  }

  for (const contractor of seedData.contractors) {
    await executor.query(
      `
        INSERT INTO contractor_participation (
          id,
          deal_id,
          participant_id,
          trade,
          total_contract_value,
          cash_paid,
          deferred_amount,
          contribution_type,
          hybrid,
          status,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
      [
        contractor.id,
        contractor.dealId,
        contractor.participantId,
        contractor.trade,
        contractor.totalContractValue,
        contractor.cashPaid,
        contractor.deferredAmount,
        contractor.contributionType,
        contractor.hybrid ? 1 : 0,
        contractor.status,
        timestamp,
        timestamp
      ]
    );
  }

  for (const resource of seedData.companyResources ?? []) {
    await executor.query(
      `
        INSERT INTO company_resources (
          id,
          title,
          deal_id,
          resource_type,
          summary_text,
          body_text,
          file_name,
          file_mime_type,
          file_data_url,
          published_at,
          created_by_user_id,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
      [
        resource.id,
        resource.title,
        resource.dealId ?? null,
        resource.resourceType,
        resource.summary ?? null,
        resource.bodyText ?? null,
        resource.fileName || null,
        resource.fileMimeType || null,
        resource.fileDataUrl || null,
        resource.publishedAt ?? timestamp,
        seedData.users.find((user) => user.role === "manager")?.id ?? null,
        timestamp,
        timestamp
      ]
    );
  }

  for (const election of seedData.distributionElections ?? []) {
    await executor.query(
      `
        INSERT INTO distribution_elections (
          id,
          deal_id,
          participant_id,
          election_mode,
          reinvest_percent,
          reinvest_amount,
          rollover_target_deal_id,
          notes,
          submitted_by_user_id,
          submitted_by_role,
          approval_status,
          approved_reinvest_amount,
          approved_cash_payout_amount,
          payout_expected_on,
          reviewed_by_user_id,
          reviewed_at,
          manager_override,
          override_notes,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      `,
      [
        election.id,
        election.dealId,
        election.participantId,
        election.electionMode,
        election.reinvestPercent,
        election.reinvestAmount,
        election.rolloverTargetDealId ?? null,
        election.notes ?? null,
        election.submittedByUserId ?? null,
        election.submittedByRole ?? null,
        election.approvalStatus ?? (election.reviewedAt ? "approved" : "pending"),
        election.approvedReinvestAmount ?? null,
        election.approvedCashPayoutAmount ?? null,
        election.payoutExpectedOn ?? null,
        election.reviewedByUserId ?? null,
        election.reviewedAt ?? null,
        election.managerOverride ? 1 : 0,
        election.overrideNotes ?? null,
        timestamp,
        timestamp
      ]
    );
  }

  for (const deal of seedData.deals) {
    await syncDealEquity(deal.id, executor);
  }
}

export async function seedDatabase({ force = false } = {}) {
  await assertDatabaseReady();

  const counts = await queryOne(`
    SELECT
      (SELECT COUNT(*)::int FROM participants) AS participants,
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM deals) AS deals
  `);
  const hasExistingData =
    (counts?.participants ?? 0) > 0 || (counts?.users ?? 0) > 0 || (counts?.deals ?? 0) > 0;

  if (hasExistingData && !force) {
    throw new Error(
      "Database already contains data. Run `npm run seed -- --force` if you want to replace it."
    );
  }

  await withTransaction(async (client) => {
    if (force) {
      await client.query(`
        TRUNCATE TABLE
          deal_issue_votes,
          deal_issues,
          email_notifications,
          company_resources,
          contractor_participation,
          distribution_elections,
          positions,
          deal_timeline_items,
          promote_tiers,
          users,
          deals,
          participants
      `);
    }

    await insertSeedData(client);
  });

  return {
    participants: seedData.participants.length,
    users: seedData.users.length,
    deals: seedData.deals.length,
    positions: seedData.positions.length
  };
}

const USER_SELECT_FRAGMENT = `
  SELECT
    users.id AS id,
    users.participant_id AS "participantId",
    users.role AS role,
    participants.name AS name,
    participants.category AS category,
    participants.first_name AS "firstName",
    participants.middle_name AS "middleName",
    participants.last_name AS "lastName",
    participants.driver_license_number AS "driverLicenseNumber",
    participants.id_card_file_name AS "idCardFileName",
    participants.current_address AS "currentAddress",
    participants.mailing_address AS "mailingAddress",
    participants.contact_phone AS "contactPhone",
    users.email AS email,
    users.password_salt AS "passwordSalt",
    users.password_hash AS "passwordHash",
    users.is_active AS "isActive",
    users.must_change_password AS "mustChangePassword",
    users.last_login_at AS "lastLoginAt",
    notification.status AS "notificationStatus",
    notification.provider AS "notificationProvider",
    notification.local_path AS "notificationLocalPath"
  FROM users
  JOIN participants ON participants.id = users.participant_id
  LEFT JOIN LATERAL (
    SELECT status, provider, local_path
    FROM email_notifications
    WHERE user_id = users.id
    ORDER BY created_at DESC
    LIMIT 1
  ) notification ON TRUE
`;

async function getUserAccountById(userId, { includeInactive = false } = {}) {
  const row = await queryOne(
    `
      ${USER_SELECT_FRAGMENT}
      WHERE users.id = $1
      ${includeInactive ? "" : "AND users.is_active = 1"}
    `,
    [userId]
  );

  return mapUserRow(row);
}

async function countActiveManagers(executor = pool) {
  const row = await queryOne(
    `
      SELECT COUNT(*)::int AS count
      FROM users
      WHERE role = 'manager'
        AND is_active = 1
    `,
    [],
    executor
  );

  return Number(row?.count ?? 0);
}

async function getActiveManagerRecipients({ excludeUserId = null } = {}) {
  return queryAll(
    `
      SELECT
        users.id AS "userId",
        users.participant_id AS "participantId",
        users.email AS email,
        participants.name AS "fullName"
      FROM users
      JOIN participants ON participants.id = users.participant_id
      WHERE users.role = 'manager'
        AND users.is_active = 1
        AND ($1::text IS NULL OR users.id <> $1)
      ORDER BY participants.name
    `,
    [excludeUserId]
  );
}

export async function getUserByEmail(email) {
  const row = await queryOne(
    `
      ${USER_SELECT_FRAGMENT}
      WHERE LOWER(users.email) = $1
        AND users.is_active = 1
    `,
    [normalizeEmail(email)]
  );

  return mapUserRow(row);
}

export async function getUserById(userId) {
  return getUserAccountById(userId, { includeInactive: false });
}

export async function getAppDataSnapshot() {
  const participants = (await queryAll(
    `
      SELECT
        id,
        name,
        category,
        first_name AS "firstName",
        middle_name AS "middleName",
        last_name AS "lastName",
        driver_license_number AS "driverLicenseNumber",
        id_card_file_name AS "idCardFileName",
        current_address AS "currentAddress",
        mailing_address AS "mailingAddress",
        contact_phone AS "contactPhone",
        payout_method AS "payoutMethod",
        bank_account_name AS "bankAccountName",
        bank_name AS "bankName",
        bank_routing_number AS "bankRoutingNumber",
        bank_account_number AS "bankAccountNumber",
        zelle_details AS "zelleDetails",
        cash_app_handle AS "cashAppHandle",
        payout_notes AS "payoutNotes",
        (id_card_file_name IS NOT NULL) AS "hasIdCard"
      FROM participants
      ORDER BY name
    `
  )).map((row) => mapParticipantRow(row));

  const users = (await queryAll(
    `
      ${USER_SELECT_FRAGMENT}
      ORDER BY participants.name
    `
  )).map((row) => mapUserRow(row));

  const deals = (await queryAll(
    `
      SELECT
        id,
        name,
        location,
        total_equity AS "totalEquity",
        debt,
        tax_expense AS "taxExpense",
        debt_interest_rate AS "debtInterestRate",
        total_interest_paid AS "totalInterestPaid",
        total_project_cost AS "totalProjectCost",
        sale_price AS "salePrice",
        hold_months AS "holdMonths",
        pref_rate AS "prefRate",
        status,
        current_phase AS "currentPhase",
        funded_on AS "fundedOn",
        investment_close_on AS "investmentCloseOn",
        projected_exit_on AS "projectedExitOn",
        actual_exit_on AS "actualExitOn",
        timeline_progress AS "timelineProgress"
      FROM deals
      ORDER BY name
    `
  )).map((row) => ({
    ...row,
    totalEquity: Number(row.totalEquity),
    debt: Number(row.debt),
    taxExpense: Number(row.taxExpense),
    debtInterestRate: Number(row.debtInterestRate),
    totalInterestPaid: Number(row.totalInterestPaid),
    totalProjectCost: Number(row.totalProjectCost),
    salePrice: Number(row.salePrice),
    holdMonths: Number(row.holdMonths),
    prefRate: Number(row.prefRate),
    timelineProgress: Number(row.timelineProgress),
    promoteTiers: [],
    timeline: []
  }));

  const dealMap = new Map(deals.map((deal) => [deal.id, deal]));

  for (const row of await queryAll(
    `
      SELECT
        deal_id AS "dealId",
        label,
        hurdle,
        investor_share AS "investorShare",
        sponsor_share AS "sponsorShare",
        is_enabled AS "isEnabled",
        sort_order AS "sortOrder"
      FROM promote_tiers
      ORDER BY deal_id, sort_order
    `
  )) {
    dealMap.get(row.dealId)?.promoteTiers.push({
      label: row.label,
      hurdle: Number(row.hurdle),
      investorShare: Number(row.investorShare),
      sponsorShare: Number(row.sponsorShare),
      isEnabled: Boolean(row.isEnabled),
      description: `${row.label} promote hurdle`,
      sortOrder: Number(row.sortOrder)
    });
  }

  for (const row of await queryAll(
    `
      SELECT
        deal_id AS "dealId",
        label,
        milestone_date AS date,
        status,
        sort_order AS "sortOrder"
      FROM deal_timeline_items
      ORDER BY deal_id, sort_order
    `
  )) {
    dealMap.get(row.dealId)?.timeline.push({
      label: row.label,
      date: row.date,
      status: row.status,
      sortOrder: Number(row.sortOrder)
    });
  }

  const positions = (await queryAll(
    `
      SELECT
        id,
        deal_id AS "dealId",
        participant_id AS "participantId",
        class_type AS "classType",
        contribution_type AS "contributionType",
        contribution_amount AS "contributionAmount",
        distributions_to_date AS "distributionsToDate"
      FROM positions
      ORDER BY deal_id, participant_id
    `
  )).map((row) => ({
    ...row,
    contributionAmount: Number(row.contributionAmount),
    distributionsToDate: Number(row.distributionsToDate)
  }));

  const contractors = (await queryAll(
    `
      SELECT
        contractor_participation.id AS id,
        contractor_participation.deal_id AS "dealId",
        contractor_participation.participant_id AS "participantId",
        participants.name AS "contractorName",
        contractor_participation.trade AS trade,
        contractor_participation.total_contract_value AS "totalContractValue",
        contractor_participation.cash_paid AS "cashPaid",
        contractor_participation.deferred_amount AS "deferredAmount",
        contractor_participation.contribution_type AS "contributionType",
        contractor_participation.hybrid AS hybrid,
        contractor_participation.status AS status
      FROM contractor_participation
      JOIN participants ON participants.id = contractor_participation.participant_id
      ORDER BY contractor_participation.deal_id, participants.name
    `
  )).map((row) => ({
    ...row,
    totalContractValue: Number(row.totalContractValue),
    cashPaid: Number(row.cashPaid),
    deferredAmount: Number(row.deferredAmount),
    hybrid: Boolean(row.hybrid)
  }));

  const distributionElections = (await queryAll(
    `
      SELECT
        id,
        deal_id AS "dealId",
        participant_id AS "participantId",
        election_mode AS "electionMode",
        reinvest_percent AS "reinvestPercent",
        reinvest_amount AS "reinvestAmount",
        rollover_target_deal_id AS "rolloverTargetDealId",
        notes,
        submitted_by_user_id AS "submittedByUserId",
        submitted_by_role AS "submittedByRole",
        approval_status AS "approvalStatus",
        approved_reinvest_amount AS "approvedReinvestAmount",
        approved_cash_payout_amount AS "approvedCashPayoutAmount",
        payout_expected_on AS "payoutExpectedOn",
        reviewed_by_user_id AS "reviewedByUserId",
        reviewed_at AS "reviewedAt",
        manager_override AS "managerOverride",
        override_notes AS "overrideNotes",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM distribution_elections
      ORDER BY updated_at DESC, id
    `
  )).map((row) => ({
    ...row,
    reinvestPercent:
      row.reinvestPercent === null || row.reinvestPercent === undefined
        ? null
        : Number(row.reinvestPercent),
    reinvestAmount:
      row.reinvestAmount === null || row.reinvestAmount === undefined
        ? null
        : Number(row.reinvestAmount),
    approvedReinvestAmount:
      row.approvedReinvestAmount === null || row.approvedReinvestAmount === undefined
        ? null
        : Number(row.approvedReinvestAmount),
    approvedCashPayoutAmount:
      row.approvedCashPayoutAmount === null || row.approvedCashPayoutAmount === undefined
        ? null
        : Number(row.approvedCashPayoutAmount),
    managerOverride: Boolean(row.managerOverride)
  }));

  const companyResources = (await queryAll(
    `
      SELECT
        company_resources.id AS id,
        company_resources.title AS title,
        company_resources.deal_id AS "dealId",
        deals.name AS "dealName",
        company_resources.resource_type AS "resourceType",
        company_resources.summary_text AS "summaryText",
        company_resources.body_text AS "bodyText",
        company_resources.file_name AS "fileName",
        company_resources.file_mime_type AS "fileMimeType",
        (company_resources.file_name IS NOT NULL AND company_resources.file_data_url IS NOT NULL) AS "hasFile",
        company_resources.published_at AS "publishedAt",
        company_resources.created_at AS "createdAt",
        company_resources.updated_at AS "updatedAt"
      FROM company_resources
      LEFT JOIN deals ON deals.id = company_resources.deal_id
      ORDER BY company_resources.published_at DESC, company_resources.created_at DESC, company_resources.id DESC
    `
  )).map((row) => ({
    ...row,
    hasFile: Boolean(row.hasFile)
  }));

  const dealIssues = (await queryAll(
    `
      SELECT
        id,
        deal_id AS "dealId",
        title,
        description,
        approval_threshold AS "approvalThreshold",
        closes_on AS "closesOn",
        created_by_user_id AS "createdByUserId",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM deal_issues
      ORDER BY created_at DESC, id
    `
  )).map((row) => ({
    ...row,
    approvalThreshold: Number(row.approvalThreshold)
  }));

  const issueVotes = await queryAll(
    `
      SELECT
        id,
        issue_id AS "issueId",
        participant_id AS "participantId",
        vote_choice AS "voteChoice",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM deal_issue_votes
      ORDER BY updated_at DESC, id
    `
  );

  return {
    asOfDate: todayStamp(),
    participants,
    users,
    deals,
    positions,
    contractors,
    distributionElections,
    companyResources,
    dealIssues,
    issueVotes
  };
}

async function createUserRecord(
  input,
  { mustChangePassword = true, sendNotification = true } = {}
) {
  const normalizedCategory = normalizeCategory(input.category);
  const profile = normalizePersonInput(input);
  validateUserProfileForCreation(profile, normalizedCategory);

  const existingUser = await queryOne(
    `
      SELECT id
      FROM users
      WHERE LOWER(email) = $1
    `,
    [profile.email]
  );

  if (existingUser) {
    throw new Error("A user with that email already exists.");
  }

  const passwordRecord = hashPassword(profile.password);
  const timestamp = nowTimestamp();
  const participantId = createId("participant");
  const userId = createId("user");
  const role = normalizedCategory === "manager" ? "manager" : "investor";

  await withTransaction(async (client) => {
    await client.query(
      `
        INSERT INTO participants (
          id,
          name,
          category,
          first_name,
          middle_name,
          last_name,
          driver_license_number,
          id_card_file_name,
          id_card_mime_type,
          id_card_data_url,
          current_address,
          mailing_address,
          contact_phone,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `,
      [
        participantId,
        profile.fullName,
        normalizedCategory,
        profile.firstName,
        profile.middleName || null,
        profile.lastName,
        profile.driverLicenseNumber,
        profile.idCardFile?.fileName ?? null,
        profile.idCardFile?.mimeType ?? null,
        profile.idCardFile?.dataUrl ?? null,
        profile.currentAddress,
        profile.mailingAddress,
        profile.contactPhone,
        timestamp,
        timestamp
      ]
    );

    await client.query(
      `
        INSERT INTO users (
          id,
          participant_id,
          role,
          email,
          password_salt,
          password_hash,
          is_active,
          must_change_password,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        userId,
        participantId,
        role,
        profile.email,
        passwordRecord.salt,
        passwordRecord.hash,
        1,
        mustChangePassword ? 1 : 0,
        timestamp,
        timestamp
      ]
    );
  });

  const user = await getUserById(userId);
  let notification;

  if (sendNotification) {
    try {
      notification = await sendCredentialNotification({
        userId,
        participantId,
        fullName: profile.fullName,
        email: profile.email,
        role,
        temporaryPassword: profile.password
      });
    } catch (error) {
      notification = {
        status: "failed",
        provider: "notification_error",
        localPath: null,
        errorMessage: error.message
      };
    }
  } else {
    notification = null;
  }

  return {
    user,
    notification
  };
}

export async function createManagedUser(input) {
  return createUserRecord(input, {
    mustChangePassword: true,
    sendNotification: true
  });
}

export async function ensureInitialManagerUser() {
  await assertDatabaseReady();

  const existingManager = await queryOne(
    `
      SELECT id
      FROM users
      WHERE role = 'manager'
        AND is_active = 1
      LIMIT 1
    `
  );

  if (existingManager) {
    return {
      created: false,
      user: await getUserById(existingManager.id),
      notification: null
    };
  }

  const email = normalizeConfigValue(process.env.DEFAULT_MANAGER_EMAIL);
  const password = normalizeConfigValue(process.env.DEFAULT_MANAGER_PASSWORD);
  const firstName = normalizeConfigValue(process.env.DEFAULT_MANAGER_FIRST_NAME);
  const lastName = normalizeConfigValue(process.env.DEFAULT_MANAGER_LAST_NAME);
  const middleName = normalizeConfigValue(process.env.DEFAULT_MANAGER_MIDDLE_NAME);
  const contactPhone = normalizeConfigValue(process.env.DEFAULT_MANAGER_PHONE);
  const address = normalizeConfigValue(process.env.DEFAULT_MANAGER_ADDRESS);
  const missing = [];

  if (!email) {
    missing.push("DEFAULT_MANAGER_EMAIL");
  }

  if (!password) {
    missing.push("DEFAULT_MANAGER_PASSWORD");
  }

  if (!firstName) {
    missing.push("DEFAULT_MANAGER_FIRST_NAME");
  }

  if (!lastName) {
    missing.push("DEFAULT_MANAGER_LAST_NAME");
  }

  if (missing.length) {
    throw new Error(
      `No active manager account exists. Set ${missing.join(", ")} in .env so the initial manager can be created.`
    );
  }

  const createdUser = await createUserRecord(
    {
      category: "manager",
      firstName,
      middleName,
      lastName,
      email,
      password,
      contactPhone,
      currentAddress: address,
      mailingAddress: address
    },
    {
      mustChangePassword: false,
      sendNotification: true
    }
  );

  return {
    created: true,
    ...createdUser
  };
}

export async function markUserLogin(userId) {
  await pool.query(
    `
      UPDATE users
      SET last_login_at = $1
      WHERE id = $2
    `,
    [nowTimestamp(), userId]
  );
}

export async function updateOwnProfile(userId, input) {
  const currentUser = await getUserById(userId);

  if (!currentUser) {
    throw new Error("User not found.");
  }

  const profile = normalizePersonInput(input);
  const isManager = currentUser.role === "manager";
  const payoutMethod = isManager ? null : profile.payoutMethod;

  if (profile.firstName.length < 2) {
    throw new Error("First name must be at least 2 characters.");
  }

  if (profile.lastName.length < 2) {
    throw new Error("Last name must be at least 2 characters.");
  }

  if (!profile.email.includes("@")) {
    throw new Error("A valid email is required.");
  }

  if (payoutMethod && !["bank", "zelle", "cash_app", "other"].includes(payoutMethod)) {
    throw new Error("Preferred payout method is invalid.");
  }

  const existingUser = await queryOne(
    `
      SELECT id
      FROM users
      WHERE LOWER(email) = $1
        AND id <> $2
    `,
    [profile.email, userId]
  );

  if (existingUser) {
    throw new Error("That email address is already in use.");
  }

  const timestamp = nowTimestamp();

  await withTransaction(async (client) => {
    await client.query(
      `
        UPDATE participants
        SET
          name = $1,
          first_name = $2,
          middle_name = $3,
          last_name = $4,
          current_address = $5,
          mailing_address = $6,
          contact_phone = $7,
          payout_method = $8,
          bank_account_name = $9,
          bank_name = $10,
          bank_routing_number = $11,
          bank_account_number = $12,
          zelle_details = $13,
          cash_app_handle = $14,
          payout_notes = $15,
          updated_at = $16
        WHERE id = $17
      `,
      [
        profile.fullName,
        profile.firstName,
        profile.middleName || null,
        profile.lastName,
        profile.currentAddress,
        profile.mailingAddress,
        profile.contactPhone,
        payoutMethod,
        isManager ? null : profile.bankAccountName,
        isManager ? null : profile.bankName,
        isManager ? null : profile.bankRoutingNumber,
        isManager ? null : profile.bankAccountNumber,
        isManager ? null : profile.zelleDetails,
        isManager ? null : profile.cashAppHandle,
        isManager ? null : profile.payoutNotes,
        timestamp,
        currentUser.participantId
      ]
    );

    await client.query(
      `
        UPDATE users
        SET email = $1, updated_at = $2
        WHERE id = $3
      `,
      [profile.email, timestamp, userId]
    );
  });

  return getUserById(userId);
}

export async function updateUserPassword(userId, newPassword) {
  const normalizedPassword = String(newPassword ?? "");

  if (normalizedPassword.length < 8) {
    throw new Error("New password must be at least 8 characters.");
  }

  const passwordRecord = hashPassword(normalizedPassword);

  await pool.query(
    `
      UPDATE users
      SET
        password_salt = $1,
        password_hash = $2,
        must_change_password = 0,
        updated_at = $3
      WHERE id = $4
    `,
    [passwordRecord.salt, passwordRecord.hash, nowTimestamp(), userId]
  );

  return getUserById(userId);
}

export async function requestPasswordReset(email) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail.includes("@")) {
    throw new Error("A valid email is required.");
  }

  const user = await getUserByEmail(normalizedEmail);

  if (!user) {
    return {
      requested: true,
      notification: null
    };
  }

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashResetToken(rawToken);
  const tokenId = createId("reset");
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);

  await withTransaction(async (client) => {
    await client.query(
      `
        UPDATE password_reset_tokens
        SET used_at = $1
        WHERE user_id = $2
          AND used_at IS NULL
      `,
      [createdAt.toISOString(), user.id]
    );

    await client.query(
      `
        INSERT INTO password_reset_tokens (
          id,
          user_id,
          token_hash,
          expires_at,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [tokenId, user.id, tokenHash, expiresAt.toISOString(), createdAt.toISOString()]
    );
  });

  const notification = await sendPasswordResetNotification({
    userId: user.id,
    participantId: user.participantId,
    fullName: user.name,
    email: user.email,
    resetUrl: buildPasswordResetUrl(rawToken),
    expiresInMinutes: PASSWORD_RESET_TTL_MINUTES
  });

  return {
    requested: true,
    notification
  };
}

export async function resetPasswordWithToken(token, newPassword) {
  const normalizedToken = String(token ?? "").trim();
  const normalizedPassword = String(newPassword ?? "");

  if (!normalizedToken) {
    throw new Error("A valid password reset token is required.");
  }

  if (normalizedPassword.length < 8) {
    throw new Error("New password must be at least 8 characters.");
  }

  const tokenHash = hashResetToken(normalizedToken);
  const resetRecord = await queryOne(
    `
      SELECT
        password_reset_tokens.id AS id,
        password_reset_tokens.user_id AS "userId",
        users.is_active AS "isActive"
      FROM password_reset_tokens
      JOIN users ON users.id = password_reset_tokens.user_id
      WHERE password_reset_tokens.token_hash = $1
        AND password_reset_tokens.used_at IS NULL
        AND password_reset_tokens.expires_at > NOW()
      LIMIT 1
    `,
    [tokenHash]
  );

  if (!resetRecord || !Boolean(resetRecord.isActive)) {
    throw new Error("This password reset link is invalid or has expired.");
  }

  const passwordRecord = hashPassword(normalizedPassword);
  const usedAt = nowTimestamp();

  await withTransaction(async (client) => {
    await client.query(
      `
        UPDATE users
        SET
          password_salt = $1,
          password_hash = $2,
          must_change_password = 0,
          updated_at = $3
        WHERE id = $4
      `,
      [passwordRecord.salt, passwordRecord.hash, usedAt, resetRecord.userId]
    );

    await client.query(
      `
        UPDATE password_reset_tokens
        SET used_at = $1
        WHERE user_id = $2
          AND used_at IS NULL
      `,
      [usedAt, resetRecord.userId]
    );
  });

  return {
    ok: true
  };
}

export async function createDealAllocation(input) {
  const dealId = String(input.dealId ?? "").trim();
  const participantId = String(input.participantId ?? "").trim();
  const classType = String(input.classType ?? "").trim() || "Class A";
  const contributionType = String(input.contributionType ?? "").trim();
  const contributionAmount = Number(input.contributionAmount);
  const trade = String(input.trade ?? "").trim();
  const totalContractValue = Number(input.totalContractValue ?? 0);
  const cashPaid = Number(input.cashPaid ?? 0);
  const contractorStatus = String(input.contractorStatus ?? "Active").trim() || "Active";

  if (!dealId) {
    throw new Error("Deal selection is required.");
  }

  if (!participantId) {
    throw new Error("Participant selection is required.");
  }

  if (!["Class A", "Class B", "Class C"].includes(classType)) {
    throw new Error("Class type is invalid.");
  }

  if (!Number.isFinite(contributionAmount) || contributionAmount <= 0) {
    throw new Error("Contribution amount must be greater than zero.");
  }

  const deal = await queryOne(
    `
      SELECT id, name, investment_close_on AS "investmentCloseOn"
      FROM deals
      WHERE id = $1
    `,
    [dealId]
  );

  if (!deal) {
    throw new Error("Deal not found.");
  }

  if (isInvestmentWindowClosed(deal.investmentCloseOn)) {
    throw new Error(
      `Investments for ${deal.name} closed on ${deal.investmentCloseOn}. You can no longer add allocations to this project.`
    );
  }

  const participant = await queryOne(
    `
      SELECT id, name, category
      FROM participants
      WHERE id = $1
    `,
    [participantId]
  );

  if (!participant) {
    throw new Error("Participant not found.");
  }

  if (!["investor", "contractor"].includes(participant.category)) {
    throw new Error("Only investor and contractor participants can be allocated to deals.");
  }

  const existingPosition = await queryOne(
    `
      SELECT
        id,
        class_type AS "classType",
        contribution_type AS "contributionType",
        contribution_amount AS "contributionAmount"
      FROM positions
      WHERE deal_id = $1
        AND participant_id = $2
    `,
    [dealId, participantId]
  );

  if (participant.category === "contractor" && classType !== "Class C") {
    throw new Error("Contractor participants must be assigned as Class C.");
  }

  if (participant.category === "contractor") {
    if (!trade) {
      throw new Error("Trade is required for contractor participants.");
    }

    if (!Number.isFinite(totalContractValue) || totalContractValue <= 0) {
      throw new Error("Total contract value must be greater than zero for contractors.");
    }

    if (!Number.isFinite(cashPaid) || cashPaid < 0) {
      throw new Error("Cash paid must be zero or greater.");
    }

    if (cashPaid + contributionAmount > totalContractValue) {
      throw new Error("Cash paid plus deferred amount cannot exceed the total contract value.");
    }

    if (!["Active", "Completed", "Paid"].includes(contractorStatus)) {
      throw new Error("Contractor status is invalid.");
    }
  }

  const timestamp = nowTimestamp();
  const positionId = createId("position");

  await withTransaction(async (client) => {
    if (existingPosition) {
      if (existingPosition.classType !== classType) {
        throw new Error(
          `This participant already has a ${existingPosition.classType} position in ${deal.name}. Use the same class type to increase the position.`
        );
      }

      await client.query(
        `
          UPDATE positions
          SET
            contribution_type = $1,
            contribution_amount = $2,
            updated_at = $3
          WHERE id = $4
        `,
        [
          contributionType || existingPosition.contributionType,
          roundNumber(Number(existingPosition.contributionAmount ?? 0) + contributionAmount),
          timestamp,
          existingPosition.id
        ]
      );

      if (participant.category === "contractor") {
        const existingContractor = await queryOne(
          `
            SELECT
              id,
              trade,
              total_contract_value AS "totalContractValue",
              cash_paid AS "cashPaid",
              deferred_amount AS "deferredAmount",
              contribution_type AS "contributionType",
              status
            FROM contractor_participation
            WHERE deal_id = $1
              AND participant_id = $2
          `,
          [dealId, participantId],
          client
        );

        const updatedTotalContractValue = roundNumber(
          Number(existingContractor?.totalContractValue ?? 0) + totalContractValue
        );
        const updatedCashPaid = roundNumber(Number(existingContractor?.cashPaid ?? 0) + cashPaid);
        const updatedDeferredAmount = roundNumber(
          Number(existingContractor?.deferredAmount ?? 0) + contributionAmount
        );

        if (updatedCashPaid + updatedDeferredAmount > updatedTotalContractValue) {
          throw new Error("Cash paid plus deferred amount cannot exceed the total contract value.");
        }

        if (existingContractor) {
          await client.query(
            `
              UPDATE contractor_participation
              SET
                trade = $1,
                total_contract_value = $2,
                cash_paid = $3,
                deferred_amount = $4,
                contribution_type = $5,
                hybrid = $6,
                status = $7,
                updated_at = $8
              WHERE id = $9
            `,
            [
              trade || existingContractor.trade,
              updatedTotalContractValue,
              updatedCashPaid,
              updatedDeferredAmount,
              contributionType || existingContractor.contributionType,
              updatedCashPaid > 0 && updatedCashPaid < updatedTotalContractValue ? 1 : 0,
              contractorStatus || existingContractor.status,
              timestamp,
              existingContractor.id
            ]
          );
        }
      }
    } else {
      await client.query(
        `
          INSERT INTO positions (
            id,
            deal_id,
            participant_id,
            class_type,
            contribution_type,
            contribution_amount,
            distributions_to_date,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          positionId,
          dealId,
          participantId,
          classType,
          contributionType ||
            (participant.category === "contractor" ? "Deferred compensation" : "Cash equity"),
          roundNumber(contributionAmount),
          0,
          timestamp,
          timestamp
        ]
      );

      if (participant.category === "contractor") {
        await client.query(
          `
            INSERT INTO contractor_participation (
              id,
              deal_id,
              participant_id,
              trade,
              total_contract_value,
              cash_paid,
              deferred_amount,
              contribution_type,
              hybrid,
              status,
              created_at,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          `,
          [
            createId("contractor"),
            dealId,
            participantId,
            trade,
            roundNumber(totalContractValue),
            roundNumber(cashPaid),
            roundNumber(contributionAmount),
            "Class C",
            cashPaid > 0 && cashPaid < totalContractValue ? 1 : 0,
            contractorStatus,
            timestamp,
            timestamp
          ]
        );
      }
    }

    await syncDealEquity(dealId, client);
  });

  return {
    action: existingPosition ? "increased" : "created",
    dealId,
    dealName: deal.name,
    participantId,
    participantName: participant.name,
    positionId: existingPosition?.id ?? positionId
  };
}

async function applyApprovedReinvestmentAllocation({
  client,
  targetDealId,
  participantId,
  classType,
  amount
}) {
  const normalizedAmount = roundNumber(Number(amount ?? 0));

  if (!targetDealId || !participantId || normalizedAmount <= 0) {
    return null;
  }

  const timestamp = nowTimestamp();
  const existingPosition = await queryOne(
    `
      SELECT id, contribution_amount AS "contributionAmount"
      FROM positions
      WHERE deal_id = $1
        AND participant_id = $2
    `,
    [targetDealId, participantId],
    client
  );

  if (existingPosition) {
    await client.query(
      `
        UPDATE positions
        SET
          contribution_amount = $1,
          updated_at = $2
        WHERE id = $3
      `,
      [
        roundNumber(Number(existingPosition.contributionAmount ?? 0) + normalizedAmount),
        timestamp,
        existingPosition.id
      ]
    );

    await syncDealEquity(targetDealId, client);

    return existingPosition.id;
  }

  const positionId = createId("position");

  await client.query(
    `
      INSERT INTO positions (
        id,
        deal_id,
        participant_id,
        class_type,
        contribution_type,
        contribution_amount,
        distributions_to_date,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      positionId,
      targetDealId,
      participantId,
      classType,
      "Reinvested proceeds",
      normalizedAmount,
      0,
      timestamp,
      timestamp
    ]
  );

  await syncDealEquity(targetDealId, client);

  return positionId;
}

function normalizeDealInput(input) {
  const name = String(input.name ?? "").trim();
  const location = String(input.location ?? "").trim();
  const currentPhase = String(input.currentPhase ?? "").trim();
  const status = String(input.status ?? "").trim();
  const fundedOn = normalizeOptionalDateInput(input.fundedOn, "Funded on");
  const investmentCloseOn = normalizeOptionalDateInput(
    input.investmentCloseOn,
    "Investment close date"
  );
  const projectedExitOn = normalizeOptionalDateInput(input.projectedExitOn, "Projected exit");
  const actualExitOn = normalizeOptionalDateInput(input.actualExitOn, "Actual exit");
  const debt = Number(input.debt);
  const taxExpense = Number(input.taxExpense ?? 0);
  const debtInterestRate = Number(input.debtInterestRate ?? 0);
  const totalInterestPaid = Number(input.totalInterestPaid ?? 0);
  const totalProjectCost = Number(input.totalProjectCost);
  const salePrice = Number(input.salePrice);
  const holdMonths = Number(input.holdMonths);
  const prefRate = Number(input.prefRate);
  const timelineProgress = Number(input.timelineProgress);

  if (!name || !location || !currentPhase || !fundedOn || !investmentCloseOn) {
    throw new Error("Name, location, phase, funded date, and investment close date are required.");
  }

  if (!["under_construction", "listed", "sold"].includes(status)) {
    throw new Error("Deal status is invalid.");
  }

  if (!Number.isFinite(debt) || debt < 0) {
    throw new Error("Debt must be zero or greater.");
  }

  if (!Number.isFinite(taxExpense) || taxExpense < 0) {
    throw new Error("Tax expense must be zero or greater.");
  }

  if (!Number.isFinite(debtInterestRate) || debtInterestRate < 0 || debtInterestRate > 1) {
    throw new Error("Debt interest rate must be between 0 and 1.");
  }

  if (!Number.isFinite(totalInterestPaid) || totalInterestPaid < 0) {
    throw new Error("Total interest paid must be zero or greater.");
  }

  if (!Number.isFinite(totalProjectCost) || totalProjectCost < 0) {
    throw new Error("Total project cost must be zero or greater.");
  }

  if (!Number.isFinite(salePrice) || salePrice < 0) {
    throw new Error("Sale price must be zero or greater.");
  }

  if (!Number.isFinite(holdMonths) || holdMonths <= 0) {
    throw new Error("Hold months must be greater than zero.");
  }

  if (!Number.isFinite(prefRate) || prefRate < 0) {
    throw new Error("Preferred return rate must be zero or greater.");
  }

  if (!Number.isFinite(timelineProgress) || timelineProgress < 0 || timelineProgress > 100) {
    throw new Error("Timeline progress must be between 0 and 100.");
  }

  return {
    name,
    location,
    currentPhase,
    status,
    fundedOn,
    investmentCloseOn,
    projectedExitOn,
    actualExitOn,
    debt: roundNumber(debt),
    taxExpense: roundNumber(taxExpense),
    debtInterestRate: roundNumber(debtInterestRate),
    totalInterestPaid: roundNumber(totalInterestPaid),
    totalProjectCost: roundNumber(totalProjectCost),
    salePrice: roundNumber(salePrice),
    holdMonths: Math.round(holdMonths),
    prefRate: roundNumber(prefRate),
    timelineProgress: status === "sold" ? 100 : Math.round(timelineProgress)
  };
}

function normalizeIssueInput(input) {
  const dealId = String(input.dealId ?? "").trim();
  const title = String(input.title ?? "").trim();
  const description = String(input.description ?? "").trim();
  const approvalThreshold = Number(input.approvalThreshold ?? 0.75);
  const closesOn = String(input.closesOn ?? "").trim();

  if (!dealId) {
    throw new Error("A deal selection is required.");
  }

  if (!title) {
    throw new Error("Issue title is required.");
  }

  if (!description) {
    throw new Error("Issue description is required.");
  }

  if (!Number.isFinite(approvalThreshold) || approvalThreshold <= 0 || approvalThreshold > 1) {
    throw new Error("Approval threshold must be between 0 and 1.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(closesOn) || Number.isNaN(new Date(closesOn).getTime())) {
    throw new Error("A valid vote close date is required.");
  }

  if (closesOn < todayStamp()) {
    throw new Error("Vote close date cannot be in the past.");
  }

  return {
    dealId,
    title,
    description,
    approvalThreshold: roundNumber(approvalThreshold),
    closesOn
  };
}

function normalizeVoteChoice(value) {
  const voteChoice = String(value ?? "").trim().toLowerCase();

  if (!["yes", "no"].includes(voteChoice)) {
    throw new Error("Vote choice must be either yes or no.");
  }

  return voteChoice;
}

function normalizeCompanyResourceInput(input) {
  const title = String(input.title ?? "").trim();
  const resourceType = String(input.resourceType ?? "").trim();
  const dealId = normalizeOptionalText(input.dealId);
  const summaryText = normalizeOptionalText(input.summaryText ?? input.summary);
  const bodyText = normalizeOptionalText(input.bodyText);
  const resourceFile = normalizeResourceFile(input.resourceFile);

  if (!title) {
    throw new Error("A resource title is required.");
  }

  if (!["bylaw_document", "announcement", "project_balance_sheet"].includes(resourceType)) {
    throw new Error(
      "Resource type must be bylaw document, announcement, or project balance sheet."
    );
  }

  if (resourceType === "bylaw_document" && !resourceFile) {
    throw new Error("Bylaw documents must include an uploaded file.");
  }

  if (resourceType === "project_balance_sheet") {
    if (!dealId) {
      throw new Error("Project balance sheets must be linked to a deal.");
    }

    if (!resourceFile) {
      throw new Error("Project balance sheets must include an uploaded file.");
    }
  }

  if (resourceType === "announcement" && !summaryText && !bodyText && !resourceFile) {
    throw new Error("Announcements must include text or an attachment.");
  }

  return {
    title,
    dealId: resourceType === "project_balance_sheet" ? dealId : null,
    resourceType,
    summaryText,
    bodyText,
    resourceFile
  };
}

function normalizeDistributionElectionInput(input) {
  const electionMode = String(input.electionMode ?? "").trim();
  const targetDealId = normalizeOptionalText(input.targetDealId);
  const notes = normalizeOptionalText(input.notes);
  const rawPercent = String(input.reinvestPercent ?? "").trim();
  const rawAmount = String(input.reinvestAmount ?? "").trim();
  const reinvestPercent =
    rawPercent === "" ? null : roundNumber(Number(rawPercent));
  const reinvestAmount =
    rawAmount === "" ? null : roundNumber(Number(rawAmount));

  if (
    !["payout_all", "reinvest_all", "split_percentage", "split_amount"].includes(electionMode)
  ) {
    throw new Error("Choose a valid distribution instruction.");
  }

  if (electionMode === "split_percentage") {
    if (
      reinvestPercent === null ||
      !Number.isFinite(reinvestPercent) ||
      reinvestPercent < 0 ||
      reinvestPercent > 1
    ) {
      throw new Error("Reinvestment percentage must be between 0 and 1.");
    }
  }

  if (electionMode === "split_amount") {
    if (
      reinvestAmount === null ||
      !Number.isFinite(reinvestAmount) ||
      reinvestAmount < 0
    ) {
      throw new Error("Reinvestment amount must be zero or greater.");
    }
  }

  return {
    electionMode,
    reinvestPercent,
    reinvestAmount,
    targetDealId,
    notes
  };
}

function normalizeTimelineItems(items) {
  if (!Array.isArray(items)) {
    return null;
  }

  return items.reduce((timeline, item, index) => {
    const label = String(item?.label ?? "").trim();
    const date = String(item?.date ?? "").trim();
    const status = String(item?.status ?? "").trim();
    const isBlank = !label && !date && !status;

    if (isBlank) {
      return timeline;
    }

    if (!label || !date || !status) {
      throw new Error(`Timeline row ${index + 1} must include a label, date, and status.`);
    }

    if (!["complete", "in_progress", "upcoming"].includes(status)) {
      throw new Error(`Timeline row ${index + 1} has an invalid status.`);
    }

    timeline.push({
      label,
      date,
      status,
      sortOrder: timeline.length + 1
    });

    return timeline;
  }, []);
}

function normalizePromoteTiers(items) {
  if (!Array.isArray(items)) {
    return null;
  }

  return items.reduce((tiers, item, index) => {
    const label = String(item?.label ?? "").trim();
    const hurdleRaw = String(item?.hurdle ?? "").trim();
    const investorShareRaw = String(item?.investorShare ?? "").trim();
    const sponsorShareRaw = String(item?.sponsorShare ?? "").trim();
    const isEnabled = item?.isEnabled !== false;
    const isBlank = !label && !hurdleRaw && !investorShareRaw && !sponsorShareRaw;

    if (isBlank) {
      return tiers;
    }

    const hurdle = Number(hurdleRaw);
    const investorShare = Number(investorShareRaw);
    const sponsorShare = Number(sponsorShareRaw);

    if (!label) {
      throw new Error(`Promote tier ${index + 1} must include a label.`);
    }

    if (!Number.isFinite(hurdle) || hurdle < 0) {
      throw new Error(`Promote tier ${index + 1} must have a valid hurdle.`);
    }

    if (!Number.isFinite(investorShare) || investorShare < 0 || investorShare > 1) {
      throw new Error(`Promote tier ${index + 1} must have a valid investor share.`);
    }

    if (!Number.isFinite(sponsorShare) || sponsorShare < 0 || sponsorShare > 1) {
      throw new Error(`Promote tier ${index + 1} must have a valid sponsor share.`);
    }

    if (Math.abs(investorShare + sponsorShare - 1) > 0.001) {
      throw new Error(
        `Promote tier ${index + 1} must have investor and sponsor shares that total 1.0.`
      );
    }

    tiers.push({
      label,
      hurdle: roundNumber(hurdle),
      investorShare: roundNumber(investorShare),
      sponsorShare: roundNumber(sponsorShare),
      isEnabled,
      sortOrder: tiers.length + 1
    });

    return tiers;
  }, []);
}

async function replaceDealTimeline(dealId, timelineItems, executor) {
  const timestamp = nowTimestamp();

  await executor.query(
    `
      DELETE FROM deal_timeline_items
      WHERE deal_id = $1
    `,
    [dealId]
  );

  for (const item of timelineItems) {
    await executor.query(
      `
        INSERT INTO deal_timeline_items (
          id,
          deal_id,
          label,
          milestone_date,
          status,
          sort_order,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        createId("timeline"),
        dealId,
        item.label,
        item.date,
        item.status,
        item.sortOrder,
        timestamp,
        timestamp
      ]
    );
  }
}

async function replacePromoteTiers(dealId, tiers, executor) {
  const timestamp = nowTimestamp();

  await executor.query(
    `
      DELETE FROM promote_tiers
      WHERE deal_id = $1
    `,
    [dealId]
  );

  for (const tier of tiers) {
    await executor.query(
      `
        INSERT INTO promote_tiers (
          id,
          deal_id,
          label,
          hurdle,
          investor_share,
          sponsor_share,
          is_enabled,
          sort_order,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        createId("tier"),
        dealId,
        tier.label,
        tier.hurdle,
        tier.investorShare,
        tier.sponsorShare,
        tier.isEnabled ? 1 : 0,
        tier.sortOrder,
        timestamp,
        timestamp
      ]
    );
  }
}

export async function createDeal(input) {
  const deal = normalizeDealInput(input);
  const timelineItems = normalizeTimelineItems(input.timeline);
  const promoteTiers = normalizePromoteTiers(input.promoteTiers);
  const existingDeal = await queryOne(
    `
      SELECT id
      FROM deals
      WHERE LOWER(name) = LOWER($1)
    `,
    [deal.name]
  );

  if (existingDeal) {
    throw new Error("A deal with that name already exists.");
  }

  const timestamp = nowTimestamp();
  const dealId = createId("deal");

  await withTransaction(async (client) => {
    await client.query(
      `
        INSERT INTO deals (
          id,
          name,
          location,
          total_equity,
          debt,
          tax_expense,
          debt_interest_rate,
          total_interest_paid,
          total_project_cost,
          sale_price,
          hold_months,
          pref_rate,
        status,
        current_phase,
        funded_on,
        investment_close_on,
        projected_exit_on,
        actual_exit_on,
        timeline_progress,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          $16,
          $17,
          $18,
          $19,
          $20,
          $21
        )
      `,
      [
        dealId,
        deal.name,
        deal.location,
        0,
        deal.debt,
        deal.taxExpense,
        deal.debtInterestRate,
        deal.totalInterestPaid,
        deal.totalProjectCost,
        deal.salePrice,
        deal.holdMonths,
        deal.prefRate,
        deal.status,
        deal.currentPhase,
        deal.fundedOn,
        deal.investmentCloseOn,
        deal.projectedExitOn,
        deal.actualExitOn,
        deal.timelineProgress,
        timestamp,
        timestamp
      ]
    );

    if (timelineItems) {
      await replaceDealTimeline(dealId, timelineItems, client);
    }

    if (promoteTiers) {
      await replacePromoteTiers(dealId, promoteTiers, client);
    }
  });

  const recipients = await queryAll(
    `
      SELECT
        users.id AS "userId",
        users.participant_id AS "participantId",
        users.email AS email,
        participants.name AS "fullName"
      FROM users
      JOIN participants ON participants.id = users.participant_id
      WHERE users.role = 'investor'
        AND users.is_active = 1
      ORDER BY participants.name
    `
  );

  const notifications = await Promise.all(
    recipients.map(async (recipient) => {
      try {
        return await sendNewDealAnnouncementNotification({
          userId: recipient.userId,
          participantId: recipient.participantId,
          fullName: recipient.fullName,
          email: recipient.email,
          dealName: deal.name,
          location: deal.location,
          currentPhase: deal.currentPhase,
          investmentCloseOn: deal.investmentCloseOn
        });
      } catch (error) {
        return {
          status: "failed",
          provider: "notification_error",
          localPath: null,
          errorMessage: error.message,
          recipientEmail: recipient.email
        };
      }
    })
  );

  const createdDeal = await queryOne(
    `
      SELECT id, name
      FROM deals
      WHERE id = $1
    `,
    [dealId]
  );

  return {
    deal: createdDeal,
    notifications
  };
}

export async function updateDeal(dealId, input) {
  const id = String(dealId ?? "").trim();

  if (!id) {
    throw new Error("Deal id is required.");
  }

  const existingDeal = await queryOne(
    `
      SELECT id
      FROM deals
      WHERE id = $1
    `,
    [id]
  );

  if (!existingDeal) {
    throw new Error("Deal not found.");
  }

  const deal = normalizeDealInput(input);
  const timelineItems = normalizeTimelineItems(input.timeline);
  const promoteTiers = normalizePromoteTiers(input.promoteTiers);
  const duplicateDeal = await queryOne(
    `
      SELECT id
      FROM deals
      WHERE LOWER(name) = LOWER($1)
        AND id <> $2
    `,
    [deal.name, id]
  );

  if (duplicateDeal) {
    throw new Error("A deal with that name already exists.");
  }

  await withTransaction(async (client) => {
    await client.query(
      `
        UPDATE deals
        SET
          name = $1,
          location = $2,
          debt = $3,
          tax_expense = $4,
          debt_interest_rate = $5,
          total_interest_paid = $6,
          total_project_cost = $7,
          sale_price = $8,
          hold_months = $9,
          pref_rate = $10,
          status = $11,
          current_phase = $12,
          funded_on = $13,
          investment_close_on = $14,
          projected_exit_on = $15,
          actual_exit_on = $16,
          timeline_progress = $17,
          updated_at = $18
        WHERE id = $19
      `,
      [
        deal.name,
        deal.location,
        deal.debt,
        deal.taxExpense,
        deal.debtInterestRate,
        deal.totalInterestPaid,
        deal.totalProjectCost,
        deal.salePrice,
        deal.holdMonths,
        deal.prefRate,
        deal.status,
        deal.currentPhase,
        deal.fundedOn,
        deal.investmentCloseOn,
        deal.projectedExitOn,
        deal.actualExitOn,
        deal.timelineProgress,
        nowTimestamp(),
        id
      ]
    );

    if (timelineItems) {
      await replaceDealTimeline(id, timelineItems, client);
    }

    if (promoteTiers) {
      await replacePromoteTiers(id, promoteTiers, client);
    }
  });
}

export async function createCompanyResource(input, createdByUserId) {
  const resource = normalizeCompanyResourceInput(input);
  const resourceId = createId("resource");
  const timestamp = nowTimestamp();

  if (resource.dealId) {
    const linkedDeal = await queryOne(
      `
        SELECT id
        FROM deals
        WHERE id = $1
      `,
      [resource.dealId]
    );

    if (!linkedDeal) {
      throw new Error("Choose a valid deal for the project balance sheet.");
    }
  }

  await pool.query(
    `
      INSERT INTO company_resources (
        id,
        title,
        deal_id,
        resource_type,
        summary_text,
        body_text,
        file_name,
        file_mime_type,
        file_data_url,
        published_at,
        created_by_user_id,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `,
    [
      resourceId,
      resource.title,
      resource.dealId,
      resource.resourceType,
      resource.summaryText,
      resource.bodyText,
      resource.resourceFile?.fileName ?? null,
      resource.resourceFile?.mimeType ?? null,
      resource.resourceFile?.dataUrl ?? null,
      timestamp,
      createdByUserId,
      timestamp,
      timestamp
    ]
  );

  return {
    id: resourceId,
    title: resource.title,
    dealId: resource.dealId,
    resourceType: resource.resourceType
  };
}

export async function getCompanyResourceDownload(resourceId) {
  const normalizedResourceId = String(resourceId ?? "").trim();

  if (!normalizedResourceId) {
    throw new Error("Resource id is required.");
  }

  const resource = await queryOne(
    `
      SELECT
        id,
        title,
        file_name AS "fileName",
        file_mime_type AS "fileMimeType",
        file_data_url AS "fileDataUrl"
      FROM company_resources
      WHERE id = $1
    `,
    [normalizedResourceId]
  );

  if (!resource) {
    throw new Error("Resource not found.");
  }

  if (!resource.fileName || !resource.fileDataUrl) {
    throw new Error("This resource does not have a downloadable file.");
  }

  return resource;
}

async function insertArchivedRecord(client, archiveInput) {
  const entityType = String(archiveInput?.entityType ?? "").trim();
  const entityId = String(archiveInput?.entityId ?? "").trim();
  const sourceTable = String(archiveInput?.sourceTable ?? "").trim();

  if (!entityType || !entityId || !sourceTable) {
    throw new Error("Archive entries require entity type, entity id, and source table.");
  }

  const deletedAt = nowTimestamp();
  const actor = await getArchiveActorSnapshot(archiveInput?.deletedByUserId, client);
  const archiveRecord = {
    id: createId("archive"),
    entityType,
    entityId,
    sourceTable,
    displayName: normalizeOptionalText(archiveInput?.displayName),
    relatedDealId: normalizeOptionalText(archiveInput?.relatedDealId),
    relatedParticipantId: normalizeOptionalText(archiveInput?.relatedParticipantId),
    deletedByUserId: actor?.id ?? normalizeOptionalText(archiveInput?.deletedByUserId),
    deletedByRole: actor?.role ?? null,
    deletedByEmail: actor?.email ?? null,
    deletedByName: actor?.name ?? null,
    deletedAt,
    payloadJson: archiveInput?.payload ?? {},
    createdAt: deletedAt
  };

  await client.query(
    `
      INSERT INTO archived_records (
        id,
        entity_type,
        entity_id,
        source_table,
        display_name,
        related_deal_id,
        related_participant_id,
        deleted_by_user_id,
        deleted_by_role,
        deleted_by_email,
        deleted_by_name,
        deleted_at,
        payload_json,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14)
    `,
    [
      archiveRecord.id,
      archiveRecord.entityType,
      archiveRecord.entityId,
      archiveRecord.sourceTable,
      archiveRecord.displayName,
      archiveRecord.relatedDealId,
      archiveRecord.relatedParticipantId,
      archiveRecord.deletedByUserId,
      archiveRecord.deletedByRole,
      archiveRecord.deletedByEmail,
      archiveRecord.deletedByName,
      archiveRecord.deletedAt,
      JSON.stringify(archiveRecord.payloadJson ?? {}),
      archiveRecord.createdAt
    ]
  );

  return archiveRecord;
}

async function buildCompanyResourceArchivePayload(resourceId, executor = pool) {
  return queryOne(
    `
      SELECT
        company_resources.*,
        deals.name AS deal_name,
        creator.email AS created_by_email,
        creator_participant.name AS created_by_name
      FROM company_resources
      LEFT JOIN deals ON deals.id = company_resources.deal_id
      LEFT JOIN users AS creator ON creator.id = company_resources.created_by_user_id
      LEFT JOIN participants AS creator_participant
        ON creator_participant.id = creator.participant_id
      WHERE company_resources.id = $1
    `,
    [resourceId],
    executor
  );
}

async function buildDealArchivePayload(dealId, executor = pool) {
  const deal = await queryOne(
    `
      SELECT *
      FROM deals
      WHERE id = $1
    `,
    [dealId],
    executor
  );

  if (!deal) {
    return null;
  }

  const promoteTiers = await queryAll(
    `
      SELECT *
      FROM promote_tiers
      WHERE deal_id = $1
      ORDER BY sort_order, id
    `,
    [dealId],
    executor
  );
  const timelineItems = await queryAll(
    `
      SELECT *
      FROM deal_timeline_items
      WHERE deal_id = $1
      ORDER BY sort_order, id
    `,
    [dealId],
    executor
  );
  const positions = await queryAll(
    `
      SELECT
        positions.*,
        participants.name AS participant_name,
        participants.category AS participant_category
      FROM positions
      LEFT JOIN participants ON participants.id = positions.participant_id
      WHERE positions.deal_id = $1
      ORDER BY positions.created_at, positions.id
    `,
    [dealId],
    executor
  );
  const contractorParticipation = await queryAll(
    `
      SELECT
        contractor_participation.*,
        participants.name AS participant_name,
        participants.category AS participant_category
      FROM contractor_participation
      LEFT JOIN participants ON participants.id = contractor_participation.participant_id
      WHERE contractor_participation.deal_id = $1
      ORDER BY contractor_participation.created_at, contractor_participation.id
    `,
    [dealId],
    executor
  );
  const distributionElections = await queryAll(
    `
      SELECT
        distribution_elections.*,
        participants.name AS participant_name,
        rollover_deal.name AS rollover_target_deal_name,
        submitter.email AS submitted_by_email,
        submitter_participant.name AS submitted_by_name,
        reviewer.email AS reviewed_by_email,
        reviewer_participant.name AS reviewed_by_name
      FROM distribution_elections
      LEFT JOIN participants ON participants.id = distribution_elections.participant_id
      LEFT JOIN deals AS rollover_deal
        ON rollover_deal.id = distribution_elections.rollover_target_deal_id
      LEFT JOIN users AS submitter
        ON submitter.id = distribution_elections.submitted_by_user_id
      LEFT JOIN participants AS submitter_participant
        ON submitter_participant.id = submitter.participant_id
      LEFT JOIN users AS reviewer
        ON reviewer.id = distribution_elections.reviewed_by_user_id
      LEFT JOIN participants AS reviewer_participant
        ON reviewer_participant.id = reviewer.participant_id
      WHERE distribution_elections.deal_id = $1
      ORDER BY distribution_elections.created_at, distribution_elections.id
    `,
    [dealId],
    executor
  );
  const companyResources = await queryAll(
    `
      SELECT
        company_resources.*,
        creator.email AS created_by_email,
        creator_participant.name AS created_by_name
      FROM company_resources
      LEFT JOIN users AS creator ON creator.id = company_resources.created_by_user_id
      LEFT JOIN participants AS creator_participant
        ON creator_participant.id = creator.participant_id
      WHERE company_resources.deal_id = $1
      ORDER BY company_resources.created_at, company_resources.id
    `,
    [dealId],
    executor
  );
  const issues = await queryAll(
    `
      SELECT
        deal_issues.*,
        creator.email AS created_by_email,
        creator_participant.name AS created_by_name
      FROM deal_issues
      LEFT JOIN users AS creator ON creator.id = deal_issues.created_by_user_id
      LEFT JOIN participants AS creator_participant
        ON creator_participant.id = creator.participant_id
      WHERE deal_issues.deal_id = $1
      ORDER BY deal_issues.created_at, deal_issues.id
    `,
    [dealId],
    executor
  );
  const issueVotes = await queryAll(
    `
      SELECT
        deal_issue_votes.*,
        deal_issues.title AS issue_title,
        participants.name AS participant_name
      FROM deal_issue_votes
      JOIN deal_issues ON deal_issues.id = deal_issue_votes.issue_id
      LEFT JOIN participants ON participants.id = deal_issue_votes.participant_id
      WHERE deal_issues.deal_id = $1
      ORDER BY deal_issue_votes.created_at, deal_issue_votes.id
    `,
    [dealId],
    executor
  );

  return {
    deal,
    promoteTiers,
    timelineItems,
    positions,
    contractorParticipation,
    distributionElections,
    companyResources,
    issues,
    issueVotes,
    counts: {
      promoteTiers: promoteTiers.length,
      timelineItems: timelineItems.length,
      positions: positions.length,
      contractorParticipation: contractorParticipation.length,
      distributionElections: distributionElections.length,
      companyResources: companyResources.length,
      issues: issues.length,
      issueVotes: issueVotes.length
    }
  };
}

async function buildUserArchivePayload(userId, executor = pool) {
  const user = await queryOne(
    `
      SELECT
        users.*,
        participants.name AS participant_name,
        participants.category AS participant_category,
        participants.first_name,
        participants.middle_name,
        participants.last_name,
        participants.driver_license_number,
        participants.id_card_file_name,
        participants.id_card_mime_type,
        participants.id_card_data_url,
        participants.current_address,
        participants.mailing_address,
        participants.contact_phone,
        participants.payout_method,
        participants.bank_account_name,
        participants.bank_name,
        participants.bank_routing_number,
        participants.bank_account_number,
        participants.zelle_details,
        participants.cash_app_handle,
        participants.payout_notes
      FROM users
      JOIN participants ON participants.id = users.participant_id
      WHERE users.id = $1
    `,
    [userId],
    executor
  );

  if (!user) {
    return null;
  }

  const positions = await queryAll(
    `
      SELECT
        positions.*,
        deals.name AS deal_name
      FROM positions
      LEFT JOIN deals ON deals.id = positions.deal_id
      WHERE positions.participant_id = $1
      ORDER BY positions.created_at, positions.id
    `,
    [user.participant_id],
    executor
  );
  const contractorParticipation = await queryAll(
    `
      SELECT
        contractor_participation.*,
        deals.name AS deal_name
      FROM contractor_participation
      LEFT JOIN deals ON deals.id = contractor_participation.deal_id
      WHERE contractor_participation.participant_id = $1
      ORDER BY contractor_participation.created_at, contractor_participation.id
    `,
    [user.participant_id],
    executor
  );
  const distributionElections = await queryAll(
    `
      SELECT
        distribution_elections.*,
        deals.name AS deal_name,
        rollover_deal.name AS rollover_target_deal_name
      FROM distribution_elections
      LEFT JOIN deals ON deals.id = distribution_elections.deal_id
      LEFT JOIN deals AS rollover_deal
        ON rollover_deal.id = distribution_elections.rollover_target_deal_id
      WHERE distribution_elections.participant_id = $1
      ORDER BY distribution_elections.created_at, distribution_elections.id
    `,
    [user.participant_id],
    executor
  );
  const emailNotifications = await queryAll(
    `
      SELECT *
      FROM email_notifications
      WHERE user_id = $1
      ORDER BY created_at, id
    `,
    [userId],
    executor
  );
  const passwordResetTokens = await queryAll(
    `
      SELECT *
      FROM password_reset_tokens
      WHERE user_id = $1
      ORDER BY created_at, id
    `,
    [userId],
    executor
  );
  const createdCompanyResources = await queryAll(
    `
      SELECT
        company_resources.*,
        deals.name AS deal_name
      FROM company_resources
      LEFT JOIN deals ON deals.id = company_resources.deal_id
      WHERE company_resources.created_by_user_id = $1
      ORDER BY company_resources.created_at, company_resources.id
    `,
    [userId],
    executor
  );
  const createdDealIssues = await queryAll(
    `
      SELECT
        deal_issues.*,
        deals.name AS deal_name
      FROM deal_issues
      LEFT JOIN deals ON deals.id = deal_issues.deal_id
      WHERE deal_issues.created_by_user_id = $1
      ORDER BY deal_issues.created_at, deal_issues.id
    `,
    [userId],
    executor
  );
  const reviewedDistributionElections = await queryAll(
    `
      SELECT
        distribution_elections.*,
        deals.name AS deal_name,
        participants.name AS participant_name
      FROM distribution_elections
      LEFT JOIN deals ON deals.id = distribution_elections.deal_id
      LEFT JOIN participants ON participants.id = distribution_elections.participant_id
      WHERE distribution_elections.submitted_by_user_id = $1
         OR distribution_elections.reviewed_by_user_id = $1
      ORDER BY distribution_elections.updated_at, distribution_elections.id
    `,
    [userId],
    executor
  );

  return {
    user,
    positions,
    contractorParticipation,
    distributionElections,
    emailNotifications,
    passwordResetTokens,
    createdCompanyResources,
    createdDealIssues,
    reviewedDistributionElections,
    counts: {
      positions: positions.length,
      contractorParticipation: contractorParticipation.length,
      distributionElections: distributionElections.length,
      emailNotifications: emailNotifications.length,
      passwordResetTokens: passwordResetTokens.length,
      createdCompanyResources: createdCompanyResources.length,
      createdDealIssues: createdDealIssues.length,
      reviewedDistributionElections: reviewedDistributionElections.length
    }
  };
}

export async function deleteCompanyResource(resourceId, actingUserId = null) {
  const normalizedResourceId = String(resourceId ?? "").trim();

  if (!normalizedResourceId) {
    throw new Error("Resource id is required.");
  }

  const archive = await withTransaction(async (client) => {
    const existing = await buildCompanyResourceArchivePayload(normalizedResourceId, client);

    if (!existing) {
      throw new Error("Resource not found.");
    }

    const archiveRecord = await insertArchivedRecord(client, {
      entityType: "company_resource",
      entityId: normalizedResourceId,
      sourceTable: "company_resources",
      displayName: existing.title,
      relatedDealId: existing.deal_id,
      deletedByUserId: actingUserId,
      payload: existing
    });

    await client.query(
      `
        DELETE FROM company_resources
        WHERE id = $1
      `,
      [normalizedResourceId]
    );

    return archiveRecord;
  });

  return {
    ok: true,
    deletedResourceId: normalizedResourceId,
    archivedRecordId: archive.id
  };
}

function participantHasPayoutInstructions(participant) {
  return Boolean(
    participant?.payoutMethod ||
      participant?.bankAccountName ||
      participant?.bankName ||
      participant?.bankRoutingNumber ||
      participant?.bankAccountNumber ||
      participant?.zelleDetails ||
      participant?.cashAppHandle ||
      participant?.payoutNotes
  );
}

export async function upsertDistributionElection(dealId, userId, input) {
  const normalizedDealId = String(dealId ?? "").trim();

  if (!normalizedDealId) {
    throw new Error("Deal id is required.");
  }

  const user = await getUserById(userId);

  if (!user) {
    throw new Error("User not found.");
  }

  const isManagerActing = user.role === "manager";
  const targetParticipantId = String(
    input?.participantId ?? user.participantId ?? ""
  ).trim();

  if (!targetParticipantId) {
    throw new Error("Participant id is required.");
  }

  if (!isManagerActing && targetParticipantId !== user.participantId) {
    throw new Error("You can only save elections for your own investor position.");
  }

  const election = normalizeDistributionElectionInput(input);
  const overrideNotes = normalizeOptionalText(input?.overrideNotes);
  const payoutExpectedOn = normalizeOptionalDateInput(
    input?.payoutExpectedOn,
    "Expected payout date"
  );
  const snapshot = await getAppDataSnapshot();
  const deal = snapshot.deals.find((item) => item.id === normalizedDealId);

  if (!deal) {
    throw new Error("Deal not found.");
  }

  if (deal.status !== "sold") {
    throw new Error("Reinvestment elections can only be saved after the project has sold.");
  }

  const participant = snapshot.participants.find((item) => item.id === targetParticipantId);
  const position = snapshot.positions.find(
    (item) => item.dealId === normalizedDealId && item.participantId === targetParticipantId
  );

  if (!position || position.contributionAmount <= 0) {
    throw new Error("You do not have an eligible position in this deal.");
  }

  if (participant?.category !== "investor") {
    throw new Error("Distribution elections are only supported for investor positions.");
  }

  const dealPositions = snapshot.positions.filter((item) => item.dealId === normalizedDealId);
  const waterfall = calculateWaterfall({ deal, positions: dealPositions });
  const positionResult = waterfall.participantResults.find(
    (item) => item.positionId === position.id
  );

  if (!positionResult || positionResult.totalPayout <= 0) {
    throw new Error("No exited proceeds are available for this position.");
  }

  const { totalPayout, reinvestAmount, cashPayoutAmount } = computeDistributionAmounts(
    election,
    positionResult.totalPayout
  );
  const rolloverTargetDealId = reinvestAmount > 0 ? election.targetDealId : null;

  if (rolloverTargetDealId) {
    const rolloverTarget = snapshot.deals.find((item) => item.id === rolloverTargetDealId);

    if (!rolloverTarget) {
      throw new Error("Choose a valid target project for reinvestment.");
    }

    if (rolloverTarget.id === normalizedDealId) {
      throw new Error("Reinvestment target must be a different project.");
    }

    if (rolloverTarget.status === "sold") {
      throw new Error("Reinvestment target must still be an active project.");
    }
  }

  if (cashPayoutAmount > 0 && !participantHasPayoutInstructions(participant)) {
    throw new Error(
      "Save your payout method or payout instructions in Profile & Payout Details before requesting a cash payout."
    );
  }

  if (isManagerActing && cashPayoutAmount > 0 && !payoutExpectedOn) {
    throw new Error("Expected payout date is required when approving a cash payout.");
  }

  const existingElection = await queryOne(
    `
      SELECT
        id,
        election_mode AS "electionMode",
        reinvest_percent AS "reinvestPercent",
        reinvest_amount AS "reinvestAmount",
        rollover_target_deal_id AS "rolloverTargetDealId",
        notes,
        submitted_by_user_id AS "submittedByUserId",
        submitted_by_role AS "submittedByRole",
        approval_status AS "approvalStatus",
        approved_reinvest_amount AS "approvedReinvestAmount",
        approved_cash_payout_amount AS "approvedCashPayoutAmount",
        payout_expected_on AS "payoutExpectedOn",
        reviewed_by_user_id AS "reviewedByUserId",
        reviewed_at AS "reviewedAt",
        manager_override AS "managerOverride",
        override_notes AS "overrideNotes"
      FROM distribution_elections
      WHERE deal_id = $1
        AND participant_id = $2
    `,
    [normalizedDealId, targetParticipantId]
  );

  const timestamp = nowTimestamp();
  const hasInstructionChange =
    !existingElection ||
    existingElection.electionMode !== election.electionMode ||
    Number(existingElection.reinvestPercent ?? 0) !== Number(election.reinvestPercent ?? 0) ||
    Number(existingElection.reinvestAmount ?? 0) !==
      Number(election.electionMode === "split_amount" ? reinvestAmount : 0) ||
    String(existingElection.rolloverTargetDealId ?? "") !== String(rolloverTargetDealId ?? "") ||
    String(existingElection.notes ?? "") !== String(election.notes ?? "");
  const rolloverTargetDealName = rolloverTargetDealId
    ? snapshot.deals.find((item) => item.id === rolloverTargetDealId)?.name ?? null
    : null;

  if (!isManagerActing && existingElection?.approvalStatus === "approved") {
    throw new Error("This distribution election has already been approved and cannot be changed.");
  }

  let notifications = [];

  if (!isManagerActing) {
    await withTransaction(async (client) => {
      if (existingElection) {
        await client.query(
          `
            UPDATE distribution_elections
            SET
              election_mode = $1,
              reinvest_percent = $2,
              reinvest_amount = $3,
              rollover_target_deal_id = $4,
              notes = $5,
              submitted_by_user_id = $6,
              submitted_by_role = $7,
              approval_status = $8,
              approved_reinvest_amount = NULL,
              approved_cash_payout_amount = NULL,
              payout_expected_on = NULL,
              reviewed_by_user_id = NULL,
              reviewed_at = NULL,
              manager_override = 0,
              override_notes = NULL,
              updated_at = $9
            WHERE id = $10
          `,
          [
            election.electionMode,
            election.electionMode === "split_percentage" ? election.reinvestPercent : null,
            election.electionMode === "split_amount" ? reinvestAmount : null,
            rolloverTargetDealId,
            election.notes,
            user.id,
            "investor",
            "pending",
            timestamp,
            existingElection.id
          ]
        );
      } else {
        await client.query(
          `
            INSERT INTO distribution_elections (
              id,
              deal_id,
              participant_id,
              election_mode,
              reinvest_percent,
              reinvest_amount,
              rollover_target_deal_id,
              notes,
              submitted_by_user_id,
              submitted_by_role,
              approval_status,
              reviewed_by_user_id,
              reviewed_at,
              manager_override,
              override_notes,
              created_at,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL, NULL, 0, NULL, $12, $13)
          `,
          [
            createId("distribution"),
            normalizedDealId,
            targetParticipantId,
            election.electionMode,
            election.electionMode === "split_percentage" ? election.reinvestPercent : null,
            election.electionMode === "split_amount" ? reinvestAmount : null,
            rolloverTargetDealId,
            election.notes,
            user.id,
            "investor",
            "pending",
            timestamp,
            timestamp
          ]
        );
      }
    });

    const managerRecipients = await getActiveManagerRecipients();
    notifications = await Promise.all(
      managerRecipients.map(async (managerRecipient) => {
        try {
          return await sendDistributionElectionAlertNotification({
            userId: managerRecipient.userId,
            participantId: managerRecipient.participantId,
            managerName: managerRecipient.fullName,
            email: managerRecipient.email,
            investorName: participant?.name ?? "Investor",
            dealName: deal.name,
            electionMode: election.electionMode,
            cashPayoutAmount,
            reinvestAmount,
            rolloverTargetDealName,
            notes: election.notes,
            submittedAt: timestamp
          });
        } catch (error) {
          return {
            status: "failed",
            provider: "notification_error",
            localPath: null,
            errorMessage: error.message,
            recipientEmail: managerRecipient.email
          };
        }
      })
    );

    return {
      dealId: normalizedDealId,
      participantId: targetParticipantId,
      electionMode: election.electionMode,
      totalPayout,
      reinvestAmount,
      cashPayoutAmount,
      rolloverTargetDealId,
      approvalStatus: "pending",
      managerOverride: false,
      reviewedAt: null,
      payoutExpectedOn: null,
      notifications
    };
  }

  if (existingElection?.approvalStatus === "approved") {
    throw new Error("This distribution election has already been approved and applied.");
  }

  const submittedByUserId = existingElection?.submittedByUserId ?? user.id;
  const submittedByRole = existingElection?.submittedByRole ?? "manager";
  const managerOverride = Boolean(
    existingElection?.id &&
      existingElection.submittedByRole === "investor" &&
      hasInstructionChange
  );
  const approvedTargetPositionId = await withTransaction(async (client) => {
    if (existingElection) {
      await client.query(
        `
          UPDATE distribution_elections
          SET
            election_mode = $1,
            reinvest_percent = $2,
            reinvest_amount = $3,
            rollover_target_deal_id = $4,
            notes = $5,
            submitted_by_user_id = $6,
            submitted_by_role = $7,
            approval_status = $8,
            approved_reinvest_amount = $9,
            approved_cash_payout_amount = $10,
            payout_expected_on = $11,
            reviewed_by_user_id = $12,
            reviewed_at = $13,
            manager_override = $14,
            override_notes = $15,
            updated_at = $16
          WHERE id = $17
        `,
        [
          election.electionMode,
          election.electionMode === "split_percentage" ? election.reinvestPercent : null,
          election.electionMode === "split_amount" ? reinvestAmount : null,
          rolloverTargetDealId,
          election.notes,
          submittedByUserId,
          submittedByRole,
          "approved",
          reinvestAmount > 0 ? reinvestAmount : 0,
          cashPayoutAmount > 0 ? cashPayoutAmount : 0,
          cashPayoutAmount > 0 ? payoutExpectedOn : null,
          user.id,
          timestamp,
          managerOverride ? 1 : 0,
          overrideNotes,
          timestamp,
          existingElection.id
        ]
      );
    } else {
      await client.query(
        `
          INSERT INTO distribution_elections (
            id,
            deal_id,
            participant_id,
            election_mode,
            reinvest_percent,
            reinvest_amount,
            rollover_target_deal_id,
            notes,
            submitted_by_user_id,
            submitted_by_role,
            approval_status,
            approved_reinvest_amount,
            approved_cash_payout_amount,
            payout_expected_on,
            reviewed_by_user_id,
            reviewed_at,
            manager_override,
            override_notes,
            created_at,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
          )
        `,
        [
          createId("distribution"),
          normalizedDealId,
          targetParticipantId,
          election.electionMode,
          election.electionMode === "split_percentage" ? election.reinvestPercent : null,
          election.electionMode === "split_amount" ? reinvestAmount : null,
          rolloverTargetDealId,
          election.notes,
          user.id,
          "manager",
          "approved",
          reinvestAmount > 0 ? reinvestAmount : 0,
          cashPayoutAmount > 0 ? cashPayoutAmount : 0,
          cashPayoutAmount > 0 ? payoutExpectedOn : null,
          user.id,
          timestamp,
          0,
          overrideNotes,
          timestamp,
          timestamp
        ]
      );
    }

    return applyApprovedReinvestmentAllocation({
      client,
      targetDealId: rolloverTargetDealId,
      participantId: targetParticipantId,
      classType: position.classType,
      amount: reinvestAmount
    });
  });

  const linkedInvestorUser = snapshot.users.find(
    (account) => account.participantId === targetParticipantId && account.role === "investor"
  );

  if (linkedInvestorUser?.email) {
    try {
      notifications = [
        await sendDistributionElectionApprovedNotification({
          userId: linkedInvestorUser.id,
          participantId: linkedInvestorUser.participantId,
          fullName: linkedInvestorUser.name,
          email: linkedInvestorUser.email,
          dealName: deal.name,
          electionMode: election.electionMode,
          approvedAt: timestamp,
          payoutExpectedOn: cashPayoutAmount > 0 ? payoutExpectedOn : null,
          payoutMethod: participant?.payoutMethod ?? "",
          cashPayoutAmount,
          reinvestAmount,
          rolloverTargetDealName,
          managerOverride,
          overrideNotes,
          notes: election.notes
        })
      ];
    } catch (error) {
      notifications = [
        {
          status: "failed",
          provider: "notification_error",
          localPath: null,
          errorMessage: error.message,
          recipientEmail: linkedInvestorUser.email
        }
      ];
    }
  }

  return {
    dealId: normalizedDealId,
    participantId: targetParticipantId,
    electionMode: election.electionMode,
    totalPayout,
    reinvestAmount,
    cashPayoutAmount,
    rolloverTargetDealId,
    approvedTargetPositionId,
    approvalStatus: "approved",
    managerOverride,
    reviewedAt: timestamp,
    payoutExpectedOn: cashPayoutAmount > 0 ? payoutExpectedOn : null,
    notifications
  };
}

export async function createDealIssue(input, createdByUserId) {
  const issue = normalizeIssueInput(input);
  const deal = await queryOne(
    `
      SELECT id, name
      FROM deals
      WHERE id = $1
    `,
    [issue.dealId]
  );

  if (!deal) {
    throw new Error("Deal not found.");
  }

  const recipients = await queryAll(
    `
      SELECT
        users.id AS "userId",
        users.participant_id AS "participantId",
        users.email AS email,
        participants.name AS "fullName",
        COALESCE(SUM(positions.contribution_amount), 0)::float AS "contributionAmount"
      FROM positions
      JOIN participants ON participants.id = positions.participant_id
      JOIN users ON users.participant_id = positions.participant_id
      WHERE positions.deal_id = $1
        AND participants.category = 'investor'
        AND users.is_active = 1
      GROUP BY users.id, users.participant_id, users.email, participants.name
      HAVING COALESCE(SUM(positions.contribution_amount), 0) > 0
      ORDER BY participants.name
    `,
    [issue.dealId]
  );
  const totalRecipientContribution = recipients.reduce(
    (sum, recipient) => sum + Number(recipient.contributionAmount ?? 0),
    0
  );

  const timestamp = nowTimestamp();
  const issueId = createId("issue");

  await pool.query(
    `
      INSERT INTO deal_issues (
        id,
        deal_id,
        title,
        description,
        approval_threshold,
        closes_on,
        created_by_user_id,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      issueId,
      issue.dealId,
      issue.title,
      issue.description,
      issue.approvalThreshold,
      issue.closesOn,
      createdByUserId,
      timestamp,
      timestamp
    ]
  );

  const notifications = await Promise.all(
    recipients.map(async (recipient) => {
      try {
        return await sendIssueCreatedNotification({
          userId: recipient.userId,
          participantId: recipient.participantId,
          fullName: recipient.fullName,
          email: recipient.email,
          dealName: deal.name,
          issueTitle: issue.title,
          issueDescription: issue.description,
          approvalThreshold: issue.approvalThreshold,
          closesOn: issue.closesOn,
          weightPct:
            totalRecipientContribution > 0
              ? Number(recipient.contributionAmount ?? 0) / totalRecipientContribution
              : 0
        });
      } catch (error) {
        return {
          status: "failed",
          provider: "notification_error",
          localPath: null,
          errorMessage: error.message,
          recipientEmail: recipient.email
        };
      }
    })
  );

  return {
    issue: {
      id: issueId,
      dealId: issue.dealId,
      closesOn: issue.closesOn,
      title: issue.title
    },
    notifications
  };
}

export async function castDealIssueVote(issueId, userId, voteChoiceInput) {
  const normalizedIssueId = String(issueId ?? "").trim();

  if (!normalizedIssueId) {
    throw new Error("Issue id is required.");
  }

  const voteChoice = normalizeVoteChoice(voteChoiceInput);
  const votingContext = await queryOne(
    `
      SELECT
        deal_issues.id AS id,
        deal_issues.deal_id AS "dealId",
        deal_issues.closes_on AS "closesOn",
        users.id AS "userId",
        users.participant_id AS "participantId",
        participants.category AS category,
        COALESCE(SUM(positions.contribution_amount), 0)::float AS "contributionAmount"
      FROM deal_issues
      JOIN users ON users.id = $2
      JOIN participants ON participants.id = users.participant_id
      LEFT JOIN positions
        ON positions.deal_id = deal_issues.deal_id
       AND positions.participant_id = users.participant_id
      WHERE deal_issues.id = $1
      GROUP BY deal_issues.id, deal_issues.deal_id, users.id, users.participant_id, participants.category
    `,
    [normalizedIssueId, userId]
  );

  if (!votingContext) {
    throw new Error("Issue not found.");
  }

  if (votingContext.category !== "investor") {
    throw new Error("Only investor participants can vote on major issues.");
  }

  if (Number(votingContext.contributionAmount) <= 0) {
    throw new Error("Only investors with capital in this deal can vote on this issue.");
  }

  if (votingContext.closesOn && todayStamp() > votingContext.closesOn) {
    throw new Error("Voting on this issue has already closed.");
  }

  const timestamp = nowTimestamp();

  await pool.query(
    `
      INSERT INTO deal_issue_votes (
        id,
        issue_id,
        participant_id,
        vote_choice,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (issue_id, participant_id)
      DO UPDATE SET
        vote_choice = EXCLUDED.vote_choice,
        updated_at = EXCLUDED.updated_at
    `,
    [
      createId("vote"),
      normalizedIssueId,
      votingContext.participantId,
      voteChoice,
      timestamp,
      timestamp
    ]
  );

  return {
    issueId: normalizedIssueId,
    participantId: votingContext.participantId,
    voteChoice
  };
}

export async function deleteDeal(dealId, actingUserId = null) {
  const id = String(dealId ?? "").trim();

  if (!id) {
    throw new Error("Deal id is required.");
  }

  const archive = await withTransaction(async (client) => {
    const existingDeal = await buildDealArchivePayload(id, client);

    if (!existingDeal) {
      throw new Error("Deal not found.");
    }

    const archiveRecord = await insertArchivedRecord(client, {
      entityType: "deal",
      entityId: id,
      sourceTable: "deals",
      displayName: existingDeal.deal?.name ?? id,
      relatedDealId: id,
      deletedByUserId: actingUserId,
      payload: existingDeal
    });

    await client.query(
      `
        DELETE FROM deals
        WHERE id = $1
      `,
      [id]
    );

    return archiveRecord;
  });

  return {
    ok: true,
    deletedDealId: id,
    archivedRecordId: archive.id
  };
}

export async function setUserAccountActive(userId, isActive, actingUserId) {
  const targetUser = await getUserAccountById(userId, { includeInactive: true });

  if (!targetUser) {
    throw new Error("User not found.");
  }

  if (targetUser.id === actingUserId) {
    throw new Error("You cannot change the status of your own account.");
  }

  const nextActive = Boolean(isActive);

  if (!nextActive && targetUser.role === "manager") {
    const activeManagers = await countActiveManagers();

    if (targetUser.isActive && activeManagers <= 1) {
      throw new Error("At least one active manager account must remain.");
    }
  }

  await pool.query(
    `
      UPDATE users
      SET is_active = $1, updated_at = $2
      WHERE id = $3
    `,
    [nextActive ? 1 : 0, nowTimestamp(), userId]
  );

  return getUserAccountById(userId, { includeInactive: true });
}

export async function deleteUserAccount(userId, actingUserId) {
  const targetUser = await getUserAccountById(userId, { includeInactive: true });

  if (!targetUser) {
    throw new Error("User not found.");
  }

  if (targetUser.id === actingUserId) {
    throw new Error("You cannot delete your own account.");
  }

  if (targetUser.role === "manager" && targetUser.isActive) {
    const activeManagers = await countActiveManagers();

    if (activeManagers <= 1) {
      throw new Error("At least one active manager account must remain.");
    }
  }

  const archive = await withTransaction(async (client) => {
    const archivePayload = await buildUserArchivePayload(userId, client);

    if (!archivePayload) {
      throw new Error("User not found.");
    }

    const archiveRecord = await insertArchivedRecord(client, {
      entityType: "user",
      entityId: userId,
      sourceTable: "users",
      displayName: archivePayload.user?.participant_name ?? targetUser.name ?? targetUser.email,
      relatedParticipantId: archivePayload.user?.participant_id ?? targetUser.participantId ?? null,
      deletedByUserId: actingUserId,
      payload: archivePayload
    });

    await client.query(
      `
        DELETE FROM users
        WHERE id = $1
      `,
      [userId]
    );

    return archiveRecord;
  });

  return {
    ok: true,
    deletedUserId: userId,
    archivedRecordId: archive.id
  };
}
