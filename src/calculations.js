import { seedData } from "./data.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 30.4375;

export function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function monthsBetween(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return 0;
  }

  return (end - start) / MS_PER_DAY / DAYS_PER_MONTH;
}

export function annualizedIrr(totalEquity, equityProceeds, holdMonths) {
  if (totalEquity <= 0 || holdMonths <= 0) {
    return 0;
  }

  if (equityProceeds <= 0) {
    return -1;
  }

  return Math.pow(equityProceeds / totalEquity, 12 / holdMonths) - 1;
}

export function statusLabel(status) {
  const labels = {
    under_construction: "Under construction",
    listed: "Listed",
    sold: "Sold"
  };

  return labels[status] ?? status;
}

function resolveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveTimelineProgress(status, timelineProgress) {
  const progress = Math.max(0, Math.min(100, resolveNumber(timelineProgress, 0)));
  return status === "sold" ? 100 : progress;
}

function normalizeProjectCost(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return roundCurrency(Math.max(0, resolveNumber(value, 0)));
}

function sortDebtServiceEntries(entries = []) {
  return [...entries].sort((left, right) =>
    String(left?.serviceMonth ?? "").localeCompare(String(right?.serviceMonth ?? ""))
  );
}

function sortExpenseEntries(entries = []) {
  return [...entries].sort(
    (left, right) => resolveNumber(left?.sortOrder, 0) - resolveNumber(right?.sortOrder, 0)
  );
}

function summarizeDealFinancing(deal, overrides = {}) {
  const budgetedProjectCost = roundCurrency(
    Math.max(
      0,
      resolveNumber(
        overrides.budgetedProjectCost,
        deal.budgetedProjectCost ?? deal.totalProjectCost ?? 0
      )
    )
  );
  const explicitProjectCostOverride = normalizeProjectCost(overrides.totalProjectCost);
  const expenseEntries = Array.isArray(overrides.expenseEntries)
    ? sortExpenseEntries(overrides.expenseEntries)
    : sortExpenseEntries(deal.expenseEntries ?? []);
  const actualOverride =
    explicitProjectCostOverride !== null
      ? explicitProjectCostOverride
      : overrides.actualProjectCost === undefined
        ? deal.actualProjectCost
        : overrides.actualProjectCost;
  const normalizedActualOverride = normalizeProjectCost(actualOverride);
  const hasTrackedProjectCost =
    explicitProjectCostOverride !== null ||
    expenseEntries.length > 0 ||
    normalizedActualOverride !== null;
  const actualProjectCost = hasTrackedProjectCost
    ? roundCurrency(
        explicitProjectCostOverride !== null
          ? explicitProjectCostOverride
          : expenseEntries.length
          ? expenseEntries.reduce((sum, entry) => sum + resolveNumber(entry?.amountPaid, 0), 0)
          : normalizedActualOverride
      )
    : 0;
  const debtServiceEntries = Array.isArray(overrides.debtServiceEntries)
    ? sortDebtServiceEntries(overrides.debtServiceEntries)
    : sortDebtServiceEntries(deal.debtServiceEntries ?? []);
  const derivedInterestPaid = roundCurrency(
    debtServiceEntries.reduce((sum, entry) => sum + resolveNumber(entry?.interestPaid, 0), 0)
  );
  const totalInterestPaid = roundCurrency(
    Math.max(
      0,
      resolveNumber(
        overrides.totalInterestPaid,
        debtServiceEntries.length ? derivedInterestPaid : deal.totalInterestPaid ?? 0
      )
    )
  );
  const derivedTotalDebt = roundCurrency(
    debtServiceEntries.reduce((sum, entry) => sum + resolveNumber(entry?.drawBalance, 0), 0)
  );
  const totalDebt = roundCurrency(
    Math.max(0, debtServiceEntries.length ? derivedTotalDebt : resolveNumber(deal.debt, 0))
  );
  const latestDebtServiceEntry = debtServiceEntries.at(-1) ?? null;
  const latestDrawBalance = roundCurrency(
    Math.max(0, resolveNumber(overrides.latestDrawBalance, latestDebtServiceEntry?.drawBalance ?? 0))
  );
  const effectiveProjectCost = hasTrackedProjectCost ? actualProjectCost : budgetedProjectCost;
  const projectCostVariance =
    hasTrackedProjectCost ? roundCurrency(actualProjectCost - budgetedProjectCost) : null;
  const projectCostVariancePct =
    !hasTrackedProjectCost || budgetedProjectCost <= 0
      ? null
      : projectCostVariance / budgetedProjectCost;

  return {
    budgetedProjectCost,
    actualProjectCost,
    hasTrackedProjectCost,
    effectiveProjectCost,
    projectCostVariance,
    projectCostVariancePct,
    totalInterestPaid,
    totalDebt,
    expenseEntries,
    debtServiceEntries,
    latestDebtServiceEntry,
    latestDrawBalance
  };
}

export function getTriggeredTier(projectIrr, tiers) {
  if (!tiers.length) {
    return null;
  }

  let activeTier = tiers[0];

  for (const tier of tiers) {
    if (projectIrr >= tier.hurdle) {
      activeTier = tier;
    }
  }

  return activeTier;
}

export function calculateWaterfall({ deal, positions, overrides = {} }) {
  const salePrice = resolveNumber(overrides.salePrice, deal.salePrice);
  const holdMonths = resolveNumber(overrides.holdMonths, deal.holdMonths);
  const prefRate = resolveNumber(overrides.prefRate, deal.prefRate);
  const debt = resolveNumber(overrides.debt, deal.debt);
  const taxExpense = roundCurrency(Math.max(0, resolveNumber(overrides.taxExpense, deal.taxExpense)));
  const financing = summarizeDealFinancing(deal, overrides);
  const totalInterestPaid = financing.totalInterestPaid;
  const promoteTiers = (deal.promoteTiers ?? []).filter((tier) => tier.isEnabled !== false);

  const totalEquity = roundCurrency(
    positions.reduce((sum, position) => sum + position.contributionAmount, 0)
  );
  const projectCostBasis = roundCurrency(
    financing.effectiveProjectCost + taxExpense + totalInterestPaid
  );
  const netProjectProfit = roundCurrency(salePrice - projectCostBasis);
  const distributableEquity = roundCurrency(Math.max(0, totalEquity + netProjectProfit));
  const costRecoveryShortfall = roundCurrency(Math.max(0, -netProjectProfit));
  const hasClearedCostRecovery = netProjectProfit > 0;
  const capitalPool = roundCurrency(Math.min(distributableEquity, totalEquity));
  const prefTargets = positions.map((position) => ({
    positionId: position.id,
    prefTarget: roundCurrency(position.contributionAmount * prefRate * (holdMonths / 12))
  }));
  const totalPrefTarget = roundCurrency(
    prefTargets.reduce((sum, item) => sum + item.prefTarget, 0)
  );
  const profitEligiblePool = roundCurrency(
    hasClearedCostRecovery
      ? Math.max(0, Math.min(netProjectProfit, distributableEquity - capitalPool))
      : 0
  );
  const prefPool = roundCurrency(
    Math.min(profitEligiblePool, totalPrefTarget)
  );
  const remainingAfterPref = roundCurrency(
    Math.max(profitEligiblePool - prefPool, 0)
  );
  const grossIrrProceeds = roundCurrency(capitalPool + profitEligiblePool);
  const projectIrr = annualizedIrr(totalEquity, grossIrrProceeds, holdMonths);
  const activeTier = hasClearedCostRecovery ? getTriggeredTier(projectIrr, promoteTiers) : null;
  const sponsorPromote = roundCurrency(
    remainingAfterPref * (activeTier?.sponsorShare ?? 0)
  );
  const investorProfitPool = roundCurrency(remainingAfterPref - sponsorPromote);
  const returnOnCost = projectCostBasis > 0 ? netProjectProfit / projectCostBasis : 0;

  const participantResults = positions.map((position) => {
    const ownershipShare = totalEquity > 0 ? position.contributionAmount / totalEquity : 0;
    const prefTarget =
      prefTargets.find((item) => item.positionId === position.id)?.prefTarget ?? 0;
    const capitalReturned = roundCurrency(capitalPool * ownershipShare);
    const prefEarned = roundCurrency(
      totalPrefTarget > 0 ? prefPool * (prefTarget / totalPrefTarget) : 0
    );
    const profitShare = roundCurrency(investorProfitPool * ownershipShare);
    const totalPayout = roundCurrency(capitalReturned + prefEarned + profitShare);

    return {
      positionId: position.id,
      participantId: position.participantId,
      classType: position.classType,
      contributionAmount: position.contributionAmount,
      ownershipPct: ownershipShare,
      capitalReturned,
      prefEarned,
      profitShare,
      totalPayout
    };
  });

  const classBreakdown = [...new Set(positions.map((position) => position.classType))]
    .sort()
    .map((classType) => {
      const classRows = participantResults.filter((row) => row.classType === classType);

      return {
        classType,
        contributionAmount: roundCurrency(
          classRows.reduce((sum, row) => sum + row.contributionAmount, 0)
        ),
        capitalReturned: roundCurrency(
          classRows.reduce((sum, row) => sum + row.capitalReturned, 0)
        ),
        prefEarned: roundCurrency(classRows.reduce((sum, row) => sum + row.prefEarned, 0)),
        profitShare: roundCurrency(classRows.reduce((sum, row) => sum + row.profitShare, 0)),
        totalPayout: roundCurrency(classRows.reduce((sum, row) => sum + row.totalPayout, 0))
      };
    });

  return {
    salePrice,
    debt,
    taxExpense,
    totalInterestPaid,
    holdMonths,
    prefRate,
    totalEquity,
    totalDebt: financing.totalDebt,
    distributableEquity,
    grossIrrProceeds,
    projectProfit: netProjectProfit,
    budgetedProjectCost: financing.budgetedProjectCost,
    actualProjectCost: financing.actualProjectCost,
    totalProjectCost: financing.actualProjectCost,
    hasTrackedProjectCost: financing.hasTrackedProjectCost,
    effectiveProjectCost: financing.effectiveProjectCost,
    projectCostVariance: financing.projectCostVariance,
    projectCostVariancePct: financing.projectCostVariancePct,
    expenseEntries: financing.expenseEntries,
    debtServiceEntries: financing.debtServiceEntries,
    latestDrawBalance: financing.latestDrawBalance,
    projectCostBasis,
    netProjectProfit,
    costRecoveryShortfall,
    hasClearedCostRecovery,
    preferredReturnPaid: prefPool,
    returnOnCost,
    totalPrefTarget,
    projectIrr,
    activeTier,
    sponsorPromote,
    investorProfitPool,
    participantResults,
    classBreakdown,
    waterfallSteps: [
      {
        label: "Interest paid",
        amount: totalInterestPaid
      },
      {
        label: "Tax expense",
        amount: taxExpense
      },
      {
        label: "Capital returned",
        amount: capitalPool
      },
      {
        label: hasClearedCostRecovery
          ? "Preferred return"
          : "Preferred return (blocked until cost recovery)",
        amount: prefPool
      },
      {
        label: hasClearedCostRecovery
          ? "Investor profit pool"
          : "Investor profit pool (blocked until cost recovery)",
        amount: investorProfitPool
      },
      {
        label: hasClearedCostRecovery
          ? "Sponsor promote"
          : "Sponsor promote (blocked until cost recovery)",
        amount: sponsorPromote
      },
      ...(hasClearedCostRecovery
        ? []
        : [
            {
              label: "Cost recovery shortfall",
              amount: costRecoveryShortfall
            }
          ])
    ]
  };
}

