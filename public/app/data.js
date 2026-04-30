import { state } from "./state.js?v=20260430-frontend-24";
import { roundMoney } from "./helpers.js?v=20260430-frontend-24";

export function getCreateDealDefaults() {
  const investmentCloseOn = new Date();
  investmentCloseOn.setDate(investmentCloseOn.getDate() + 30);

  return {
    name: "",
    location: "",
    currentPhase: "",
    status: "under_construction",
    budgetedProjectCost: "",
    debt: "0",
    holdMonths: 18,
    prefRate: 0.08,
    taxExpense: 0,
    debtInterestRate: 0,
    earlyWithdrawalPenaltyRate: 0.3,
    salePrice: "",
    timelineProgress: 0,
    fundedOn: new Date().toISOString().slice(0, 10),
    investmentCloseOn: investmentCloseOn.toISOString().slice(0, 10),
    projectedExitOn: "",
    actualExitOn: ""
  };
}

function todayStamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentMonthStamp() {
  return todayStamp().slice(0, 7);
}

export function isDealOpenForAllocation(deal) {
  const investmentCloseOn = String(deal?.investmentCloseOn ?? "").trim();
  return deal?.status !== "sold" && (!investmentCloseOn || investmentCloseOn >= todayStamp());
}

export function getAllocatableDeals(deals = state.dashboard?.deals ?? []) {
  return deals.filter((deal) => isDealOpenForAllocation(deal));
}

export function getDefaultVoteCloseDate() {
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  return nextWeek.toISOString().slice(0, 10);
}

export function getManagerEditableDeal() {
  if (!state.dashboard?.deals?.length) {
    return null;
  }

  return (
    state.dashboard.deals.find((deal) => deal.id === state.adminDealId) ??
    state.dashboard.deals[0]
  );
}

export function getCalculatorPreset(dealId) {
  return state.dashboard?.calculator?.deals?.find((deal) => deal.id === dealId) ?? null;
}

export function applyAllocationFilters(rows) {
  return rows.filter((row) => {
    if (state.allocationFilters.dealId && row.dealId !== state.allocationFilters.dealId) {
      return false;
    }

    if (
      state.allocationFilters.participantId &&
      row.participantId !== state.allocationFilters.participantId
    ) {
      return false;
    }

    if (state.allocationFilters.category && row.category !== state.allocationFilters.category) {
      return false;
    }

    if (state.allocationFilters.classType && row.classType !== state.allocationFilters.classType) {
      return false;
    }

    return true;
  });
}

export function applyUserFilters(rows) {
  const search = state.userFilters.search.trim().toLowerCase();

  return rows.filter((row) => {
    if (
      search &&
      !`${row.name} ${row.email} ${row.contactPhone} ${row.category} ${row.role}`
        .toLowerCase()
        .includes(search)
    ) {
      return false;
    }

    if (state.userFilters.category && row.category !== state.userFilters.category) {
      return false;
    }

    if (state.userFilters.role && row.role !== state.userFilters.role) {
      return false;
    }

    if (state.userFilters.status) {
      const rowStatus = row.isActive ? "active" : "disabled";
      const approvalStatus = row.accountApprovalStatus ?? "approved";

      if (rowStatus !== state.userFilters.status && approvalStatus !== state.userFilters.status) {
        return false;
      }
    }

    return true;
  });
}

export function applyArchivedProjectFilters(rows) {
  const search = state.archivedProjectFilter.trim().toLowerCase();

  if (!search) {
    return rows;
  }

  return rows.filter((row) =>
    `${row.name ?? ""} ${row.projectName ?? ""} ${row.dealId ?? ""}`
      .toLowerCase()
      .includes(search)
  );
}

export function applyQuestionnaireFilters(rows) {
  const search = state.questionnaireFilters.search.trim().toLowerCase();

  if (!search) {
    return rows;
  }

  return rows.filter((row) =>
    `${row.userName ?? ""} ${row.nameEntity ?? ""} ${row.email ?? ""} ${row.userEmail ?? ""}`
      .toLowerCase()
      .includes(search)
  );
}

export function applyDistributionReviewFilters(rows) {
  return rows.filter((row) => {
    if (
      state.distributionReviewFilters.dealId &&
      row.dealId !== state.distributionReviewFilters.dealId
    ) {
      return false;
    }

    if (
      state.distributionReviewFilters.participantId &&
      row.participantId !== state.distributionReviewFilters.participantId
    ) {
      return false;
    }

    return true;
  });
}

export function applyInvestorProjectFilters(rows) {
  return rows.filter((row) => {
    if (state.investorProjectFilters.dealId && row.id !== state.investorProjectFilters.dealId) {
      return false;
    }

    if (state.investorProjectFilters.status && row.status !== state.investorProjectFilters.status) {
      return false;
    }

    return true;
  });
}

