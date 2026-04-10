import { randomBytes, randomUUID, scryptSync } from "node:crypto";

import { seedData } from "./data.js";
import { assertDatabaseReady } from "./migrations.js";
import { sendCredentialNotification } from "./notifications.js";
import { pool, queryAll, queryOne, withTransaction } from "./postgres.js";

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

function normalizeConfigValue(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+#.*$/, "")
    .trim();
}

function roundNumber(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function createId(prefix) {
  return `${prefix}-${randomUUID()}`;
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
          debt_interest_rate,
          total_interest_paid,
          total_project_cost,
          sale_price,
          hold_months,
          pref_rate,
          status,
          current_phase,
          funded_on,
          projected_exit_on,
          actual_exit_on,
          timeline_progress,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      `,
      [
        deal.id,
        deal.name,
        deal.location,
        deal.totalEquity,
        deal.debt,
        deal.debtInterestRate ?? 0,
        deal.totalInterestPaid ?? 0,
        deal.totalProjectCost,
        deal.salePrice,
        deal.holdMonths,
        deal.prefRate,
        deal.status,
        deal.currentPhase,
        deal.fundedOn,
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
          contractor_participation,
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
        debt_interest_rate AS "debtInterestRate",
        total_interest_paid AS "totalInterestPaid",
        total_project_cost AS "totalProjectCost",
        sale_price AS "salePrice",
        hold_months AS "holdMonths",
        pref_rate AS "prefRate",
        status,
        current_phase AS "currentPhase",
        funded_on AS "fundedOn",
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

  const dealIssues = (await queryAll(
    `
      SELECT
        id,
        deal_id AS "dealId",
        title,
        description,
        approval_threshold AS "approvalThreshold",
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
  const payoutMethod = profile.payoutMethod;

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
        profile.bankAccountName,
        profile.bankName,
        profile.bankRoutingNumber,
        profile.bankAccountNumber,
        profile.zelleDetails,
        profile.cashAppHandle,
        profile.payoutNotes,
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
      SELECT id, name
      FROM deals
      WHERE id = $1
    `,
    [dealId]
  );

  if (!deal) {
    throw new Error("Deal not found.");
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
      SELECT id
      FROM positions
      WHERE deal_id = $1
        AND participant_id = $2
    `,
    [dealId, participantId]
  );

  if (existingPosition) {
    throw new Error("That participant already has a position in this deal.");
  }

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

    await syncDealEquity(dealId, client);
  });
}

function normalizeDealInput(input) {
  const name = String(input.name ?? "").trim();
  const location = String(input.location ?? "").trim();
  const currentPhase = String(input.currentPhase ?? "").trim();
  const status = String(input.status ?? "").trim();
  const fundedOn = String(input.fundedOn ?? "").trim();
  const projectedExitOn = String(input.projectedExitOn ?? "").trim();
  const actualExitOn = String(input.actualExitOn ?? "").trim();
  const debt = Number(input.debt);
  const debtInterestRate = Number(input.debtInterestRate ?? 0);
  const totalInterestPaid = Number(input.totalInterestPaid ?? 0);
  const totalProjectCost = Number(input.totalProjectCost);
  const salePrice = Number(input.salePrice);
  const holdMonths = Number(input.holdMonths);
  const prefRate = Number(input.prefRate);
  const timelineProgress = Number(input.timelineProgress);

  if (!name || !location || !currentPhase || !fundedOn) {
    throw new Error("Name, location, phase, and funded date are required.");
  }

  if (!["under_construction", "listed", "sold"].includes(status)) {
    throw new Error("Deal status is invalid.");
  }

  if (!Number.isFinite(debt) || debt < 0) {
    throw new Error("Debt must be zero or greater.");
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
    projectedExitOn: projectedExitOn || null,
    actualExitOn: actualExitOn || null,
    debt: roundNumber(debt),
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

  return {
    dealId,
    title,
    description,
    approvalThreshold: roundNumber(approvalThreshold)
  };
}

function normalizeVoteChoice(value) {
  const voteChoice = String(value ?? "").trim().toLowerCase();

  if (!["yes", "no"].includes(voteChoice)) {
    throw new Error("Vote choice must be either yes or no.");
  }

  return voteChoice;
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
          debt_interest_rate,
          total_interest_paid,
          total_project_cost,
          sale_price,
          hold_months,
          pref_rate,
          status,
          current_phase,
          funded_on,
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
          $19
        )
      `,
      [
        dealId,
        deal.name,
        deal.location,
        0,
        deal.debt,
        deal.debtInterestRate,
        deal.totalInterestPaid,
        deal.totalProjectCost,
        deal.salePrice,
        deal.holdMonths,
        deal.prefRate,
        deal.status,
        deal.currentPhase,
        deal.fundedOn,
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

  return queryOne(
    `
      SELECT id, name
      FROM deals
      WHERE id = $1
    `,
    [dealId]
  );
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
          debt_interest_rate = $4,
          total_interest_paid = $5,
          total_project_cost = $6,
          sale_price = $7,
          hold_months = $8,
          pref_rate = $9,
          status = $10,
          current_phase = $11,
          funded_on = $12,
          projected_exit_on = $13,
          actual_exit_on = $14,
          timeline_progress = $15,
          updated_at = $16
        WHERE id = $17
      `,
      [
        deal.name,
        deal.location,
        deal.debt,
        deal.debtInterestRate,
        deal.totalInterestPaid,
        deal.totalProjectCost,
        deal.salePrice,
        deal.holdMonths,
        deal.prefRate,
        deal.status,
        deal.currentPhase,
        deal.fundedOn,
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
        created_by_user_id,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      issueId,
      issue.dealId,
      issue.title,
      issue.description,
      issue.approvalThreshold,
      createdByUserId,
      timestamp,
      timestamp
    ]
  );

  return {
    id: issueId,
    dealId: issue.dealId,
    title: issue.title
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

export async function deleteDeal(dealId) {
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

  await pool.query(
    `
      DELETE FROM deals
      WHERE id = $1
    `,
    [id]
  );

  return {
    ok: true,
    deletedDealId: id
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

  await pool.query(
    `
      DELETE FROM users
      WHERE id = $1
    `,
    [userId]
  );

  return {
    ok: true,
    deletedUserId: userId
  };
}