function getParticipantMap(data) {
  return new Map(data.participants.map((participant) => [participant.id, participant]));
}

function getPositionResultMap(participantResults) {
  return new Map(participantResults.map((row) => [row.positionId, row]));
}

function getUserMapById(data) {
  return new Map((data.users ?? []).map((user) => [user.id, user]));
}

function getUserMapByParticipantId(data) {
  return new Map((data.users ?? []).map((user) => [user.participantId, user]));
}

function calculateCurrentPref(position, deal, asOfDate) {
  const stopDate = deal.status === "sold" ? deal.actualExitOn : asOfDate;
  const monthsAccrued = Math.min(monthsBetween(deal.fundedOn, stopDate), deal.holdMonths);

  return roundCurrency(position.contributionAmount * deal.prefRate * (monthsAccrued / 12));
}

function calculateProjectedPref(position, deal) {
  return roundCurrency(position.contributionAmount * deal.prefRate * (deal.holdMonths / 12));
}

function buildProfilePayload(user, participant) {
  return {
    firstName: participant?.firstName ?? "",
    middleName: participant?.middleName ?? "",
    lastName: participant?.lastName ?? "",
    fullName: participant?.name ?? user.name,
    email: user.email,
    contactPhone: participant?.contactPhone ?? "",
    currentAddress: participant?.currentAddress ?? "",
    mailingAddress: participant?.mailingAddress ?? "",
    driverLicenseNumber: participant?.driverLicenseNumber ?? "",
    idCardFileName: participant?.idCardFileName ?? "",
    hasIdCard: Boolean(participant?.hasIdCard),
    idDocumentIssueDate: participant?.idDocumentIssueDate ?? "",
    idDocumentExpirationDate: participant?.idDocumentExpirationDate ?? "",
    payoutMethod: participant?.payoutMethod ?? "",
    bankAccountName: participant?.bankAccountName ?? "",
    bankName: participant?.bankName ?? "",
    bankRoutingNumber: participant?.bankRoutingNumber ?? "",
    bankAccountNumber: participant?.bankAccountNumber ?? "",
    zelleDetails: participant?.zelleDetails ?? "",
    cashAppHandle: participant?.cashAppHandle ?? "",
    payoutNotes: participant?.payoutNotes ?? ""
  };
}

function buildPayoutInstructionPayload(participant) {
  return {
    payoutMethod: participant?.payoutMethod ?? "",
    bankAccountName: participant?.bankAccountName ?? "",
    bankName: participant?.bankName ?? "",
    bankRoutingNumber: participant?.bankRoutingNumber ?? "",
    bankAccountNumber: participant?.bankAccountNumber ?? "",
    zelleDetails: participant?.zelleDetails ?? "",
    cashAppHandle: participant?.cashAppHandle ?? "",
    payoutNotes: participant?.payoutNotes ?? ""
  };
}

function getDistributionElectionMap(data) {
  return new Map(
    (data.distributionElections ?? []).map((election) => [
      `${election.dealId}:${election.participantId}`,
      election
    ])
  );
}

function getEarlyWithdrawalRequestMap(data) {
  return new Map(
    (data.earlyWithdrawalRequests ?? []).map((request) => [
      `${request.dealId}:${request.participantId}`,
      request
    ])
  );
}

function buildDistributionPlan({ deal, position, participant, result, election, dealMap }) {
  const totalPayout = roundCurrency(result?.totalPayout ?? 0);
  const actualPayoutAmount = roundCurrency(Math.max(0, position?.distributionsToDate ?? 0));
  let requestedReinvestAmount = 0;

  if (election?.electionMode === "reinvest_all") {
    requestedReinvestAmount = totalPayout;
  } else if (election?.electionMode === "split_percentage") {
    requestedReinvestAmount = roundCurrency(totalPayout * (election.reinvestPercent ?? 0));
  } else if (election?.electionMode === "split_amount") {
    requestedReinvestAmount = roundCurrency(election.reinvestAmount ?? 0);
  }

  requestedReinvestAmount = roundCurrency(
    Math.max(0, Math.min(requestedReinvestAmount, totalPayout))
  );
  const requestedCashPayoutAmount = roundCurrency(totalPayout - requestedReinvestAmount);
  const approvalStatus = election?.approvalStatus ?? (election?.reviewedAt ? "approved" : "pending");
  const approvedReinvestedAmount =
    approvalStatus === "approved"
      ? roundCurrency(
          Math.max(
            0,
            Math.min(
              election?.approvedReinvestAmount ?? requestedReinvestAmount,
              totalPayout
            )
          )
        )
      : 0;
  const approvedCashPayoutAmount =
    approvalStatus === "approved"
      ? roundCurrency(
          Math.max(
            0,
            election?.approvedCashPayoutAmount ?? (totalPayout - approvedReinvestedAmount)
          )
        )
      : 0;
  const remainingScheduledPayoutAmount = roundCurrency(
    Math.max(approvedCashPayoutAmount - actualPayoutAmount, 0)
  );

  return {
    hasElection: Boolean(election),
    canSetDistributionElection:
      deal.status === "sold" && totalPayout > 0 && approvalStatus !== "approved",
    electionMode: election?.electionMode ?? null,
    reinvestPercent: election?.reinvestPercent ?? null,
    requestedReinvestAmount: election?.reinvestAmount ?? null,
    requestedReinvestedAmount: requestedReinvestAmount,
    requestedCashPayoutAmount,
    actualPayoutAmount,
    reinvestedAmount: approvedReinvestedAmount,
    approvedReinvestedAmount,
    approvedCashPayoutAmount,
    pendingDistributionAmount: remainingScheduledPayoutAmount,
    remainingScheduledPayoutAmount,
    rolloverTargetDealId: election?.rolloverTargetDealId ?? null,
    rolloverTargetDealName: election?.rolloverTargetDealId
      ? dealMap.get(election.rolloverTargetDealId)?.name ?? null
      : null,
    notes: election?.notes ?? "",
    submittedByUserId: election?.submittedByUserId ?? null,
    submittedByRole: election?.submittedByRole ?? null,
    approvalStatus: election ? approvalStatus : "none",
    reviewedByUserId: election?.reviewedByUserId ?? null,
    reviewedAt: election?.reviewedAt ?? null,
    managerOverride: Boolean(election?.managerOverride),
    overrideNotes: election?.overrideNotes ?? "",
    payoutExpectedOn: election?.payoutExpectedOn ?? null,
    createdAt: election?.createdAt ?? null,
    updatedAt: election?.updatedAt ?? null,
    payoutMethod: participant?.payoutMethod ?? "",
    totalPayout
  };
}

function buildEarlyWithdrawalPlan({ deal, position, participant, request }) {
  const currentContributionAmount = roundCurrency(Math.max(0, position?.contributionAmount ?? 0));
  const requestedCapitalAmount = roundCurrency(
    Math.max(0, request?.requestedCapitalAmount ?? currentContributionAmount)
  );
  const penaltyRate = Math.max(
    0,
    Math.min(1, Number(request?.penaltyRate ?? deal?.earlyWithdrawalPenaltyRate ?? 0.3))
  );
  const penaltyAmount = roundCurrency(
    Math.max(0, request?.penaltyAmount ?? requestedCapitalAmount * penaltyRate)
  );
  const estimatedPayoutAmount = roundCurrency(Math.max(requestedCapitalAmount - penaltyAmount, 0));
  const requestStatus = request?.requestStatus ?? "none";

  return {
    hasRequest: Boolean(request),
    canRequest:
      (deal?.status ?? "sold") !== "sold" &&
      currentContributionAmount > 0 &&
      requestStatus !== "approved",
    requestStatus,
    classType: position?.classType ?? request?.classType ?? null,
    currentContributionAmount,
    requestedCapitalAmount,
    penaltyRate,
    penaltyAmount,
    estimatedPayoutAmount,
    approvedPayoutAmount:
      requestStatus === "approved"
        ? roundCurrency(request?.approvedPayoutAmount ?? estimatedPayoutAmount)
        : 0,
    payoutExpectedOn: request?.payoutExpectedOn ?? null,
    investorNotes: request?.investorNotes ?? "",
    managerNotes: request?.managerNotes ?? "",
    submittedByUserId: request?.requestedByUserId ?? null,
    reviewedByUserId: request?.reviewedByUserId ?? null,
    reviewedAt: request?.reviewedAt ?? null,
    createdAt: request?.createdAt ?? null,
    updatedAt: request?.updatedAt ?? null,
    payoutMethod: participant?.payoutMethod ?? ""
  };
}

