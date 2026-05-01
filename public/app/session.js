import {
  ALLOCATION_PAGE_SIZE,
  DEFAULT_MANAGER_PAGE,
  SESSION_ACTIVITY_THROTTLE_MS,
  SESSION_HEARTBEAT_INTERVAL_MS,
  SESSION_IDLE_MESSAGE,
  SESSION_IDLE_TIMEOUT_MS,
  createInitialAllocationFilters,
  createInitialDistributionReviewFilters,
  createInitialInvestorIssueFilters,
  createInitialInvestorProjectFilters,
  createInitialQuestionnaireFilters,
  createInitialUserFilters,
  sessionRuntime,
  state
} from "./state.js?v=20260501-frontend-09";
import {
  clearAuthFeedback,
  clearMessages
} from "./helpers.js?v=20260501-frontend-09";
import {
  applyAllocationFilters,
  getAllocationFilterOptions,
  getCalculatorPreset,
  getContractorFilterOptions,
  getDistributionReviewFilterOptions,
  getInvestorIssueFilterOptions,
  getInvestorProjectFilterOptions,
  getUserFilterOptions
} from "./data.js?v=20260501-frontend-09";
import { render } from "./renderers.js?v=20260501-frontend-09";

export async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    },
    ...options
  });

  const payload = await response.json();

  if (!response.ok) {
    const error = new Error(payload.error ?? "Request failed.");
    error.status = response.status;
    error.code = payload.code;

    if (response.status === 401 && path !== "/api/login") {
      applyLoggedOutState(payload.code === "SESSION_EXPIRED" ? SESSION_IDLE_MESSAGE : payload.error);
    }

    throw error;
  }

  return payload;
}

export function resetDashboardState() {
  state.dashboard = null;
  state.calculator = null;
  state.calculatorSelectionId = null;
  state.managerPage = DEFAULT_MANAGER_PAGE;
  state.adminDealId = null;
  state.dealEditorDrafts = {};
  state.rollupDealFilter = "";
  state.contractorDealFilter = "";
  state.archivedProjectFilter = "";
  state.questionnaireFilters = createInitialQuestionnaireFilters();
  state.notificationPanelOpen = false;
  state.accountDetailsOpen = false;
  state.allocationPage = 1;
  state.allocationFilters = createInitialAllocationFilters();
  state.distributionReviewFilters = createInitialDistributionReviewFilters();
  state.investorProjectFilters = createInitialInvestorProjectFilters();
  state.investorIssueFilters = createInitialInvestorIssueFilters();
  state.userFilters = createInitialUserFilters();
}

export function stopSessionTimers() {
  if (sessionRuntime.idleTimeoutId) {
    window.clearTimeout(sessionRuntime.idleTimeoutId);
    sessionRuntime.idleTimeoutId = null;
  }

  if (sessionRuntime.heartbeatIntervalId) {
    window.clearInterval(sessionRuntime.heartbeatIntervalId);
    sessionRuntime.heartbeatIntervalId = null;
  }
}

export function scheduleIdleLogout() {
  if (!state.session) {
    stopSessionTimers();
    return;
  }

  if (sessionRuntime.idleTimeoutId) {
    window.clearTimeout(sessionRuntime.idleTimeoutId);
  }

  sessionRuntime.idleTimeoutId = window.setTimeout(() => {
    void handleIdleLogout();
  }, SESSION_IDLE_TIMEOUT_MS);
}

export function recordSessionActivity(force = false) {
  if (!state.session) {
    return;
  }

  const now = Date.now();

  if (!force && now - sessionRuntime.lastActivityAt < SESSION_ACTIVITY_THROTTLE_MS) {
    return;
  }

  sessionRuntime.lastActivityAt = now;
  scheduleIdleLogout();
}

export async function pingSession() {
  if (!state.session) {
    return;
  }

  try {
    await api("/api/session/ping", { method: "GET" });
  } catch {}
}

