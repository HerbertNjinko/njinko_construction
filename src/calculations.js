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
  const promoteTiers = (deal.promoteTiers ?? []).filter((tier) => tier.isEnabled !== false);

  const totalEquity = roundCurrency(
    positions.reduce((sum, position) => sum + position.contributionAmount, 0)
  );
  const distributableEquity = roundCurrency(Math.max(0, salePrice - debt));
  const capitalPool = roundCurrency(Math.min(distributableEquity, totalEquity));
  const prefTargets = positions.map((position) => ({
    positionId: position.id,
    prefTarget: roundCurrency(position.contributionAmount * prefRate * (holdMonths / 12))
  }));
  const totalPrefTarget = roundCurrency(
    prefTargets.reduce((sum, item) => sum + item.prefTarget, 0)
  );
  const prefPool = roundCurrency(
    Math.min(Math.max(distributableEquity - capitalPool, 0), totalPrefTarget)
  );
  const remainingAfterPref = roundCurrency(
    Math.max(distributableEquity - capitalPool - prefPool, 0)
  );
  const projectIrr = annualizedIrr(totalEquity, distributableEquity, holdMonths);
  const activeTier = getTriggeredTier(projectIrr, promoteTiers);
  const sponsorPromote = roundCurrency(
    remainingAfterPref * (activeTier?.sponsorShare ?? 0)
  );
  const investorProfitPool = roundCurrency(remainingAfterPref - sponsorPromote);

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
    holdMonths,
    prefRate,
    totalEquity,
    distributableEquity,
    projectProfit: roundCurrency(distributableEquity - totalEquity),
    totalPrefTarget,
    projectIrr,
    activeTier,
    sponsorPromote,
    investorProfitPool,
    participantResults,
    classBreakdown,
    waterfallSteps: [
      {
        label: "Capital returned",
        amount: capitalPool
      },
      {
        label: "Preferred return",
        amount: prefPool
      },
      {
        label: "Investor profit pool",
        amount: investorProfitPool
      },
      {
        label: "Sponsor promote",
        amount: sponsorPromote
      }
    ]
  };
}

function getParticipantMap(data) {
  return new Map(data.participants.map((participant) => [participant.id, participant]));
}

function getPositionResultMap(participantResults) {
  return new Map(participantResults.map((row) => [row.positionId, row]));
}

function calculateCurrentPref(position, deal, asOfDate) {
  const stopDate = deal.status === "sold" ? deal.actualExitOn : asOfDate;
  const monthsAccrued = Math.min(monthsBetween(deal.fundedOn, stopDate), deal.holdMonths);

  return roundCurrency(position.contributionAmount * deal.prefRate * (monthsAccrued / 12));
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

function buildGovernanceIssues(data, viewerParticipantId, { includeAll = false } = {}) {
  const participantMap = getParticipantMap(data);
  const dealMap = new Map(data.deals.map((deal) => [deal.id, deal]));
  const investorCapitalByDeal = new Map();
  const votesByIssue = new Map();

  for (const position of data.positions) {
    const participant = participantMap.get(position.participantId);

    if (participant?.category !== "investor") {
      continue;
    }

    if (!investorCapitalByDeal.has(position.dealId)) {
      investorCapitalByDeal.set(position.dealId, new Map());
    }

    const dealCapital = investorCapitalByDeal.get(position.dealId);
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
      const capitalByParticipant = investorCapitalByDeal.get(issue.dealId) ?? new Map();
      const eligibleInvestment = roundCurrency(
        [...capitalByParticipant.values()].reduce((sum, value) => sum + value, 0)
      );
      const relevantVotes = (votesByIssue.get(issue.id) ?? []).filter((vote) =>
        capitalByParticipant.has(vote.participantId)
      );
      let yesInvestment = 0;
      let noInvestment = 0;

      for (const vote of relevantVotes) {
        const investedAmount = capitalByParticipant.get(vote.participantId) ?? 0;

        if (vote.voteChoice === "yes") {
          yesInvestment += investedAmount;
        } else if (vote.voteChoice === "no") {
          noInvestment += investedAmount;
        }
      }

      const pendingInvestment = Math.max(0, eligibleInvestment - yesInvestment - noInvestment);
      const yesPct = eligibleInvestment > 0 ? yesInvestment / eligibleInvestment : 0;
      const noPct = eligibleInvestment > 0 ? noInvestment / eligibleInvestment : 0;
      const pendingPct = eligibleInvestment > 0 ? pendingInvestment / eligibleInvestment : 0;
      const myInvestment = capitalByParticipant.get(viewerParticipantId) ?? 0;
      const myVote = relevantVotes.find((vote) => vote.participantId === viewerParticipantId)?.voteChoice ?? null;
      const isEligibleToVote = myInvestment > 0;
      let status = "open";

      if (eligibleInvestment > 0) {
        if (yesPct >= issue.approvalThreshold) {
          status = "passed";
        } else if (yesPct + pendingPct < issue.approvalThreshold) {
          status = "failed";
        }
      }

      return {
        id: issue.id,
        dealId: issue.dealId,
        dealName: deal?.name ?? "Deal",
        dealStatus: deal?.status ?? "under_construction",
        title: issue.title,
        description: issue.description,
        approvalThreshold: issue.approvalThreshold,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        eligibleInvestment,
        eligibleVoterCount: capitalByParticipant.size,
        voteCount: relevantVotes.length,
        yesInvestment: roundCurrency(yesInvestment),
        noInvestment: roundCurrency(noInvestment),
        pendingInvestment: roundCurrency(pendingInvestment),
        yesPct,
        noPct,
        pendingPct,
        status,
        isEligibleToVote,
        canVote: isEligibleToVote && status === "open",
        myVote,
        myWeightPct: eligibleInvestment > 0 ? myInvestment / eligibleInvestment : 0
      };
    })
    .filter((issue) => includeAll || issue.isEligibleToVote);
}

