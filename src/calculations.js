import { seedData } from "./data.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 30.4375;

export function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatCurrencyLabel(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Number.isInteger(Number(value)) ? 0 : 2
  }).format(Number(value ?? 0));
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

function getEnrollmentInvestmentAmount(data, participantId) {
  const amounts = (data.userLegalAcknowledgements ?? [])
    .filter((acknowledgement) => acknowledgement.participantId === participantId)
    .filter((acknowledgement) => Number(acknowledgement.investmentAmount) > 0)
    .map((acknowledgement) => Number(acknowledgement.investmentAmount ?? 0));

  return roundCurrency(amounts.length ? Math.max(...amounts) : 0);
}

function getEnrollmentDeferredAmount(data, participantId) {
  const amounts = (data.userLegalAcknowledgements ?? [])
    .filter((acknowledgement) => acknowledgement.participantId === participantId)
    .filter((acknowledgement) => Number(acknowledgement.deferredAmount) > 0)
    .map((acknowledgement) => Number(acknowledgement.deferredAmount ?? 0));

  return roundCurrency(amounts.length ? Math.max(...amounts) : 0);
}

function buildCapitalAccountLedger(data, participantId) {
  const approvedDeposits = (data.userCapitalDeposits ?? []).filter(
    (deposit) => deposit.participantId === participantId && deposit.status === "approved"
  );
  const pendingDeposits = (data.userCapitalDeposits ?? []).filter(
    (deposit) => deposit.participantId === participantId && deposit.status === "pending"
  );
  const pendingUnallocatedPayouts = (data.userAccountPayouts ?? []).filter(
    (payout) =>
      payout.participantId === participantId &&
      payout.sourceType === "unallocated_funds" &&
      payout.status === "pending"
  );
  const paidUnallocatedPayouts = (data.userAccountPayouts ?? []).filter(
    (payout) =>
      payout.participantId === participantId &&
      payout.sourceType === "unallocated_funds" &&
      payout.status === "paid"
  );
  const approvedEarlyWithdrawals = (data.earlyWithdrawalRequests ?? []).filter(
    (request) => request.participantId === participantId && request.requestStatus === "approved"
  );
  const enrollmentInvestmentAmount = getEnrollmentInvestmentAmount(data, participantId);
  const approvedDepositAmount = roundCurrency(
    approvedDeposits.reduce((sum, deposit) => sum + Number(deposit.amount ?? 0), 0)
  );
  const pendingDepositAmount = roundCurrency(
    pendingDeposits.reduce((sum, deposit) => sum + Number(deposit.amount ?? 0), 0)
  );
  const pendingPayoutAmount = roundCurrency(
    pendingUnallocatedPayouts.reduce((sum, payout) => sum + Number(payout.amount ?? 0), 0)
  );
  const paidPayoutAmount = roundCurrency(
    paidUnallocatedPayouts.reduce((sum, payout) => sum + Number(payout.amount ?? 0), 0)
  );
  const approvedEarlyWithdrawalCapitalAmount = roundCurrency(
    approvedEarlyWithdrawals.reduce(
      (sum, request) => sum + Number(request.requestedCapitalAmount ?? 0),
      0
    )
  );
  const allocatedToProjects = roundCurrency(
    (data.positions ?? [])
      .filter((position) => position.participantId === participantId)
      .filter((position) => position.contributionType !== "Reinvested proceeds")
      .reduce((sum, position) => sum + Number(position.contributionAmount ?? 0), 0)
  );
  const committedToPools = roundCurrency(
    (data.investorPoolCommitments ?? [])
      .filter((commitment) => commitment.participantId === participantId)
      .reduce((sum, commitment) => sum + Number(commitment.commitmentAmount ?? 0), 0)
  );
  const committedToProjectPools = roundCurrency(
    (data.userAllocationRequests ?? [])
      .filter(
        (request) =>
          request.participantId === participantId &&
          request.allocationMode === "pooled" &&
          request.status === "approved"
      )
      .reduce((sum, request) => sum + Number(request.amount ?? 0), 0)
  );
  const pendingAllocationRequestAmount = roundCurrency(
    (data.userAllocationRequests ?? [])
      .filter((request) => request.participantId === participantId && request.status === "pending")
      .reduce((sum, request) => sum + Number(request.amount ?? 0), 0)
  );
  const totalAccountFunds = roundCurrency(
    Math.max(approvedDepositAmount - paidPayoutAmount - approvedEarlyWithdrawalCapitalAmount, 0)
  );
  const totalAllocatedFunds = roundCurrency(
    allocatedToProjects +
      committedToPools +
      committedToProjectPools +
      pendingAllocationRequestAmount +
      pendingPayoutAmount
  );
  const availableCapital = roundCurrency(Math.max(totalAccountFunds - totalAllocatedFunds, 0));
  const latestApprovedDeposit = approvedDeposits
    .slice()
    .sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")))[0];
  const latestEnrollmentProof = (data.userLegalAcknowledgements ?? [])
    .filter((acknowledgement) => acknowledgement.participantId === participantId)
    .filter(
      (acknowledgement) =>
        Number(acknowledgement.investmentAmount) > 0 &&
        acknowledgement.proofOfPaymentFileName
    )
    .sort((left, right) =>
      String(right.acknowledgedAt ?? "").localeCompare(String(left.acknowledgedAt ?? ""))
    )[0];

  return {
    participantId,
    enrollmentInvestmentAmount,
    approvedDepositAmount,
    pendingDepositAmount,
    pendingPayoutAmount,
    paidPayoutAmount,
    approvedEarlyWithdrawalCapitalAmount,
    totalAccountFunds,
    allocatedToProjects,
    committedToPools: roundCurrency(committedToPools + committedToProjectPools),
    committedToProjectPools,
    pendingAllocationRequestAmount,
    totalAllocatedFunds,
    availableCapital,
    latestApprovedDepositId: latestApprovedDeposit?.id ?? null,
    latestApprovedProofFileName: latestApprovedDeposit?.proofFileName ?? "",
    enrollmentProofAcknowledgementId: latestEnrollmentProof?.id ?? null,
    enrollmentProofFileName: latestEnrollmentProof?.proofOfPaymentFileName ?? ""
  };
}

function buildDwollaAccountPayload(user) {
  return {
    customerId: user?.dwollaCustomerId ?? "",
    customerUrl: user?.dwollaCustomerUrl ?? "",
    customerStatus: user?.dwollaCustomerStatus ?? "",
    fundingSourceId: user?.dwollaFundingSourceId ?? "",
    fundingSourceUrl: user?.dwollaFundingSourceUrl ?? "",
    fundingSourceStatus: user?.dwollaFundingSourceStatus ?? "",
    fundingSourceName: user?.dwollaFundingSourceName ?? "",
    fundingSourceBankName: user?.dwollaFundingSourceBankName ?? "",
    fundingSourceType: user?.dwollaFundingSourceType ?? "",
    syncedAt: user?.dwollaSyncedAt ?? null
  };
}

function buildDeferredAccountLedger(data, participantId) {
  const enrollmentDeferredAmount = getEnrollmentDeferredAmount(data, participantId);
  const allocatedDeferredAmount = roundCurrency(
    (data.contractors ?? [])
      .filter((contractor) => contractor.participantId === participantId)
      .reduce((sum, contractor) => sum + Number(contractor.deferredAmount ?? 0), 0)
  );
  const pendingAllocationRequestAmount = roundCurrency(
    (data.userAllocationRequests ?? [])
      .filter((request) => request.participantId === participantId && request.status === "pending")
      .reduce((sum, request) => sum + Number(request.amount ?? 0), 0)
  );
  const availableDeferredAmount = roundCurrency(
    Math.max(enrollmentDeferredAmount - allocatedDeferredAmount - pendingAllocationRequestAmount, 0)
  );

  return {
    participantId,
    accountType: "contractor_deferred",
    enrollmentDeferredAmount,
    allocatedDeferredAmount,
    pendingAllocationRequestAmount,
    availableDeferredAmount
  };
}