export function startSessionTimers() {
  stopSessionTimers();

  if (!state.session) {
    return;
  }

  sessionRuntime.lastActivityAt = Date.now();
  scheduleIdleLogout();
  sessionRuntime.heartbeatIntervalId = window.setInterval(() => {
    if (
      !state.session ||
      Date.now() - sessionRuntime.lastActivityAt >= SESSION_IDLE_TIMEOUT_MS
    ) {
      return;
    }

    void pingSession();
  }, SESSION_HEARTBEAT_INTERVAL_MS);
}

function canLoadDashboard(session) {
  if (!session || session.mustChangePassword) {
    return false;
  }

  if (session.hasPendingLegalAcknowledgements) {
    return false;
  }

  return session.role === "manager" || (session.accountApprovalStatus ?? "approved") === "approved";
}

export function applyLoggedOutState(notice = "") {
  stopSessionTimers();
  state.session = null;
  resetDashboardState();
  clearMessages();
  state.loading = false;
  clearAuthFeedback();
  state.authMode = state.passwordResetToken ? "reset" : "login";
  state.loginError = notice || "";
  render();
}

export async function handleIdleLogout() {
  if (!state.session) {
    return;
  }

  try {
    await api("/api/logout", {
      method: "POST",
      body: JSON.stringify({})
    });
  } catch {}

  applyLoggedOutState(SESSION_IDLE_MESSAGE);
}

export async function loadCalculator(dealId, overrides = null) {
  const preset = getCalculatorPreset(dealId);

  if (!preset) {
    state.calculator = null;
    state.calculatorSelectionId = null;
    return;
  }

  state.calculatorSelectionId = preset.id;
  state.calculator = await api("/api/calculator", {
    method: "POST",
    body: JSON.stringify(
      overrides ?? {
        dealId: preset.id,
        salePrice: preset.salePrice,
        totalProjectCost: preset.totalProjectCost,
        holdMonths: preset.holdMonths,
        prefRate: preset.prefRate,
        taxExpense: preset.taxExpense
      }
    )
  });
}