export function buildInvestorDashboard(user, data = seedData) {
  const participantMap = getParticipantMap(data);
  const dealMap = new Map(data.deals.map((deal) => [deal.id, deal]));
  const participant = participantMap.get(user.participantId);
  const governanceIssues = buildGovernanceIssues(data, user.participantId);
  const issuesByDeal = new Map();

  for (const issue of governanceIssues) {
    if (!issuesByDeal.has(issue.dealId)) {
      issuesByDeal.set(issue.dealId, []);
    }

    issuesByDeal.get(issue.dealId).push(issue);
  }

  const visiblePositions = data.positions.filter(
    (position) => position.participantId === user.participantId
  );

  const projects = visiblePositions.map((position) => {
    const deal = dealMap.get(position.dealId);
    const dealPositions = data.positions.filter((item) => item.dealId === deal.id);
    const waterfall = calculateWaterfall({ deal, positions: dealPositions });
    const result = getPositionResultMap(waterfall.participantResults).get(position.id);
    const exitLabel = deal.status === "sold" ? "Sale price" : "Projected sale price";

    return {
      id: deal.id,
      name: deal.name,
      location: deal.location,
      status: deal.status,
      statusLabel: statusLabel(deal.status),
      currentPhase: deal.currentPhase,
      timelineProgress: resolveTimelineProgress(deal.status, deal.timelineProgress),
      timeline: deal.timeline,
      projectionLabel: deal.status === "sold" ? "Actual at exit" : "Projected at exit",
      issues: issuesByDeal.get(deal.id) ?? [],
      personalPosition: {
        classType: position.classType,
        contributionType: position.contributionType,
        amountInvested: position.contributionAmount,
        ownershipPct: result.ownershipPct,
        prefEarned: calculateCurrentPref(position, deal, data.asOfDate),
        estimatedTotalReturn: result.totalPayout,
        capitalReturned: result.capitalReturned,
        profitEarned: roundCurrency(result.prefEarned + result.profitShare),
        totalPayout: result.totalPayout
      },
      projectSummary: {
        totalProjectCost: deal.totalProjectCost,
        salePrice: waterfall.salePrice,
        salePriceLabel: exitLabel,
        totalEquity: waterfall.totalEquity,
        debt: deal.debt,
        debtInterestRate: deal.debtInterestRate ?? 0,
        totalInterestPaid: deal.totalInterestPaid ?? 0,
        holdMonths: deal.holdMonths,
        projectIrr: waterfall.projectIrr,
        fundedOn: deal.fundedOn,
        exitOn: deal.actualExitOn ?? deal.projectedExitOn
      },
      privacyNote:
        "Other investor contributions, bank balances, and internal cost detail remain hidden."
    };
  });

  const totalInvested = roundCurrency(
    visiblePositions.reduce((sum, position) => sum + position.contributionAmount, 0)
  );
  const totalReturned = roundCurrency(
    projects
      .filter((project) => project.status === "sold")
      .reduce((sum, project) => sum + project.personalPosition.totalPayout, 0)
  );
  const activeInvestments = projects.filter((project) => project.status !== "sold").length;
  const currentPrefEarned = roundCurrency(
    projects.reduce((sum, project) => sum + project.personalPosition.prefEarned, 0)
  );
  const totalAmountPayout = roundCurrency(
    projects.reduce((sum, project) => sum + project.personalPosition.totalPayout, 0)
  );

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
      currentPrefEarned
    },
    governance: {
      issues: governanceIssues
    },
    projects
  };
}

export function buildManagerDashboard(user, data = seedData) {
  const participantMap = getParticipantMap(data);
  const userMap = new Map(data.users.map((item) => [item.participantId, item]));
  const contractorMap = new Map(
    data.contractors.map((item) => [`${item.dealId}:${item.participantId}`, item])
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
      debt: deal.debt,
      debtInterestRate: deal.debtInterestRate ?? 0,
      totalInterestPaid: deal.totalInterestPaid ?? 0,
      totalProjectCost: deal.totalProjectCost,
      salePrice: deal.salePrice,
      holdMonths: deal.holdMonths,
      prefRate: deal.prefRate,
      currentPhase: deal.currentPhase,
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
      isActive: Boolean(account.isActive),
      mustChangePassword: Boolean(account.mustChangePassword),
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

  const adminAllocations = data.positions
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
      projectedSponsorPromote
    },
    deals,
    contractorLedger,
    admin: {
      users: adminUsers,
      participants: adminParticipants,
      allocations: adminAllocations
    },
    governance: {
      issues: governanceIssues
    },
    calculator: {
      deals: deals.map((deal) => ({
        id: deal.id,
        name: deal.name,
        salePrice: deal.salePrice,
        holdMonths: deal.holdMonths,
        prefRate: deal.prefRate,
        debt: deal.debt
      }))
    }
  };
}

export function buildDashboardForUser(user, data = seedData) {
  if (user.role === "manager") {
    return buildManagerDashboard(user, data);
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
      holdMonths: waterfall.holdMonths,
      prefRate: waterfall.prefRate,
      debt: waterfall.debt
    },
    outputs: {
      projectIrr: waterfall.projectIrr,
      distributableEquity: waterfall.distributableEquity,
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