export function applyInvestorIssueFilters(rows) {
  return rows.filter((row) => {
    if (state.investorIssueFilters.dealId && row.dealId !== state.investorIssueFilters.dealId) {
      return false;
    }

    if (state.investorIssueFilters.status && row.status !== state.investorIssueFilters.status) {
      return false;
    }

    return true;
  });
}

export function getAllocationFilterOptions(rows) {
  const deals = [
    ...new Map(rows.map((row) => [row.dealId, { id: row.dealId, name: row.dealName }])).values()
  ].sort((left, right) => left.name.localeCompare(right.name));
  const participants = [
    ...new Map(
      rows.map((row) => [row.participantId, { id: row.participantId, name: row.participantName }])
    ).values()
  ].sort((left, right) => left.name.localeCompare(right.name));

  return {
    deals,
    participants,
    categories: [...new Set(rows.map((row) => row.category))].sort((left, right) =>
      left.localeCompare(right)
    ),
    classTypes: [...new Set(rows.map((row) => row.classType))].sort((left, right) =>
      left.localeCompare(right)
    )
  };
}

export function getUserFilterOptions(rows) {
  return {
    categories: [...new Set(rows.map((row) => row.category))].sort((left, right) =>
      left.localeCompare(right)
    ),
    roles: [...new Set(rows.map((row) => row.role))].sort((left, right) =>
      left.localeCompare(right)
    )
  };
}

export function getDistributionReviewFilterOptions(rows) {
  const deals = [
    ...new Map(rows.map((row) => [row.dealId, { id: row.dealId, name: row.dealName }])).values()
  ].sort((left, right) => left.name.localeCompare(right.name));
  const participants = [
    ...new Map(
      rows.map((row) => [
        row.participantId,
        { id: row.participantId, name: row.participantName }
      ])
    ).values()
  ].sort((left, right) => left.name.localeCompare(right.name));

  return {
    deals,
    participants
  };
}

export function getInvestorProjectFilterOptions(rows) {
  const deals = [
    ...new Map(rows.map((row) => [row.id, { id: row.id, name: row.name }])).values()
  ].sort((left, right) => left.name.localeCompare(right.name));
  const statuses = [...new Set(rows.map((row) => row.status))].sort((left, right) =>
    left.localeCompare(right)
  );

  return {
    deals,
    statuses
  };
}

export function getInvestorIssueFilterOptions(rows) {
  const deals = [
    ...new Map(rows.map((row) => [row.dealId, { id: row.dealId, name: row.dealName }])).values()
  ].sort((left, right) => left.name.localeCompare(right.name));
  const statuses = [...new Set(rows.map((row) => row.status))].sort((left, right) =>
    left.localeCompare(right)
  );

  return {
    deals,
    statuses
  };
}

export function getFilteredRollupDeals() {
  const deals = state.dashboard?.deals ?? [];
  return state.rollupDealFilter ? deals.filter((deal) => deal.id === state.rollupDealFilter) : deals;
}

export function applyContractorFilters(rows) {
  return state.contractorDealFilter
    ? rows.filter((row) => row.dealId === state.contractorDealFilter)
    : rows;
}

export function getContractorFilterOptions(rows) {
  return [
    ...new Map(rows.map((row) => [row.dealId, { id: row.dealId, name: row.dealName }])).values()
  ].sort((left, right) => left.name.localeCompare(right.name));
}

export function buildContractorProjectRollups(rows) {
  const byDeal = new Map();

  for (const row of rows) {
    if (!byDeal.has(row.dealId)) {
      byDeal.set(row.dealId, {
        dealId: row.dealId,
        dealName: row.dealName,
        contractorCount: 0,
        totalContractValue: 0,
        cashPaid: 0,
        deferredAmount: 0,
        prefEarned: 0,
        profitShare: 0,
        totalPayout: 0
      });
    }

    const summary = byDeal.get(row.dealId);
    summary.contractorCount += 1;
    summary.totalContractValue += row.totalContractValue ?? 0;
    summary.cashPaid += row.cashPaid ?? 0;
    summary.deferredAmount += row.deferredAmount ?? 0;
    summary.prefEarned += row.prefEarned ?? 0;
    summary.profitShare += row.profitShare ?? 0;
    summary.totalPayout += row.totalPayout ?? 0;
  }

  return [...byDeal.values()]
    .map((row) => ({
      ...row,
      totalContractValue: roundMoney(row.totalContractValue),
      cashPaid: roundMoney(row.cashPaid),
      deferredAmount: roundMoney(row.deferredAmount),
      prefEarned: roundMoney(row.prefEarned),
      profitShare: roundMoney(row.profitShare),
      totalPayout: roundMoney(row.totalPayout)
    }))
    .sort((left, right) => left.dealName.localeCompare(right.dealName));
}