function buildGovernanceIssues(data, viewerParticipantId, { includeAll = false } = {}) {
  const participantMap = getParticipantMap(data);
  const dealMap = new Map(data.deals.map((deal) => [deal.id, deal]));
  const asOfDate = String(data.asOfDate ?? new Date().toISOString().slice(0, 10));
  const participantCapitalByDeal = new Map();
  const votesByIssue = new Map();

  for (const position of data.positions) {
    const participant = participantMap.get(position.participantId);

    if (!["investor", "contractor"].includes(participant?.category ?? "")) {
      continue;
    }

    if (!participantCapitalByDeal.has(position.dealId)) {
      participantCapitalByDeal.set(position.dealId, new Map());
    }

    const dealCapital = participantCapitalByDeal.get(position.dealId);
    dealCapital.set(
      position.participantId,
      roundCurrency((dealCapital.get(position.participantId) ?? 0) + position.contributionAmount)
    );
  }

  for (const vote of data.issueVotes ?? []) {
    if (!votesByIssue.has(vote.issueId)) {
      votesByIssue.set(vote.issueId, []);
    }

    votesByIssue.get(vote.issueId).push(vote);
  }

  return [...(data.dealIssues ?? [])]
    .sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")))
    .map((issue) => {
      const deal = dealMap.get(issue.dealId);
      const capitalByParticipant = participantCapitalByDeal.get(issue.dealId) ?? new Map();
      const eligibleInvestment = roundCurrency(
        [...capitalByParticipant.values()].reduce((sum, value) => sum + value, 0)
      );
      const relevantVotes = (votesByIssue.get(issue.id) ?? []).filter((vote) =>
        capitalByParticipant.has(vote.participantId)
      );
      const votesByParticipant = new Map(
        relevantVotes.map((vote) => [vote.participantId, vote])
      );
      let explicitYesInvestment = 0;
      let noInvestment = 0;

      for (const vote of relevantVotes) {
        const investedAmount = capitalByParticipant.get(vote.participantId) ?? 0;

        if (vote.voteChoice === "yes") {
          explicitYesInvestment += investedAmount;
        } else if (vote.voteChoice === "no") {
          noInvestment += investedAmount;
        }
      }

      const closesOn = issue.closesOn ?? null;
      const isClosed = Boolean(closesOn) && asOfDate > closesOn;
      const unresolvedInvestment = Math.max(
        0,
        eligibleInvestment - explicitYesInvestment - noInvestment
      );
      const assumedYesInvestment = isClosed ? unresolvedInvestment : 0;
      const pendingInvestment = isClosed ? 0 : unresolvedInvestment;
      const yesInvestment = explicitYesInvestment + assumedYesInvestment;
      const yesPct = eligibleInvestment > 0 ? yesInvestment / eligibleInvestment : 0;
      const noPct = eligibleInvestment > 0 ? noInvestment / eligibleInvestment : 0;
      const pendingPct = eligibleInvestment > 0 ? pendingInvestment / eligibleInvestment : 0;
      const explicitYesPct =
        eligibleInvestment > 0 ? explicitYesInvestment / eligibleInvestment : 0;
      const assumedYesPct =
        eligibleInvestment > 0 ? assumedYesInvestment / eligibleInvestment : 0;
      const myInvestment = capitalByParticipant.get(viewerParticipantId) ?? 0;
      const myVote =
        relevantVotes.find((vote) => vote.participantId === viewerParticipantId)?.voteChoice ?? null;
      const isEligibleToVote = myInvestment > 0;
      let status = "open";

      if (isClosed && issue.resolutionResult === "passed") {
        status = "passed";
      } else if (isClosed && issue.resolutionResult === "failed") {
        status = "failed";
      } else if (isClosed && eligibleInvestment > 0) {
        if (yesPct >= issue.approvalThreshold) {
          status = "passed";
        } else {
          status = "failed";
        }
      }

      const investorVotes = [...capitalByParticipant.entries()]
        .map(([participantId, investedAmount]) => {
          const participant = participantMap.get(participantId);
          const explicitVote = votesByParticipant.get(participantId)?.voteChoice ?? null;
          const finalVote = isClosed ? explicitVote ?? "assumed_yes" : explicitVote;

          return {
            participantId,
            participantName: participant?.name ?? "Participant",
            weightPct: eligibleInvestment > 0 ? investedAmount / eligibleInvestment : 0,
            explicitVote,
            finalVote,
            hasVoted: Boolean(explicitVote),
            isAssumedApproval: isClosed && !explicitVote
          };
        })
        .sort((left, right) => {
          if (right.weightPct !== left.weightPct) {
            return right.weightPct - left.weightPct;
          }

          return left.participantName.localeCompare(right.participantName);
        });
      const finalResults = isClosed ? investorVotes : [];

      return {
        id: issue.id,
        dealId: issue.dealId,
        dealName: deal?.name ?? "Deal",
        dealStatus: deal?.status ?? "under_construction",
        issueType: issue.issueType ?? "general",
        title: issue.title,
        description: issue.description,
        approvalThreshold: issue.approvalThreshold,
        proposedPenaltyRate: issue.proposedPenaltyRate ?? null,
        closesOn,
        isClosed,
        resolutionResult: issue.resolutionResult ?? null,
        resolutionAppliedAt: issue.resolutionAppliedAt ?? null,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        eligibleInvestment,
        eligibleVoterCount: capitalByParticipant.size,
        voteCount: relevantVotes.length,
        explicitYesInvestment: roundCurrency(explicitYesInvestment),
        assumedYesInvestment: roundCurrency(assumedYesInvestment),
        yesInvestment: roundCurrency(yesInvestment),
        noInvestment: roundCurrency(noInvestment),
        pendingInvestment: roundCurrency(pendingInvestment),
        explicitYesPct,
        assumedYesPct,
        yesPct,
        noPct,
        pendingPct,
        status,
        isEligibleToVote,
        canVote: isEligibleToVote && !isClosed,
        investorVotes,
        myVote,
        myWeightPct: eligibleInvestment > 0 ? myInvestment / eligibleInvestment : 0,
        finalResults
      };
    })
    .filter((issue) => includeAll || issue.isEligibleToVote);
}

function isDateClosed(dateValue, asOfDate) {
  const normalized = String(dateValue ?? "").trim();
  return Boolean(normalized && normalized < asOfDate);
}