function buildAllocationTargets(data, asOfDate = String(data.asOfDate ?? new Date().toISOString().slice(0, 10))) {
  return (data.deals ?? [])
    .filter((deal) => deal.status !== "sold" && !isDateClosed(deal.investmentCloseOn, asOfDate))
    .map((deal) => ({
      id: deal.id,
      name: deal.name,
      location: deal.location,
      investmentCloseOn: deal.investmentCloseOn ?? null,
      directInvestmentMinimum: roundCurrency(deal.directInvestmentMinimum ?? 0),
      pooledInvestmentAllowed: Boolean(Number(deal.pooledInvestmentAllowed ?? 0)),
      pooledInvestmentTarget: roundCurrency(deal.pooledInvestmentTarget ?? 0),
      pooledVoteThreshold: roundCurrency(deal.pooledVoteThreshold ?? 0.5),
      pooledVoteClosesOn: deal.pooledVoteClosesOn ?? null,
      status: deal.status,
      statusLabel: statusLabel(deal.status)
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function buildParticipantAllocationRequests(data, participantId) {
  const dealMap = new Map((data.deals ?? []).map((deal) => [deal.id, deal]));
  const voteMap = new Map(
    (data.projectPoolVotes ?? []).map((vote) => [`${vote.dealId}:${vote.participantId}`, vote])
  );
  const requestsByDeal = new Map();

  for (const request of data.userAllocationRequests ?? []) {
    if (request.allocationMode !== "pooled" || request.createdPositionId) {
      continue;
    }

    if (request.status !== "approved") {
      continue;
    }

    if (!requestsByDeal.has(request.dealId)) {
      requestsByDeal.set(request.dealId, []);
    }

    requestsByDeal.get(request.dealId).push(request);
  }

  return (data.userAllocationRequests ?? [])
    .filter((request) => request.participantId === participantId)
    .map((request) => {
      if (request.allocationMode !== "pooled" || request.createdPositionId) {
        return request;
      }

      const deal = dealMap.get(request.dealId);

      if (!deal) {
        return request;
      }

      const voteSummary = buildProjectPoolVoteSummaryForRequests({
        deal,
        requests: requestsByDeal.get(request.dealId) ?? [],
        votes: data.projectPoolVotes ?? [],
        asOfDate: data.asOfDate
      });
      const vote = voteMap.get(`${request.dealId}:${participantId}`);

      return {
        ...request,
        poolVoteChoice: vote?.voteChoice ?? "",
        poolVoteClosesOn: voteSummary.voteClosesOn,
        poolVoteThreshold: voteSummary.voteThreshold,
        poolVotePassed: voteSummary.votePassed,
        poolVoteEffectiveYesPct: voteSummary.effectiveYesPct,
        poolVoteCanFund: voteSummary.canFund,
        poolVoteCanVote:
          request.status === "approved" &&
          !voteSummary.votingClosed &&
          !request.createdPositionId,
        poolVoteVotingClosed: voteSummary.votingClosed
      };
    })
    .sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")));
}

function buildProjectPoolVoteSummaryForRequests({ deal, requests, votes, asOfDate }) {
  const weights = new Map();
  const effectiveAsOfDate = String(asOfDate ?? new Date().toISOString().slice(0, 10));

  for (const request of requests ?? []) {
    weights.set(
      request.participantId,
      roundCurrency((weights.get(request.participantId) ?? 0) + Number(request.amount ?? 0))
    );
  }

  const totalCommitted = roundCurrency(
    [...weights.values()].reduce((sum, amount) => sum + amount, 0)
  );
  const eligibleParticipantIds = new Set(weights.keys());
  const voteMap = new Map(
    (votes ?? [])
      .filter((vote) => vote.dealId === deal.id && eligibleParticipantIds.has(vote.participantId))
      .map((vote) => [vote.participantId, vote])
  );
  const voteClosesOn = deal.pooledVoteClosesOn ?? deal.investmentCloseOn ?? null;
  const votingClosed = isDateClosed(voteClosesOn, effectiveAsOfDate);
  const voteThreshold = roundCurrency(Number(deal.pooledVoteThreshold ?? 0.5));
  let yesWeight = 0;
  let noWeight = 0;
  let abstainWeight = 0;

  for (const [participantId, amount] of weights) {
    const vote = voteMap.get(participantId);

    if (vote?.voteChoice === "yes") {
      yesWeight += amount;
    } else if (vote?.voteChoice === "no") {
      noWeight += amount;
    } else {
      abstainWeight += amount;
    }
  }

  yesWeight = roundCurrency(yesWeight);
  noWeight = roundCurrency(noWeight);
  abstainWeight = roundCurrency(abstainWeight);

  const effectiveYesWeight = roundCurrency(yesWeight + (votingClosed ? abstainWeight : 0));
  const effectiveYesPct = totalCommitted > 0 ? roundCurrency(effectiveYesWeight / totalCommitted) : 0;
  const pooledInvestmentTarget = roundCurrency(deal.pooledInvestmentTarget ?? 0);
  const targetMet = pooledInvestmentTarget <= 0 || totalCommitted >= pooledInvestmentTarget;
  const votePassed = totalCommitted > 0 && effectiveYesPct >= voteThreshold;
  const requirementsMet = targetMet && votePassed;

  return {
    voteClosesOn,
    votingClosed,
    voteThreshold,
    memberCount: weights.size,
    voteCount: voteMap.size,
    totalCommitted,
    pooledInvestmentTarget,
    amountRemaining: roundCurrency(Math.max(pooledInvestmentTarget - totalCommitted, 0)),
    yesWeight,
    noWeight,
    abstainWeight,
    effectiveYesWeight,
    yesPct: totalCommitted > 0 ? roundCurrency(yesWeight / totalCommitted) : 0,
    noPct: totalCommitted > 0 ? roundCurrency(noWeight / totalCommitted) : 0,
    abstainPct: totalCommitted > 0 ? roundCurrency(abstainWeight / totalCommitted) : 0,
    effectiveYesPct,
    targetMet,
    votePassed,
    requirementsMet,
    canFund: votingClosed && requirementsMet,
    canManagerOverrideFund: votingClosed && totalCommitted > 0 && !requirementsMet,
    members: [...weights.entries()].map(([participantId, amount]) => {
      const vote = voteMap.get(participantId);

      return {
        participantId,
        amount,
        ownershipPct: totalCommitted > 0 ? roundCurrency(amount / totalCommitted) : 0,
        voteChoice: vote?.voteChoice ?? (votingClosed ? "yes" : ""),
        voteCountedByDeadline: !vote && votingClosed,
        votedAt: vote?.updatedAt ?? null
      };
    })
  };
}

function buildProjectPooledRequestBuckets(data, asOfDate) {
  const participantMap = getParticipantMap(data);
  const userMap = getUserMapByParticipantId(data);

  return (data.deals ?? [])
    .filter((deal) => deal.status !== "sold")
    .filter((deal) => Boolean(Number(deal.pooledInvestmentAllowed ?? 0)))
    .map((deal) => {
      const pooledRequests = (data.userAllocationRequests ?? [])
        .filter(
          (request) =>
            request.dealId === deal.id &&
            request.allocationMode === "pooled" &&
            ["pending", "approved"].includes(request.status) &&
            !request.createdPositionId
        )
        .sort((left, right) =>
          String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? ""))
        );
      const approvedRequests = pooledRequests.filter((request) => request.status === "approved");
      const pendingRequests = pooledRequests.filter((request) => request.status === "pending");
      const voteSummary = buildProjectPoolVoteSummaryForRequests({
        deal,
        requests: approvedRequests,
        votes: data.projectPoolVotes ?? [],
        asOfDate
      });
      const pendingAmount = roundCurrency(
        pendingRequests.reduce((sum, request) => sum + Number(request.amount ?? 0), 0)
      );

      return {
        dealId: deal.id,
        dealName: deal.name,
        location: deal.location,
        investmentCloseOn: deal.investmentCloseOn ?? null,
        investmentWindowClosed: isDateClosed(deal.investmentCloseOn, asOfDate),
        pooledInvestmentTarget: voteSummary.pooledInvestmentTarget,
        approvedAmount: voteSummary.totalCommitted,
        committedAmount: voteSummary.totalCommitted,
        pendingAmount,
        amountRemaining: voteSummary.amountRemaining,
        requestCount: pooledRequests.length,
        approvedRequestCount: approvedRequests.length,
        pendingRequestCount: pendingRequests.length,
        memberCount: voteSummary.memberCount,
        voteCount: voteSummary.voteCount,
        voteThreshold: voteSummary.voteThreshold,
        voteClosesOn: voteSummary.voteClosesOn,
        votingClosed: voteSummary.votingClosed,
        yesWeight: voteSummary.yesWeight,
        noWeight: voteSummary.noWeight,
        abstainWeight: voteSummary.abstainWeight,
        effectiveYesPct: voteSummary.effectiveYesPct,
        targetMet: voteSummary.targetMet,
        votePassed: voteSummary.votePassed,
        requirementsMet: voteSummary.requirementsMet,
        canFund: approvedRequests.length > 0 && voteSummary.canFund,
        canManagerOverrideFund:
          approvedRequests.length > 0 && voteSummary.canManagerOverrideFund,
        canManagerFund:
          approvedRequests.length > 0 &&
          (voteSummary.canFund || voteSummary.canManagerOverrideFund),
        requests: pooledRequests.map((request) => {
          const participant = participantMap.get(request.participantId);
          const user = userMap.get(request.participantId);
          const member = voteSummary.members.find(
            (item) => item.participantId === request.participantId
          );

          return {
            id: request.id,
            participantId: request.participantId,
            participantName: participant?.name ?? request.participantName,
            participantEmail: user?.email ?? request.participantEmail,
            amount: Number(request.amount ?? 0),
            status: request.status,
            voteChoice: member?.voteChoice ?? "",
            ownershipPct: member?.ownershipPct ?? 0,
            submittedAt: request.submittedAt ?? request.createdAt
          };
        })
      };
    })
    .filter((bucket) => !bucket.investmentWindowClosed || bucket.requestCount > 0)
    .sort((left, right) => {
      if (left.canManagerFund !== right.canManagerFund) {
        return left.canManagerFund ? -1 : 1;
      }

      if (left.requestCount !== right.requestCount) {
        return right.requestCount - left.requestCount;
      }

      return left.dealName.localeCompare(right.dealName);
    });
}

function buildParticipantProjectPoolViews(data, participantId) {
  const dealMap = new Map((data.deals ?? []).map((deal) => [deal.id, deal]));
  const positionMap = new Map((data.positions ?? []).map((position) => [position.id, position]));
  const withdrawalMap = getApprovedWithdrawalAmountByPositionParticipant(data);
  const requestsByDeal = new Map();
  const voteMap = new Map(
    (data.projectPoolVotes ?? []).map((vote) => [`${vote.dealId}:${vote.participantId}`, vote])
  );
  const waterfallCache = new Map();

  for (const request of data.userAllocationRequests ?? []) {
    if (request.allocationMode !== "pooled") {
      continue;
    }

    if (!requestsByDeal.has(request.dealId)) {
      requestsByDeal.set(request.dealId, []);
    }

    requestsByDeal.get(request.dealId).push(request);
  }

  function getWaterfallForDeal(dealId) {
    if (!waterfallCache.has(dealId)) {
      const deal = dealMap.get(dealId);
      const dealPositions = (data.positions ?? []).filter((position) => position.dealId === dealId);
      waterfallCache.set(dealId, deal ? calculateWaterfall({ deal, positions: dealPositions }) : null);
    }

    return waterfallCache.get(dealId);
  }

  return [...requestsByDeal.entries()]
    .map(([dealId, dealRequests]) => {
      const deal = dealMap.get(dealId);

      if (!deal) {
        return null;
      }

      const myRequests = dealRequests.filter((request) => request.participantId === participantId);

      if (!myRequests.length) {
        return null;
      }

      const activeApprovedRequests = dealRequests.filter(
        (request) => request.status === "approved" && !request.createdPositionId
      );
      const activePendingRequests = dealRequests.filter(
        (request) => request.status === "pending" && !request.createdPositionId
      );
      const voteSummary = buildProjectPoolVoteSummaryForRequests({
        deal,
        requests: activeApprovedRequests,
        votes: data.projectPoolVotes ?? [],
        asOfDate: data.asOfDate
      });
      const myActiveApprovedAmount = roundCurrency(
        myRequests
          .filter((request) => request.status === "approved" && !request.createdPositionId)
          .reduce((sum, request) => sum + Number(request.amount ?? 0), 0)
      );
      const myPendingAmount = roundCurrency(
        myRequests
          .filter((request) => request.status === "pending" && !request.createdPositionId)
          .reduce((sum, request) => sum + Number(request.amount ?? 0), 0)
      );
      const myRejectedAmount = roundCurrency(
        myRequests
          .filter((request) => request.status === "rejected")
          .reduce((sum, request) => sum + Number(request.amount ?? 0), 0)
      );
      const fundedRequest = myRequests.find(
        (request) => request.status === "approved" && request.createdPositionId
      );
      const fundedPositionId = fundedRequest?.createdPositionId ?? null;
      const fundedGroupRequests = fundedPositionId
        ? dealRequests.filter(
            (request) =>
              request.status === "approved" && request.createdPositionId === fundedPositionId
          )
        : [];
      const fundedGroupTotal = roundCurrency(
        fundedGroupRequests.reduce(
          (sum, request) =>
            sum +
            getEffectiveCapitalAfterWithdrawal({
              amount: request.amount,
              positionId: fundedPositionId,
              participantId: request.participantId,
              withdrawalMap
            }),
          0
        )
      );
      const myFundedAmount = roundCurrency(
        fundedGroupRequests
          .filter((request) => request.participantId === participantId)
          .reduce(
            (sum, request) =>
              sum +
              getEffectiveCapitalAfterWithdrawal({
                amount: request.amount,
                positionId: fundedPositionId,
                participantId: request.participantId,
                withdrawalMap
              }),
            0
          )
      );
      const poolPosition = fundedPositionId ? positionMap.get(fundedPositionId) ?? null : null;
      const waterfall = poolPosition ? getWaterfallForDeal(deal.id) : null;
      const poolResult = poolPosition
        ? getPositionResultMap(waterfall?.participantResults ?? []).get(poolPosition.id) ?? null
        : null;
      const fundedSharePct = fundedGroupTotal > 0 ? myFundedAmount / fundedGroupTotal : 0;
      const activeMember = voteSummary.members.find((member) => member.participantId === participantId);
      const activeSharePct = activeMember?.ownershipPct ?? 0;
      const vote = voteMap.get(`${deal.id}:${participantId}`);
      const status = fundedPositionId
        ? myFundedAmount > 0
          ? "funded"
          : "withdrawn"
        : myActiveApprovedAmount > 0
          ? "voting"
          : myPendingAmount > 0
            ? "pending_approval"
            : "rejected";
      const sharePct = fundedPositionId ? fundedSharePct : activeSharePct;
      const currentPrefEarned =
        poolPosition && deal.status !== "sold"
          ? roundCurrency(calculateCurrentPref(poolPosition, deal, data.asOfDate) * sharePct)
          : 0;
      const projectedPrefEarned = poolPosition
        ? roundCurrency(
            (deal.status === "sold"
              ? poolResult?.prefEarned ?? 0
              : calculateProjectedPref(poolPosition, deal)) * sharePct
          )
        : 0;

      return {
        id: `project-pool-${deal.id}`,
        dealId: deal.id,
        dealName: deal.name,
        name: `${deal.name} Project Pool`,
        location: deal.location,
        status,
        statusLabel:
          status === "pending_approval"
            ? "Pending approval"
            : status === "funded"
              ? "Funded"
              : status === "withdrawn"
                ? "Withdrawn"
              : status === "voting"
                ? "Voting"
                : "Rejected",
        minimumCapitalAmount: roundCurrency(deal.pooledInvestmentTarget ?? 0),
        totalCommitted: fundedPositionId ? fundedGroupTotal : voteSummary.totalCommitted,
        amountRemaining: fundedPositionId ? 0 : voteSummary.amountRemaining,
        memberCount: fundedPositionId ? fundedGroupRequests.length : voteSummary.memberCount,
        voteThreshold: voteSummary.voteThreshold,
        voteClosesOn: voteSummary.voteClosesOn,
        votingClosed: voteSummary.votingClosed,
        votePassed: voteSummary.votePassed,
        effectiveYesPct: voteSummary.effectiveYesPct,
        myCommitmentAmount:
          myFundedAmount || myActiveApprovedAmount || myPendingAmount || myRejectedAmount,
        mySharePct: sharePct,
        myVoteChoice: vote?.voteChoice ?? "",
        canVote: myActiveApprovedAmount > 0 && !voteSummary.votingClosed && !fundedPositionId,
        project: poolPosition
          ? {
              id: deal.id,
              name: deal.name,
              location: deal.location,
              status: deal.status,
              statusLabel: statusLabel(deal.status),
              currentPhase: deal.currentPhase,
              timelineProgress: resolveTimelineProgress(deal.status, deal.timelineProgress),
              timeline: deal.timeline,
              totalEquity: waterfall?.totalEquity ?? deal.totalEquity ?? 0,
              totalDebt: waterfall?.totalDebt ?? 0,
              totalProjectCost: waterfall?.totalProjectCost ?? deal.actualProjectCost ?? 0,
              salePrice: waterfall?.salePrice ?? deal.salePrice ?? 0,
              salePriceLabel: deal.status === "sold" ? "Sale price" : "Projected sale price"
            }
          : null,
        myPosition: {
          amountInvested: myFundedAmount,
          pendingCommittedAmount: myPendingAmount + myActiveApprovedAmount,
          sharePct,
          currentPrefEarned,
          projectedPrefEarned,
          estimatedTotalReturn: roundCurrency((poolResult?.totalPayout ?? 0) * sharePct),
          capitalReturned: roundCurrency((poolResult?.capitalReturned ?? 0) * sharePct),
          profitReturned: roundCurrency(
            ((poolResult?.prefEarned ?? 0) + (poolResult?.profitShare ?? 0)) * sharePct
          ),
          totalAmountPayout: roundCurrency((poolPosition?.distributionsToDate ?? 0) * sharePct)
        }
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const statusOrder = {
        voting: 0,
        pending_approval: 1,
        funded: 2,
        withdrawn: 3,
        rejected: 4
      };
      const leftOrder = statusOrder[left.status] ?? 9;
      const rightOrder = statusOrder[right.status] ?? 9;

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      return left.dealName.localeCompare(right.dealName);
    });
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
    payoutNotes: participant?.payoutNotes ?? "",
    dwolla: buildDwollaAccountPayload(user)
  };
}

function buildNotificationCenter(user, data = seedData) {
  const managerActionSubjects = [
    "Account approval requested:",
    "Account funds deposit submitted:",
    "Project allocation request submitted:",
    "Investor distribution election submitted",
    "Early withdrawal request submitted",
    "Pool vote submitted:"
  ];
  const items = (data.emailNotifications ?? [])
    .filter((notification) => notification.userId === user.id)
    .filter((notification) => !notification.clearedAt)
    .filter(
      (notification) =>
        user.role !== "manager" ||
        managerActionSubjects.some((subjectPrefix) =>
          String(notification.subject ?? "").startsWith(subjectPrefix)
        )
    )
    .map((notification) => {
      const bodyLines = String(notification.bodyText ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      return {
        id: notification.id,
        subject: notification.subject ?? "Portal notification",
        bodyPreview: bodyLines.find((line) => !line.toLowerCase().startsWith("hello ")) ?? "",
        status: notification.status ?? "queued",
        provider: notification.provider ?? "",
        localPath: notification.localPath ?? null,
        errorMessage: notification.errorMessage ?? null,
        createdAt: notification.createdAt ?? null,
        sentAt: notification.sentAt ?? null,
        readAt: notification.readAt ?? null,
        clearedAt: notification.clearedAt ?? null,
        isUnread: !notification.readAt
      };
    })
    .sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")));

  return {
    unreadCount: items.filter((notification) => notification.isUnread).length,
    items: items.slice(0, 10)
  };
}

function sortUserQuestions(left, right) {
  if (left.status === "open" && right.status !== "open") {
    return -1;
  }

  if (left.status !== "open" && right.status === "open") {
    return 1;
  }

  return String(right.updatedAt ?? right.createdAt ?? "").localeCompare(
    String(left.updatedAt ?? left.createdAt ?? "")
  );
}

function buildParticipantQuestions(data, participantId) {
  return (data.userQuestions ?? [])
    .filter((question) => question.participantId === participantId)
    .slice()
    .sort(sortUserQuestions);
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

function hasApprovedDistributionElection(election) {
  const approvalStatus = election?.approvalStatus ?? (election?.reviewedAt ? "approved" : "pending");

  return approvalStatus === "approved";
}

function getEarlyWithdrawalRequestMap(data) {
  return new Map(
    (data.earlyWithdrawalRequests ?? []).map((request) => [
      `${request.dealId}:${request.participantId}`,
      request
    ])
  );
}

function getApprovedWithdrawalAmountByPositionParticipant(data) {
  const withdrawalMap = new Map();

  for (const request of data.earlyWithdrawalRequests ?? []) {
    if (request.requestStatus !== "approved" || !request.positionId) {
      continue;
    }

    const key = `${request.positionId}:${request.participantId}`;
    withdrawalMap.set(
      key,
      roundCurrency(
        (withdrawalMap.get(key) ?? 0) + Number(request.requestedCapitalAmount ?? 0)
      )
    );
  }

  return withdrawalMap;
}

function getEffectiveCapitalAfterWithdrawal({
  amount,
  positionId,
  participantId,
  withdrawalMap
}) {
  const withdrawnAmount = withdrawalMap.get(`${positionId}:${participantId}`) ?? 0;

  return roundCurrency(Math.max(Number(amount ?? 0) - withdrawnAmount, 0));
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
    id: election?.id ?? null,
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
    electionDueOn: deal.distributionElectionDueOn ?? null,
    createdAt: election?.createdAt ?? null,
    updatedAt: election?.updatedAt ?? null,
    payoutMethod: participant?.payoutMethod ?? "",
    totalPayout
  };
}

function archivedValue(source, camelKey, snakeKey = camelKey, fallback = null) {
  if (!source || typeof source !== "object") {
    return fallback;
  }

  return source[camelKey] ?? source[snakeKey] ?? fallback;
}

function archivedNumber(source, camelKey, snakeKey = camelKey, fallback = 0) {
  return resolveNumber(archivedValue(source, camelKey, snakeKey, fallback), fallback);
}

function mapArchivedDeal(payload) {
  const deal = payload?.deal ?? {};

  return {
    id: archivedValue(deal, "id"),
    name: archivedValue(deal, "name", "name", "Archived project"),
    location: archivedValue(deal, "location", "location", ""),
    totalEquity: archivedNumber(deal, "totalEquity", "total_equity"),
    debt: archivedNumber(deal, "debt"),
    taxExpense: archivedNumber(deal, "taxExpense", "tax_expense"),
    debtInterestRate: archivedNumber(deal, "debtInterestRate", "debt_interest_rate"),
    totalInterestPaid: archivedNumber(deal, "totalInterestPaid", "total_interest_paid"),
    budgetedProjectCost: archivedNumber(deal, "budgetedProjectCost", "budgeted_project_cost"),
    actualProjectCost: archivedValue(deal, "actualProjectCost", "actual_project_cost", null),
    totalProjectCost: archivedNumber(deal, "totalProjectCost", "total_project_cost"),
    salePrice: archivedNumber(deal, "salePrice", "sale_price"),
    holdMonths: archivedNumber(deal, "holdMonths", "hold_months"),
    prefRate: archivedNumber(deal, "prefRate", "pref_rate"),
    status: archivedValue(deal, "status", "status", "sold"),
    currentPhase: archivedValue(deal, "currentPhase", "current_phase", "Archived"),
    fundedOn: archivedValue(deal, "fundedOn", "funded_on", null),
    projectedExitOn: archivedValue(deal, "projectedExitOn", "projected_exit_on", null),
    actualExitOn: archivedValue(deal, "actualExitOn", "actual_exit_on", null),
    timelineProgress: archivedNumber(deal, "timelineProgress", "timeline_progress", 100),
    earlyWithdrawalPenaltyRate: archivedNumber(
      deal,
      "earlyWithdrawalPenaltyRate",
      "early_withdrawal_penalty_rate",
      0.3
    ),
    promoteTiers: (payload?.promoteTiers ?? []).map((tier) => ({
      label: archivedValue(tier, "label", "label", ""),
      hurdle: archivedNumber(tier, "hurdle"),
      investorShare: archivedNumber(tier, "investorShare", "investor_share"),
      sponsorShare: archivedNumber(tier, "sponsorShare", "sponsor_share"),
      sortOrder: archivedNumber(tier, "sortOrder", "sort_order"),
      isEnabled:
        archivedValue(tier, "isEnabled", "is_enabled", true) !== false &&
        archivedValue(tier, "isEnabled", "is_enabled", true) !== 0
    })),
    expenseEntries: (payload?.expenseEntries ?? []).map((entry) => ({
      amountPaid: archivedNumber(entry, "amountPaid", "amount_paid"),
      paidOn: archivedValue(entry, "paidOn", "paid_on", null),
      sortOrder: archivedNumber(entry, "sortOrder", "sort_order")
    })),
    debtServiceEntries: (payload?.debtServiceEntries ?? []).map((entry) => ({
      serviceMonth: archivedValue(entry, "serviceMonth", "interest_month", ""),
      drawBalance: archivedNumber(entry, "drawBalance", "draw_balance"),
      interestPaid: archivedNumber(entry, "interestPaid", "interest_paid")
    }))
  };
}

function mapArchivedPosition(position) {
  return {
    id: archivedValue(position, "id"),
    dealId: archivedValue(position, "dealId", "deal_id"),
    participantId: archivedValue(position, "participantId", "participant_id"),
    participantName: archivedValue(position, "participantName", "participant_name", "Investor"),
    participantCategory: archivedValue(position, "participantCategory", "participant_category", ""),
    classType: archivedValue(position, "classType", "class_type", "Class A"),
    contributionType: archivedValue(position, "contributionType", "contribution_type", ""),
    contributionAmount: archivedNumber(position, "contributionAmount", "contribution_amount"),
    distributionsToDate: archivedNumber(position, "distributionsToDate", "distributions_to_date")
  };
}

function mapArchivedDistributionElection(election) {
  return {
    id: archivedValue(election, "id"),
    dealId: archivedValue(election, "dealId", "deal_id"),
    participantId: archivedValue(election, "participantId", "participant_id"),
    participantName: archivedValue(election, "participantName", "participant_name", "Investor"),
    electionMode: archivedValue(election, "electionMode", "election_mode", null),
    reinvestPercent:
      archivedValue(election, "reinvestPercent", "reinvest_percent", null) === null
        ? null
        : archivedNumber(election, "reinvestPercent", "reinvest_percent"),
    reinvestAmount:
      archivedValue(election, "reinvestAmount", "reinvest_amount", null) === null
        ? null
        : archivedNumber(election, "reinvestAmount", "reinvest_amount"),
    rolloverTargetDealId: archivedValue(
      election,
      "rolloverTargetDealId",
      "rollover_target_deal_id",
      null
    ),
    rolloverTargetDealName: archivedValue(
      election,
      "rolloverTargetDealName",
      "rollover_target_deal_name",
      null
    ),
    notes: archivedValue(election, "notes", "notes", ""),
    submittedByUserId: archivedValue(election, "submittedByUserId", "submitted_by_user_id", null),
    submittedByRole: archivedValue(election, "submittedByRole", "submitted_by_role", null),
    approvalStatus: archivedValue(election, "approvalStatus", "approval_status", null),
    approvedReinvestAmount:
      archivedValue(election, "approvedReinvestAmount", "approved_reinvest_amount", null) === null
        ? null
        : archivedNumber(election, "approvedReinvestAmount", "approved_reinvest_amount"),
    approvedCashPayoutAmount:
      archivedValue(election, "approvedCashPayoutAmount", "approved_cash_payout_amount", null) === null
        ? null
        : archivedNumber(election, "approvedCashPayoutAmount", "approved_cash_payout_amount"),
    payoutExpectedOn: archivedValue(election, "payoutExpectedOn", "payout_expected_on", null),
    reviewedAt: archivedValue(election, "reviewedAt", "reviewed_at", null),
    managerOverride: Boolean(archivedValue(election, "managerOverride", "manager_override", false)),
    overrideNotes: archivedValue(election, "overrideNotes", "override_notes", ""),
    createdAt: archivedValue(election, "createdAt", "created_at", null),
    updatedAt: archivedValue(election, "updatedAt", "updated_at", null)
  };
}

function buildArchivedProjectSnapshots(data) {
  const participantMap = getParticipantMap(data);
  const currentDealMap = new Map((data.deals ?? []).map((deal) => [deal.id, deal]));
  const currentPoolsByPoolParticipantId = new Map(
    (data.investorPools ?? []).map((pool) => [pool.poolParticipantId, pool])
  );
  const currentPoolCommitmentsByPoolId = new Map();

  for (const commitment of data.investorPoolCommitments ?? []) {
    if (!currentPoolCommitmentsByPoolId.has(commitment.poolId)) {
      currentPoolCommitmentsByPoolId.set(commitment.poolId, []);
    }

    currentPoolCommitmentsByPoolId.get(commitment.poolId).push(commitment);
  }

  return (data.archivedRecords ?? [])
    .filter((record) => record.entityType === "deal" || record.sourceTable === "deals")
    .map((record) => {
      const payload = record.payloadJson ?? {};
      const deal = mapArchivedDeal(payload);
      const positions = (payload.positions ?? []).map((position) => mapArchivedPosition(position));
      const elections = (payload.distributionElections ?? []).map((election) =>
        mapArchivedDistributionElection(election)
      );
      const archivedPoolsByPoolParticipantId = new Map(
        (payload.investorPools ?? []).map((pool) => [
          archivedValue(pool, "poolParticipantId", "pool_participant_id"),
          pool
        ])
      );
      const archivedPoolCommitmentsByPoolId = new Map();

      for (const commitment of payload.investorPoolCommitments ?? []) {
        const poolId = archivedValue(commitment, "poolId", "pool_id");

        if (!poolId) {
          continue;
        }

        if (!archivedPoolCommitmentsByPoolId.has(poolId)) {
          archivedPoolCommitmentsByPoolId.set(poolId, []);
        }

        archivedPoolCommitmentsByPoolId.get(poolId).push(commitment);
      }

      const archivedProjectPoolRequestsByPositionId = new Map();

      for (const request of payload.userAllocationRequests ?? []) {
        const allocationMode = archivedValue(request, "allocationMode", "allocation_mode", "");
        const status = archivedValue(request, "status", "status", "");
        const createdPositionId = archivedValue(
          request,
          "createdPositionId",
          "created_position_id",
          null
        );

        if (allocationMode !== "pooled" || status !== "approved" || !createdPositionId) {
          continue;
        }

        if (!archivedProjectPoolRequestsByPositionId.has(createdPositionId)) {
          archivedProjectPoolRequestsByPositionId.set(createdPositionId, []);
        }

        archivedProjectPoolRequestsByPositionId.get(createdPositionId).push(request);
      }

      const electionMap = new Map(
        elections.map((election) => [`${election.dealId}:${election.participantId}`, election])
      );
      const waterfall = calculateWaterfall({ deal, positions });
      const archivedDealMap = new Map(currentDealMap);
      archivedDealMap.set(deal.id, deal);

      const investorRows = positions.map((position) => {
        const result =
          waterfall.participantResults.find((row) => row.positionId === position.id) ?? {};
        const participant = participantMap.get(position.participantId) ?? {
          id: position.participantId,
          name: position.participantName
        };
        const election = electionMap.get(`${deal.id}:${position.participantId}`) ?? null;
        const distributionPlan = buildDistributionPlan({
          deal,
          position,
          participant,
          result,
          election,
          dealMap: archivedDealMap
        });
        const reinvestedAmount = distributionPlan.approvedReinvestedAmount;
        const totalAmountPayout =
          distributionPlan.approvalStatus === "approved"
            ? distributionPlan.approvedCashPayoutAmount
            : position.distributionsToDate;

        return {
          participantId: position.participantId,
          participantName: participant?.name ?? position.participantName,
          classType: position.classType,
          totalInvested: roundCurrency(position.contributionAmount),
          totalReturned: roundCurrency((result.prefEarned ?? 0) + (result.profitShare ?? 0)),
          totalPayout: roundCurrency(result.totalPayout ?? 0),
          totalAmountPayout: roundCurrency(totalAmountPayout),
          electionMode: distributionPlan.electionMode,
          electionStatus: distributionPlan.approvalStatus,
          reinvestedAmount,
          cashPayoutAmount: distributionPlan.approvedCashPayoutAmount,
          rolloverTargetDealName:
            election?.rolloverTargetDealName ?? distributionPlan.rolloverTargetDealName ?? null,
          notes: distributionPlan.notes,
          reviewedAt: distributionPlan.reviewedAt,
          payoutExpectedOn: distributionPlan.payoutExpectedOn
        };
      });
      const pooledMemberRows = positions
        .filter((position) => {
          const participantCategory =
            participantMap.get(position.participantId)?.category ?? position.participantCategory;
          return participantCategory === "pool";
        })
        .flatMap((position) => {
          const archivedPool = archivedPoolsByPoolParticipantId.get(position.participantId);
          const currentPool = currentPoolsByPoolParticipantId.get(position.participantId);
          const pool = archivedPool ?? currentPool;
          const poolId = archivedValue(pool, "id");

          if (!poolId) {
            return [];
          }

          const commitments =
            archivedPoolCommitmentsByPoolId.get(poolId) ??
            currentPoolCommitmentsByPoolId.get(poolId) ??
            [];
          const normalizedCommitments = commitments
            .map((commitment) => ({
              participantId: archivedValue(commitment, "participantId", "participant_id"),
              participantName: archivedValue(
                commitment,
                "participantName",
                "participant_name",
                "Pooled member"
              ),
              commitmentAmount: archivedNumber(
                commitment,
                "commitmentAmount",
                "commitment_amount"
              )
            }))
            .filter((commitment) => commitment.participantId && commitment.commitmentAmount > 0);
          const totalCommitted = roundCurrency(
            normalizedCommitments.reduce(
              (sum, commitment) => sum + commitment.commitmentAmount,
              0
            )
          );

          if (totalCommitted <= 0) {
            return [];
          }

          const poolResult =
            waterfall.participantResults.find((row) => row.positionId === position.id) ?? {};
          const poolName =
            archivedValue(pool, "name", "name", null) ??
            position.participantName ??
            "Pooled capital group";

          return normalizedCommitments.map((commitment) => {
            const sharePct = commitment.commitmentAmount / totalCommitted;
            const participant = participantMap.get(commitment.participantId) ?? {
              id: commitment.participantId,
              name: commitment.participantName
            };
            const election = electionMap.get(`${deal.id}:${commitment.participantId}`) ?? null;
            const result = {
              positionId: `${position.id}:${commitment.participantId}`,
              participantId: commitment.participantId,
              classType: position.classType,
              contributionAmount: commitment.commitmentAmount,
              ownershipPct: (poolResult.ownershipPct ?? 0) * sharePct,
              capitalReturned: roundCurrency((poolResult.capitalReturned ?? 0) * sharePct),
              prefEarned: roundCurrency((poolResult.prefEarned ?? 0) * sharePct),
              profitShare: roundCurrency((poolResult.profitShare ?? 0) * sharePct),
              totalPayout: roundCurrency((poolResult.totalPayout ?? 0) * sharePct)
            };
            const distributionPlan = buildDistributionPlan({
              deal,
              position: {
                id: result.positionId,
                dealId: deal.id,
                participantId: commitment.participantId,
                classType: position.classType,
                contributionType: "Pooled commitment",
                contributionAmount: commitment.commitmentAmount,
                distributionsToDate: roundCurrency(position.distributionsToDate * sharePct)
              },
              participant,
              result,
              election,
              dealMap: archivedDealMap
            });
            const totalAmountPayout =
              distributionPlan.approvalStatus === "approved"
                ? distributionPlan.approvedCashPayoutAmount
                : roundCurrency(position.distributionsToDate * sharePct);

            return {
              participantId: commitment.participantId,
              participantName: `${participant?.name ?? commitment.participantName} (via ${poolName})`,
              classType: `${position.classType} pooled`,
              totalInvested: roundCurrency(commitment.commitmentAmount),
              totalReturned: roundCurrency(result.prefEarned + result.profitShare),
              totalPayout: result.totalPayout,
              totalAmountPayout: roundCurrency(totalAmountPayout),
              electionMode: distributionPlan.electionMode,
              electionStatus: distributionPlan.approvalStatus,
              reinvestedAmount: distributionPlan.approvedReinvestedAmount,
              cashPayoutAmount: distributionPlan.approvedCashPayoutAmount,
              rolloverTargetDealName:
                election?.rolloverTargetDealName ?? distributionPlan.rolloverTargetDealName ?? null,
              notes: distributionPlan.notes,
              reviewedAt: distributionPlan.reviewedAt,
              payoutExpectedOn: distributionPlan.payoutExpectedOn,
              isPooledMember: true,
              sourcePoolName: poolName
            };
          });
        });
      const projectPooledMemberRows = positions
        .filter((position) => {
          const participantCategory =
            participantMap.get(position.participantId)?.category ?? position.participantCategory;
          return participantCategory === "pool";
        })
        .flatMap((position) => {
          const requests = archivedProjectPoolRequestsByPositionId.get(position.id) ?? [];
          const normalizedRequests = requests
            .map((request) => ({
              participantId: archivedValue(request, "participantId", "participant_id"),
              participantName: archivedValue(
                request,
                "participantName",
                "participant_name",
                "Investor"
              ),
              amount: archivedNumber(request, "amount", "amount")
            }))
            .filter((request) => request.participantId && request.amount > 0);
          const totalCommitted = roundCurrency(
            normalizedRequests.reduce((sum, request) => sum + request.amount, 0)
          );

          if (totalCommitted <= 0) {
            return [];
          }

          const poolResult =
            waterfall.participantResults.find((row) => row.positionId === position.id) ?? {};
          const poolName = `${deal.name} Project Pool`;

          return normalizedRequests.map((request) => {
            const sharePct = request.amount / totalCommitted;
            const participant = participantMap.get(request.participantId) ?? {
              id: request.participantId,
              name: request.participantName
            };
            const election = electionMap.get(`${deal.id}:${request.participantId}`) ?? null;
            const result = {
              positionId: `${position.id}:${request.participantId}`,
              participantId: request.participantId,
              classType: position.classType,
              contributionAmount: request.amount,
              ownershipPct: (poolResult.ownershipPct ?? 0) * sharePct,
              capitalReturned: roundCurrency((poolResult.capitalReturned ?? 0) * sharePct),
              prefEarned: roundCurrency((poolResult.prefEarned ?? 0) * sharePct),
              profitShare: roundCurrency((poolResult.profitShare ?? 0) * sharePct),
              totalPayout: roundCurrency((poolResult.totalPayout ?? 0) * sharePct)
            };
            const distributionPlan = buildDistributionPlan({
              deal,
              position: {
                id: result.positionId,
                dealId: deal.id,
                participantId: request.participantId,
                classType: position.classType,
                contributionType: "Project pooled commitment",
                contributionAmount: request.amount,
                distributionsToDate: roundCurrency(position.distributionsToDate * sharePct)
              },
              participant,
              result,
              election,
              dealMap: archivedDealMap
            });
            const totalAmountPayout =
              distributionPlan.approvalStatus === "approved"
                ? distributionPlan.approvedCashPayoutAmount
                : roundCurrency(position.distributionsToDate * sharePct);

            return {
              participantId: request.participantId,
              participantName: `${participant?.name ?? request.participantName} (via ${poolName})`,
              classType: `${position.classType} pooled`,
              totalInvested: roundCurrency(request.amount),
              totalReturned: roundCurrency(result.prefEarned + result.profitShare),
              totalPayout: result.totalPayout,
              totalAmountPayout: roundCurrency(totalAmountPayout),
              electionMode: distributionPlan.electionMode,
              electionStatus: distributionPlan.approvalStatus,
              reinvestedAmount: distributionPlan.approvedReinvestedAmount,
              cashPayoutAmount: distributionPlan.approvedCashPayoutAmount,
              rolloverTargetDealName:
                election?.rolloverTargetDealName ?? distributionPlan.rolloverTargetDealName ?? null,
              notes: distributionPlan.notes,
              reviewedAt: distributionPlan.reviewedAt,
              payoutExpectedOn: distributionPlan.payoutExpectedOn,
              isPooledMember: true,
              sourcePoolName: poolName
            };
          });
        });
      investorRows.push(...pooledMemberRows, ...projectPooledMemberRows);

      return {
        id: record.id,
        archivedRecordId: record.id,
        dealId: deal.id ?? record.entityId,
        name: deal.name ?? record.displayName ?? "Archived project",
        location: deal.location ?? "",
        status: deal.status,
        statusLabel: statusLabel(deal.status),
        archivedAt: record.deletedAt ?? record.createdAt,
        archivedByName: record.deletedByName ?? "",
        archivedByEmail: record.deletedByEmail ?? "",
        salePrice: waterfall.salePrice,
        totalProjectCost: waterfall.totalProjectCost,
        totalEquity: waterfall.totalEquity,
        totalDebt: waterfall.totalDebt,
        netProjectProfit: waterfall.netProjectProfit,
        sponsorPromote: waterfall.sponsorPromote,
        investorProfitPool: waterfall.investorProfitPool,
        positionCount: positions.length,
        distributionElectionCount: elections.length,
        resourceCount: (payload.companyResources ?? []).length,
        issueCount: (payload.issues ?? []).length,
        investorRows
      };
    });
}

function buildArchivedProjectHistoryForParticipant(data, participantId) {
  return buildArchivedProjectSnapshots(data)
    .flatMap((archivedProject) =>
      archivedProject.investorRows
        .filter((row) => row.participantId === participantId)
        .map((row) => ({
          id: `${archivedProject.archivedRecordId}:${row.participantId}:${row.sourcePoolName ?? "direct"}`,
          archivedRecordId: archivedProject.archivedRecordId,
          dealId: archivedProject.dealId,
          projectName: archivedProject.name,
          archivedAt: archivedProject.archivedAt,
          totalInvested: row.totalInvested,
          totalReturned: row.totalReturned,
          totalAmountPayout: row.totalAmountPayout,
          totalPayout: row.totalPayout,
          electionMode: row.electionMode,
          electionStatus: row.electionStatus,
          reinvestedAmount: row.reinvestedAmount,
          cashPayoutAmount: row.cashPayoutAmount,
          rolloverTargetDealName: row.rolloverTargetDealName,
          reviewedAt: row.reviewedAt,
          payoutExpectedOn: row.payoutExpectedOn,
          sourcePoolName: row.sourcePoolName ?? null
        }))
    )
    .sort((left, right) => String(right.archivedAt ?? "").localeCompare(String(left.archivedAt ?? "")));
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

function buildEarlyWithdrawalContextsForParticipant(data, participantId) {
  const dealMap = new Map((data.deals ?? []).map((deal) => [deal.id, deal]));
  const positionById = new Map((data.positions ?? []).map((position) => [position.id, position]));
  const withdrawalMap = getApprovedWithdrawalAmountByPositionParticipant(data);
  const requestMap = getEarlyWithdrawalRequestMap(data);
  const contexts = [];

  for (const position of data.positions ?? []) {
    if (position.participantId !== participantId) {
      continue;
    }

    const deal = dealMap.get(position.dealId);

    if (!deal || deal.status === "sold") {
      continue;
    }

    const currentContributionAmount = getEffectiveCapitalAfterWithdrawal({
      amount: position.contributionAmount,
      positionId: position.id,
      participantId,
      withdrawalMap
    });

    contexts.push({
      key: `${position.dealId}:${position.id}:direct`,
      deal,
      position: {
        ...position,
        contributionAmount: currentContributionAmount
      },
      positionId: position.id,
      sourceKind: "direct",
      sourceName: position.contributionType || "Direct investor position"
    });
  }

  const projectPoolRequestsByPositionId = new Map();

  for (const request of data.userAllocationRequests ?? []) {
    if (
      request.participantId !== participantId ||
      request.allocationMode !== "pooled" ||
      request.status !== "approved" ||
      !request.createdPositionId
    ) {
      continue;
    }

    if (!projectPoolRequestsByPositionId.has(request.createdPositionId)) {
      projectPoolRequestsByPositionId.set(request.createdPositionId, []);
    }

    projectPoolRequestsByPositionId.get(request.createdPositionId).push(request);
  }

  for (const [positionId, requests] of projectPoolRequestsByPositionId) {
    const poolPosition = positionById.get(positionId);
    const deal = poolPosition ? dealMap.get(poolPosition.dealId) : null;

    if (!poolPosition || !deal || deal.status === "sold") {
      continue;
    }

    const currentContributionAmount = roundCurrency(
      requests.reduce(
        (sum, request) =>
          sum +
          getEffectiveCapitalAfterWithdrawal({
            amount: request.amount,
            positionId,
            participantId,
            withdrawalMap
          }),
        0
      )
    );

    contexts.push({
      key: `${poolPosition.dealId}:${positionId}:project_pool`,
      deal,
      position: {
        ...poolPosition,
        participantId,
        contributionType: "Project pooled capital",
        contributionAmount: currentContributionAmount
      },
      positionId,
      sourceKind: "project_pool",
      sourceName: `${deal.name} Project Pool`
    });
  }

  for (const commitment of data.investorPoolCommitments ?? []) {
    if (commitment.participantId !== participantId) {
      continue;
    }

    const investmentPool = (data.investorPools ?? []).find(
      (pool) => pool.id === commitment.poolId
    );
    const deal = investmentPool?.selectedDealId
      ? dealMap.get(investmentPool.selectedDealId)
      : null;
    const poolPosition = deal
      ? (data.positions ?? []).find(
          (position) =>
            position.dealId === deal.id &&
            position.participantId === investmentPool.poolParticipantId
        )
      : null;

    if (!investmentPool || !deal || deal.status === "sold" || !poolPosition) {
      continue;
    }

    const currentContributionAmount = getEffectiveCapitalAfterWithdrawal({
      amount: commitment.commitmentAmount,
      positionId: poolPosition.id,
      participantId,
      withdrawalMap
    });

    contexts.push({
      key: `${deal.id}:${poolPosition.id}:legacy_pool`,
      deal,
      position: {
        ...poolPosition,
        participantId,
        contributionType: "Pooled capital",
        contributionAmount: currentContributionAmount
      },
      positionId: poolPosition.id,
      sourceKind: "legacy_pool",
      sourceName: investmentPool.name
    });
  }

  return contexts
    .map((context) => {
      const request = requestMap.get(`${context.deal.id}:${participantId}`) ?? null;
      const requestMatchesContext =
        !request ||
        (request.positionId
          ? request.positionId === context.positionId
          : context.sourceKind === "direct");

      return {
        ...context,
        request: requestMatchesContext ? request : null,
        hasOtherRequest: Boolean(request && !requestMatchesContext)
      };
    })
    .filter(
      (context) =>
        context.position.contributionAmount > 0 ||
        context.request ||
        context.hasOtherRequest
    )
    .sort((left, right) => {
      const sourceOrder = {
        direct: 0,
        project_pool: 1,
        legacy_pool: 2
      };
      const leftOrder = sourceOrder[left.sourceKind] ?? 9;
      const rightOrder = sourceOrder[right.sourceKind] ?? 9;

      if (left.deal.name !== right.deal.name) {
        return left.deal.name.localeCompare(right.deal.name);
      }

      return leftOrder - rightOrder;
    });
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
  const dealMap = new Map(data.deals.map((deal) => [deal.id, deal]));
  const distributionElectionMap = getDistributionElectionMap(data);
  const participant = participantMap.get(user.participantId);
  const pools = buildInvestorPoolViews(data, user.participantId).filter(
    (pool) => pool.myCommitmentAmount > 0
  );
  const reinvestmentTargets = data.deals
    .filter((deal) => deal.status !== "sold")
    .map((deal) => ({
      id: deal.id,
      name: deal.name
    }));
  const directProjects = data.positions
    .filter((position) => position.participantId === user.participantId)
    .filter((position) => position.contributionAmount > 0 || position.distributionsToDate > 0)
    .map((position) => {
      const deal = dealMap.get(position.dealId);

      if (!deal) {
        return null;
      }

      const dealPositions = data.positions.filter((item) => item.dealId === deal.id);
      const waterfall = calculateWaterfall({ deal, positions: dealPositions });
      const result = getPositionResultMap(waterfall.participantResults).get(position.id);

      if (!result) {
        return null;
      }

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
        distributionElectionDueOn: deal.distributionElectionDueOn ?? null,
        earlyWithdrawalPenaltyRate: deal.earlyWithdrawalPenaltyRate ?? 0.3,
        timelineProgress: resolveTimelineProgress(deal.status, deal.timelineProgress),
        timeline: deal.timeline,
        projectionLabel: deal.status === "sold" ? "Actual at exit" : "Projected at exit",
        issues: [],
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
    })
    .filter(Boolean);
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
    distributionElectionDueOn: context.distributionElectionDueOn ?? null,
    personalPosition: {
      totalPayout: context.totalPayout,
      profitEarned: context.profitReturned,
      distributionElection: context.distributionPlan
    },
    reinvestmentTargets: context.reinvestmentTargets
  }));
  const archivedProjects = buildArchivedProjectHistoryForParticipant(data, user.participantId);
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
  const isContractorAccount = participant?.category === "contractor";
  const capitalAccount = {
    ...(isContractorAccount
      ? buildDeferredAccountLedger(data, user.participantId)
      : buildCapitalAccountLedger(data, user.participantId)),
    dwolla: buildDwollaAccountPayload(user),
    deposits: isContractorAccount
      ? []
      : (data.userCapitalDeposits ?? [])
          .filter((deposit) => deposit.participantId === user.participantId)
          .sort((left, right) =>
            String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? ""))
          ),
    payouts: isContractorAccount
      ? []
      : (data.userAccountPayouts ?? [])
          .filter((payout) => payout.participantId === user.participantId)
          .sort((left, right) =>
            String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? ""))
          ),
    allocationRequests: buildParticipantAllocationRequests(data, user.participantId)
  };
  const allocationTargets = buildAllocationTargets(data);

  return {
    role: user.role,
    viewer: {
      name: user.name,
      email: user.email,
      role: user.role,
      category: participant?.category ?? "pool_member"
    },
    profile: buildProfilePayload(user, participant),
    notifications: buildNotificationCenter(user, data),
    companyResources: data.companyResources ?? [],
    questions: buildParticipantQuestions(data, user.participantId),
    capitalAccount,
    allocationTargets,
    poolPortfolio: {
      totalCommitted,
      totalInvested,
      totalReturned,
      totalAmountPayout,
      currentPrefEarned,
      projectedPrefEarned,
      activePools,
      pendingPools,
      jointCapitalDeployed,
      archivedProjectCount: archivedProjects.length
    },
    pooledDistributionProjects: distributionProjects,
    archivedProjects,
    directProjects,
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
  const positionById = new Map(data.positions.map((position) => [position.id, position]));
  const withdrawalMap = getApprovedWithdrawalAmountByPositionParticipant(data);
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

    const poolPosition =
      positionMap.get(`${investmentPool.selectedDealId}:${investmentPool.poolParticipantId}`) ?? null;

    if (!poolPosition) {
      continue;
    }

    const commitments = (poolCommitmentsByPool.get(investmentPool.id) ?? [])
      .map((commitment) => ({
        ...commitment,
        effectiveCommitmentAmount: getEffectiveCapitalAfterWithdrawal({
          amount: commitment.commitmentAmount,
          positionId: poolPosition.id,
          participantId: commitment.participantId,
          withdrawalMap
        })
      }))
      .filter((commitment) => commitment.effectiveCommitmentAmount > 0);
    const totalCommitted = roundCurrency(
      commitments.reduce((sum, commitment) => sum + commitment.effectiveCommitmentAmount, 0)
    );

    if (totalCommitted <= 0) {
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

      const memberSharePct =
        totalCommitted > 0 ? commitment.effectiveCommitmentAmount / totalCommitted : 0;
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

  const projectPoolRequestsByPositionId = new Map();

  for (const request of data.userAllocationRequests ?? []) {
    if (
      request.allocationMode !== "pooled" ||
      request.status !== "approved" ||
      !request.createdPositionId
    ) {
      continue;
    }

    if (!projectPoolRequestsByPositionId.has(request.createdPositionId)) {
      projectPoolRequestsByPositionId.set(request.createdPositionId, []);
    }

    projectPoolRequestsByPositionId.get(request.createdPositionId).push(request);
  }

  for (const [positionId, requests] of projectPoolRequestsByPositionId) {
    const poolPosition = positionById.get(positionId);

    if (!poolPosition) {
      continue;
    }

    if (targetDealId && poolPosition.dealId !== targetDealId) {
      continue;
    }

    const deal = dealMap.get(poolPosition.dealId);

    if (!deal || deal.status !== "sold") {
      continue;
    }

    const requestsWithEffectiveAmount = requests
      .map((request) => ({
        ...request,
        effectiveAmount: getEffectiveCapitalAfterWithdrawal({
          amount: request.amount,
          positionId,
          participantId: request.participantId,
          withdrawalMap
        })
      }))
      .filter((request) => request.effectiveAmount > 0);
    const totalCommitted = roundCurrency(
      requestsWithEffectiveAmount.reduce((sum, request) => sum + request.effectiveAmount, 0)
    );

    if (totalCommitted <= 0) {
      continue;
    }

    const dealWaterfall = getWaterfallContext(poolPosition.dealId);
    const poolResult =
      getPositionResultMap(dealWaterfall?.waterfall?.participantResults ?? []).get(poolPosition.id) ??
      null;

    if (!poolResult || poolResult.totalPayout <= 0) {
      continue;
    }

    for (const request of requestsWithEffectiveAmount) {
      if (targetParticipantId && request.participantId !== targetParticipantId) {
        continue;
      }

      const memberSharePct = request.effectiveAmount / totalCommitted;
      const key = `${poolPosition.dealId}:${request.participantId}`;

      if (!groupedContexts.has(key)) {
        const participant = participantMap.get(request.participantId);

        groupedContexts.set(key, {
          dealId: poolPosition.dealId,
          dealName: deal.name,
          participantId: request.participantId,
          participantName: participant?.name ?? "Investor",
          participantEmail: userMapByParticipantId.get(request.participantId)?.email ?? "",
          payoutInstructions: buildPayoutInstructionPayload(participant),
          sourcePoolNames: new Set()
        });
      }

      const context = groupedContexts.get(key);
      context.sourcePoolNames.add(`${deal.name} Project Pool`);
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
        distributionElectionDueOn: deal.distributionElectionDueOn ?? null,
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
  const participant = participantMap.get(user.participantId);
  const pooledDistributionContexts = buildPoolDistributionContexts(data, {
    participantId: user.participantId
  });
  const projectPoolGroups = buildParticipantProjectPoolViews(data, user.participantId);
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
      distributionElectionDueOn: deal.distributionElectionDueOn ?? null,
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
  const archivedProjects = buildArchivedProjectHistoryForParticipant(data, user.participantId);

  const withdrawalProjects =
    ["investor", "pool_member", "contractor"].includes(participant?.category ?? "")
      ? buildEarlyWithdrawalContextsForParticipant(data, user.participantId)
          .map((context) => {
            const deal = context.deal;
            const plan = buildEarlyWithdrawalPlan({
              deal,
              position: context.position,
              participant,
              request: context.request
            });

            if (context.hasOtherRequest) {
              plan.canRequest = false;
            }

            if (!plan.hasRequest && !plan.canRequest) {
              return null;
            }

            return {
              id: `${deal.id}:${context.positionId}:${context.sourceKind}`,
              dealId: deal.id,
              positionId: context.positionId,
              sourceKind: context.sourceKind,
              sourceName: context.sourceName,
              name: deal.name,
              location: deal.location,
              currentPhase: deal.currentPhase,
              status: deal.status,
              statusLabel: statusLabel(deal.status),
              investmentCloseOn: deal.investmentCloseOn ?? null,
              earlyWithdrawalPenaltyRate: deal.earlyWithdrawalPenaltyRate ?? 0.3,
              withdrawalRequest: {
                ...plan,
                positionId: context.positionId,
                sourceKind: context.sourceKind,
                sourceName: context.sourceName,
                hasOtherRequest: context.hasOtherRequest
              }
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
    visiblePositions.reduce((sum, position) => sum + position.contributionAmount, 0) +
      projectPoolGroups.reduce(
        (sum, projectPool) => sum + Number(projectPool.myPosition.amountInvested ?? 0),
        0
      )
  );
  const totalReturned = roundCurrency(
    projects
      .filter((project) => project.status === "sold")
      .reduce((sum, project) => sum + project.personalPosition.profitEarned, 0) +
      projectPoolGroups
        .filter((projectPool) => projectPool.project?.status === "sold")
        .reduce((sum, projectPool) => sum + projectPool.myPosition.profitReturned, 0)
  );
  const activeInvestments =
    projects.filter((project) => project.status !== "sold").length +
    projectPoolGroups.filter(
      (projectPool) => projectPool.project && projectPool.project.status !== "sold"
    ).length;
  const currentPrefEarned = roundCurrency(
    projects
      .filter((project) => project.status !== "sold")
      .reduce((sum, project) => sum + project.personalPosition.prefEarned, 0) +
      projectPoolGroups
        .filter((projectPool) => projectPool.project?.status !== "sold")
        .reduce((sum, projectPool) => sum + projectPool.myPosition.currentPrefEarned, 0)
  );
  const projectedPrefEarned = roundCurrency(
    projects
      .filter((project) => project.status !== "sold")
      .reduce((sum, project) => sum + project.personalPosition.projectedPrefEarned, 0) +
      projectPoolGroups
        .filter((projectPool) => projectPool.project?.status !== "sold")
        .reduce((sum, projectPool) => sum + projectPool.myPosition.projectedPrefEarned, 0)
  );
  const totalAmountPayout = roundCurrency(
    visiblePositions.reduce((sum, position) => sum + (position.distributionsToDate ?? 0), 0) +
      projectPoolGroups.reduce(
        (sum, projectPool) => sum + Number(projectPool.myPosition.totalAmountPayout ?? 0),
        0
      )
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
  const isContractorAccount = participant?.category === "contractor";
  const capitalAccount = {
    ...(isContractorAccount
      ? buildDeferredAccountLedger(data, user.participantId)
      : buildCapitalAccountLedger(data, user.participantId)),
    dwolla: buildDwollaAccountPayload(user),
    deposits: isContractorAccount
      ? []
      : (data.userCapitalDeposits ?? [])
          .filter((deposit) => deposit.participantId === user.participantId)
          .sort((left, right) =>
            String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? ""))
          ),
    payouts: isContractorAccount
      ? []
      : (data.userAccountPayouts ?? [])
          .filter((payout) => payout.participantId === user.participantId)
          .sort((left, right) =>
            String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? ""))
          ),
    allocationRequests: buildParticipantAllocationRequests(data, user.participantId)
  };
  const allocationTargets = buildAllocationTargets(data);

  return {
    role: user.role,
    viewer: {
      name: user.name,
      email: user.email,
      role: user.role,
      category: participantMap.get(user.participantId)?.category ?? "investor"
    },
    profile: buildProfilePayload(user, participant),
    notifications: buildNotificationCenter(user, data),
    capitalAccount,
    questions: buildParticipantQuestions(data, user.participantId),
    portfolio: {
      totalInvested,
      totalReturned,
      totalAmountPayout,
      activeInvestments,
      currentPrefEarned,
      projectedPrefEarned,
      archivedProjectCount: archivedProjects.length
    },
    governance: {
      issues: governanceIssues
    },
    companyResources: data.companyResources ?? [],
    allocationTargets,
    pooledDistributionProjects,
    archivedProjects,
    projectPoolGroups,
    projects,
    withdrawalRequests: withdrawalProjects
  };
}

export function buildManagerDashboard(user, data = seedData) {
  const participantMap = getParticipantMap(data);
  const dealMap = new Map(data.deals.map((deal) => [deal.id, deal]));
  const userMap = new Map(data.users.map((item) => [item.participantId, item]));
  const userMapById = getUserMapById(data);
  const legalAcknowledgementsByUserId = new Map();
  const investorQuestionnaireByUserId = new Map(
    (data.investorQuestionnaires ?? []).map((questionnaire) => [
      questionnaire.userId,
      questionnaire
    ])
  );

  for (const acknowledgement of data.userLegalAcknowledgements ?? []) {
    if (!legalAcknowledgementsByUserId.has(acknowledgement.userId)) {
      legalAcknowledgementsByUserId.set(acknowledgement.userId, []);
    }

    legalAcknowledgementsByUserId.get(acknowledgement.userId).push(acknowledgement);
  }
  const investorPools = buildInvestorPoolViews(data);
  const contractorMap = new Map(
    data.contractors.map((item) => [`${item.dealId}:${item.participantId}`, item])
  );
  const distributionElectionMap = getDistributionElectionMap(data);
  const poolDistributionContextMap = new Map(
    buildPoolDistributionContexts(data).map((context) => [
      `${context.dealId}:${context.participantId}`,
      context
    ])
  );
  const payoutBySource = new Map(
    (data.userAccountPayouts ?? [])
      .filter((payout) => payout.sourceType && payout.sourceId)
      .map((payout) => [`${payout.sourceType}:${payout.sourceId}`, payout])
  );
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
      directInvestmentMinimum: roundCurrency(deal.directInvestmentMinimum ?? 0),
      pooledInvestmentAllowed: Boolean(Number(deal.pooledInvestmentAllowed ?? 0)),
      pooledInvestmentTarget: roundCurrency(deal.pooledInvestmentTarget ?? 0),
      pooledVoteThreshold: roundCurrency(deal.pooledVoteThreshold ?? 0.5),
      pooledVoteClosesOn: deal.pooledVoteClosesOn ?? null,
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

  function getEnrollmentFundingDetails(participantId, participantCategory) {
    const investmentAmount = getEnrollmentInvestmentAmount(data, participantId);
    const deferredAmount = getEnrollmentDeferredAmount(data, participantId);
    const capitalLedger = buildCapitalAccountLedger(data, participantId);
    const deferredLedger = buildDeferredAccountLedger(data, participantId);
    const enrollmentFundingAmount =
      participantCategory === "contractor" ? deferredAmount : investmentAmount;
    const allocatedAmount = roundCurrency(
      participantCategory === "pool_member"
        ? (data.investorPoolCommitments ?? [])
            .filter((commitment) => commitment.participantId === participantId)
            .reduce((sum, commitment) => sum + commitment.commitmentAmount, 0)
        : (data.positions ?? [])
            .filter((position) => position.participantId === participantId)
            .reduce((sum, position) => sum + position.contributionAmount, 0)
    );
    const remainingAmount =
      participantCategory === "contractor"
        ? enrollmentFundingAmount > 0
          ? deferredLedger.availableDeferredAmount
          : null
        : capitalLedger.availableCapital;
    const fundingLabel =
      participantCategory === "contractor"
        ? deferredAmount > 0
          ? `Deferred Amount: ${formatCurrencyLabel(deferredAmount)}${
              remainingAmount !== null ? `; Remaining: ${formatCurrencyLabel(remainingAmount)}` : ""
            }${
              deferredLedger.pendingAllocationRequestAmount > 0
                ? `; Pending requests: ${formatCurrencyLabel(deferredLedger.pendingAllocationRequestAmount)}`
                : ""
            }`
          : ""
        : investmentAmount > 0 ||
            capitalLedger.totalAccountFunds > 0 ||
            capitalLedger.pendingDepositAmount > 0
          ? `Target investment: ${formatCurrencyLabel(investmentAmount)}; Processed ACH: ${formatCurrencyLabel(
              capitalLedger.totalAccountFunds
            )}; Available: ${formatCurrencyLabel(
              capitalLedger.availableCapital
            )}${
              capitalLedger.pendingDepositAmount > 0
                ? `; Pending deposits: ${formatCurrencyLabel(capitalLedger.pendingDepositAmount)}`
                : ""
            }${
              capitalLedger.pendingPayoutAmount > 0
                ? `; Pending withdrawals: ${formatCurrencyLabel(capitalLedger.pendingPayoutAmount)}`
                : ""
            }`
          : "";

    return {
      enrollmentInvestmentAmount: investmentAmount || null,
      enrollmentDeferredAmount: deferredAmount || null,
      enrollmentFundingAmount: enrollmentFundingAmount || null,
      enrollmentAllocatedAmount: allocatedAmount || null,
      enrollmentRemainingAmount: remainingAmount,
      accountFundsTotal: capitalLedger.totalAccountFunds,
      accountFundsAvailable: capitalLedger.availableCapital,
      accountFundsPendingDeposits: capitalLedger.pendingDepositAmount,
      accountFundsPendingPayouts: capitalLedger.pendingPayoutAmount,
      accountFundsAllocatedToProjects: capitalLedger.allocatedToProjects,
      accountFundsCommittedToPools: capitalLedger.committedToPools,
      suggestedAllocationAmount: remainingAmount && remainingAmount > 0 ? remainingAmount : null,
      enrollmentFundingLabel: fundingLabel
    };
  }

  const adminUsers = data.users
    .map((account) => {
      const category = participantMap.get(account.participantId)?.category ?? "investor";

      return {
        id: account.id,
        participantId: account.participantId,
        name: account.name,
        firstName: account.firstName ?? "",
        middleName: account.middleName ?? "",
        lastName: account.lastName ?? "",
        email: account.email,
        role: account.role,
        category,
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
        dwolla: buildDwollaAccountPayload(account),
        legalAcknowledgements: legalAcknowledgementsByUserId.get(account.id) ?? [],
        investorQuestionnaire: investorQuestionnaireByUserId.get(account.id) ?? null,
        ...getEnrollmentFundingDetails(account.participantId, category),
        lastLoginAt: account.lastLoginAt ?? null,
        notificationStatus: account.notificationStatus ?? null,
        notificationProvider: account.notificationProvider ?? null,
        notificationLocalPath: account.notificationLocalPath ?? null
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  const investorQuestionnaires = (data.investorQuestionnaires ?? [])
    .map((questionnaire) => {
      const account = userMapById.get(questionnaire.userId);
      const participantRecord = participantMap.get(questionnaire.participantId);

      return {
        ...questionnaire,
        userName: account?.name ?? participantRecord?.name ?? questionnaire.nameEntity,
        userEmail: account?.email ?? questionnaire.email,
        category: participantRecord?.category ?? account?.category ?? "investor"
      };
    })
    .sort((left, right) => {
      const nameCompare = left.userName.localeCompare(right.userName);
      return nameCompare !== 0
        ? nameCompare
        : String(right.submittedAt ?? "").localeCompare(String(left.submittedAt ?? ""));
    });

  const adminParticipants = data.participants
    .filter((participant) => !["sponsor", "manager"].includes(participant.category))
    .map((participant) => {
      const linkedUser = userMap.get(participant.id);

      return {
        id: participant.id,
        name: participant.name,
        category: participant.category,
        hasUser: Boolean(linkedUser),
        userId: linkedUser?.id ?? null,
        email: linkedUser?.email ?? null,
        dwolla: buildDwollaAccountPayload(linkedUser),
        contactPhone: participant.contactPhone ?? "",
        idCardFileName: participant.idCardFileName ?? "",
        ...getEnrollmentFundingDetails(participant.id, participant.category)
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  const allocationParticipants = adminParticipants.filter((participant) =>
    ["investor", "contractor"].includes(participant.category)
  );
  const poolMembers = adminParticipants.filter(
    (participant) => participant.category === "pool_member" && participant.hasUser
  );
  const capitalAccounts = adminParticipants
    .filter(
      (participant) =>
        ["investor", "pool_member"].includes(participant.category) && participant.hasUser
    )
    .map((participant) => ({
      ...participant,
      ...buildCapitalAccountLedger(data, participant.id)
    }))
    .sort((left, right) => {
      if (right.availableCapital !== left.availableCapital) {
        return right.availableCapital - left.availableCapital;
      }

      return left.name.localeCompare(right.name);
    });
  const capitalDeposits = (data.userCapitalDeposits ?? [])
    .map((deposit) => ({
      ...deposit,
      participantName: participantMap.get(deposit.participantId)?.name ?? deposit.participantName,
      category: participantMap.get(deposit.participantId)?.category ?? deposit.category
    }))
    .sort((left, right) => {
      if (left.status === "pending" && right.status !== "pending") {
        return -1;
      }

      if (left.status !== "pending" && right.status === "pending") {
        return 1;
      }

      return String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? ""));
    });
  const capitalPayouts = (data.userAccountPayouts ?? [])
    .map((payout) => ({
      ...payout,
      participantName: participantMap.get(payout.participantId)?.name ?? payout.participantName,
      category: participantMap.get(payout.participantId)?.category ?? payout.category,
      dealName: payout.dealId ? dealMap.get(payout.dealId)?.name ?? payout.dealName : payout.dealName
    }))
    .sort((left, right) => {
      if (left.status === "pending" && right.status !== "pending") {
        return -1;
      }

      if (left.status !== "pending" && right.status === "pending") {
        return 1;
      }

      return String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? ""));
    });
  const userQuestions = (data.userQuestions ?? [])
    .map((question) => ({
      ...question,
      participantName: participantMap.get(question.participantId)?.name ?? question.participantName,
      userEmail: userMap.get(question.participantId)?.email ?? question.userEmail,
      category: participantMap.get(question.participantId)?.category ?? question.category,
      needsResponse: question.status === "open"
    }))
    .sort(sortUserQuestions);
  const allocationRequests = (data.userAllocationRequests ?? [])
    .map((request) => ({
      ...request,
      participantName: participantMap.get(request.participantId)?.name ?? request.participantName,
      participantEmail: userMap.get(request.participantId)?.email ?? request.participantEmail,
      participantCategory:
        participantMap.get(request.participantId)?.category ?? request.participantCategory,
      dealName: dealMap.get(request.dealId)?.name ?? request.dealName,
      needsReview: request.status === "pending",
      canReview: request.status === "pending"
    }))
    .sort((left, right) => {
      if (left.needsReview !== right.needsReview) {
        return left.needsReview ? -1 : 1;
      }

      return String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? ""));
    });

  function resolveAllocationStatus({ deal, position, participant: allocationParticipant, contractorRecord }) {
    if (!deal) {
      return contractorRecord?.status ?? "Active";
    }

    if (deal.status !== "sold") {
      return contractorRecord?.status ?? "Active";
    }

    if (["investor", "pool_member"].includes(allocationParticipant?.category ?? "")) {
      const positionResult = deals
        .find((item) => item.id === position.dealId)
        ?.participantResults.find((result) => result.positionId === position.id);

      if (!positionResult || positionResult.totalPayout <= 0) {
        return "Complete";
      }

      const election = distributionElectionMap.get(`${position.dealId}:${position.participantId}`);

      return hasApprovedDistributionElection(election) ? "Complete" : "Pending election";
    }

    if (allocationParticipant?.category === "pool") {
      const investmentPool = (data.investorPools ?? []).find(
        (pool) =>
          pool.poolParticipantId === position.participantId && pool.selectedDealId === position.dealId
      );
      const commitments = (data.investorPoolCommitments ?? []).filter(
        (commitment) => commitment.poolId === investmentPool?.id
      );
      const requiredContexts = commitments
        .map((commitment) => poolDistributionContextMap.get(`${position.dealId}:${commitment.participantId}`))
        .filter(Boolean);

      if (!requiredContexts.length) {
        return "Complete";
      }

      return requiredContexts.every((context) =>
        hasApprovedDistributionElection(context.distributionPlan)
      )
        ? "Complete"
        : "Pending election";
    }

    return contractorRecord?.status ?? "Complete";
  }

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
        status: resolveAllocationStatus({
          deal,
          position,
          participant: participant,
          contractorRecord
        })
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

      if (
        !deal ||
        deal.status !== "sold" ||
        !["investor", "pool_member"].includes(participantRecord?.category ?? "")
      ) {
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
        distributionElectionDueOn: distribution.electionDueOn,
        notes: distribution.notes,
        payout:
          distribution.id && payoutBySource.has(`distribution_cash:${distribution.id}`)
            ? payoutBySource.get(`distribution_cash:${distribution.id}`)
            : null,
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
      distributionElectionDueOn: distribution.electionDueOn,
      notes: distribution.notes,
      payout:
        distribution.id && payoutBySource.has(`distribution_cash:${distribution.id}`)
          ? payoutBySource.get(`distribution_cash:${distribution.id}`)
          : null,
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

      if (
        !deal ||
        !["investor", "pool_member", "contractor"].includes(participantRecord?.category ?? "")
      ) {
        return null;
      }

      const linkedUser = userMap.get(request.participantId);
      const submittedBy = request.requestedByUserId
        ? userMapById.get(request.requestedByUserId)
        : null;
      const reviewedBy = request.reviewedByUserId
        ? userMapById.get(request.reviewedByUserId)
        : null;
      const withdrawalContext =
        buildEarlyWithdrawalContextsForParticipant(data, request.participantId).find(
          (context) =>
            context.deal.id === request.dealId &&
            (!request.positionId || context.positionId === request.positionId)
        ) ?? null;
      const position =
        withdrawalContext?.position ??
        data.positions.find((item) => item.id === request.positionId) ??
        data.positions.find(
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
        positionId: withdrawalContext?.positionId ?? request.positionId ?? position?.id ?? null,
        sourceKind: withdrawalContext?.sourceKind ?? "direct",
        sourceName: withdrawalContext?.sourceName ?? "Direct investor position",
        currentContributionAmount: plan.currentContributionAmount,
        requestedCapitalAmount: plan.requestedCapitalAmount,
        penaltyRate: plan.penaltyRate,
        penaltyAmount: plan.penaltyAmount,
        estimatedPayoutAmount: plan.estimatedPayoutAmount,
        approvedPayoutAmount: plan.approvedPayoutAmount,
        payoutExpectedOn: plan.payoutExpectedOn,
        payout:
          request.id && payoutBySource.has(`early_withdrawal:${request.id}`)
            ? payoutBySource.get(`early_withdrawal:${request.id}`)
            : null,
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
  const archivedProjects = buildArchivedProjectSnapshots(data);
  const projectPooledRequests = buildProjectPooledRequestBuckets(data, data.asOfDate);

  return {
    role: user.role,
    viewer: {
      name: user.name,
      email: user.email,
      role: user.role,
      category: participant?.category ?? "manager"
    },
    profile: buildProfilePayload(user, participant),
    notifications: buildNotificationCenter(user, data),
    overview: {
      totalDeals: deals.length,
      activeDeals: deals.filter((deal) => deal.status !== "sold").length,
      totalTrackedEquity,
      projectedSponsorPromote,
      archivedDeals: archivedProjects.length,
      totalInvestorPools: investorPools.length + projectPooledRequests.length,
      totalPooledCapital: roundCurrency(
        investorPools.reduce((sum, investmentPool) => sum + investmentPool.totalCommitted, 0) +
          projectPooledRequests.reduce(
            (sum, projectPool) => sum + Number(projectPool.approvedAmount ?? 0),
            0
          )
      )
    },
    deals,
    contractorLedger,
    admin: {
      users: adminUsers,
      participants: adminParticipants,
      investorQuestionnaires,
      allocationParticipants,
      poolMembers,
      capitalAccounts,
      capitalDeposits,
      capitalPayouts,
      userQuestions,
      allocationRequests,
      projectPooledRequests,
      investorPools,
      allocations: adminAllocations,
      archivedProjects,
      distributionReviews: combinedDistributionReviews,
      earlyWithdrawalReviews
    },
    governance: {
      issues: governanceIssues
    },
    companyResources: data.companyResources ?? [],
    legalDocuments: data.legalDocuments ?? [],
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