export function createTimelineDraft(step = {}) {
  return {
    label: String(step.label ?? ""),
    date: String(step.date ?? ""),
    status: String(step.status ?? "upcoming")
  };
}

export function createDebtServiceDraft(entry = {}) {
  return {
    serviceMonth: String(entry.serviceMonth ?? ""),
    drawBalance:
      entry.drawBalance === 0 || entry.drawBalance ? String(entry.drawBalance) : "",
    interestPaid:
      entry.interestPaid === 0 || entry.interestPaid ? String(entry.interestPaid) : ""
  };
}

export function createExpenseDraft(entry = {}) {
  return {
    stageLabel: String(entry.stageLabel ?? ""),
    payeeName: String(entry.payeeName ?? ""),
    amountPaid: entry.amountPaid === 0 || entry.amountPaid ? String(entry.amountPaid) : "",
    paidOn: String(entry.paidOn ?? ""),
    notes: String(entry.notes ?? "")
  };
}

export function createTierDraft(tier = {}) {
  return {
    label: String(tier.label ?? ""),
    hurdle: tier.hurdle === 0 || tier.hurdle ? String(tier.hurdle) : "",
    investorShare:
      tier.investorShare === 0 || tier.investorShare ? String(tier.investorShare) : "",
    sponsorShare:
      tier.sponsorShare === 0 || tier.sponsorShare ? String(tier.sponsorShare) : "",
    isEnabled: tier.isEnabled !== false
  };
}

export function buildCreateDealDraft() {
  const defaults = getCreateDealDefaults();

  return {
    ...defaults,
    holdMonths: String(defaults.holdMonths),
    prefRate: String(defaults.prefRate),
    taxExpense: String(defaults.taxExpense),
    debtInterestRate: String(defaults.debtInterestRate),
    earlyWithdrawalPenaltyRate: String(defaults.earlyWithdrawalPenaltyRate),
    timelineProgress: String(defaults.timelineProgress),
    expenseEntries: [createExpenseDraft()],
    debtServiceEntries: [createDebtServiceDraft({ serviceMonth: currentMonthStamp() })]
  };
}

export function buildDealEditorDraft(deal) {
  return {
    id: deal.id,
    name: String(deal.name ?? ""),
    location: String(deal.location ?? ""),
    currentPhase: String(deal.currentPhase ?? ""),
    status: String(deal.status ?? "under_construction"),
    budgetedProjectCost: String(deal.budgetedProjectCost ?? deal.totalProjectCost ?? 0),
    debt: String(deal.debt ?? 0),
    taxExpense: String(deal.taxExpense ?? 0),
    debtInterestRate: String(deal.debtInterestRate ?? 0),
    earlyWithdrawalPenaltyRate: String(deal.earlyWithdrawalPenaltyRate ?? 0.3),
    salePrice: String(deal.salePrice ?? 0),
    holdMonths: String(deal.holdMonths ?? 1),
    prefRate: String(deal.prefRate ?? 0),
    timelineProgress: String(deal.timelineProgress ?? 0),
    fundedOn: String(deal.fundedOn ?? ""),
    investmentCloseOn: String(deal.investmentCloseOn ?? ""),
    projectedExitOn: String(deal.projectedExitOn ?? ""),
    actualExitOn: String(deal.actualExitOn ?? ""),
    expenseEntries:
      deal.expenseEntries?.length
        ? deal.expenseEntries.map((entry) => createExpenseDraft(entry))
        : [createExpenseDraft()],
    debtServiceEntries:
      deal.debtServiceEntries?.length
        ? deal.debtServiceEntries.map((entry) => createDebtServiceDraft(entry))
        : [createDebtServiceDraft({ serviceMonth: currentMonthStamp() })],
    timeline:
      deal.timeline?.length
        ? deal.timeline.map((step) => createTimelineDraft(step))
        : [createTimelineDraft()],
    promoteTiers:
      deal.promoteTiers?.length
        ? deal.promoteTiers.map((tier) => createTierDraft(tier))
        : [createTierDraft({ investorShare: 0.7, sponsorShare: 0.3, isEnabled: true })]
  };
}

export function getCreateDealDraft() {
  if (!state.createDealDraft) {
    state.createDealDraft = buildCreateDealDraft();
  }

  return state.createDealDraft;
}

export function updateCreateDealDraft(updater) {
  const current = getCreateDealDraft();
  const nextDraft = updater({
    ...current,
    expenseEntries: current.expenseEntries.map((entry) => ({ ...entry })),
    debtServiceEntries: current.debtServiceEntries.map((entry) => ({ ...entry }))
  });

  state.createDealDraft = nextDraft;
  return nextDraft;
}