function buildInvestorPoolViews(data, viewerParticipantId = null) {
  const participantMap = getParticipantMap(data);
  const userMapByParticipantId = getUserMapByParticipantId(data);
  const dealMap = new Map(data.deals.map((deal) => [deal.id, deal]));
  const positionMap = new Map(
    data.positions.map((position) => [`${position.dealId}:${position.participantId}`, position])
  );
  const asOfDate = String(data.asOfDate ?? new Date().toISOString().slice(0, 10));
  const poolCommitmentsByPool = new Map();
  const poolVotesByPool = new Map();
  const candidateDeals = data.deals.filter(
    (deal) => deal.status !== "sold" && !isDateClosed(deal.investmentCloseOn, asOfDate)
  );
  const waterfallCache = new Map();

  for (const commitment of data.investorPoolCommitments ?? []) {
    if (!poolCommitmentsByPool.has(commitment.poolId)) {
      poolCommitmentsByPool.set(commitment.poolId, []);
    }

    poolCommitmentsByPool.get(commitment.poolId).push(commitment);
  }

  for (const vote of data.investorPoolVotes ?? []) {
    if (!poolVotesByPool.has(vote.poolId)) {
      poolVotesByPool.set(vote.poolId, []);
    }

    poolVotesByPool.get(vote.poolId).push(vote);
  }

  function getWaterfallForDeal(dealId) {
    if (!waterfallCache.has(dealId)) {
      const deal = dealMap.get(dealId);
      const dealPositions = data.positions.filter((position) => position.dealId === dealId);
      waterfallCache.set(dealId, {
        deal,
        waterfall: deal ? calculateWaterfall({ deal, positions: dealPositions }) : null
      });
    }

    return waterfallCache.get(dealId);
  }

  return (data.investorPools ?? []).map((investmentPool) => {
    const commitments = [...(poolCommitmentsByPool.get(investmentPool.id) ?? [])].sort((left, right) => {
      const leftName = participantMap.get(left.participantId)?.name ?? "";
      const rightName = participantMap.get(right.participantId)?.name ?? "";
      return leftName.localeCompare(rightName);
    });
    const totalCommitted = roundCurrency(
      commitments.reduce((sum, commitment) => sum + commitment.commitmentAmount, 0)
    );
    const minimumCapitalAmount = roundCurrency(investmentPool.minimumCapitalAmount ?? 0);
    const amountRemaining = roundCurrency(Math.max(minimumCapitalAmount - totalCommitted, 0));
    const commitmentProgressPct =
      minimumCapitalAmount > 0 ? Math.min(totalCommitted / minimumCapitalAmount, 1) : 0;
    const myCommitmentRecord = commitments.find(
      (commitment) => commitment.participantId === viewerParticipantId
    );
    const myCommitmentAmount = roundCurrency(myCommitmentRecord?.commitmentAmount ?? 0);
    const mySharePct = totalCommitted > 0 ? myCommitmentAmount / totalCommitted : 0;
    const votes = poolVotesByPool.get(investmentPool.id) ?? [];
    const voteByParticipant = new Map(votes.map((vote) => [vote.participantId, vote]));
    const voteWeightByDeal = new Map();
    const voteCountByDeal = new Map();

    for (const vote of votes) {
      const commitmentAmount =
        commitments.find((commitment) => commitment.participantId === vote.participantId)
          ?.commitmentAmount ?? 0;
      voteWeightByDeal.set(
        vote.dealId,
        roundCurrency((voteWeightByDeal.get(vote.dealId) ?? 0) + commitmentAmount)
      );
      voteCountByDeal.set(vote.dealId, (voteCountByDeal.get(vote.dealId) ?? 0) + 1);
    }

    const voteResultSource = investmentPool.selectedDealId
      ? [
          ...(candidateDeals.some((deal) => deal.id === investmentPool.selectedDealId)
            ? candidateDeals
            : [dealMap.get(investmentPool.selectedDealId)].filter(Boolean))
        ]
      : candidateDeals;
    const voteSummary = voteResultSource
      .map((deal) => {
        const voteWeightAmount = roundCurrency(voteWeightByDeal.get(deal.id) ?? 0);
        const voteCount = Number(voteCountByDeal.get(deal.id) ?? 0);

        return {
          dealId: deal.id,
          dealName: deal.name,
          dealStatus: deal.status,
          dealStatusLabel: statusLabel(deal.status),
          voteWeightAmount,
          voteWeightPct: totalCommitted > 0 ? voteWeightAmount / totalCommitted : 0,
          voteCount,
          isSelectedDeal: investmentPool.selectedDealId === deal.id,
          isMyVote: voteByParticipant.get(viewerParticipantId)?.dealId === deal.id
        };
      })
      .filter((result) => result.voteWeightAmount > 0 || result.isSelectedDeal)
      .sort((left, right) => {
        if (right.voteWeightAmount !== left.voteWeightAmount) {
          return right.voteWeightAmount - left.voteWeightAmount;
        }

        return left.dealName.localeCompare(right.dealName);
      });
    const leadingWeightAmount = voteSummary[0]?.voteWeightAmount ?? 0;
    const leaders =
      leadingWeightAmount > 0
        ? voteSummary.filter((result) => result.voteWeightAmount === leadingWeightAmount)
        : [];
    const leadingDealId = leaders.length === 1 ? leaders[0].dealId : null;
    const selectedDeal = dealMap.get(investmentPool.selectedDealId) ?? null;
    const poolPosition = selectedDeal
      ? positionMap.get(`${selectedDeal.id}:${investmentPool.poolParticipantId}`) ?? null
      : null;
    const poolWaterfall = selectedDeal ? getWaterfallForDeal(selectedDeal.id) : null;
    const poolResult = poolPosition
      ? getPositionResultMap(poolWaterfall?.waterfall?.participantResults ?? []).get(poolPosition.id) ??
        null
      : null;
    const allMembersVoted = commitments.length > 0 && votes.length >= commitments.length;
    const votingClosed = isDateClosed(investmentPool.voteClosesOn, asOfDate);
    const currentPrefEarned =
      poolPosition && selectedDeal
        ? roundCurrency(calculateCurrentPref(poolPosition, selectedDeal, asOfDate) * mySharePct)
        : 0;
    const projectedPrefEarned =
      poolPosition && selectedDeal
        ? roundCurrency(
            (selectedDeal.status === "sold"
              ? poolResult?.prefEarned ?? 0
              : calculateProjectedPref(poolPosition, selectedDeal)) * mySharePct
          )
        : 0;
    const myEstimatedTotalReturn = roundCurrency((poolResult?.totalPayout ?? 0) * mySharePct);
    const myCapitalReturned = roundCurrency((poolResult?.capitalReturned ?? 0) * mySharePct);
    const myProfitReturned = roundCurrency(
      ((poolResult?.prefEarned ?? 0) + (poolResult?.profitShare ?? 0)) * mySharePct
    );
    const myActualPayoutAmount = roundCurrency((poolPosition?.distributionsToDate ?? 0) * mySharePct);
    const memberRows = commitments.map((commitment) => {
      const linkedParticipant = participantMap.get(commitment.participantId);
      const linkedUser = userMapByParticipantId.get(commitment.participantId);
      const vote = voteByParticipant.get(commitment.participantId) ?? null;

      return {
        participantId: commitment.participantId,
        participantName: linkedParticipant?.name ?? "Pooled member",
        participantEmail: linkedUser?.email ?? "",
        commitmentAmount: commitment.commitmentAmount,
        sharePct: totalCommitted > 0 ? commitment.commitmentAmount / totalCommitted : 0,
        votedDealId: vote?.dealId ?? null,
        votedDealName: vote?.dealId ? dealMap.get(vote.dealId)?.name ?? "Project" : null
      };
    });

    return {
      id: investmentPool.id,
      name: investmentPool.name,
      status: investmentPool.status,
      minimumCapitalAmount,
      totalCommitted,
      amountRemaining,
      commitmentProgressPct,
      voteClosesOn: investmentPool.voteClosesOn ?? null,
      fundedOn: investmentPool.fundedOn ?? null,
      selectedDealId: investmentPool.selectedDealId ?? null,
      selectedDealName: selectedDeal?.name ?? null,
      selectedDealStatus: selectedDeal?.status ?? null,
      selectedDealStatusLabel: selectedDeal ? statusLabel(selectedDeal.status) : null,
      memberCount: commitments.length,
      members: memberRows,
      allMembersVoted,
      votingClosed,
      canVote:
        Boolean(viewerParticipantId) &&
        myCommitmentAmount > 0 &&
        investmentPool.status === "voting" &&
        !investmentPool.selectedDealId &&
        !votingClosed,
      leadingDealId,
      leadingDealName: leadingDealId ? dealMap.get(leadingDealId)?.name ?? null : null,
      voteSummary,
      myCommitmentAmount,
      mySharePct,
      myVoteDealId: voteByParticipant.get(viewerParticipantId)?.dealId ?? null,
      canFund:
        investmentPool.status === "voting" &&
        totalCommitted >= minimumCapitalAmount &&
        (allMembersVoted || votingClosed) &&
        Boolean(leadingDealId),
      availableDeals: candidateDeals.map((deal) => ({
        id: deal.id,
        name: deal.name,
        status: deal.status,
        statusLabel: statusLabel(deal.status),
        investmentCloseOn: deal.investmentCloseOn ?? null
      })),
      jointPosition: poolPosition
        ? {
            dealId: poolPosition.dealId,
            amountInvested: poolPosition.contributionAmount,
            actualPayoutAmount: poolPosition.distributionsToDate,
            estimatedTotalReturn: roundCurrency(poolResult?.totalPayout ?? 0),
            capitalReturned: roundCurrency(poolResult?.capitalReturned ?? 0),
            profitReturned: roundCurrency(
              (poolResult?.prefEarned ?? 0) + (poolResult?.profitShare ?? 0)
            )
          }
        : null,
      project: selectedDeal
        ? {
            id: selectedDeal.id,
            name: selectedDeal.name,
            location: selectedDeal.location,
            status: selectedDeal.status,
            statusLabel: statusLabel(selectedDeal.status),
            currentPhase: selectedDeal.currentPhase,
            investmentCloseOn: selectedDeal.investmentCloseOn ?? null,
            timelineProgress: selectedDeal.status === "sold" ? 100 : selectedDeal.timelineProgress,
            timeline: selectedDeal.timeline,
            budgetedProjectCost:
              poolWaterfall?.waterfall?.budgetedProjectCost ??
              selectedDeal.budgetedProjectCost ??
              0,
            totalProjectCost:
              poolWaterfall?.waterfall?.totalProjectCost ?? selectedDeal.actualProjectCost ?? 0,
            effectiveProjectCost:
              poolWaterfall?.waterfall?.effectiveProjectCost ??
              selectedDeal.actualProjectCost ??
              selectedDeal.budgetedProjectCost ??
              0,
            projectCostVariance: poolWaterfall?.waterfall?.projectCostVariance ?? null,
            latestDrawBalance: poolWaterfall?.waterfall?.latestDrawBalance ?? 0,
            salePrice: poolWaterfall?.waterfall?.salePrice ?? selectedDeal.salePrice,
            salePriceLabel: selectedDeal.status === "sold" ? "Actual at exit" : "Projected at exit",
            totalEquity: poolWaterfall?.waterfall?.totalEquity ?? selectedDeal.totalEquity,
            debt: selectedDeal.debt,
            taxExpense: selectedDeal.taxExpense ?? 0,
            debtInterestRate: selectedDeal.debtInterestRate ?? 0,
            totalInterestPaid:
              poolWaterfall?.waterfall?.totalInterestPaid ?? selectedDeal.totalInterestPaid ?? 0,
            holdMonths: selectedDeal.holdMonths,
            fundedOn: selectedDeal.fundedOn,
            exitOn: selectedDeal.actualExitOn ?? selectedDeal.projectedExitOn
          }
        : null,
      myPosition: {
        amountInvested: selectedDeal ? myCommitmentAmount : 0,
        pendingCommittedAmount: selectedDeal ? 0 : myCommitmentAmount,
        sharePct: mySharePct,
        currentPrefEarned,
        projectedPrefEarned,
        estimatedTotalReturn: myEstimatedTotalReturn,
        capitalReturned: myCapitalReturned,
        profitReturned: myProfitReturned,
        totalAmountPayout: myActualPayoutAmount
      }
    };
  });
}