export async function refreshDashboard() {
  state.dashboard = await api("/api/dashboard", { method: "GET" });
  state.dealEditorDrafts = {};

  if (state.dashboard.role === "manager") {
    const dealIds = new Set(state.dashboard.deals.map((deal) => deal.id));

    if (
      !state.adminDealId ||
      !state.dashboard.deals.some((deal) => deal.id === state.adminDealId)
    ) {
      state.adminDealId = state.dashboard.deals[0]?.id ?? null;
    }

    if (state.rollupDealFilter && !dealIds.has(state.rollupDealFilter)) {
      state.rollupDealFilter = "";
    }

    const contractorOptions = getContractorFilterOptions(state.dashboard.contractorLedger);

    if (
      state.contractorDealFilter &&
      !contractorOptions.some((deal) => deal.id === state.contractorDealFilter)
    ) {
      state.contractorDealFilter = "";
    }

    const allocationRows = state.dashboard.admin.allocations;
    const allocationOptions = getAllocationFilterOptions(allocationRows);

    if (
      state.allocationFilters.dealId &&
      !allocationOptions.deals.some((deal) => deal.id === state.allocationFilters.dealId)
    ) {
      state.allocationFilters.dealId = "";
    }

    if (
      state.allocationFilters.participantId &&
      !allocationOptions.participants.some(
        (participant) => participant.id === state.allocationFilters.participantId
      )
    ) {
      state.allocationFilters.participantId = "";
    }

    if (
      state.allocationFilters.category &&
      !allocationOptions.categories.includes(state.allocationFilters.category)
    ) {
      state.allocationFilters.category = "";
    }

    if (
      state.allocationFilters.classType &&
      !allocationOptions.classTypes.includes(state.allocationFilters.classType)
    ) {
      state.allocationFilters.classType = "";
    }

    const distributionReviewRows = state.dashboard.admin.distributionReviews;
    const distributionReviewOptions = getDistributionReviewFilterOptions(distributionReviewRows);

    if (
      state.distributionReviewFilters.dealId &&
      !distributionReviewOptions.deals.some(
        (deal) => deal.id === state.distributionReviewFilters.dealId
      )
    ) {
      state.distributionReviewFilters.dealId = "";
    }

    if (
      state.distributionReviewFilters.participantId &&
      !distributionReviewOptions.participants.some(
        (participant) => participant.id === state.distributionReviewFilters.participantId
      )
    ) {
      state.distributionReviewFilters.participantId = "";
    }

    const userRows = state.dashboard.admin.users;
    const userFilterOptions = getUserFilterOptions(userRows);

    if (
      state.userFilters.category &&
      !userFilterOptions.categories.includes(state.userFilters.category)
    ) {
      state.userFilters.category = "";
    }

    if (state.userFilters.role && !userFilterOptions.roles.includes(state.userFilters.role)) {
      state.userFilters.role = "";
    }

    const filteredAllocationCount = applyAllocationFilters(allocationRows).length;
    const totalPages = Math.max(1, Math.ceil(filteredAllocationCount / ALLOCATION_PAGE_SIZE));
    state.allocationPage = Math.min(Math.max(state.allocationPage, 1), totalPages);

    const nextCalculatorDealId =
      state.calculatorSelectionId &&
      state.dashboard.calculator.deals.some((deal) => deal.id === state.calculatorSelectionId)
        ? state.calculatorSelectionId
        : state.dashboard.calculator.deals[0]?.id ?? null;

    if (nextCalculatorDealId) {
      await loadCalculator(nextCalculatorDealId);
    } else {
      state.calculator = null;
      state.calculatorSelectionId = null;
    }
  } else {
    state.calculator = null;
    state.calculatorSelectionId = null;
    state.adminDealId = null;
    state.dealEditorDrafts = {};
    state.rollupDealFilter = "";
    state.contractorDealFilter = "";
    state.allocationPage = 1;
    state.allocationFilters = createInitialAllocationFilters();
    state.distributionReviewFilters = createInitialDistributionReviewFilters();
    state.userFilters = createInitialUserFilters();

    const investorProjectOptions = getInvestorProjectFilterOptions(state.dashboard.projects ?? []);

    if (
      state.investorProjectFilters.dealId &&
      !investorProjectOptions.deals.some(
        (deal) => deal.id === state.investorProjectFilters.dealId
      )
    ) {
      state.investorProjectFilters.dealId = "";
    }

    if (
      state.investorProjectFilters.status &&
      !investorProjectOptions.statuses.includes(state.investorProjectFilters.status)
    ) {
      state.investorProjectFilters.status = "";
    }

    const investorIssueOptions = getInvestorIssueFilterOptions(
      state.dashboard.governance?.issues ?? []
    );

    if (
      state.investorIssueFilters.dealId &&
      !investorIssueOptions.deals.some((deal) => deal.id === state.investorIssueFilters.dealId)
    ) {
      state.investorIssueFilters.dealId = "";
    }

    if (
      state.investorIssueFilters.status &&
      !investorIssueOptions.statuses.includes(state.investorIssueFilters.status)
    ) {
      state.investorIssueFilters.status = "";
    }
  }
}

export async function loadSession() {
  state.loading = true;
  render();

  try {
    const session = await api("/api/session", { method: "GET" });
    state.session = session.user;

    if (canLoadDashboard(state.session)) {
      clearAuthFeedback();
      startSessionTimers();
      await refreshDashboard();
    } else if (state.session) {
      clearAuthFeedback();
      resetDashboardState();
      startSessionTimers();
    } else {
      stopSessionTimers();
      resetDashboardState();
      state.authMode = state.passwordResetToken ? "reset" : "login";

      if (session.expired) {
        state.loginError = SESSION_IDLE_MESSAGE;
      }
    }
  } catch (error) {
    state.loginError = error.message;
    state.session = null;
    stopSessionTimers();
    resetDashboardState();
    state.authMode = state.passwordResetToken ? "reset" : "login";
  } finally {
    state.loading = false;
    render();
  }
}