export function syncCreateDealField(target) {
  const form = target.closest("#create-deal-form");

  if (!form) {
    return false;
  }

  if (target.dataset.createDealField) {
    updateCreateDealDraft((draft) => ({
      ...draft,
      [target.dataset.createDealField]: target.value,
      ...(target.dataset.createDealField === "status" && target.value === "sold"
        ? { timelineProgress: "100" }
        : {})
    }));
    return true;
  }

  if (target.dataset.createDebtServiceField) {
    const index = Number(target.dataset.index);

    if (!Number.isFinite(index)) {
      return false;
    }

    updateCreateDealDraft((draft) => ({
      ...draft,
      debtServiceEntries: draft.debtServiceEntries.map((entry, entryIndex) =>
        entryIndex === index
          ? { ...entry, [target.dataset.createDebtServiceField]: target.value }
          : entry
      )
    }));
    return true;
  }

  if (target.dataset.createExpenseField) {
    const index = Number(target.dataset.index);

    if (!Number.isFinite(index)) {
      return false;
    }

    updateCreateDealDraft((draft) => ({
      ...draft,
      expenseEntries: draft.expenseEntries.map((entry, entryIndex) =>
        entryIndex === index
          ? { ...entry, [target.dataset.createExpenseField]: target.value }
          : entry
      )
    }));
    return true;
  }

  return false;
}

export function getDealById(dealId) {
  return state.dashboard?.deals?.find((deal) => deal.id === dealId) ?? null;
}

export function getDealEditorDraft(deal = getManagerEditableDeal()) {
  if (!deal) {
    return null;
  }

  if (!state.dealEditorDrafts[deal.id]) {
    state.dealEditorDrafts[deal.id] = buildDealEditorDraft(deal);
  }

  return state.dealEditorDrafts[deal.id];
}

export function updateDealEditorDraft(dealId, updater) {
  const deal = getDealById(dealId);

  if (!deal) {
    return null;
  }

  const current = getDealEditorDraft(deal);
  const nextDraft = updater({
    ...current,
    expenseEntries: current.expenseEntries.map((entry) => ({ ...entry })),
    debtServiceEntries: current.debtServiceEntries.map((entry) => ({ ...entry })),
    timeline: current.timeline.map((step) => ({ ...step })),
    promoteTiers: current.promoteTiers.map((tier) => ({ ...tier }))
  });

  state.dealEditorDrafts = {
    ...state.dealEditorDrafts,
    [dealId]: nextDraft
  };

  return nextDraft;
}

export function syncDealEditorField(target) {
  const form = target.closest("#deal-form");

  if (!form) {
    return false;
  }

  const dealId = form.dataset.dealId;

  if (!dealId) {
    return false;
  }

  if (target.dataset.dealField) {
    updateDealEditorDraft(dealId, (draft) => ({
      ...draft,
      [target.dataset.dealField]: target.value,
      ...(target.dataset.dealField === "status" && target.value === "sold"
        ? { timelineProgress: "100" }
        : {})
    }));
    return true;
  }

  if (target.dataset.timelineField) {
    const index = Number(target.dataset.index);

    if (!Number.isFinite(index)) {
      return false;
    }

    updateDealEditorDraft(dealId, (draft) => {
      const timeline = draft.timeline.map((step, stepIndex) =>
        stepIndex === index
          ? { ...step, [target.dataset.timelineField]: target.value }
          : step
      );

      return {
        ...draft,
        timeline
      };
    });
    return true;
  }

  if (target.dataset.debtServiceField) {
    const index = Number(target.dataset.index);

    if (!Number.isFinite(index)) {
      return false;
    }

    updateDealEditorDraft(dealId, (draft) => ({
      ...draft,
      debtServiceEntries: draft.debtServiceEntries.map((entry, entryIndex) =>
        entryIndex === index
          ? { ...entry, [target.dataset.debtServiceField]: target.value }
          : entry
      )
    }));
    return true;
  }

  if (target.dataset.expenseField) {
    const index = Number(target.dataset.index);

    if (!Number.isFinite(index)) {
      return false;
    }

    updateDealEditorDraft(dealId, (draft) => ({
      ...draft,
      expenseEntries: draft.expenseEntries.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [target.dataset.expenseField]: target.value } : entry
      )
    }));
    return true;
  }

  if (target.dataset.tierField) {
    const index = Number(target.dataset.index);

    if (!Number.isFinite(index)) {
      return false;
    }

    updateDealEditorDraft(dealId, (draft) => {
      const promoteTiers = draft.promoteTiers.map((tier, tierIndex) =>
        tierIndex === index
          ? {
              ...tier,
              [target.dataset.tierField]:
                target.type === "checkbox" ? target.checked : target.value
            }
          : tier
      );

      return {
        ...draft,
        promoteTiers
      };
    });
    return true;
  }

  return false;
}