export function buildPoolMemberDashboard(user, data = seedData) {
  const participantMap = getParticipantMap(data);
  const participant = participantMap.get(user.participantId);
  const pools = buildInvestorPoolViews(data, user.participantId).filter(
    (pool) => pool.myCommitmentAmount > 0
  );
  const distributionProjects = buildPoolDistributionContexts(data, {
    participantId: user.participantId
  }).map((context) => ({
    id: context.dealId,
    name: context.dealName,
    location: context.sourcePoolNames.join(", "),
    currentPhase:
      context.sourcePoolNames.length === 1
        ? `Pooled through ${context.sourcePoolNames[0]}`
        : `Pooled through ${context.sourcePoolNames.length} capital groups`,
    status: "sold",
    personalPosition: {
      totalPayout: context.totalPayout,
      profitEarned: context.profitReturned,
      distributionElection: context.distributionPlan
    },
    reinvestmentTargets: context.reinvestmentTargets
  }));
  const totalCommitted = roundCurrency(
    pools.reduce((sum, investmentPool) => sum + investmentPool.myCommitmentAmount, 0)
  );
  const totalInvested = roundCurrency(
    pools.reduce((sum, investmentPool) => sum + investmentPool.myPosition.amountInvested, 0)
  );
  const totalReturned = roundCurrency(
    pools
      .filter((investmentPool) => investmentPool.selectedDealStatus === "sold")
      .reduce((sum, investmentPool) => sum + investmentPool.myPosition.profitReturned, 0)
  );
  const totalAmountPayout = roundCurrency(
    pools.reduce((sum, investmentPool) => sum + investmentPool.myPosition.totalAmountPayout, 0)
  );
  const currentPrefEarned = roundCurrency(
    pools
      .filter((investmentPool) => investmentPool.selectedDealStatus !== "sold")
      .reduce((sum, investmentPool) => sum + investmentPool.myPosition.currentPrefEarned, 0)
  );
  const projectedPrefEarned = roundCurrency(
    pools
      .filter((investmentPool) => investmentPool.selectedDealStatus !== "sold")
      .reduce((sum, investmentPool) => sum + investmentPool.myPosition.projectedPrefEarned, 0)
  );
  const activePools = pools.filter(
    (investmentPool) =>
      investmentPool.selectedDealId && investmentPool.selectedDealStatus !== "sold"
  ).length;
  const pendingPools = pools.filter((investmentPool) => !investmentPool.selectedDealId).length;
  const jointCapitalDeployed = roundCurrency(
    pools.reduce((sum, investmentPool) => sum + (investmentPool.jointPosition?.amountInvested ?? 0), 0)
  );

  return {
    role: user.role,
    viewer: {
      name: user.name,
      email: user.email,
      role: user.role,
      category: participant?.category ?? "pool_member"
    },
    profile: buildProfilePayload(user, participant),
    companyResources: data.companyResources ?? [],
    poolPortfolio: {
      totalCommitted,
      totalInvested,
      totalReturned,
      totalAmountPayout,
      currentPrefEarned,
      projectedPrefEarned,
      activePools,
      pendingPools,
      jointCapitalDeployed
    },
    pooledDistributionProjects: distributionProjects,
    pools
  };
}

export function buildPoolDistributionContexts(
  data = seedData,
  { participantId: targetParticipantId = null, dealId: targetDealId = null } = {}
) {
  const participantMap = getParticipantMap(data);
  const userMapByParticipantId = getUserMapByParticipantId(data);
  const dealMap = new Map(data.deals.map((deal) => [deal.id, deal]));
  const distributionElectionMap = getDistributionElectionMap(data);
  const poolCommitmentsByPool = new Map();
  const positionMap = new Map(
    data.positions.map((position) => [`${position.dealId}:${position.participantId}`, position])
  );
  const groupedContexts = new Map();
  const dealWaterfallCache = new Map();

  for (const commitment of data.investorPoolCommitments ?? []) {
    if (!poolCommitmentsByPool.has(commitment.poolId)) {
      poolCommitmentsByPool.set(commitment.poolId, []);
    }

    poolCommitmentsByPool.get(commitment.poolId).push(commitment);
  }

  function getWaterfallContext(dealId) {
    if (!dealWaterfallCache.has(dealId)) {
      const deal = dealMap.get(dealId);
      const positions = data.positions.filter((position) => position.dealId === dealId);
      const waterfall = deal ? calculateWaterfall({ deal, positions }) : null;
      dealWaterfallCache.set(dealId, { deal, waterfall });
    }

    return dealWaterfallCache.get(dealId);
  }

  for (const investmentPool of data.investorPools ?? []) {
    if (!investmentPool.selectedDealId) {
      continue;
    }

    if (targetDealId && investmentPool.selectedDealId !== targetDealId) {
      continue;
    }

    const deal = dealMap.get(investmentPool.selectedDealId);

    if (!deal || deal.status !== "sold") {
      continue;
    }

    const commitments = poolCommitmentsByPool.get(investmentPool.id) ?? [];
    const totalCommitted = roundCurrency(
      commitments.reduce((sum, commitment) => sum + commitment.commitmentAmount, 0)
    );

    if (totalCommitted <= 0) {
      continue;
    }

    const poolPosition =
      positionMap.get(`${investmentPool.selectedDealId}:${investmentPool.poolParticipantId}`) ?? null;

    if (!poolPosition) {
      continue;
    }

    const dealWaterfall = getWaterfallContext(investmentPool.selectedDealId);
    const poolResult =
      getPositionResultMap(dealWaterfall?.waterfall?.participantResults ?? []).get(poolPosition.id) ?? null;

    if (!poolResult || poolResult.totalPayout <= 0) {
      continue;
    }

    for (const commitment of commitments) {
      if (targetParticipantId && commitment.participantId !== targetParticipantId) {
        continue;
      }

      const memberSharePct = totalCommitted > 0 ? commitment.commitmentAmount / totalCommitted : 0;
      const key = `${investmentPool.selectedDealId}:${commitment.participantId}`;

      if (!groupedContexts.has(key)) {
        const participant = participantMap.get(commitment.participantId);

        groupedContexts.set(key, {
          dealId: investmentPool.selectedDealId,
          dealName: deal.name,
          participantId: commitment.participantId,
          participantName: participant?.name ?? "Pooled member",
          participantEmail: userMapByParticipantId.get(commitment.participantId)?.email ?? "",
          payoutInstructions: buildPayoutInstructionPayload(participant),
          sourcePoolNames: new Set()
        });
      }

      const context = groupedContexts.get(key);
      context.sourcePoolNames.add(investmentPool.name);
      context.totalPayout = roundCurrency(
        (context.totalPayout ?? 0) + poolResult.totalPayout * memberSharePct
      );
      context.capitalReturned = roundCurrency(
        (context.capitalReturned ?? 0) + poolResult.capitalReturned * memberSharePct
      );
      context.profitReturned = roundCurrency(
        (context.profitReturned ?? 0) +
          (poolResult.prefEarned + poolResult.profitShare) * memberSharePct
      );
    }
  }

  return [...groupedContexts.values()]
    .map((context) => {
      const deal = dealMap.get(context.dealId);
      const participant = participantMap.get(context.participantId);
      const totalPayout = roundCurrency(context.totalPayout ?? 0);
      const capitalReturned = roundCurrency(context.capitalReturned ?? 0);
      const profitReturned = roundCurrency(context.profitReturned ?? 0);
      const distributionPlan = buildDistributionPlan({
        deal,
        position: {
          id: null,
          classType: "Class A",
          distributionsToDate: 0
        },
        participant,
        result: {
          totalPayout
        },
        election: distributionElectionMap.get(`${context.dealId}:${context.participantId}`) ?? null,
        dealMap
      });

      return {
        dealId: context.dealId,
        dealName: context.dealName,
        participantId: context.participantId,
        participantName: context.participantName,
        participantEmail: context.participantEmail,
        ...context.payoutInstructions,
        sourcePoolNames: [...context.sourcePoolNames].sort((left, right) =>
          left.localeCompare(right)
        ),
        totalPayout,
        capitalReturned,
        profitReturned,
        distributionPlan,
        reinvestmentTargets: data.deals
          .filter((item) => item.status !== "sold" && item.id !== context.dealId)
          .map((item) => ({ id: item.id, name: item.name }))
      };
    })
    .filter((context) => context.totalPayout > 0)
    .sort((left, right) => {
      const dealCompare = left.dealName.localeCompare(right.dealName);
      return dealCompare !== 0 ? dealCompare : left.participantName.localeCompare(right.participantName);
    });
}

