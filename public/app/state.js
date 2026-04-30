export const ALLOCATION_PAGE_SIZE = 50;
export const SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const SESSION_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
export const SESSION_ACTIVITY_THROTTLE_MS = 30 * 1000;
export const SESSION_IDLE_MESSAGE = "You were logged out after 15 minutes of inactivity.";
export const COMPANY_NAME = "Njinko Development Group LLC";
export const LOGIN_PAGE_TITLE = "Investor and Manager Access Portal";
export const RESET_TOKEN_PARAM = "resetToken";
export const DEFAULT_MANAGER_PAGE = "overview";

function getPasswordResetTokenFromLocation() {
  const params = new URLSearchParams(window.location.search);
  return String(params.get(RESET_TOKEN_PARAM) ?? "").trim();
}

const initialPasswordResetToken = getPasswordResetTokenFromLocation();

export function createInitialAllocationFilters() {
  return {
    dealId: "",
    participantId: "",
    category: "",
    classType: ""
  };
}

export function createInitialUserFilters() {
  return {
    search: "",
    category: "",
    role: "",
    status: ""
  };
}

export function createInitialDistributionReviewFilters() {
  return {
    dealId: "",
    participantId: ""
  };
}

export function createInitialInvestorProjectFilters() {
  return {
    dealId: "",
    status: ""
  };
}

export function createInitialInvestorIssueFilters() {
  return {
    dealId: "",
    status: ""
  };
}

export function createInitialMessages() {
  return {
    user: null,
    allocation: null,
    deal: null,
    dealCreate: null,
    issue: null,
    pool: null,
    vote: null,
    distribution: null,
    withdrawal: null,
    resource: null,
    directory: null,
    profile: null,
    password: null,
    identity: null
  };
}

export const state = {
  session: null,
  dashboard: null,
  calculator: null,
  calculatorSelectionId: null,
  managerPage: DEFAULT_MANAGER_PAGE,
  adminDealId: null,
  createDealDraft: null,
  dealEditorDrafts: {},
  rollupDealFilter: "",
  contractorDealFilter: "",
  archivedProjectFilter: "",
  notificationPanelOpen: false,
  collapsedSections: {},
  allocationPage: 1,
  allocationFilters: createInitialAllocationFilters(),
  distributionReviewFilters: createInitialDistributionReviewFilters(),
  investorProjectFilters: createInitialInvestorProjectFilters(),
  investorIssueFilters: createInitialInvestorIssueFilters(),
  userFilters: createInitialUserFilters(),
  authMode: initialPasswordResetToken ? "reset" : "login",
  passwordResetToken: initialPasswordResetToken || null,
  authMessage: null,
  loginError: "",
  loading: true,
  messages: createInitialMessages()
};

export const app = document.querySelector("#app");

export const sessionRuntime = {
  idleTimeoutId: null,
  heartbeatIntervalId: null,
  lastActivityAt: 0
};
