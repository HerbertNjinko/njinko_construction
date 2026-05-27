import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

import { seedData } from "./data.js";

const DATA_DIR = join(process.cwd(), "data");
const DATABASE_PATH = join(DATA_DIR, "deal_app.db");
const SCHEMA_PATH = join(DATA_DIR, "schema.sql");

mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DATABASE_PATH);
db.exec("PRAGMA foreign_keys = ON;");
db.exec(readFileSync(SCHEMA_PATH, "utf8"));

initializeDatabase();

function nowTimestamp() {
  return new Date().toISOString();
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

function roundNumber(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function createId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

function runInTransaction(callback) {
  db.exec("BEGIN");

  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}

    throw error;
  }
}

function getTableCount(tableName) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");

  return {
    salt,
    hash
  };
}

function mapUserRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    participantId: row.participantId,
    role: row.role,
    name: row.name,
    email: row.email,
    category: row.category,
    passwordSalt: row.passwordSalt,
    passwordHash: row.passwordHash,
    isActive: Boolean(row.isActive)
  };
}

function syncDealEquity(dealId) {
  const totalEquity =
    db
      .prepare(
        `
          SELECT COALESCE(SUM(contribution_amount), 0) AS totalEquity
          FROM positions
          WHERE deal_id = ?
        `
      )
      .get(dealId).totalEquity ?? 0;

  db.prepare(
    `
      UPDATE deals
      SET total_equity = ?, updated_at = ?
      WHERE id = ?
    `
  ).run(roundNumber(totalEquity), nowTimestamp(), dealId);
}