export function buildInvestorDashboard(user, data = seedData) {
  const participantMap = getParticipantMap(data);
  const dealMap = new Map(data.deals.map((deal) => [deal.id, deal]));
  const distributionElectionMap = getDistributionElectionMap(data);
  const earlyWithdrawalRequestMap = getEarlyWithdrawalRequestMap(data);
  const participant = participantMap.get(user.participantId);
  const pooledDistributionContexts = buildPoolDistributionContexts(data, {
    participantId: user.participantId
  });
  const governanceIssues = buildGovernanceIssues(data, user.participantId);
  const issuesByDeal = new Map();
  const reinvestmentTargets = data.deals
    .filter((deal) => deal.status !== "sold")
    .map((deal) => ({
      id: deal.id,
      name: deal.name
    }));

  for (const issue of governanceIssues) {
    if (!issuesByDeal.has(issue.dealId)) {
      issuesByDeal.set(issue.dealId, []);
    }

    issuesByDeal.get(issue.dealId).push(issue);
  }

  const participantPositions = data.positions.filter(
    (position) => position.participantId === user.participantId
  );
  const visiblePositions = participantPositions.filter(
    (position) => position.contributionAmount > 0 || position.distributionsToDate > 0
  );

  const projects = visiblePositions.map((position) => {
    const deal = dealMap.get(position.dealId);
    const dealPositions = data.positions.filter((item) => item.dealId === deal.id);
    const waterfall = calculateWaterfall({ deal, positions: dealPositions });
    const result = getPositionResultMap(waterfall.participantResults).get(position.id);
    const distributionPlan = buildDistributionPlan({
      deal,
      position,
      participant,
      result,
      election: distributionElectionMap.get(`${position.dealId}:${position.participantId}`) ?? null,
      dealMap
    });
    const exitLabel = deal.status === "sold" ? "Sale price" : "Projected sale price";

    return {
      id: deal.id,
      name: deal.name,
      location: deal.location,
      status: deal.status,
      statusLabel: statusLabel(deal.status),
      currentPhase: deal.currentPhase,
      investmentCloseOn: deal.investmentCloseOn ?? null,
      earlyWithdrawalPenaltyRate: deal.earlyWithdrawalPenaltyRate ?? 0.3,
      timelineProgress: resolveTimelineProgress(deal.status, deal.timelineProgress),
      timeline: deal.timeline,
      projectionLabel: deal.status === "sold" ? "Actual at exit" : "Projected at exit",
      issues: issuesByDeal.get(deal.id) ?? [],
      personalPosition: {
        classType: position.classType,
        contributionType: position.contributionType,
        amountInvested: position.contributionAmount,
        ownershipPct: result.ownershipPct,
        prefEarned:
          deal.status === "sold"
            ? result.prefEarned
            : calculateCurrentPref(position, deal, data.asOfDate),
        projectedPrefEarned:
          deal.status === "sold" ? result.prefEarned : calculateProjectedPref(position, deal),
        estimatedTotalReturn: result.totalPayout,
        capitalReturned: result.capitalReturned,
        profitEarned: roundCurrency(result.prefEarned + result.profitShare),
        totalPayout: result.totalPayout,
        actualPayoutAmount: distributionPlan.actualPayoutAmount,
        reinvestedAmount: distributionPlan.reinvestedAmount,
        pendingDistributionAmount: distributionPlan.pendingDistributionAmount,
        distributionElection: distributionPlan
      },
      projectSummary: {
        budgetedProjectCost: waterfall.budgetedProjectCost,
        totalProjectCost: waterfall.totalProjectCost,
        hasTrackedProjectCost: waterfall.hasTrackedProjectCost,
        effectiveProjectCost: waterfall.effectiveProjectCost,
        projectCostVariance: waterfall.projectCostVariance,
        projectCostVariancePct: waterfall.projectCostVariancePct,
        salePrice: waterfall.salePrice,
        salePriceLabel: exitLabel,
        totalEquity: waterfall.totalEquity,
        totalDebt: waterfall.totalDebt,
        debt: deal.debt,
        taxExpense: deal.taxExpense ?? 0,
        debtInterestRate: deal.debtInterestRate ?? 0,
        totalInterestPaid: waterfall.totalInterestPaid,
        expenseEntries: waterfall.expenseEntries,
        latestDrawBalance: waterfall.latestDrawBalance,
        debtServiceEntries: waterfall.debtServiceEntries,
        projectCostBasis: waterfall.projectCostBasis,
        netProjectProfit: waterfall.netProjectProfit,
        returnOnCost: waterfall.returnOnCost,
        holdMonths: deal.holdMonths,
        projectIrr: waterfall.projectIrr,
        fundedOn: deal.fundedOn,
        exitOn: deal.actualExitOn ?? deal.projectedExitOn
      },
      reinvestmentTargets: reinvestmentTargets.filter((item) => item.id !== deal.id),
      privacyNote:
        "Other investor contributions, bank balances, and the detailed monthly financing ledger remain hidden."
    };
  });

  const withdrawalProjects =
    ["investor", "contractor"].includes(participant?.category ?? "")
      ? [...new Set(
          [
            ...participantPositions
              .filter((position) => {
                const deal = dealMap.get(position.dealId);
                return deal && deal.status !== "sold";
              })
              .map((position) => position.dealId),
            ...(data.earlyWithdrawalRequests ?? [])
              .filter((request) => request.participantId === user.participantId)
              .map((request) => request.dealId)
          ].filter(Boolean)
        )]
          .map((dealId) => {
            const deal = dealMap.get(dealId);

            if (!deal || deal.status === "sold") {
              return null;
            }

            const position = participantPositions.find((item) => item.dealId === dealId) ?? null;
            const request =
              earlyWithdrawalRequestMap.get(`${dealId}:${user.participantId}`) ?? null;
            const plan = buildEarlyWithdrawalPlan({
              deal,
              position,
              participant,
              request
            });

            if (!plan.hasRequest && !plan.canRequest) {
              return null;
            }

            return {
              id: deal.id,
              name: deal.name,
              location: deal.location,
              currentPhase: deal.currentPhase,
              status: deal.status,
              statusLabel: statusLabel(deal.status),
              investmentCloseOn: deal.investmentCloseOn ?? null,
              earlyWithdrawalPenaltyRate: deal.earlyWithdrawalPenaltyRate ?? 0.3,
              withdrawalRequest: plan
            };
          })
          .filter(Boolean)
          .sort((left, right) => {
            const leftPending = left.withdrawalRequest.requestStatus === "pending";
            const rightPending = right.withdrawalRequest.requestStatus === "pending";

            if (leftPending !== rightPending) {
              return leftPending ? -1 : 1;
            }

            return left.name.localeCompare(right.name);
          })
      : [];

  const totalInvested = roundCurrency(
    visiblePositions.reduce((sum, position) => sum + position.contributionAmount, 0)
  );
  const totalReturned = roundCurrency(
    projects
      .filter((project) => project.status === "sold")
      .reduce((sum, project) => sum + project.personalPosition.profitEarned, 0)
  );
  const activeInvestments = projects.filter((project) => project.status !== "sold").length;
  const currentPrefEarned = roundCurrency(
    projects
      .filter((project) => project.status !== "sold")
      .reduce((sum, project) => sum + project.personalPosition.prefEarned, 0)
  );
  const projectedPrefEarned = roundCurrency(
    projects
      .filter((project) => project.status !== "sold")
      .reduce((sum, project) => sum + project.personalPosition.projectedPrefEarned, 0)
  );
  const totalAmountPayout = roundCurrency(
    visiblePositions.reduce((sum, position) => sum + (position.distributionsToDate ?? 0), 0)
  );
  const pooledDistributionProjects = pooledDistributionContexts.map((context) => ({
    id: context.dealId,
    name: context.dealName,
    location: context.sourcePoolNames.join(", "),
    currentPhase:
      context.sourcePoolNames.length === 1
        ? `Pooled through ${context.sourcePoolNames[0]}`
        : `Pooled through ${context.sourcePoolNames.length} capital groups`,
    status: "sold",
    personalPosition: {
      totalPayout: context.totalPayout,
      profitEarned: context.profitReturned,
      distributionElection: context.distributionPlan
    },
    reinvestmentTargets: context.reinvestmentTargets
  }));

  return {
    role: user.role,
    viewer: {
      name: user.name,
      email: user.email,
      role: user.role,
      category: participantMap.get(user.participantId)?.category ?? "investor"
    },
    profile: buildProfilePayload(user, participant),
    portfolio: {
      totalInvested,
      totalReturned,
      totalAmountPayout,
      activeInvestments,
      currentPrefEarned,
      projectedPrefEarned
    },
    governance: {
      issues: governanceIssues
    },
    companyResources: data.companyResources ?? [],
    pooledDistributionProjects,
    projects,
    withdrawalRequests: withdrawalProjects
  };
}

export function buildManagerDashboard(user, data = seedData) {
  const participantMap = getParticipantMap(data);
  const userMap = new Map(data.users.map((item) => [item.participantId, item]));
  const userMapById = getUserMapById(data);
  const investorPools = buildInvestorPoolViews(data);
  const contractorMap = new Map(
    data.contractors.map((item) => [`${item.dealId}:${item.participantId}`, item])
  );
  const distributionElectionMap = getDistributionElectionMap(data);
  const participant = participantMap.get(user.participantId);
  const governanceIssues = buildGovernanceIssues(data, user.participantId, {
    includeAll: true
  });
  const issuesByDeal = new Map();

  for (const issue of governanceIssues) {
    if (!issuesByDeal.has(issue.dealId)) {
      issuesByDeal.set(issue.dealId, []);
    }

    issuesByDeal.get(issue.dealId).push(issue);
  }

  const deals = data.deals.map((deal) => {
    const dealPositions = data.positions.filter((position) => position.dealId === deal.id);
    const waterfall = calculateWaterfall({ deal, positions: dealPositions });

    return {
      id: deal.id,
      name: deal.name,
      location: deal.location,
      status: deal.status,
      statusLabel: statusLabel(deal.status),
      totalEquity: waterfall.totalEquity,
      totalDebt: waterfall.totalDebt,
      debt: deal.debt,
      taxExpense: deal.taxExpense ?? 0,
      debtInterestRate: deal.debtInterestRate ?? 0,
      totalInterestPaid: waterfall.totalInterestPaid,
      earlyWithdrawalPenaltyRate: deal.earlyWithdrawalPenaltyRate ?? 0.3,
      budgetedProjectCost: waterfall.budgetedProjectCost,
      totalProjectCost: waterfall.totalProjectCost,
      hasTrackedProjectCost: waterfall.hasTrackedProjectCost,
      effectiveProjectCost: waterfall.effectiveProjectCost,
      projectCostVariance: waterfall.projectCostVariance,
      projectCostVariancePct: waterfall.projectCostVariancePct,
      expenseEntries: waterfall.expenseEntries,
      latestDrawBalance: waterfall.latestDrawBalance,
      debtServiceEntries: waterfall.debtServiceEntries,
      projectCostBasis: waterfall.projectCostBasis,
      netProjectProfit: waterfall.netProjectProfit,
      returnOnCost: waterfall.returnOnCost,
      salePrice: deal.salePrice,
      holdMonths: deal.holdMonths,
      prefRate: deal.prefRate,
      currentPhase: deal.currentPhase,
      investmentCloseOn: deal.investmentCloseOn ?? null,
      timelineProgress: resolveTimelineProgress(deal.status, deal.timelineProgress),
      timeline: deal.timeline,
      fundedOn: deal.fundedOn,
      projectedExitOn: deal.projectedExitOn,
      actualExitOn: deal.actualExitOn,
      projectIrr: waterfall.projectIrr,
      sponsorPromote: waterfall.sponsorPromote,
      activeTier: waterfall.activeTier,
      classBreakdown: waterfall.classBreakdown,
      issues: issuesByDeal.get(deal.id) ?? [],
      promoteTiers: deal.promoteTiers,
      participantResults: waterfall.participantResults.map((result) => ({
        ...result,
        participantName: participantMap.get(result.participantId)?.name ?? "Participant"
      }))
    };
  });

  const totalTrackedEquity = roundCurrency(
    data.positions.reduce((sum, position) => sum + position.contributionAmount, 0)
  );
  const projectedSponsorPromote = roundCurrency(
    deals.reduce((sum, deal) => sum + deal.sponsorPromote, 0)
  );
  const contractorLedger = data.contractors.map((contractor) => {
    const deal = data.deals.find((item) => item.id === contractor.dealId);
    const dealPositions = data.positions.filter((position) => position.dealId === deal.id);
    const waterfall = calculateWaterfall({ deal, positions: dealPositions });
    const linkedPosition = data.positions.find(
      (position) =>
        position.dealId === contractor.dealId &&
        position.participantId === contractor.participantId
    );
    const positionResult = waterfall.participantResults.find(
      (result) => result.positionId === linkedPosition?.id
    );

    return {
      id: contractor.id,
      dealId: contractor.dealId,
      participantId: contractor.participantId,
      dealName: deal.name,
      contractorName: contractor.contractorName,
      trade: contractor.trade,
      totalContractValue: contractor.totalContractValue,
      cashPaid: contractor.cashPaid,
      deferredAmount: contractor.deferredAmount,
      contributionType: contractor.contributionType,
      ownershipPct: waterfall.totalEquity > 0 ? contractor.deferredAmount / waterfall.totalEquity : 0,
      prefEarned:
        deal.status === "sold"
          ? positionResult?.prefEarned ?? 0
          : roundCurrency(
              contractor.deferredAmount *
                deal.prefRate *
                (Math.min(monthsBetween(deal.fundedOn, data.asOfDate), deal.holdMonths) / 12)
            ),
      profitShare: positionResult?.profitShare ?? 0,
      totalPayout: positionResult?.totalPayout ?? 0,
      status: contractor.status,
      hybrid: contractor.hybrid
    };
  });

  const adminUsers = data.users
    .map((account) => ({
      id: account.id,
      participantId: account.participantId,
      name: account.name,
      firstName: account.firstName ?? "",
      middleName: account.middleName ?? "",
      lastName: account.lastName ?? "",
      email: account.email,
      role: account.role,
      category: participantMap.get(account.participantId)?.category ?? "investor",
      contactPhone: account.contactPhone ?? "",
      currentAddress: account.currentAddress ?? "",
      mailingAddress: account.mailingAddress ?? "",
      driverLicenseNumber: account.driverLicenseNumber ?? "",
      idCardFileName: account.idCardFileName ?? "",
      idDocumentIssueDate: account.idDocumentIssueDate ?? "",
      idDocumentExpirationDate: account.idDocumentExpirationDate ?? "",
      isActive: Boolean(account.isActive),
      mustChangePassword: Boolean(account.mustChangePassword),
      accountApprovalStatus: account.accountApprovalStatus ?? "approved",
      accountRejectionComment: account.accountRejectionComment ?? "",
      accountReviewedAt: account.accountReviewedAt ?? null,
      onboardingSubmittedAt: account.onboardingSubmittedAt ?? null,
      lastLoginAt: account.lastLoginAt ?? null,
      notificationStatus: account.notificationStatus ?? null,
      notificationProvider: account.notificationProvider ?? null,
      notificationLocalPath: account.notificationLocalPath ?? null
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const adminParticipants = data.participants
    .filter((participant) => !["sponsor", "manager"].includes(participant.category))
    .map((participant) => {
      const linkedUser = userMap.get(participant.id);

      return {
        id: participant.id,
        name: participant.name,
        category: participant.category,
        hasUser: Boolean(linkedUser),
        email: linkedUser?.email ?? null,
        contactPhone: participant.contactPhone ?? "",
        idCardFileName: participant.idCardFileName ?? ""
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  const allocationParticipants = adminParticipants.filter((participant) =>
    ["investor", "contractor"].includes(participant.category)
  );
  const poolMembers = adminParticipants.filter(
    (participant) => participant.category === "pool_member" && participant.hasUser
  );

  const adminAllocations = data.positions
    .filter((position) => position.contributionAmount > 0)
    .map((position) => {
      const deal = data.deals.find((item) => item.id === position.dealId);
      const participant = participantMap.get(position.participantId);
      const contractorRecord = contractorMap.get(`${position.dealId}:${position.participantId}`);

      return {
        id: position.id,
        dealId: position.dealId,
        dealName: deal?.name ?? "Deal",
        participantId: position.participantId,
        participantName: participant?.name ?? "Participant",
        category: participant?.category ?? "investor",
        classType: position.classType,
        contributionType: position.contributionType,
        contributionAmount: position.contributionAmount,
        trade: contractorRecord?.trade ?? null,
        cashPaid: contractorRecord?.cashPaid ?? 0,
        deferredAmount: contractorRecord?.deferredAmount ?? position.contributionAmount,
        status: contractorRecord?.status ?? null
      };
    })
    .sort((left, right) => {
      const dealCompare = left.dealName.localeCompare(right.dealName);
      return dealCompare !== 0 ? dealCompare : left.participantName.localeCompare(right.participantName);
    });

  const distributionReviews = data.positions
    .map((position) => {
      const deal = data.deals.find((item) => item.id === position.dealId);
      const participantRecord = participantMap.get(position.participantId);

      if (!deal || deal.status !== "sold" || participantRecord?.category !== "investor") {
        return null;
      }

      const dealPositions = data.positions.filter((item) => item.dealId === deal.id);
      const waterfall = calculateWaterfall({ deal, positions: dealPositions });
      const result = waterfall.participantResults.find((item) => item.positionId === position.id);

      if (!result || result.totalPayout <= 0) {
        return null;
      }

      const distribution = buildDistributionPlan({
        deal,
        position,
        participant: participantRecord,
        result,
        election: distributionElectionMap.get(`${position.dealId}:${position.participantId}`) ?? null,
        dealMap: new Map(data.deals.map((item) => [item.id, item]))
      });
      const linkedUser = userMap.get(position.participantId);
      const submittedBy = distribution.submittedByUserId
        ? userMapById.get(distribution.submittedByUserId)
        : null;
      const reviewedBy = distribution.reviewedByUserId
        ? userMapById.get(distribution.reviewedByUserId)
        : null;
      const needsReview = !distribution.hasElection || distribution.approvalStatus !== "approved";
      let reviewStatus = "No election";

      if (!distribution.hasElection) {
        reviewStatus = "No election";
      } else if (distribution.approvalStatus === "approved" && distribution.managerOverride) {
        reviewStatus = "Approved with override";
      } else if (distribution.approvalStatus === "approved" && distribution.submittedByRole === "manager") {
        reviewStatus = "Backfilled approval";
      } else if (distribution.approvalStatus === "approved") {
        reviewStatus = "Approved";
      } else if (distribution.submittedByRole === "investor") {
        reviewStatus = "Pending approval";
      } else {
        reviewStatus = "Manager draft";
      }

      return {
        dealId: deal.id,
        dealName: deal.name,
        participantId: position.participantId,
        participantName: participantRecord?.name ?? "Investor",
        participantEmail: linkedUser?.email ?? "",
        ...buildPayoutInstructionPayload(participantRecord),
        totalPayout: result.totalPayout,
        capitalReturned: result.capitalReturned,
        profitReturned: roundCurrency(result.prefEarned + result.profitShare),
        approvalStatus: distribution.approvalStatus,
        actualPayoutAmount: distribution.actualPayoutAmount,
        requestedReinvestedAmount: distribution.requestedReinvestedAmount,
        requestedCashPayoutAmount: distribution.requestedCashPayoutAmount,
        approvedReinvestedAmount: distribution.approvedReinvestedAmount,
        approvedCashPayoutAmount: distribution.approvedCashPayoutAmount,
        reinvestedAmount: distribution.reinvestedAmount,
        pendingDistributionAmount: distribution.pendingDistributionAmount,
        electionMode: distribution.electionMode,
        reinvestPercent: distribution.reinvestPercent,
        requestedReinvestAmount: distribution.requestedReinvestAmount,
        rolloverTargetDealId: distribution.rolloverTargetDealId,
        rolloverTargetDealName: distribution.rolloverTargetDealName,
        payoutExpectedOn: distribution.payoutExpectedOn,
        notes: distribution.notes,
        submittedByRole: distribution.submittedByRole,
        submittedByName: submittedBy?.name ?? null,
        reviewedByName: reviewedBy?.name ?? null,
        reviewedAt: distribution.reviewedAt,
        managerOverride: distribution.managerOverride,
        overrideNotes: distribution.overrideNotes,
        updatedAt: distribution.updatedAt,
        reviewStatus,
        needsReview,
        canApprove: distribution.approvalStatus !== "approved",
        reinvestmentTargets: data.deals
          .filter((item) => item.status !== "sold" && item.id !== deal.id)
          .map((item) => ({ id: item.id, name: item.name }))
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.needsReview !== right.needsReview) {
        return left.needsReview ? -1 : 1;
      }

      return String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""));
    });
  const pooledDistributionReviews = buildPoolDistributionContexts(data).map((context) => {
    const distribution = context.distributionPlan;
    const submittedBy = distribution.submittedByUserId
      ? userMapById.get(distribution.submittedByUserId)
      : null;
    const reviewedBy = distribution.reviewedByUserId
      ? userMapById.get(distribution.reviewedByUserId)
      : null;
    const needsReview = !distribution.hasElection || distribution.approvalStatus !== "approved";
    let reviewStatus = "No election";

    if (!distribution.hasElection) {
      reviewStatus = "No election";
    } else if (distribution.approvalStatus === "approved" && distribution.managerOverride) {
      reviewStatus = "Approved with override";
    } else if (distribution.approvalStatus === "approved" && distribution.submittedByRole === "manager") {
      reviewStatus = "Backfilled approval";
    } else if (distribution.approvalStatus === "approved") {
      reviewStatus = "Approved";
    } else if (distribution.submittedByRole === "investor") {
      reviewStatus = "Pending approval";
    } else {
      reviewStatus = "Manager draft";
    }

    return {
      dealId: context.dealId,
      dealName: context.dealName,
      participantId: context.participantId,
      participantName: context.participantName,
      participantEmail: context.participantEmail,
      ...buildPayoutInstructionPayload(participantMap.get(context.participantId)),
      sourcePoolNames: context.sourcePoolNames,
      totalPayout: context.totalPayout,
      capitalReturned: context.capitalReturned,
      profitReturned: context.profitReturned,
      approvalStatus: distribution.approvalStatus,
      actualPayoutAmount: distribution.actualPayoutAmount,
      requestedReinvestedAmount: distribution.requestedReinvestedAmount,
      requestedCashPayoutAmount: distribution.requestedCashPayoutAmount,
      approvedReinvestedAmount: distribution.approvedReinvestedAmount,
      approvedCashPayoutAmount: distribution.approvedCashPayoutAmount,
      reinvestedAmount: distribution.reinvestedAmount,
      pendingDistributionAmount: distribution.pendingDistributionAmount,
      electionMode: distribution.electionMode,
      reinvestPercent: distribution.reinvestPercent,
      requestedReinvestAmount: distribution.requestedReinvestAmount,
      rolloverTargetDealId: distribution.rolloverTargetDealId,
      rolloverTargetDealName: distribution.rolloverTargetDealName,
      payoutExpectedOn: distribution.payoutExpectedOn,
      notes: distribution.notes,
      submittedByRole: distribution.submittedByRole,
      submittedByName: submittedBy?.name ?? null,
      reviewedByName: reviewedBy?.name ?? null,
      reviewedAt: distribution.reviewedAt,
      managerOverride: distribution.managerOverride,
      overrideNotes: distribution.overrideNotes,
      updatedAt: distribution.updatedAt,
      reviewStatus,
      needsReview,
      canApprove: distribution.approvalStatus !== "approved",
      reinvestmentTargets: context.reinvestmentTargets
    };
  });
  const combinedDistributionReviews = [...distributionReviews, ...pooledDistributionReviews].sort(
    (left, right) => {
      if (left.needsReview !== right.needsReview) {
        return left.needsReview ? -1 : 1;
      }

      return String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""));
    }
  );

  const earlyWithdrawalReviews = (data.earlyWithdrawalRequests ?? [])
    .map((request) => {
      const deal = data.deals.find((item) => item.id === request.dealId);
      const participantRecord = participantMap.get(request.participantId);

      if (!deal || !["investor", "contractor"].includes(participantRecord?.category ?? "")) {
        return null;
      }

      const linkedUser = userMap.get(request.participantId);
      const submittedBy = request.requestedByUserId
        ? userMapById.get(request.requestedByUserId)
        : null;
      const reviewedBy = request.reviewedByUserId
        ? userMapById.get(request.reviewedByUserId)
        : null;
      const position = data.positions.find(
        (item) => item.dealId === request.dealId && item.participantId === request.participantId
      );
      const plan = buildEarlyWithdrawalPlan({
        deal,
        position,
        participant: participantRecord,
        request
      });
      let reviewStatus = "Pending review";

      if (request.requestStatus === "approved") {
        reviewStatus = "Approved";
      } else if (request.requestStatus === "rejected") {
        reviewStatus = "Rejected";
      }

      return {
        dealId: deal.id,
        dealName: deal.name,
        participantId: request.participantId,
        participantName: participantRecord?.name ?? "Investor",
        participantEmail: linkedUser?.email ?? "",
        ...buildPayoutInstructionPayload(participantRecord),
        requestStatus: request.requestStatus,
        reviewStatus,
        needsReview: request.requestStatus === "pending",
        canReview: request.requestStatus === "pending",
        classType: plan.classType,
        currentContributionAmount: plan.currentContributionAmount,
        requestedCapitalAmount: plan.requestedCapitalAmount,
        penaltyRate: plan.penaltyRate,
        penaltyAmount: plan.penaltyAmount,
        estimatedPayoutAmount: plan.estimatedPayoutAmount,
        approvedPayoutAmount: plan.approvedPayoutAmount,
        payoutExpectedOn: plan.payoutExpectedOn,
        investorNotes: plan.investorNotes,
        managerNotes: plan.managerNotes,
        submittedByName: submittedBy?.name ?? null,
        reviewedByName: reviewedBy?.name ?? null,
        reviewedAt: plan.reviewedAt,
        updatedAt: plan.updatedAt
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.needsReview !== right.needsReview) {
        return left.needsReview ? -1 : 1;
      }

      return String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""));
    });

  return {
    role: user.role,
    viewer: {
      name: user.name,
      email: user.email,
      role: user.role,
      category: participant?.category ?? "manager"
    },
    profile: buildProfilePayload(user, participant),
    overview: {
      totalDeals: deals.length,
      activeDeals: deals.filter((deal) => deal.status !== "sold").length,
      totalTrackedEquity,
      projectedSponsorPromote,
      totalInvestorPools: investorPools.length,
      totalPooledCapital: roundCurrency(
        investorPools.reduce((sum, investmentPool) => sum + investmentPool.totalCommitted, 0)
      )
    },
    deals,
    contractorLedger,
    admin: {
      users: adminUsers,
      participants: adminParticipants,
      allocationParticipants,
      poolMembers,
      investorPools,
      allocations: adminAllocations,
      distributionReviews: combinedDistributionReviews,
      earlyWithdrawalReviews
    },
    governance: {
      issues: governanceIssues
    },
    companyResources: data.companyResources ?? [],
    calculator: {
      deals: deals.map((deal) => ({
        id: deal.id,
        name: deal.name,
        salePrice: deal.salePrice,
        totalProjectCost: deal.hasTrackedProjectCost
          ? deal.totalProjectCost
          : deal.effectiveProjectCost,
        holdMonths: deal.holdMonths,
        prefRate: deal.prefRate,
        debt: deal.debt,
        taxExpense: deal.taxExpense ?? 0
      }))
    }
  };
}