function initializeDatabase() {
  if (getTableCount("participants") > 0) {
    return;
  }

  const timestamp = nowTimestamp();

  const insertParticipant = db.prepare(
    `
      INSERT INTO participants (id, name, category, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `
  );
  const insertUser = db.prepare(
    `
      INSERT INTO users (
        id,
        participant_id,
        role,
        email,
        password_salt,
        password_hash,
        is_active,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  );
  const insertDeal = db.prepare(
    `
      INSERT INTO deals (
        id,
        name,
        location,
        total_equity,
        debt,
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  );
  const insertPromoteTier = db.prepare(
    `
      INSERT INTO promote_tiers (
        id,
        deal_id,
        label,
        hurdle,
        investor_share,
        sponsor_share,
        sort_order,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  );
  const insertTimelineItem = db.prepare(
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  );
  const insertPosition = db.prepare(
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  );
  const insertContractor = db.prepare(
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  );

  runInTransaction(() => {
    for (const participant of seedData.participants) {
      insertParticipant.run(
        participant.id,
        participant.name,
        participant.category,
        timestamp,
        timestamp
      );
    }

    for (const user of seedData.users) {
      insertUser.run(
        user.id,
        user.participantId,
        user.role,
        normalizeEmail(user.email),
        user.passwordSalt,
        user.passwordHash,
        1,
        timestamp,
        timestamp
      );
    }

    for (const deal of seedData.deals) {
      insertDeal.run(
        deal.id,
        deal.name,
        deal.location,
        deal.totalEquity,
        deal.debt,
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
      );

      for (const [index, tier] of deal.promoteTiers.entries()) {
        insertPromoteTier.run(
          createId("tier"),
          deal.id,
          tier.label,
          tier.hurdle,
          tier.investorShare,
          tier.sponsorShare,
          index + 1,
          timestamp,
          timestamp
        );
      }

      for (const [index, milestone] of deal.timeline.entries()) {
        insertTimelineItem.run(
          createId("timeline"),
          deal.id,
          milestone.label,
          milestone.date,
          milestone.status,
          index + 1,
          timestamp,
          timestamp
        );
      }
    }

    for (const position of seedData.positions) {
      insertPosition.run(
        position.id,
        position.dealId,
        position.participantId,
        position.classType,
        position.contributionType,
        position.contributionAmount,
        position.distributionsToDate ?? 0,
        timestamp,
        timestamp
      );
    }

    for (const contractor of seedData.contractors) {
      insertContractor.run(
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
      );
    }

    for (const deal of seedData.deals) {
      syncDealEquity(deal.id);
    }
  });
}

export function getUserByEmail(email) {
  const row = db
    .prepare(
      `
        SELECT
          users.id AS id,
          users.participant_id AS participantId,
          users.role AS role,
          participants.name AS name,
          participants.category AS category,
          users.email AS email,
          users.password_salt AS passwordSalt,
          users.password_hash AS passwordHash,
          users.is_active AS isActive
        FROM users
        JOIN participants ON participants.id = users.participant_id
        WHERE LOWER(users.email) = ?
          AND users.is_active = 1
      `
    )
    .get(normalizeEmail(email));

  return mapUserRow(row);
}

export function getUserById(userId) {
  const row = db
    .prepare(
      `
        SELECT
          users.id AS id,
          users.participant_id AS participantId,
          users.role AS role,
          participants.name AS name,
          participants.category AS category,
          users.email AS email,
          users.password_salt AS passwordSalt,
          users.password_hash AS passwordHash,
          users.is_active AS isActive
        FROM users
        JOIN participants ON participants.id = users.participant_id
        WHERE users.id = ?
          AND users.is_active = 1
      `
    )
    .get(userId);

  return mapUserRow(row);
}

export function getAppDataSnapshot() {
  const participants = db
    .prepare(
      `
        SELECT id, name, category
        FROM participants
        ORDER BY name
      `
    )
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category
    }));

  const users = db
    .prepare(
      `
        SELECT
          users.id AS id,
          users.participant_id AS participantId,
          users.role AS role,
          participants.name AS name,
          participants.category AS category,
          users.email AS email,
          users.password_salt AS passwordSalt,
          users.password_hash AS passwordHash,
          users.is_active AS isActive
        FROM users
        JOIN participants ON participants.id = users.participant_id
        WHERE users.is_active = 1
        ORDER BY participants.name
      `
    )
    .all()
    .map((row) => mapUserRow(row));

  const deals = db
    .prepare(
      `
        SELECT
          id,
          name,
          location,
          total_equity AS totalEquity,
          debt,
          total_project_cost AS totalProjectCost,
          sale_price AS salePrice,
          hold_months AS holdMonths,
          pref_rate AS prefRate,
          status,
          current_phase AS currentPhase,
          funded_on AS fundedOn,
          projected_exit_on AS projectedExitOn,
          actual_exit_on AS actualExitOn,
          timeline_progress AS timelineProgress
        FROM deals
        ORDER BY name
      `
    )
    .all()
    .map((row) => ({
      ...row,
      totalEquity: Number(row.totalEquity),
      debt: Number(row.debt),
      totalProjectCost: Number(row.totalProjectCost),
      salePrice: Number(row.salePrice),
      holdMonths: Number(row.holdMonths),
      prefRate: Number(row.prefRate),
      timelineProgress: Number(row.timelineProgress),
      promoteTiers: [],
      timeline: []
    }));

  const dealMap = new Map(deals.map((deal) => [deal.id, deal]));

  for (const row of db
    .prepare(
      `
        SELECT
          deal_id AS dealId,
          label,
          hurdle,
          investor_share AS investorShare,
          sponsor_share AS sponsorShare,
          sort_order AS sortOrder
        FROM promote_tiers
        ORDER BY deal_id, sort_order
      `
    )
    .all()) {
    dealMap.get(row.dealId)?.promoteTiers.push({
      label: row.label,
      hurdle: Number(row.hurdle),
      investorShare: Number(row.investorShare),
      sponsorShare: Number(row.sponsorShare),
      description: `${row.label} promote hurdle`,
      sortOrder: Number(row.sortOrder)
    });
  }

  for (const row of db
    .prepare(
      `
        SELECT
          deal_id AS dealId,
          label,
          milestone_date AS date,
          status,
          sort_order AS sortOrder
        FROM deal_timeline_items
        ORDER BY deal_id, sort_order
      `
    )
    .all()) {
    dealMap.get(row.dealId)?.timeline.push({
      label: row.label,
      date: row.date,
      status: row.status,
      sortOrder: Number(row.sortOrder)
    });
  }

  const positions = db
    .prepare(
      `
        SELECT
          id,
          deal_id AS dealId,
          participant_id AS participantId,
          class_type AS classType,
          contribution_type AS contributionType,
          contribution_amount AS contributionAmount,
          distributions_to_date AS distributionsToDate
        FROM positions
        ORDER BY deal_id, participant_id
      `
    )
    .all()
    .map((row) => ({
      ...row,
      contributionAmount: Number(row.contributionAmount),
      distributionsToDate: Number(row.distributionsToDate)
    }));

  const contractors = db
    .prepare(
      `
        SELECT
          contractor_participation.id AS id,
          contractor_participation.deal_id AS dealId,
          contractor_participation.participant_id AS participantId,
          participants.name AS contractorName,
          contractor_participation.trade AS trade,
          contractor_participation.total_contract_value AS totalContractValue,
          contractor_participation.cash_paid AS cashPaid,
          contractor_participation.deferred_amount AS deferredAmount,
          contractor_participation.contribution_type AS contributionType,
          contractor_participation.hybrid AS hybrid,
          contractor_participation.status AS status
        FROM contractor_participation
        JOIN participants ON participants.id = contractor_participation.participant_id
        ORDER BY contractor_participation.deal_id, participants.name
      `
    )
    .all()
    .map((row) => ({
      ...row,
      totalContractValue: Number(row.totalContractValue),
      cashPaid: Number(row.cashPaid),
      deferredAmount: Number(row.deferredAmount),
      hybrid: Boolean(row.hybrid)
    }));

  return {
    asOfDate: todayStamp(),
    participants,
    users,
    deals,
    positions,
    contractors
  };
}

export function createManagedUser({ category, name, email, password }) {
  const normalizedCategory = String(category).trim();
  const normalizedName = String(name).trim();
  const normalizedEmail = normalizeEmail(email);
  const normalizedPassword = String(password);

  if (!["investor", "contractor"].includes(normalizedCategory)) {
    throw new Error("User category must be investor or contractor.");
  }

  if (normalizedName.length < 2) {
    throw new Error("Name must be at least 2 characters.");
  }

  if (!normalizedEmail.includes("@")) {
    throw new Error("A valid email is required.");
  }

  if (normalizedPassword.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const existingUser = getUserByEmail(normalizedEmail);

  if (existingUser) {
    throw new Error("A user with that email already exists.");
  }

  const passwordRecord = hashPassword(normalizedPassword);
  const timestamp = nowTimestamp();
  const participantId = createId("participant");
  const userId = createId("user");

  runInTransaction(() => {
    db.prepare(
      `
        INSERT INTO participants (id, name, category, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `
    ).run(participantId, normalizedName, normalizedCategory, timestamp, timestamp);

    db.prepare(
      `
        INSERT INTO users (
          id,
          participant_id,
          role,
          email,
          password_salt,
          password_hash,
          is_active,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      userId,
      participantId,
      "investor",
      normalizedEmail,
      passwordRecord.salt,
      passwordRecord.hash,
      1,
      timestamp,
      timestamp
    );
  });

  return getUserById(userId);
}

export function createDealAllocation(input) {
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

  const deal = db
    .prepare(
      `
        SELECT id, name
        FROM deals
        WHERE id = ?
      `
    )
    .get(dealId);

  if (!deal) {
    throw new Error("Deal not found.");
  }

  const participant = db
    .prepare(
      `
        SELECT id, name, category
        FROM participants
        WHERE id = ?
      `
    )
    .get(participantId);

  if (!participant) {
    throw new Error("Participant not found.");
  }

  const existingPosition = db
    .prepare(
      `
        SELECT id
        FROM positions
        WHERE deal_id = ?
          AND participant_id = ?
      `
    )
    .get(dealId, participantId);

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

  runInTransaction(() => {
    db.prepare(
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      positionId,
      dealId,
      participantId,
      classType,
      contributionType || (participant.category === "contractor" ? "Deferred compensation" : "Cash equity"),
      roundNumber(contributionAmount),
      0,
      timestamp,
      timestamp
    );

    if (participant.category === "contractor") {
      db.prepare(
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
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
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
      );
    }

    syncDealEquity(dealId);
  });
}

export function updateDeal(dealId, input) {
  const id = String(dealId ?? "").trim();

  if (!id) {
    throw new Error("Deal id is required.");
  }

  const existingDeal = db
    .prepare(
      `
        SELECT id
        FROM deals
        WHERE id = ?
      `
    )
    .get(id);

  if (!existingDeal) {
    throw new Error("Deal not found.");
  }

  const name = String(input.name ?? "").trim();
  const location = String(input.location ?? "").trim();
  const currentPhase = String(input.currentPhase ?? "").trim();
  const status = String(input.status ?? "").trim();
  const fundedOn = String(input.fundedOn ?? "").trim();
  const projectedExitOn = String(input.projectedExitOn ?? "").trim();
  const actualExitOn = String(input.actualExitOn ?? "").trim();
  const debt = Number(input.debt);
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

  db.prepare(
    `
      UPDATE deals
      SET
        name = ?,
        location = ?,
        debt = ?,
        total_project_cost = ?,
        sale_price = ?,
        hold_months = ?,
        pref_rate = ?,
        status = ?,
        current_phase = ?,
        funded_on = ?,
        projected_exit_on = ?,
        actual_exit_on = ?,
        timeline_progress = ?,
        updated_at = ?
      WHERE id = ?
    `
  ).run(
    name,
    location,
    roundNumber(debt),
    roundNumber(totalProjectCost),
    roundNumber(salePrice),
    Math.round(holdMonths),
    prefRate,
    status,
    currentPhase,
    fundedOn,
    projectedExitOn || null,
    actualExitOn || null,
    Math.round(timelineProgress),
    nowTimestamp(),
    id
  );
}