export function buildDashboardForUser(user, data = seedData) {
  const participant = getParticipantMap(data).get(user.participantId);

  if (user.role === "manager") {
    return buildManagerDashboard(user, data);
  }

  if (participant?.category === "pool_member") {
    return buildPoolMemberDashboard(user, data);
  }

  return buildInvestorDashboard(user, data);
}

export function calculateScenarioForDeal(dealId, overrides = {}, data = seedData) {
  const deal = data.deals.find((item) => item.id === dealId);

  if (!deal) {
    return null;
  }

  const dealPositions = data.positions.filter((position) => position.dealId === dealId);
  const participantMap = getParticipantMap(data);
  const waterfall = calculateWaterfall({ deal, positions: dealPositions, overrides });

  return {
    deal: {
      id: deal.id,
      name: deal.name,
      status: deal.status,
      statusLabel: statusLabel(deal.status)
    },
    inputs: {
      salePrice: waterfall.salePrice,
      totalProjectCost: waterfall.hasTrackedProjectCost
        ? waterfall.totalProjectCost
        : waterfall.effectiveProjectCost,
      holdMonths: waterfall.holdMonths,
      prefRate: waterfall.prefRate,
      debt: waterfall.debt,
      taxExpense: waterfall.taxExpense
    },
    outputs: {
      projectIrr: waterfall.projectIrr,
      distributableEquity: waterfall.distributableEquity,
      grossIrrProceeds: waterfall.grossIrrProceeds,
      totalEquity: waterfall.totalEquity,
      totalDebt: waterfall.totalDebt,
      totalInterestPaid: waterfall.totalInterestPaid,
      budgetedProjectCost: waterfall.budgetedProjectCost,
      totalProjectCost: waterfall.totalProjectCost,
      effectiveProjectCost: waterfall.effectiveProjectCost,
      projectCostBasis: waterfall.projectCostBasis,
      netProjectProfit: waterfall.netProjectProfit,
      costRecoveryShortfall: waterfall.costRecoveryShortfall,
      hasClearedCostRecovery: waterfall.hasClearedCostRecovery,
      preferredReturnPaid: waterfall.preferredReturnPaid,
      returnOnCost: waterfall.returnOnCost,
      taxExpense: waterfall.taxExpense,
      sponsorPromote: waterfall.sponsorPromote,
      investorProfitPool: waterfall.investorProfitPool,
      activeTier: waterfall.activeTier,
      waterfallSteps: waterfall.waterfallSteps,
      classBreakdown: waterfall.classBreakdown,
      participants: waterfall.participantResults.map((result) => ({
        ...result,
        participantName: participantMap.get(result.participantId)?.name ?? "Participant"
      })),
      promoteTiers: deal.promoteTiers.map((tier) => ({
        ...tier,
        isEnabled: tier.isEnabled !== false,
        isActive:
          tier.isEnabled !== false && waterfall.activeTier?.label === tier.label
      }))
    }
  };
}
