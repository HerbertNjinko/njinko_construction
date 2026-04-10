const ALLOCATION_PAGE_SIZE = 50;

const state = {
  session: null,
  dashboard: null,
  calculator: null,
  calculatorSelectionId: null,
  adminDealId: null,
  dealEditorDrafts: {},
  rollupDealFilter: "",
  contractorDealFilter: "",
  collapsedSections: {},
  allocationPage: 1,
  allocationFilters: {
    dealId: "",
    participantId: "",
    category: "",
    classType: ""
  },
  userFilters: {
    search: "",
    category: "",
    role: "",
    status: ""
  },
  loginError: "",
  loading: true,
  messages: {
    user: null,
    allocation: null,
    deal: null,
    dealCreate: null,
    issue: null,
    vote: null,
    directory: null,
    profile: null,
    password: null
  }
};

const app = document.querySelector("#app");

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
});

const precisePercent = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatCurrency(value) {
  return currency.format(value ?? 0);
}

function formatPercent(value) {
  return percent.format(value ?? 0);
}

function formatRate(value) {
  return precisePercent.format(value ?? 0);
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function inputValue(value) {
  return escapeHtml(String(value ?? ""));
}

function titleCase(value) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

async function api(path, options = {}) {
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
    throw new Error(payload.error ?? "Request failed.");
  }

  return payload;
}

function clearMessages() {
  state.messages = {
    user: null,
    allocation: null,
    deal: null,
    dealCreate: null,
    issue: null,
    vote: null,
    directory: null,
    profile: null,
    password: null
  };
}

function setMessage(section, type, text) {
  state.messages[section] = {
    type,
    text
  };
}

function renderMessage(message) {
  if (!message) {
    return "";
  }

  return `
    <div class="status-message status-${escapeHtml(message.type)}">
      ${escapeHtml(message.text)}
    </div>
  `;
}

function isSectionCollapsed(sectionId) {
  return Boolean(state.collapsedSections?.[sectionId]);
}

function toggleSectionCollapsed(sectionId) {
  state.collapsedSections = {
    ...state.collapsedSections,
    [sectionId]: !isSectionCollapsed(sectionId)
  };
}

function renderSectionToggle(sectionId) {
  const collapsed = isSectionCollapsed(sectionId);

  return `
    <button
      class="button-secondary button-inline section-toggle-button"
      type="button"
      data-section-toggle="${escapeHtml(sectionId)}"
      aria-expanded="${collapsed ? "false" : "true"}"
    >
      ${collapsed ? "Maximize" : "Minimize"}
    </button>
  `;
}

function renderCollapsibleSection({
  sectionId,
  title,
  copy = "",
  body,
  message = "",
  panelClass = "panel",
  headerActions = "",
  bodyClass = ""
}) {
  const collapsed = isSectionCollapsed(sectionId);

  return `
    <section class="${escapeHtml(panelClass)} collapsible-section ${
      collapsed ? "collapsed" : ""
    }">
      <div class="section-head">
        <div>
          <h3>${escapeHtml(title)}</h3>
          ${copy ? `<p class="section-copy">${escapeHtml(copy)}</p>` : ""}
        </div>
        <div class="section-tools">
          ${headerActions}
          ${renderSectionToggle(sectionId)}
        </div>
      </div>
      ${message}
      ${
        collapsed
          ? '<div class="section-collapsed-note">Section minimized. Use Maximize to reopen it.</div>'
          : `<div class="collapsible-section-body ${escapeHtml(bodyClass)}">${body}</div>`
      }
    </section>
  `;
}

function metricCard(label, value) {
  return `
    <article class="metric-card">
      <p class="metric-label">${escapeHtml(label)}</p>
      <p class="metric-value">${escapeHtml(value)}</p>
    </article>
  `;
}

function summaryItem(label, value) {
  return `
    <article class="summary-item">
      <h4>${escapeHtml(label)}</h4>
      <p>${escapeHtml(value)}</p>
    </article>
  `;
}

function breakdownItem(label, value) {
  return `
    <article class="breakdown-item">
      <h4>${escapeHtml(label)}</h4>
      <p>${escapeHtml(value)}</p>
    </article>
  `;
}

function formatNotificationStatus(notification) {
  if (!notification) {
    return "No notification recorded";
  }

  if (notification.status === "sent") {
    return "Credential email sent.";
  }

  if (notification.status === "saved_local") {
    return notification.localPath
      ? `SMTP not configured. Saved to ${notification.localPath}.`
      : "SMTP not configured. Saved to local outbox.";
  }

  return notification.errorMessage
    ? `Notification error: ${notification.errorMessage}`
    : "Notification could not be delivered.";
}

function formatNotificationBatchSummary(notifications = []) {
  if (!notifications.length) {
    return "No investor alerts were sent.";
  }

  const sent = notifications.filter((item) => item.status === "sent").length;
  const savedLocal = notifications.filter((item) => item.status === "saved_local").length;
  const failed = notifications.filter((item) => item.status === "failed").length;
  const parts = [];

  if (sent) {
    parts.push(`${sent} sent`);
  }

  if (savedLocal) {
    parts.push(`${savedLocal} saved to local outbox`);
  }

  if (failed) {
    parts.push(`${failed} failed`);
  }

  return parts.length ? `Investor alerts: ${parts.join(", ")}.` : "No investor alerts were sent.";
}

function formatDateTime(value) {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function getCreateDealDefaults() {
  return {
    status: "under_construction",
    holdMonths: 18,
    prefRate: 0.08,
    debtInterestRate: 0,
    totalInterestPaid: 0,
    timelineProgress: 0,
    fundedOn: new Date().toISOString().slice(0, 10)
  };
}

function getDefaultVoteCloseDate() {
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  return nextWeek.toISOString().slice(0, 10);
}

async function readFileAsPayload(file) {
  if (!file) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl: String(reader.result ?? "")
      });
    reader.onerror = () => reject(new Error("Unable to read the selected file."));
    reader.readAsDataURL(file);
  });
}

function getManagerEditableDeal() {
  if (!state.dashboard?.deals?.length) {
    return null;
  }

  return (
    state.dashboard.deals.find((deal) => deal.id === state.adminDealId) ??
    state.dashboard.deals[0]
  );
}

function getCalculatorPreset(dealId) {
  return state.dashboard?.calculator?.deals?.find((deal) => deal.id === dealId) ?? null;
}

function applyAllocationFilters(rows) {
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

function applyUserFilters(rows) {
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

      if (rowStatus !== state.userFilters.status) {
        return false;
      }
    }

    return true;
  });
}

function getAllocationFilterOptions(rows) {
  const deals = [...new Map(rows.map((row) => [row.dealId, { id: row.dealId, name: row.dealName }])).values()]
    .sort((left, right) => left.name.localeCompare(right.name));
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

function getUserFilterOptions(rows) {
  return {
    categories: [...new Set(rows.map((row) => row.category))].sort((left, right) =>
      left.localeCompare(right)
    ),
    roles: [...new Set(rows.map((row) => row.role))].sort((left, right) =>
      left.localeCompare(right)
    )
  };
}

function getFilteredRollupDeals() {
  const deals = state.dashboard?.deals ?? [];
  return state.rollupDealFilter ? deals.filter((deal) => deal.id === state.rollupDealFilter) : deals;
}

function applyContractorFilters(rows) {
  return state.contractorDealFilter
    ? rows.filter((row) => row.dealId === state.contractorDealFilter)
    : rows;
}

function getContractorFilterOptions(rows) {
  return [
    ...new Map(rows.map((row) => [row.dealId, { id: row.dealId, name: row.dealName }])).values()
  ].sort((left, right) => left.name.localeCompare(right.name));
}

function buildContractorProjectRollups(rows) {
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

function createTimelineDraft(step = {}) {
  return {
    label: String(step.label ?? ""),
    date: String(step.date ?? ""),
    status: String(step.status ?? "upcoming")
  };
}

function createTierDraft(tier = {}) {
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

function buildDealEditorDraft(deal) {
  return {
    id: deal.id,
    name: String(deal.name ?? ""),
    location: String(deal.location ?? ""),
    currentPhase: String(deal.currentPhase ?? ""),
    status: String(deal.status ?? "under_construction"),
    totalProjectCost: String(deal.totalProjectCost ?? 0),
    debt: String(deal.debt ?? 0),
    debtInterestRate: String(deal.debtInterestRate ?? 0),
    totalInterestPaid: String(deal.totalInterestPaid ?? 0),
    salePrice: String(deal.salePrice ?? 0),
    holdMonths: String(deal.holdMonths ?? 1),
    prefRate: String(deal.prefRate ?? 0),
    timelineProgress: String(deal.timelineProgress ?? 0),
    fundedOn: String(deal.fundedOn ?? ""),
    projectedExitOn: String(deal.projectedExitOn ?? ""),
    actualExitOn: String(deal.actualExitOn ?? ""),
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

function getDealById(dealId) {
  return state.dashboard?.deals?.find((deal) => deal.id === dealId) ?? null;
}

function getDealEditorDraft(deal = getManagerEditableDeal()) {
  if (!deal) {
    return null;
  }

  if (!state.dealEditorDrafts[deal.id]) {
    state.dealEditorDrafts[deal.id] = buildDealEditorDraft(deal);
  }

  return state.dealEditorDrafts[deal.id];
}

function updateDealEditorDraft(dealId, updater) {
  const deal = getDealById(dealId);

  if (!deal) {
    return null;
  }

  const current = getDealEditorDraft(deal);
  const nextDraft = updater({
    ...current,
    timeline: current.timeline.map((step) => ({ ...step })),
    promoteTiers: current.promoteTiers.map((tier) => ({ ...tier }))
  });

  state.dealEditorDrafts = {
    ...state.dealEditorDrafts,
    [dealId]: nextDraft
  };

  return nextDraft;
}

function syncDealEditorField(target) {
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

async function loadCalculator(dealId, overrides = null) {
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
        holdMonths: preset.holdMonths,
        prefRate: preset.prefRate
      }
    )
  });
}

async function refreshDashboard() {
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
    state.allocationFilters = {
      dealId: "",
      participantId: "",
      category: "",
      classType: ""
    };
    state.userFilters = {
      search: "",
      category: "",
      role: "",
      status: ""
    };
  }
}

function renderLogin() {
  return `
    <div class="shell">
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">Investor Portal + Promote Calculator</p>
          <h1>Deal visibility without exposing the whole cap table.</h1>
          <p>
            Investors and contractor participants get a clean dashboard for their
            capital, preferred return, projected payout, profile details, and
            payout instructions. Sponsor access includes manager controls backed by Postgres.
          </p>
          <ul class="feature-list">
            <li>Personal portfolio totals with active deal count and current pref accrual.</li>
            <li>Per-project ownership, payout breakdown, status, and timeline progress.</li>
            <li>Manager-side user creation, deal allocations, profile capture, and first-login password resets.</li>
          </ul>
        </div>
        <aside class="login-panel">
          <p class="eyebrow">Secure Access</p>
          <h2>Log in</h2>
          <p>Each user sees only their own position. Sponsor access stays separate.</p>
          ${
            state.loginError
              ? `<div class="error-message">${escapeHtml(state.loginError)}</div>`
              : ""
          }
          <form id="login-form">
            <label>
              Email
              <input type="email" name="email" placeholder="name@example.com" required />
            </label>
            <label>
              Password
              <input type="password" name="password" placeholder="Password" required />
            </label>
            <button class="button-primary" type="submit">Enter dashboard</button>
          </form>
        </aside>
      </section>

      <section class="panel">
        <div class="section-head">
          <div>
            <h3>Demo Accounts</h3>
            <p class="section-copy">
              Use these seeded accounts to inspect the investor view, a contractor-as-investor view,
              and the sponsor management console.
            </p>
          </div>
        </div>
        <div class="credentials-grid">
          <article class="credential-card">
            <h3>Manager</h3>
            <p><code>manager@njinko.dev</code></p>
            <p><code>njinko-admin</code></p>
          </article>
          <article class="credential-card">
            <h3>Sarah Thompson</h3>
            <p><code>sarah@bluecrest.dev</code></p>
            <p><code>investor-sarah</code></p>
          </article>
          <article class="credential-card">
            <h3>David Kim</h3>
            <p><code>david@bluecrest.dev</code></p>
            <p><code>investor-david</code></p>
          </article>
          <article class="credential-card">
            <h3>John Rivera</h3>
            <p><code>john@solidset.dev</code></p>
            <p><code>contractor-john</code></p>
          </article>
        </div>
      </section>
    </div>
  `;
}

function renderPasswordResetGate() {
  return `
    <div class="shell">
      <section class="panel password-gate">
        <div class="section-head">
          <div>
            <p class="eyebrow">Password Update Required</p>
            <h2>${escapeHtml(state.session.name)}</h2>
            <p class="section-copy">
              This account was created with a temporary password. Change it now before continuing.
            </p>
          </div>
          <div class="button-row">
            <span class="read-only-tag">${escapeHtml(state.session.email)}</span>
            <button class="button-secondary" id="logout-button" type="button">Log out</button>
          </div>
        </div>
        ${renderMessage(state.messages.password)}
        <form id="password-form">
          <label>
            Current password
            <input type="password" name="currentPassword" autocomplete="current-password" required />
          </label>
          <div class="form-grid-2">
            <label>
              New password
              <input type="password" name="newPassword" minlength="8" autocomplete="new-password" required />
            </label>
            <label>
              Confirm new password
              <input type="password" name="confirmPassword" minlength="8" autocomplete="new-password" required />
            </label>
          </div>
          <button class="button-primary" type="submit">Update password</button>
        </form>
      </section>
    </div>
  `;
}

function renderProfilePanel() {
  const { profile, viewer } = state.dashboard;

  return renderCollapsibleSection({
    sectionId: `${viewer.role}-profile`,
    title: "Profile & Payout Details",
    copy:
      "Update your contact information and payment instructions here. Deal-level positions remain read only.",
    message: renderMessage(state.messages.profile),
    body: `
      <div class="summary-grid">
        ${summaryItem("Portal role", titleCase(viewer.role))}
        ${summaryItem("User category", titleCase(viewer.category ?? viewer.role))}
        ${summaryItem("Driver's license", profile.driverLicenseNumber || "Not provided")}
        ${summaryItem("Attached ID", profile.idCardFileName || "No file attached")}
      </div>
      <form id="profile-form">
        <div class="form-grid-3">
          <label>
            First name
            <input type="text" name="firstName" value="${inputValue(profile.firstName)}" minlength="2" required />
          </label>
          <label>
            Middle name
            <input type="text" name="middleName" value="${inputValue(profile.middleName)}" />
          </label>
          <label>
            Last name
            <input type="text" name="lastName" value="${inputValue(profile.lastName)}" minlength="2" required />
          </label>
        </div>
        <div class="form-grid-2">
          <label>
            Email
            <input type="email" name="email" value="${inputValue(profile.email)}" required />
          </label>
          <label>
            Contact
            <input type="text" name="contactPhone" value="${inputValue(profile.contactPhone)}" placeholder="Phone or best contact number" />
          </label>
        </div>
        <div class="form-grid-2">
          <label>
            Current address
            <textarea name="currentAddress" rows="3" placeholder="Current address">${escapeHtml(
              profile.currentAddress
            )}</textarea>
          </label>
          <label>
            Mailing address
            <textarea name="mailingAddress" rows="3" placeholder="Mailing address">${escapeHtml(
              profile.mailingAddress
            )}</textarea>
          </label>
        </div>
        <div class="form-grid-2">
          <label>
            Preferred payout method
            <select name="payoutMethod">
              <option value="" ${!profile.payoutMethod ? "selected" : ""}>Select method</option>
              <option value="bank" ${profile.payoutMethod === "bank" ? "selected" : ""}>Bank account</option>
              <option value="zelle" ${profile.payoutMethod === "zelle" ? "selected" : ""}>Zelle</option>
              <option value="cash_app" ${profile.payoutMethod === "cash_app" ? "selected" : ""}>Cash App</option>
              <option value="other" ${profile.payoutMethod === "other" ? "selected" : ""}>Other</option>
            </select>
          </label>
          <label>
            Cash App handle
            <input type="text" name="cashAppHandle" value="${inputValue(profile.cashAppHandle)}" placeholder="$yourhandle" />
          </label>
        </div>
        <div class="form-grid-2">
          <label>
            Bank name
            <input type="text" name="bankName" value="${inputValue(profile.bankName)}" />
          </label>
          <label>
            Account name
            <input type="text" name="bankAccountName" value="${inputValue(profile.bankAccountName)}" />
          </label>
        </div>
        <div class="form-grid-2">
          <label>
            Routing number
            <input type="text" name="bankRoutingNumber" value="${inputValue(
              profile.bankRoutingNumber
            )}" />
          </label>
          <label>
            Account number
            <input type="text" name="bankAccountNumber" value="${inputValue(
              profile.bankAccountNumber
            )}" />
          </label>
        </div>
        <div class="form-grid-2">
          <label>
            Zelle details
            <input type="text" name="zelleDetails" value="${inputValue(
              profile.zelleDetails
            )}" placeholder="Email or phone linked to Zelle" />
          </label>
          <label>
            Payment notes
            <textarea name="payoutNotes" rows="3" placeholder="Any payout instructions or notes">${escapeHtml(
              profile.payoutNotes
            )}</textarea>
          </label>
        </div>
        <button class="button-primary" type="submit">Save profile</button>
      </form>
    `
  });
}

function renderIssueStatus(issue) {
  return `
    <span class="vote-status vote-status-${escapeHtml(issue.status)}">
      ${escapeHtml(titleCase(issue.status))}
    </span>
  `;
}

function renderIssueMetrics(issue, { showCapital = false, showViewer = true } = {}) {
  const metrics = [
    summaryItem("Approval needed", formatPercent(issue.approvalThreshold)),
    summaryItem(issue.isClosed ? "Approved" : "Yes votes", formatPercent(issue.yesPct)),
    summaryItem("No votes", formatPercent(issue.noPct)),
    summaryItem(
      issue.isClosed ? "Assumed approvals" : "Pending",
      formatPercent(issue.isClosed ? issue.assumedYesPct : issue.pendingPct)
    ),
    summaryItem("Vote closes", issue.closesOn || "Open ended")
  ];

  if (showViewer) {
    const viewerVoteLabel =
      issue.myVote
        ? titleCase(issue.myVote)
        : issue.isClosed && issue.isEligibleToVote
          ? "Assumed yes"
          : "Not cast";

    metrics.push(summaryItem("Your vote", viewerVoteLabel));
    metrics.push(summaryItem("Your voting power", formatPercent(issue.myWeightPct)));
  }

  if (showCapital) {
    metrics.push(summaryItem("Eligible capital", formatCurrency(issue.eligibleInvestment)));
    metrics.push(summaryItem("Votes cast", `${issue.voteCount} of ${issue.eligibleVoterCount}`));
  }

  return metrics.join("");
}

function getFinalVoteLabel(result) {
  if (!result.finalVote) {
    return "Open";
  }

  if (result.finalVote === "assumed_yes") {
    return "Assumed approve";
  }

  return titleCase(result.finalVote ?? "");
}

function getIssueResponseLabel(result) {
  return result.explicitVote ? titleCase(result.explicitVote) : "Not voted";
}

function getVotePillClass(voteChoice) {
  if (voteChoice === "yes") {
    return "vote-result-yes";
  }

  if (voteChoice === "no") {
    return "vote-result-no";
  }

  if (voteChoice === "assumed_yes") {
    return "vote-result-assumed_yes";
  }

  return "vote-result-pending";
}

function renderIssueVoteLedger(issue) {
  if (!issue.investorVotes?.length) {
    return "";
  }

  return `
    <div class="issue-results">
      <div class="section-head">
        <div>
          <h4>Investor Vote Ledger</h4>
          <p class="section-copy">
            Track each investor’s response and vote weight for this issue.
          </p>
        </div>
      </div>
      <div class="table-wrap">
        <table class="issue-results-table">
          <thead>
            <tr>
              <th>Investor</th>
              <th>Response</th>
              <th>Final outcome</th>
              <th>Vote weight</th>
            </tr>
          </thead>
          <tbody>
            ${issue.investorVotes
              .map(
                (result) => `
                  <tr>
                    <td>${escapeHtml(result.participantName)}</td>
                    <td>
                      <span class="vote-result-pill ${escapeHtml(
                        getVotePillClass(result.explicitVote)
                      )}">
                        ${escapeHtml(getIssueResponseLabel(result))}
                      </span>
                    </td>
                    <td>
                      <span class="vote-result-pill ${escapeHtml(
                        getVotePillClass(result.finalVote)
                      )}">
                        ${escapeHtml(getFinalVoteLabel(result))}
                      </span>
                    </td>
                    <td>${escapeHtml(formatPercent(result.weightPct))}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderInvestorIssueCard(issue) {
  return `
    <article class="issue-card">
      <div class="section-head">
        <div>
          <p class="eyebrow">${escapeHtml(issue.dealName)}</p>
          <h4>${escapeHtml(issue.title)}</h4>
          <p class="section-copy">${escapeHtml(issue.description)}</p>
        </div>
        <div class="issue-head-meta">
          ${renderIssueStatus(issue)}
          <span class="read-only-tag">${escapeHtml(`Closes ${issue.closesOn || "TBD"}`)}</span>
          <span class="read-only-tag">${escapeHtml(`${formatPercent(issue.myWeightPct)} power`)}</span>
        </div>
      </div>
      <div class="summary-grid">
        ${renderIssueMetrics(issue)}
      </div>
      <div class="button-row issue-actions">
        <button
          class="${issue.myVote === "yes" ? "button-primary" : "button-secondary"} button-inline"
          type="button"
          data-issue-vote="yes"
          data-issue-id="${escapeHtml(issue.id)}"
          ${issue.canVote ? "" : "disabled"}
        >
          Vote yes
        </button>
        <button
          class="${issue.myVote === "no" ? "button-danger" : "button-secondary"} button-inline"
          type="button"
          data-issue-vote="no"
          data-issue-id="${escapeHtml(issue.id)}"
          ${issue.canVote ? "" : "disabled"}
        >
          Vote no
        </button>
        <span class="read-only-tag">
          ${escapeHtml(
            issue.canVote
              ? "Weighted by your invested percentage in this deal."
              : issue.isClosed && !issue.myVote
                ? `Voting closed on ${issue.closesOn}. Uncast votes were treated as approved.`
                : "Voting is closed for this issue."
          )}
        </span>
      </div>
    </article>
  `;
}

function renderInvestorGovernancePanel() {
  const issues = state.dashboard.governance?.issues ?? [];

  return renderCollapsibleSection({
    sectionId: "investor-governance",
    title: "Major Issue Voting",
    copy: "Your approval power is weighted by your invested percentage in each deal.",
    message: renderMessage(state.messages.vote),
    body: `
      <div class="issue-grid">
        ${
          issues.length
            ? issues.map((issue) => renderInvestorIssueCard(issue)).join("")
            : '<div class="empty-state">No active voting items are tied to your eligible investor positions.</div>'
        }
      </div>
    `
  });
}

function renderInvestorProject(project) {
  const sectionId = `investor-project-${project.id}`;
  const collapsed = isSectionCollapsed(sectionId);

  return `
    <article class="deal-card">
      <div class="deal-head">
        <div>
          <p class="eyebrow">${escapeHtml(project.currentPhase)}</p>
          <h3 class="deal-name">${escapeHtml(project.name)}</h3>
          <p class="deal-location">${escapeHtml(project.location)}</p>
          <div class="mini-head">
            <span class="status-pill status-${escapeHtml(project.status)}">${escapeHtml(
              project.statusLabel
            )}</span>
            <span class="class-pill">${escapeHtml(project.personalPosition.classType)}</span>
            <span class="read-only-tag">Read only</span>
          </div>
        </div>
        <div>
          <p class="metric-label">Timeline</p>
          <p class="metric-value">${escapeHtml(`${project.timelineProgress}%`)}</p>
          <div class="button-row deal-card-actions">
            ${renderSectionToggle(sectionId)}
          </div>
        </div>
      </div>
      ${
        collapsed
          ? '<div class="deal-card-collapsed-note">Project minimized. Use Maximize to reopen this breakdown.</div>'
          : `<div class="deal-body">
        <div class="progress-shell">
          <div class="progress-fill" style="width:${project.timelineProgress}%"></div>
        </div>
        <div>
          <div class="section-head">
            <div>
              <h4>Personal position</h4>
              <p class="section-copy">
                Capital, ownership, preferred return, and projected exit value for your position.
              </p>
            </div>
          </div>
          <div class="summary-grid">
            ${summaryItem("Amount invested", formatCurrency(project.personalPosition.amountInvested))}
            ${summaryItem("Ownership", formatPercent(project.personalPosition.ownershipPct))}
            ${summaryItem("Pref earned", formatCurrency(project.personalPosition.prefEarned))}
            ${summaryItem(
              "Estimated total return",
              formatCurrency(project.personalPosition.estimatedTotalReturn)
            )}
          </div>
        </div>
        <div>
          <div class="section-head">
            <div>
              <h4>Returns breakdown</h4>
              <p class="section-copy">${escapeHtml(project.projectionLabel)}</p>
            </div>
          </div>
          <div class="breakdown-grid">
            ${breakdownItem(
              "Capital returned",
              formatCurrency(project.personalPosition.capitalReturned)
            )}
            ${breakdownItem(
              "Profit earned",
              formatCurrency(project.personalPosition.profitEarned)
            )}
            ${breakdownItem("Total payout", formatCurrency(project.personalPosition.totalPayout))}
          </div>
        </div>
        <div>
          <div class="section-head">
            <div>
              <h4>Project summary</h4>
              <p class="section-copy">
                High-level project performance without other investor-level detail.
              </p>
            </div>
          </div>
          <div class="summary-grid">
            ${summaryItem(
              "Total project cost",
              formatCurrency(project.projectSummary.totalProjectCost)
            )}
            ${summaryItem(
              project.projectSummary.salePriceLabel,
              formatCurrency(project.projectSummary.salePrice)
            )}
            ${summaryItem("Tracked equity", formatCurrency(project.projectSummary.totalEquity))}
            ${summaryItem("Debt balance", formatCurrency(project.projectSummary.debt))}
            ${summaryItem("Loan interest rate", formatRate(project.projectSummary.debtInterestRate))}
            ${summaryItem(
              "Interest paid",
              formatCurrency(project.projectSummary.totalInterestPaid)
            )}
            ${summaryItem("Hold period", `${project.projectSummary.holdMonths} months`)}
          </div>
        </div>
        <div>
          <div class="section-head">
            <div>
              <h4>Timeline</h4>
              <p class="section-copy">${escapeHtml(project.privacyNote)}</p>
            </div>
          </div>
          <div class="timeline-grid">
            ${project.timeline
              .map(
                (step) => `
                  <article class="timeline-step ${escapeHtml(step.status)}">
                    <h4>${escapeHtml(step.label)}</h4>
                    <p>${escapeHtml(step.date)}</p>
                  </article>
                `
              )
              .join("")}
          </div>
        </div>
      </div>`
      }
    </article>
  `;
}

function renderInvestorDashboard() {
  const { viewer, portfolio, projects } = state.dashboard;

  return `
    <div class="shell">
      <section class="panel app-header">
        <div>
          <p class="eyebrow">Investor View</p>
          <h2>${escapeHtml(viewer.name)}</h2>
          <p class="meta-line">${escapeHtml(viewer.email)} · ${escapeHtml(
            titleCase(viewer.category)
          )}</p>
        </div>
        <div class="button-row">
          <span class="read-only-tag">Deal data remains read only</span>
          <button class="button-secondary" id="logout-button" type="button">Log out</button>
        </div>
      </section>

      ${renderProfilePanel()}

      ${renderCollapsibleSection({
        sectionId: "investor-portfolio",
        title: "Personal Portfolio View",
        copy: "Totals across all deals tied to your login. No visibility into other investor amounts.",
        body: `
          <div class="metrics-grid">
            ${metricCard("Total invested", formatCurrency(portfolio.totalInvested))}
            ${metricCard("Total returned", formatCurrency(portfolio.totalReturned))}
            ${metricCard("Total amount payout", formatCurrency(portfolio.totalAmountPayout))}
            ${metricCard("Current active investments", String(portfolio.activeInvestments))}
            ${metricCard("Current pref earned", formatCurrency(portfolio.currentPrefEarned))}
          </div>
        `
      })}

      ${renderInvestorGovernancePanel()}

      ${renderCollapsibleSection({
        sectionId: "investor-project-breakdown",
        title: "Per-Project Breakdown",
        copy:
          "Each deal shows your amount invested, ownership, returns breakdown, project status, and timeline.",
        body: `
          <div class="deal-grid">
            ${
              projects.length
                ? projects.map((project) => renderInvestorProject(project)).join("")
                : '<div class="empty-state">No positions are linked to this login.</div>'
            }
          </div>
        `
      })}
    </div>
  `;
}

function renderManagerDeal(deal) {
  const sectionId = `manager-rollup-deal-${deal.id}`;
  const collapsed = isSectionCollapsed(sectionId);

  return `
    <article class="deal-card">
      <div class="deal-head">
        <div>
          <p class="eyebrow">${escapeHtml(deal.location)}</p>
          <h3 class="deal-name">${escapeHtml(deal.name)}</h3>
          <p class="deal-location">${escapeHtml(deal.currentPhase)}</p>
          <div class="mini-head">
            <span class="status-pill status-${escapeHtml(deal.status)}">${escapeHtml(
              deal.statusLabel
            )}</span>
            <span class="class-pill">${escapeHtml(
              deal.activeTier?.label ?? "No tier"
            )} active</span>
          </div>
        </div>
        <div>
          <p class="metric-label">Sponsor promote</p>
          <p class="metric-value">${escapeHtml(formatCurrency(deal.sponsorPromote))}</p>
          <div class="button-row deal-card-actions">
            <button
              class="button-danger button-inline"
              type="button"
              data-deal-editor-action="delete-deal"
              data-deal-id="${escapeHtml(deal.id)}"
            >
              Delete deal
            </button>
            ${renderSectionToggle(sectionId)}
          </div>
        </div>
      </div>
      ${
        collapsed
          ? '<div class="deal-card-collapsed-note">Project minimized. Use Maximize to reopen this rollup.</div>'
          : `<div class="deal-body">
        <div class="summary-grid">
          ${summaryItem("Tracked equity", formatCurrency(deal.totalEquity))}
          ${summaryItem("Debt", formatCurrency(deal.debt))}
          ${summaryItem("Loan rate", formatRate(deal.debtInterestRate))}
          ${summaryItem("Interest paid", formatCurrency(deal.totalInterestPaid))}
          ${summaryItem("Current sale case", formatCurrency(deal.salePrice))}
          ${summaryItem("Gross project IRR", formatPercent(deal.projectIrr))}
        </div>
        <div class="class-grid">
          ${deal.classBreakdown
            .map(
              (item) => `
                <article class="class-card">
                  <h4>${escapeHtml(item.classType)}</h4>
                  <p>${escapeHtml(formatCurrency(item.contributionAmount))} committed</p>
                  <p>${escapeHtml(formatCurrency(item.totalPayout))} payout</p>
                </article>
              `
            )
            .join("")}
        </div>
      </div>`
      }
    </article>
  `;
}

function renderCalculator() {
  const { deals } = state.dashboard.calculator;
  const selectedDealId = state.calculatorSelectionId ?? deals[0]?.id ?? "";
  const selectedPreset =
    deals.find((deal) => deal.id === selectedDealId) ??
    deals[0] ?? {
      id: "",
      salePrice: 0,
      holdMonths: 0,
      prefRate: 0
    };

  const result = state.calculator?.deal?.id === selectedDealId ? state.calculator : null;

  return renderCollapsibleSection({
    sectionId: "manager-calculator",
    title: "Promote IRR Trigger Calculator",
    copy:
      "Plug in a sale price, hold length, and pref rate to see investor distributions, Class A vs Class C outputs, and the sponsor promote tier that gets triggered.",
    bodyClass: "calculator-section-body",
    body: `
      <div class="calculator-layout">
        <div class="calculator-form">
          <p class="eyebrow">Sponsor Tool</p>
          <form id="calculator-form">
            <label>
              Deal
              <select name="dealId" id="calculator-deal-select">
                ${deals
                  .map(
                    (deal) => `
                      <option value="${escapeHtml(deal.id)}" ${
                        deal.id === selectedPreset.id ? "selected" : ""
                      }>
                        ${escapeHtml(deal.name)}
                      </option>
                    `
                  )
                  .join("")}
              </select>
            </label>
            <label>
              Sale price
              <input
                type="number"
                min="0"
                step="1000"
                name="salePrice"
                value="${escapeHtml(String(result?.inputs.salePrice ?? selectedPreset.salePrice))}"
                required
              />
            </label>
            <label>
              Hold months
              <input
                type="number"
                min="1"
                step="1"
                name="holdMonths"
                value="${escapeHtml(String(result?.inputs.holdMonths ?? selectedPreset.holdMonths))}"
                required
              />
            </label>
            <label>
              Pref rate
              <input
                type="number"
                min="0"
                max="0.3"
                step="0.005"
                name="prefRate"
                value="${escapeHtml(String(result?.inputs.prefRate ?? selectedPreset.prefRate))}"
                required
              />
            </label>
            <button class="button-primary" type="submit">Recalculate waterfall</button>
          </form>
        </div>
        <div class="calculator-results">
          ${
            result
              ? `
                <div class="section-head">
                  <div>
                    <p class="eyebrow">${escapeHtml(result.deal.statusLabel)}</p>
                    <h3>${escapeHtml(result.deal.name)}</h3>
                    <p class="section-copy">
                      Promote is shown on the current deal-level scenario, with capital returned,
                      pref, and residual split after hurdle selection.
                    </p>
                  </div>
                </div>
                <div class="metrics-grid">
                  ${metricCard("Gross project IRR", formatPercent(result.outputs.projectIrr))}
                  ${metricCard(
                    "Distributable equity",
                    formatCurrency(result.outputs.distributableEquity)
                  )}
                  ${metricCard(
                    "Investor profit pool",
                    formatCurrency(result.outputs.investorProfitPool)
                  )}
                  ${metricCard(
                    "Sponsor promote",
                    formatCurrency(result.outputs.sponsorPromote)
                  )}
                </div>
                <div class="panel panel-inline">
                  <div class="section-head">
                    <div>
                      <h4>Promote tiers</h4>
                      <p class="section-copy">Highest cleared IRR tier becomes the active split in this prototype.</p>
                    </div>
                  </div>
                  <div class="tier-grid">
                    ${result.outputs.promoteTiers
                      .map(
                        (tier) => `
                          <article class="tier-card ${tier.isActive ? "active" : ""} ${
                            tier.isEnabled ? "" : "disabled"
                          }">
                            <h4>${escapeHtml(tier.label)}</h4>
                            <p>${escapeHtml(formatPercent(tier.hurdle))} hurdle</p>
                            <p>${escapeHtml(
                              `${Math.round(tier.investorShare * 100)}/${Math.round(
                                tier.sponsorShare * 100
                              )} investor/sponsor`
                            )}</p>
                            <p>${escapeHtml(tier.isEnabled ? "Enabled" : "Disabled")}</p>
                          </article>
                        `
                      )
                      .join("")}
                  </div>
                </div>
                <div class="panel panel-inline">
                  <div class="section-head">
                    <div>
                      <h4>Waterfall outputs</h4>
                      <p class="section-copy">Class A cash investors and Class C contractor participants flow through the same payout engine.</p>
                    </div>
                  </div>
                  <div class="class-grid">
                    ${result.outputs.classBreakdown
                      .map(
                        (item) => `
                          <article class="class-card">
                            <h4>${escapeHtml(item.classType)}</h4>
                            <p>${escapeHtml(formatCurrency(item.capitalReturned))} capital</p>
                            <p>${escapeHtml(formatCurrency(item.prefEarned))} pref</p>
                            <p>${escapeHtml(formatCurrency(item.profitShare))} profit</p>
                          </article>
                        `
                      )
                      .join("")}
                  </div>
                </div>
                <div class="table-wrap table-top-gap">
                  <table>
                    <thead>
                      <tr>
                        <th>Participant</th>
                        <th>Class</th>
                        <th>Contribution</th>
                        <th>Ownership</th>
                        <th>Capital</th>
                        <th>Pref</th>
                        <th>Profit Share</th>
                        <th>Total Payout</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${result.outputs.participants
                        .map(
                          (participant) => `
                            <tr>
                              <td>${escapeHtml(participant.participantName)}</td>
                              <td>${escapeHtml(participant.classType)}</td>
                              <td>${escapeHtml(formatCurrency(participant.contributionAmount))}</td>
                              <td>${escapeHtml(formatPercent(participant.ownershipPct))}</td>
                              <td>${escapeHtml(formatCurrency(participant.capitalReturned))}</td>
                              <td>${escapeHtml(formatCurrency(participant.prefEarned))}</td>
                              <td>${escapeHtml(formatCurrency(participant.profitShare))}</td>
                              <td>${escapeHtml(formatCurrency(participant.totalPayout))}</td>
                            </tr>
                          `
                        )
                        .join("")}
                    </tbody>
                  </table>
                </div>
              `
              : `
                <div class="empty-state">
                  Select a deal and run a scenario to see the promote hurdle, investor payouts, and sponsor share.
                </div>
              `
          }
        </div>
      </div>
    `
  });
}

function renderContractorTable() {
  const rows = state.dashboard.contractorLedger;
  const filteredRows = applyContractorFilters(rows);
  const contractorDeals = getContractorFilterOptions(rows);
  const projectRollups = buildContractorProjectRollups(filteredRows);

  return renderCollapsibleSection({
    sectionId: "manager-contractor-tracking",
    title: "Contractor Tracking System",
    copy:
      "Deferred labor is tracked separately from cash equity, tagged as Class C, and organized by project so each development can be reviewed on its own.",
    headerActions: `
      <label class="toolbar-field">
        Project filter
        <select id="contractor-filter-deal">
          <option value="">All projects</option>
          ${contractorDeals
            .map(
              (deal) => `
                <option value="${escapeHtml(deal.id)}" ${
                  deal.id === state.contractorDealFilter ? "selected" : ""
                }>
                  ${escapeHtml(deal.name)}
                </option>
              `
            )
            .join("")}
        </select>
      </label>
    `,
    body: `
      <div class="contractor-rollup-grid">
        ${
          projectRollups.length
            ? projectRollups
                .map(
                  (project) => `
                    <article class="contractor-rollup-card">
                      <div class="section-head">
                        <div>
                          <p class="eyebrow">${escapeHtml(`${project.contractorCount} contractor${project.contractorCount === 1 ? "" : "s"}`)}</p>
                          <h4>${escapeHtml(project.dealName)}</h4>
                        </div>
                      </div>
                      <div class="summary-grid">
                        ${summaryItem("Total contract", formatCurrency(project.totalContractValue))}
                        ${summaryItem("Cash paid", formatCurrency(project.cashPaid))}
                        ${summaryItem("Deferred", formatCurrency(project.deferredAmount))}
                        ${summaryItem("Pref earned", formatCurrency(project.prefEarned))}
                        ${summaryItem("Profit share", formatCurrency(project.profitShare))}
                        ${summaryItem("Total payout", formatCurrency(project.totalPayout))}
                      </div>
                    </article>
                  `
                )
                .join("")
            : '<div class="empty-state">No contractor records match the selected project filter.</div>'
        }
      </div>
      ${
        filteredRows.length
          ? `
            <div class="table-wrap contractor-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Contractor</th>
                    <th>Deal</th>
                    <th>Trade</th>
                    <th>Total Contract</th>
                    <th>Cash Paid</th>
                    <th>Deferred</th>
                    <th>Ownership</th>
                    <th>Pref Earned</th>
                    <th>Profit Share</th>
                    <th>Total Payout</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${filteredRows
                    .map(
                      (row) => `
                        <tr>
                          <td>${escapeHtml(row.contractorName)}</td>
                          <td>${escapeHtml(row.dealName)}</td>
                          <td>${escapeHtml(row.trade)}</td>
                          <td>${escapeHtml(formatCurrency(row.totalContractValue))}</td>
                          <td>${escapeHtml(formatCurrency(row.cashPaid))}</td>
                          <td>${escapeHtml(formatCurrency(row.deferredAmount))}</td>
                          <td>${escapeHtml(formatPercent(row.ownershipPct))}</td>
                          <td>${escapeHtml(formatCurrency(row.prefEarned))}</td>
                          <td>${escapeHtml(formatCurrency(row.profitShare))}</td>
                          <td>${escapeHtml(formatCurrency(row.totalPayout))}</td>
                          <td>
                            <span class="hybrid-pill">
                              ${escapeHtml(row.status)}${row.hybrid ? " · Hybrid" : ""}
                            </span>
                          </td>
                        </tr>
                      `
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          `
          : ""
      }
    `
  });
}

function renderCreateUserPanel() {
  return renderCollapsibleSection({
    sectionId: "admin-create-user",
    title: "Add Platform User",
    copy:
      "Creates the user profile, login, first-login password reset requirement, and credential notification.",
    message: renderMessage(state.messages.user),
    panelClass: "admin-card",
    body: `
      <p class="eyebrow">Manager Control</p>
      <form id="user-form">
        <label>
          Category
          <select name="category" required>
            <option value="investor">Investor</option>
            <option value="contractor">Contractor participant</option>
            <option value="manager">Manager</option>
          </select>
        </label>
        <div class="form-grid-3">
          <label>
            First name
            <input type="text" name="firstName" placeholder="Jane" minlength="2" required />
          </label>
          <label>
            Middle name
            <input type="text" name="middleName" placeholder="A." />
          </label>
          <label>
            Last name
            <input type="text" name="lastName" placeholder="Doe" minlength="2" required />
          </label>
        </div>
        <div class="form-grid-2">
          <label>
            Email
            <input type="email" name="email" placeholder="jane@example.com" required />
          </label>
          <label>
            Contact
            <input type="text" name="contactPhone" placeholder="Best phone number" />
          </label>
        </div>
        <div class="form-grid-2">
          <label>
            Driver's license number
            <input type="text" name="driverLicenseNumber" placeholder="D1234567" />
          </label>
          <label>
            Temporary password
            <input type="password" name="password" minlength="8" required />
          </label>
        </div>
        <div class="form-grid-2">
          <label>
            Current address
            <textarea name="currentAddress" rows="3" placeholder="Current address"></textarea>
          </label>
          <label>
            Mailing address
            <textarea name="mailingAddress" rows="3" placeholder="Mailing address"></textarea>
          </label>
        </div>
        <label>
          Attach ID card
          <input type="file" name="idCard" accept="image/*,.pdf" />
        </label>
        <button class="button-primary" type="submit">Create user</button>
      </form>
    `
  });
}

function renderAllocationPanel() {
  const participants = state.dashboard.admin.participants;
  const deals = state.dashboard.deals;

  return renderCollapsibleSection({
    sectionId: "admin-add-allocation",
    title: "Add Deal Allocation",
    copy:
      "Link a participant to a deal. Contractor fields are only required for contractor participants.",
    message: renderMessage(state.messages.allocation),
    panelClass: "admin-card",
    body: `
      <p class="eyebrow">Manager Control</p>
      <form id="allocation-form">
        <label>
          Participant
          <select name="participantId" required>
            <option value="">Select participant</option>
            ${participants
              .map(
                (participant) => `
                  <option value="${escapeHtml(participant.id)}">
                    ${escapeHtml(participant.name)} · ${escapeHtml(titleCase(participant.category))}
                  </option>
                `
              )
              .join("")}
          </select>
        </label>
        <label>
          Deal
          <select name="dealId" required>
            <option value="">Select deal</option>
            ${deals
              .map(
                (deal) => `
                  <option value="${escapeHtml(deal.id)}">${escapeHtml(deal.name)}</option>
                `
              )
              .join("")}
          </select>
        </label>
        <div class="form-grid-2">
          <label>
            Class type
            <select name="classType" required>
              <option value="Class A">Class A</option>
              <option value="Class C">Class C</option>
            </select>
          </label>
          <label>
            Contribution amount
            <input type="number" name="contributionAmount" min="0" step="1000" required />
          </label>
        </div>
        <label>
          Contribution type
          <input type="text" name="contributionType" placeholder="Cash equity or Deferred compensation" />
        </label>
        <p class="helper-copy">
          Contractor-only inputs:
        </p>
        <div class="form-grid-2">
          <label>
            Trade
            <input type="text" name="trade" placeholder="Foundation" />
          </label>
          <label>
            Total contract value
            <input type="number" name="totalContractValue" min="0" step="1000" />
          </label>
        </div>
        <div class="form-grid-2">
          <label>
            Cash paid
            <input type="number" name="cashPaid" min="0" step="1000" />
          </label>
          <label>
            Contractor status
            <select name="contractorStatus">
              <option value="Active">Active</option>
              <option value="Completed">Completed</option>
              <option value="Paid">Paid</option>
            </select>
          </label>
        </div>
        <button class="button-primary" type="submit">Save allocation</button>
      </form>
    `
  });
}

function renderCreateDealPanel() {
  const defaults = getCreateDealDefaults();

  return renderCollapsibleSection({
    sectionId: "admin-create-deal",
    title: "Create Project",
    copy: "Add a new deal to the database so it can be allocated to investors and contractors.",
    message: renderMessage(state.messages.dealCreate),
    panelClass: "admin-card",
    body: `
      <p class="eyebrow">Manager Control</p>
      <form id="create-deal-form">
        <div class="form-grid-2">
          <label>
            Deal name
            <input type="text" name="name" placeholder="237_Ville Development" required />
          </label>
          <label>
            Location
            <input type="text" name="location" placeholder="City, State" required />
          </label>
        </div>
        <div class="form-grid-2">
          <label>
            Current phase
            <input type="text" name="currentPhase" placeholder="Pre-construction" required />
          </label>
          <label>
            Status
            <select name="status" required>
              <option value="under_construction">Under construction</option>
              <option value="listed">Listed</option>
              <option value="sold">Sold</option>
            </select>
          </label>
        </div>
        <div class="form-grid-2">
          <label>
            Total project cost
            <input type="number" name="totalProjectCost" min="0" step="1000" required />
          </label>
          <label>
            Debt
            <input type="number" name="debt" min="0" step="1000" value="0" required />
          </label>
        </div>
        <div class="form-grid-2">
          <label>
            Loan interest rate
            <input
              type="number"
              name="debtInterestRate"
              min="0"
              max="1"
              step="0.0001"
              value="${escapeHtml(String(defaults.debtInterestRate))}"
              required
            />
          </label>
          <label>
            Total interest paid
            <input
              type="number"
              name="totalInterestPaid"
              min="0"
              step="1000"
              value="${escapeHtml(String(defaults.totalInterestPaid))}"
              required
            />
          </label>
        </div>
        <p class="helper-copy">
          Use decimal format for the loan rate. Example: <code>0.1025</code> = 10.25%.
        </p>
        <div class="form-grid-2">
          <label>
            Sale price
            <input type="number" name="salePrice" min="0" step="1000" required />
          </label>
          <label>
            Hold months
            <input
              type="number"
              name="holdMonths"
              min="1"
              step="1"
              value="${escapeHtml(String(defaults.holdMonths))}"
              required
            />
          </label>
        </div>
        <div class="form-grid-2">
          <label>
            Pref rate
            <input
              type="number"
              name="prefRate"
              min="0"
              max="0.3"
              step="0.005"
              value="${escapeHtml(String(defaults.prefRate))}"
              required
            />
          </label>
          <label>
            Timeline progress
            <input
              type="number"
              name="timelineProgress"
              min="0"
              max="100"
              step="1"
              value="${escapeHtml(String(defaults.timelineProgress))}"
              required
            />
          </label>
        </div>
        <div class="form-grid-2">
          <label>
            Funded on
            <input type="date" name="fundedOn" value="${escapeHtml(defaults.fundedOn)}" required />
          </label>
          <label>
            Projected exit
            <input type="date" name="projectedExitOn" />
          </label>
        </div>
        <label>
          Actual exit
          <input type="date" name="actualExitOn" />
        </label>
        <button class="button-primary" type="submit">Create project</button>
      </form>
    `
  });
}

function renderTimelineEditorRows(draft) {
  return `
    <div class="editor-stack">
      ${draft.timeline
        .map(
          (step, index) => `
            <article class="editor-row">
              <div class="form-grid-3">
                <label>
                  Milestone
                  <input
                    type="text"
                    value="${inputValue(step.label)}"
                    data-index="${index}"
                    data-timeline-field="label"
                    placeholder="Foundation"
                  />
                </label>
                <label>
                  Date
                  <input
                    type="date"
                    value="${inputValue(step.date)}"
                    data-index="${index}"
                    data-timeline-field="date"
                  />
                </label>
                <label>
                  Status
                  <select data-index="${index}" data-timeline-field="status">
                    <option value="upcoming" ${
                      step.status === "upcoming" ? "selected" : ""
                    }>Upcoming</option>
                    <option value="in_progress" ${
                      step.status === "in_progress" ? "selected" : ""
                    }>In progress</option>
                    <option value="complete" ${
                      step.status === "complete" ? "selected" : ""
                    }>Complete</option>
                  </select>
                </label>
              </div>
              <div class="button-row">
                <button
                  class="button-secondary button-inline"
                  type="button"
                  data-deal-editor-action="remove-timeline"
                  data-index="${index}"
                  data-deal-id="${escapeHtml(draft.id)}"
                >
                  Remove step
                </button>
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderPromoteTierEditorRows(draft) {
  return `
    <div class="editor-stack">
      ${draft.promoteTiers
        .map(
          (tier, index) => `
            <article class="editor-row">
              <div class="form-grid-2">
                <label>
                  Tier label
                  <input
                    type="text"
                    value="${inputValue(tier.label)}"
                    data-index="${index}"
                    data-tier-field="label"
                    placeholder="Tier 1"
                  />
                </label>
                <label class="checkbox-field">
                  <span>Enabled</span>
                  <input
                    type="checkbox"
                    ${tier.isEnabled ? "checked" : ""}
                    data-index="${index}"
                    data-tier-field="isEnabled"
                  />
                </label>
              </div>
              <div class="form-grid-3">
                <label>
                  IRR hurdle
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value="${inputValue(tier.hurdle)}"
                    data-index="${index}"
                    data-tier-field="hurdle"
                    placeholder="0.12"
                  />
                </label>
                <label>
                  Investor share
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value="${inputValue(tier.investorShare)}"
                    data-index="${index}"
                    data-tier-field="investorShare"
                    placeholder="0.70"
                  />
                </label>
                <label>
                  Sponsor share
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value="${inputValue(tier.sponsorShare)}"
                    data-index="${index}"
                    data-tier-field="sponsorShare"
                    placeholder="0.30"
                  />
                </label>
              </div>
              <div class="button-row">
                <button
                  class="button-secondary button-inline"
                  type="button"
                  data-deal-editor-action="remove-tier"
                  data-index="${index}"
                  data-deal-id="${escapeHtml(draft.id)}"
                >
                  Remove tier
                </button>
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderDealEditorPanel() {
  const deal = getManagerEditableDeal();
  const draft = deal ? getDealEditorDraft(deal) : null;
  const defaultVoteCloseDate = getDefaultVoteCloseDate();

  if (!deal) {
    return renderCollapsibleSection({
      sectionId: "admin-edit-deal",
      title: "Update Project",
      copy: "Save project status, phase, financial assumptions, timeline milestones, and promote tiers.",
      panelClass: "admin-card",
      body: '<div class="empty-state">No deals are available to edit.</div>'
    });
  }

  return renderCollapsibleSection({
    sectionId: "admin-edit-deal",
    title: "Update Project",
    copy: "Save project status, phase, financial assumptions, timeline milestones, and promote tiers.",
    message: renderMessage(state.messages.deal),
    panelClass: "admin-card admin-card-wide",
    body: `
      <p class="eyebrow">Manager Control</p>
      <form id="deal-form" data-deal-id="${escapeHtml(deal.id)}">
        <label>
          Deal
          <select name="dealId" id="deal-editor-select">
            ${state.dashboard.deals
              .map(
                (item) => `
                  <option value="${escapeHtml(item.id)}" ${
                    item.id === deal.id ? "selected" : ""
                  }>
                    ${escapeHtml(item.name)}
                  </option>
                `
              )
              .join("")}
          </select>
        </label>
        <div class="summary-grid">
          ${summaryItem("Tracked equity", formatCurrency(deal.totalEquity))}
          ${summaryItem("Gross project IRR", formatPercent(deal.projectIrr))}
          ${summaryItem("Sponsor promote", formatCurrency(deal.sponsorPromote))}
          ${summaryItem("Timeline progress", `${deal.timelineProgress}%`)}
        </div>
        <div class="form-grid-2">
          <label>
            Deal name
            <input
              type="text"
              name="name"
              value="${inputValue(draft.name)}"
              data-deal-field="name"
              required
            />
          </label>
          <label>
            Location
            <input
              type="text"
              name="location"
              value="${inputValue(draft.location)}"
              data-deal-field="location"
              required
            />
          </label>
        </div>
        <div class="form-grid-2">
          <label>
            Current phase
            <input
              type="text"
              name="currentPhase"
              value="${inputValue(draft.currentPhase)}"
              data-deal-field="currentPhase"
              required
            />
          </label>
          <label>
            Status
            <select name="status" data-deal-field="status" required>
              <option value="under_construction" ${
                draft.status === "under_construction" ? "selected" : ""
              }>Under construction</option>
              <option value="listed" ${draft.status === "listed" ? "selected" : ""}>Listed</option>
              <option value="sold" ${draft.status === "sold" ? "selected" : ""}>Sold</option>
            </select>
          </label>
        </div>
        <div class="form-grid-2">
          <label>
            Total project cost
            <input
              type="number"
              name="totalProjectCost"
              min="0"
              step="1000"
              value="${inputValue(draft.totalProjectCost)}"
              data-deal-field="totalProjectCost"
              required
            />
          </label>
          <label>
            Debt
            <input
              type="number"
              name="debt"
              min="0"
              step="1000"
              value="${inputValue(draft.debt)}"
              data-deal-field="debt"
              required
            />
          </label>
        </div>
        <div class="form-grid-2">
          <label>
            Loan interest rate
            <input
              type="number"
              name="debtInterestRate"
              min="0"
              max="1"
              step="0.0001"
              value="${inputValue(draft.debtInterestRate)}"
              data-deal-field="debtInterestRate"
              required
            />
          </label>
          <label>
            Total interest paid
            <input
              type="number"
              name="totalInterestPaid"
              min="0"
              step="1000"
              value="${inputValue(draft.totalInterestPaid)}"
              data-deal-field="totalInterestPaid"
              required
            />
          </label>
        </div>
        <p class="helper-copy">
          Use decimal format for the loan rate. Example: <code>0.1025</code> = 10.25%.
        </p>
        <div class="form-grid-2">
          <label>
            Sale price
            <input
              type="number"
              name="salePrice"
              min="0"
              step="1000"
              value="${inputValue(draft.salePrice)}"
              data-deal-field="salePrice"
              required
            />
          </label>
          <label>
            Hold months
            <input
              type="number"
              name="holdMonths"
              min="1"
              step="1"
              value="${inputValue(draft.holdMonths)}"
              data-deal-field="holdMonths"
              required
            />
          </label>
        </div>
        <div class="form-grid-2">
          <label>
            Pref rate
            <input
              type="number"
              name="prefRate"
              min="0"
              max="0.3"
              step="0.005"
              value="${inputValue(draft.prefRate)}"
              data-deal-field="prefRate"
              required
            />
          </label>
          <label>
            Timeline progress
            <input
              type="number"
              name="timelineProgress"
              min="0"
              max="100"
              step="1"
              value="${inputValue(draft.timelineProgress)}"
              data-deal-field="timelineProgress"
              required
            />
          </label>
        </div>
        <div class="form-grid-2">
          <label>
            Funded on
            <input
              type="date"
              name="fundedOn"
              value="${inputValue(draft.fundedOn)}"
              data-deal-field="fundedOn"
              required
            />
          </label>
          <label>
            Projected exit
            <input
              type="date"
              name="projectedExitOn"
              value="${inputValue(draft.projectedExitOn)}"
              data-deal-field="projectedExitOn"
            />
          </label>
        </div>
        <label>
          Actual exit
          <input
            type="date"
            name="actualExitOn"
            value="${inputValue(draft.actualExitOn)}"
            data-deal-field="actualExitOn"
          />
        </label>

        ${renderCollapsibleSection({
          sectionId: `admin-edit-deal-${draft.id}-timeline`,
          title: "Timeline Milestones",
          copy: "These investor-facing milestones appear in each deal’s timeline section.",
          panelClass: "editor-section",
          headerActions: `
            <button
              class="button-secondary button-inline"
              type="button"
              data-deal-editor-action="add-timeline"
              data-deal-id="${escapeHtml(draft.id)}"
            >
              Add milestone
            </button>
          `,
          body: `${renderTimelineEditorRows(draft)}`
        })}

        ${renderCollapsibleSection({
          sectionId: `admin-edit-deal-${draft.id}-tiers`,
          title: "Promote Tiers",
          copy:
            "Enable or disable tiers per project. The highest cleared enabled tier drives the split.",
          panelClass: "editor-section",
          headerActions: `
            <button
              class="button-secondary button-inline"
              type="button"
              data-deal-editor-action="add-tier"
              data-deal-id="${escapeHtml(draft.id)}"
            >
              Add tier
            </button>
          `,
          body: `
            <p class="helper-copy">
              Use decimals for hurdles and splits. Example: <code>0.12</code> = 12% hurdle, <code>0.70</code>/<code>0.30</code> = 70/30 split.
            </p>
            ${renderPromoteTierEditorRows(draft)}
          `
        })}

        ${renderCollapsibleSection({
          sectionId: `admin-edit-deal-${draft.id}-issues`,
          title: "Major Issue Voting",
          copy: "Create investor votes tied to this project. Approval is weighted by invested capital.",
          panelClass: "editor-section",
          message: renderMessage(state.messages.issue),
          body: `
            <div class="editor-row issue-creator" data-deal-issue-root="${escapeHtml(draft.id)}">
              <div class="form-grid-2">
                <label>
                  Issue title
                  <input type="text" name="title" placeholder="Approve sale price reduction" />
                </label>
                <label>
                  Approval threshold
                  <input type="number" name="approvalThreshold" min="0.01" max="1" step="0.01" value="0.75" />
                </label>
              </div>
              <label>
                Vote close date
                <input type="date" name="closesOn" value="${escapeHtml(defaultVoteCloseDate)}" />
              </label>
              <label>
                Description
                <textarea
                  name="description"
                  rows="3"
                  placeholder="Describe the decision that investors are being asked to approve."
                ></textarea>
              </label>
              <button
                class="button-primary"
                type="button"
                data-deal-editor-action="create-issue"
                data-deal-id="${escapeHtml(draft.id)}"
              >
                Create voting issue
              </button>
            </div>
            <div class="issue-grid compact-top-gap">
              ${
                deal.issues.length
                  ? deal.issues
                      .map(
                        (issue) => `
                          <article class="issue-card issue-card-compact">
                            <div class="section-head">
                              <div>
                                <h4>${escapeHtml(issue.title)}</h4>
                                <p class="section-copy">${escapeHtml(issue.description)}</p>
                              </div>
                              <div class="issue-head-meta">
                                ${renderIssueStatus(issue)}
                                <span class="read-only-tag">${escapeHtml(`Closes ${issue.closesOn || "TBD"}`)}</span>
                              </div>
                            </div>
                            <div class="summary-grid">
                              ${renderIssueMetrics(issue, { showCapital: true, showViewer: false })}
                            </div>
                            ${renderIssueVoteLedger(issue)}
                          </article>
                        `
                      )
                      .join("")
                  : '<div class="empty-state">No major issues have been created for this project yet.</div>'
              }
            </div>
          `
        })}

        <div class="button-row">
          <button class="button-primary" type="submit">Save project changes</button>
          <button
            class="button-danger"
            type="button"
            data-deal-editor-action="delete-deal"
            data-deal-id="${escapeHtml(draft.id)}"
          >
            Delete project
          </button>
        </div>
      </form>
    `
  });
}

function renderUserDirectory() {
  const rows = state.dashboard.admin.users;
  const filteredRows = applyUserFilters(rows);
  const filterOptions = getUserFilterOptions(rows);

  return renderCollapsibleSection({
    sectionId: "manager-user-directory",
    title: "User Directory",
    copy:
      "Manage login access, status, and credential-delivery history without touching deal records.",
    message: renderMessage(state.messages.directory),
    body: `
      <div class="table-toolbar">
        <div class="filter-grid filter-grid-4">
          <label>
            Search
            <input
              type="search"
              id="user-filter-search"
              value="${inputValue(state.userFilters.search)}"
              placeholder="Name, email, or contact"
            />
          </label>
          <label>
            Category
            <select id="user-filter-category">
              <option value="">All categories</option>
              ${filterOptions.categories
                .map(
                  (category) => `
                    <option value="${escapeHtml(category)}" ${
                      category === state.userFilters.category ? "selected" : ""
                    }>
                      ${escapeHtml(titleCase(category))}
                    </option>
                  `
                )
                .join("")}
            </select>
          </label>
          <label>
            Role
            <select id="user-filter-role">
              <option value="">All roles</option>
              ${filterOptions.roles
                .map(
                  (role) => `
                    <option value="${escapeHtml(role)}" ${
                      role === state.userFilters.role ? "selected" : ""
                    }>
                      ${escapeHtml(titleCase(role))}
                    </option>
                  `
                )
                .join("")}
            </select>
          </label>
          <label>
            Status
            <select id="user-filter-status">
              <option value="">All statuses</option>
              <option value="active" ${state.userFilters.status === "active" ? "selected" : ""}>Active</option>
              <option value="disabled" ${state.userFilters.status === "disabled" ? "selected" : ""}>Disabled</option>
            </select>
          </label>
        </div>
        <span class="read-only-tag">Showing ${escapeHtml(String(filteredRows.length))} of ${escapeHtml(String(rows.length))}</span>
      </div>
      ${
        filteredRows.length
          ? `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Email</th>
              <th>Contact</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last login</th>
              <th>Password reset</th>
              <th>ID card</th>
              <th>Credential notice</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${filteredRows
              .map(
                (row) => {
                  return `
                  <tr>
                    <td>${escapeHtml(row.name)}</td>
                    <td>${escapeHtml(titleCase(row.category))}</td>
                    <td>${escapeHtml(row.email)}</td>
                    <td>${escapeHtml(row.contactPhone || "—")}</td>
                    <td>${escapeHtml(titleCase(row.role))}</td>
                    <td>${escapeHtml(row.isActive ? "Active" : "Disabled")}</td>
                    <td>${escapeHtml(formatDateTime(row.lastLoginAt))}</td>
                    <td>${escapeHtml(row.mustChangePassword ? "Required" : "Completed")}</td>
                    <td>${escapeHtml(row.idCardFileName || "—")}</td>
                    <td>${escapeHtml(
                      row.notificationStatus
                        ? `${titleCase(row.notificationStatus)}${row.notificationProvider ? ` · ${titleCase(row.notificationProvider)}` : ""}`
                        : "—"
                    )}</td>
                    <td>
                      <div class="table-actions">
                        <button
                          class="button-secondary button-inline"
                          type="button"
                          data-user-action="${row.isActive ? "disable" : "enable"}"
                          data-user-id="${escapeHtml(row.id)}"
                        >
                          ${row.isActive ? "Disable" : "Re-enable"}
                        </button>
                        <button
                          class="button-danger button-inline"
                          type="button"
                          data-user-action="delete"
                          data-user-id="${escapeHtml(row.id)}"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
                }
              )
              .join("")}
          </tbody>
        </table>
      </div>
      `
          : '<div class="empty-state">No users match the current filters.</div>'
      }
    `
  });
}

function renderAllocationTable() {
  const rows = state.dashboard.admin.allocations;
  const filteredRows = applyAllocationFilters(rows);
  const filterOptions = getAllocationFilterOptions(rows);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / ALLOCATION_PAGE_SIZE));
  const currentPage = Math.min(Math.max(state.allocationPage, 1), totalPages);
  const startIndex = filteredRows.length ? (currentPage - 1) * ALLOCATION_PAGE_SIZE : 0;
  const pageRows = filteredRows.slice(startIndex, startIndex + ALLOCATION_PAGE_SIZE);
  const showingFrom = filteredRows.length ? startIndex + 1 : 0;
  const showingTo = Math.min(startIndex + ALLOCATION_PAGE_SIZE, filteredRows.length);

  return renderCollapsibleSection({
    sectionId: "manager-allocations",
    title: "Current Deal Allocations",
    copy: "Stored capital and deferred-comp participation records across all projects.",
    body: `
      <div class="table-toolbar">
        <div class="filter-grid filter-grid-4">
          <label>
            Deal
            <select id="allocation-filter-deal">
              <option value="">All deals</option>
              ${filterOptions.deals
                .map(
                  (deal) => `
                    <option value="${escapeHtml(deal.id)}" ${
                      deal.id === state.allocationFilters.dealId ? "selected" : ""
                    }>
                      ${escapeHtml(deal.name)}
                    </option>
                  `
                )
                .join("")}
            </select>
          </label>
          <label>
            Participant
            <select id="allocation-filter-participant">
              <option value="">All participants</option>
              ${filterOptions.participants
                .map(
                  (participant) => `
                    <option value="${escapeHtml(participant.id)}" ${
                      participant.id === state.allocationFilters.participantId ? "selected" : ""
                    }>
                      ${escapeHtml(participant.name)}
                    </option>
                  `
                )
                .join("")}
            </select>
          </label>
          <label>
            Category
            <select id="allocation-filter-category">
              <option value="">All categories</option>
              ${filterOptions.categories
                .map(
                  (category) => `
                    <option value="${escapeHtml(category)}" ${
                      category === state.allocationFilters.category ? "selected" : ""
                    }>
                      ${escapeHtml(titleCase(category))}
                    </option>
                  `
                )
                .join("")}
            </select>
          </label>
          <label>
            Class
            <select id="allocation-filter-class">
              <option value="">All classes</option>
              ${filterOptions.classTypes
                .map(
                  (classType) => `
                    <option value="${escapeHtml(classType)}" ${
                      classType === state.allocationFilters.classType ? "selected" : ""
                    }>
                      ${escapeHtml(classType)}
                    </option>
                  `
                )
                .join("")}
            </select>
          </label>
        </div>
        <div class="pagination-row">
          <span class="read-only-tag">
            Showing ${escapeHtml(String(showingFrom))}-${escapeHtml(String(showingTo))} of
            ${escapeHtml(String(filteredRows.length))}
          </span>
          <div class="button-row">
            <button
              class="button-secondary button-inline"
              id="allocation-page-prev"
              type="button"
              ${currentPage <= 1 ? "disabled" : ""}
            >
              Previous
            </button>
            <span class="read-only-tag">Page ${escapeHtml(String(currentPage))} of ${escapeHtml(String(totalPages))}</span>
            <button
              class="button-secondary button-inline"
              id="allocation-page-next"
              type="button"
              ${currentPage >= totalPages ? "disabled" : ""}
            >
              Next
            </button>
          </div>
        </div>
      </div>
      ${
        pageRows.length
          ? `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Deal</th>
              <th>Participant</th>
              <th>Category</th>
              <th>Class</th>
              <th>Contribution</th>
              <th>Type</th>
              <th>Trade</th>
              <th>Cash Paid</th>
              <th>Deferred</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${pageRows
              .map(
                (row) => `
                  <tr>
                    <td>${escapeHtml(row.dealName)}</td>
                    <td>${escapeHtml(row.participantName)}</td>
                    <td>${escapeHtml(titleCase(row.category))}</td>
                    <td>${escapeHtml(row.classType)}</td>
                    <td>${escapeHtml(formatCurrency(row.contributionAmount))}</td>
                    <td>${escapeHtml(row.contributionType)}</td>
                    <td>${escapeHtml(row.trade ?? "—")}</td>
                    <td>${escapeHtml(row.category === "contractor" ? formatCurrency(row.cashPaid) : "—")}</td>
                    <td>${escapeHtml(formatCurrency(row.deferredAmount))}</td>
                    <td>${escapeHtml(row.status ?? "—")}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
      `
          : '<div class="empty-state">No allocations match the current filters.</div>'
      }
    `
  });
}

function renderManagerAdmin() {
  return renderCollapsibleSection({
    sectionId: "manager-admin-console",
    title: "Admin Console",
    copy: "Manager-only controls for platform users, new deals, deal allocations, and project updates.",
    body: `
      <div class="admin-grid">
        ${renderCreateUserPanel()}
        ${renderCreateDealPanel()}
        ${renderAllocationPanel()}
        ${renderDealEditorPanel()}
      </div>
    `
  });
}

function renderManagerDashboard() {
  const { viewer, overview, deals } = state.dashboard;
  const rollupDeals = getFilteredRollupDeals();

  return `
    <div class="shell">
      <section class="panel app-header">
        <div>
          <p class="eyebrow">Sponsor View</p>
          <h2>${escapeHtml(viewer.name)}</h2>
          <p class="meta-line">${escapeHtml(viewer.email)} · Internal promote dashboard</p>
        </div>
        <div class="button-row">
          <span class="read-only-tag">Investors remain read only</span>
          <button class="button-secondary" id="logout-button" type="button">Log out</button>
        </div>
      </section>

      ${renderCollapsibleSection({
        sectionId: "manager-portfolio-controls",
        title: "Portfolio Controls",
        copy:
          "Sponsor-level snapshot across all tracked deals, including projected promote and contractor participation.",
        body: `
          <div class="metrics-grid">
            ${metricCard("Tracked deals", String(overview.totalDeals))}
            ${metricCard("Active deals", String(overview.activeDeals))}
            ${metricCard("Tracked equity", formatCurrency(overview.totalTrackedEquity))}
            ${metricCard(
              "Projected sponsor promote",
              formatCurrency(overview.projectedSponsorPromote)
            )}
          </div>
        `
      })}

      ${renderProfilePanel()}
      ${renderManagerAdmin()}
      ${renderUserDirectory()}
      ${renderAllocationTable()}

      ${renderCollapsibleSection({
        sectionId: "manager-deal-rollup",
        title: "Deal Rollup",
        copy: "Current forecast by deal, with active promote tier and class-level payout totals.",
        headerActions: `
          <label class="toolbar-field">
            Deal filter
            <select id="deal-rollup-filter">
              <option value="">All deals</option>
              ${deals
                .map(
                  (deal) => `
                    <option value="${escapeHtml(deal.id)}" ${
                      deal.id === state.rollupDealFilter ? "selected" : ""
                    }>
                      ${escapeHtml(deal.name)}
                    </option>
                  `
                )
                .join("")}
            </select>
          </label>
        `,
        body: `
          <div class="project-grid">
            ${
              rollupDeals.length
                ? rollupDeals.map((deal) => renderManagerDeal(deal)).join("")
                : '<div class="empty-state">No deals match the selected rollup filter.</div>'
            }
          </div>
        `
      })}

      ${renderCalculator()}
      ${renderContractorTable()}
    </div>
  `;
}

function renderLoading() {
  return `
    <div class="shell">
      <section class="panel">
        <p class="eyebrow">Loading</p>
        <h2>Loading dashboard...</h2>
      </section>
    </div>
  `;
}

function render() {
  if (state.loading) {
    app.innerHTML = renderLoading();
    return;
  }

  if (!state.session) {
    app.innerHTML = renderLogin();
    return;
  }

  if (state.session.mustChangePassword) {
    app.innerHTML = renderPasswordResetGate();
    return;
  }

  app.innerHTML =
    state.dashboard?.role === "manager" ? renderManagerDashboard() : renderInvestorDashboard();
}

async function loadSession() {
  state.loading = true;
  render();

  try {
    const session = await api("/api/session", { method: "GET" });
    state.session = session.user;

    if (state.session && !state.session.mustChangePassword) {
      await refreshDashboard();
    } else {
      state.dashboard = null;
      state.calculator = null;
      state.calculatorSelectionId = null;
      state.adminDealId = null;
      state.dealEditorDrafts = {};
      state.rollupDealFilter = "";
      state.contractorDealFilter = "";
      state.allocationPage = 1;
      state.allocationFilters = {
        dealId: "",
        participantId: "",
        category: "",
        classType: ""
      };
      state.userFilters = {
        search: "",
        category: "",
        role: "",
        status: ""
      };
    }
  } catch (error) {
    state.loginError = error.message;
    state.session = null;
    state.dashboard = null;
    state.calculator = null;
    state.calculatorSelectionId = null;
    state.adminDealId = null;
    state.dealEditorDrafts = {};
    state.rollupDealFilter = "";
    state.allocationPage = 1;
    state.allocationFilters = {
      dealId: "",
      participantId: "",
      category: "",
      classType: ""
    };
    state.userFilters = {
      search: "",
      category: "",
      role: "",
      status: ""
    };
  } finally {
    state.loading = false;
    render();
  }
}

document.addEventListener("submit", async (event) => {
  if (event.target.id === "login-form") {
    event.preventDefault();
    const formData = new FormData(event.target);
    state.loginError = "";
    state.loading = true;
    render();

    try {
      await api("/api/login", {
        method: "POST",
        body: JSON.stringify({
          email: formData.get("email"),
          password: formData.get("password")
        })
      });
      clearMessages();
      await loadSession();
    } catch (error) {
      state.loading = false;
      state.loginError = error.message;
      render();
    }

    return;
  }

  if (event.target.id === "password-form") {
    event.preventDefault();
    const formData = new FormData(event.target);
    const currentPassword = String(formData.get("currentPassword") ?? "");
    const newPassword = String(formData.get("newPassword") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (newPassword !== confirmPassword) {
      setMessage("password", "error", "New password and confirmation do not match.");
      render();
      return;
    }

    try {
      await api("/api/profile/password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword,
          newPassword
        })
      });
      setMessage("password", "success", "Password updated. Loading dashboard...");
      await loadSession();
    } catch (error) {
      setMessage("password", "error", error.message);
      render();
    }

    return;
  }

  if (event.target.id === "calculator-form") {
    event.preventDefault();
    const formData = new FormData(event.target);

    try {
      await loadCalculator(String(formData.get("dealId")), {
        dealId: formData.get("dealId"),
        salePrice: Number(formData.get("salePrice")),
        holdMonths: Number(formData.get("holdMonths")),
        prefRate: Number(formData.get("prefRate"))
      });
      render();
    } catch (error) {
      setMessage("deal", "error", error.message);
      render();
    }

    return;
  }

  if (event.target.id === "user-form") {
    event.preventDefault();
    const formData = new FormData(event.target);

    try {
      const idCardFile = await readFileAsPayload(event.target.elements.idCard.files[0]);
      const result = await api("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          category: formData.get("category"),
          firstName: formData.get("firstName"),
          middleName: formData.get("middleName"),
          lastName: formData.get("lastName"),
          email: formData.get("email"),
          contactPhone: formData.get("contactPhone"),
          driverLicenseNumber: formData.get("driverLicenseNumber"),
          currentAddress: formData.get("currentAddress"),
          mailingAddress: formData.get("mailingAddress"),
          password: formData.get("password"),
          idCardFile
        })
      });
      await refreshDashboard();
      setMessage(
        "user",
        "success",
        `User created. ${formatNotificationStatus(result.notification)}`
      );
      event.target.reset();
    } catch (error) {
      setMessage("user", "error", error.message);
    }

    render();
    return;
  }

  if (event.target.id === "profile-form") {
    event.preventDefault();
    const formData = new FormData(event.target);

    try {
      await api("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({
          firstName: formData.get("firstName"),
          middleName: formData.get("middleName"),
          lastName: formData.get("lastName"),
          email: formData.get("email"),
          contactPhone: formData.get("contactPhone"),
          currentAddress: formData.get("currentAddress"),
          mailingAddress: formData.get("mailingAddress"),
          payoutMethod: formData.get("payoutMethod"),
          bankAccountName: formData.get("bankAccountName"),
          bankName: formData.get("bankName"),
          bankRoutingNumber: formData.get("bankRoutingNumber"),
          bankAccountNumber: formData.get("bankAccountNumber"),
          zelleDetails: formData.get("zelleDetails"),
          cashAppHandle: formData.get("cashAppHandle"),
          payoutNotes: formData.get("payoutNotes")
        })
      });
      await loadSession();
      setMessage("profile", "success", "Profile details saved.");
      render();
    } catch (error) {
      setMessage("profile", "error", error.message);
      render();
    }

    return;
  }

  if (event.target.id === "allocation-form") {
    event.preventDefault();
    const formData = new FormData(event.target);

    try {
      await api("/api/admin/allocations", {
        method: "POST",
        body: JSON.stringify({
          participantId: formData.get("participantId"),
          dealId: formData.get("dealId"),
          classType: formData.get("classType"),
          contributionAmount: Number(formData.get("contributionAmount")),
          contributionType: formData.get("contributionType"),
          trade: formData.get("trade"),
          totalContractValue: formData.get("totalContractValue")
            ? Number(formData.get("totalContractValue"))
            : 0,
          cashPaid: formData.get("cashPaid") ? Number(formData.get("cashPaid")) : 0,
          contractorStatus: formData.get("contractorStatus")
        })
      });
      await refreshDashboard();
      setMessage("allocation", "success", "Deal allocation saved to the database.");
      event.target.reset();
    } catch (error) {
      setMessage("allocation", "error", error.message);
    }

    render();
    return;
  }

  if (event.target.id === "create-deal-form") {
    event.preventDefault();
    const formData = new FormData(event.target);

    try {
      const result = await api("/api/admin/deals", {
        method: "POST",
        body: JSON.stringify({
          name: formData.get("name"),
          location: formData.get("location"),
          currentPhase: formData.get("currentPhase"),
          status: formData.get("status"),
          totalProjectCost: Number(formData.get("totalProjectCost")),
          debt: Number(formData.get("debt")),
          debtInterestRate: Number(formData.get("debtInterestRate")),
          totalInterestPaid: Number(formData.get("totalInterestPaid")),
          salePrice: Number(formData.get("salePrice")),
          holdMonths: Number(formData.get("holdMonths")),
          prefRate: Number(formData.get("prefRate")),
          timelineProgress: Number(formData.get("timelineProgress")),
          fundedOn: formData.get("fundedOn"),
          projectedExitOn: formData.get("projectedExitOn"),
          actualExitOn: formData.get("actualExitOn")
        })
      });
      state.adminDealId = result.deal.id;
      state.rollupDealFilter = result.deal.id;
      await refreshDashboard();
      setMessage("dealCreate", "success", "Project created and ready for allocations.");
      render();
    } catch (error) {
      setMessage("dealCreate", "error", error.message);
      render();
    }

    return;
  }

  if (event.target.id === "deal-form") {
    event.preventDefault();
    const dealId = String(event.target.dataset.dealId ?? "");
    const draft = getDealEditorDraft(getDealById(dealId));

    try {
      await api(`/api/admin/deals/${encodeURIComponent(dealId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: draft.name,
          location: draft.location,
          currentPhase: draft.currentPhase,
          status: draft.status,
          totalProjectCost: draft.totalProjectCost,
          debt: draft.debt,
          debtInterestRate: draft.debtInterestRate,
          totalInterestPaid: draft.totalInterestPaid,
          salePrice: draft.salePrice,
          holdMonths: draft.holdMonths,
          prefRate: draft.prefRate,
          timelineProgress: draft.timelineProgress,
          fundedOn: draft.fundedOn,
          projectedExitOn: draft.projectedExitOn,
          actualExitOn: draft.actualExitOn,
          timeline: draft.timeline,
          promoteTiers: draft.promoteTiers
        })
      });
      state.adminDealId = dealId;
      await refreshDashboard();
      setMessage("deal", "success", "Project changes saved to the database.");
    } catch (error) {
      setMessage("deal", "error", error.message);
    }

    render();
  }
});

document.addEventListener("change", async (event) => {
  if (syncDealEditorField(event.target)) {
    return;
  }

  if (event.target.id === "deal-editor-select") {
    state.adminDealId = event.target.value;
    state.messages.deal = null;
    render();
    return;
  }

  if (event.target.id === "deal-rollup-filter") {
    state.rollupDealFilter = event.target.value;
    render();
    return;
  }

  if (event.target.id === "contractor-filter-deal") {
    state.contractorDealFilter = event.target.value;
    render();
    return;
  }

  if (event.target.id === "allocation-filter-deal") {
    state.allocationFilters.dealId = event.target.value;
    state.allocationPage = 1;
    render();
    return;
  }

  if (event.target.id === "allocation-filter-participant") {
    state.allocationFilters.participantId = event.target.value;
    state.allocationPage = 1;
    render();
    return;
  }

  if (event.target.id === "allocation-filter-category") {
    state.allocationFilters.category = event.target.value;
    state.allocationPage = 1;
    render();
    return;
  }

  if (event.target.id === "allocation-filter-class") {
    state.allocationFilters.classType = event.target.value;
    state.allocationPage = 1;
    render();
    return;
  }

  if (event.target.id === "user-filter-category") {
    state.userFilters.category = event.target.value;
    render();
    return;
  }

  if (event.target.id === "user-filter-role") {
    state.userFilters.role = event.target.value;
    render();
    return;
  }

  if (event.target.id === "user-filter-status") {
    state.userFilters.status = event.target.value;
    render();
    return;
  }

  if (event.target.id === "calculator-deal-select") {
    try {
      await loadCalculator(event.target.value);
    } catch {}
    render();
  }
});

document.addEventListener("input", (event) => {
  if (event.target.id === "user-filter-search") {
    state.userFilters.search = event.target.value;
    render();
    return;
  }

  syncDealEditorField(event.target);
});

document.addEventListener("click", async (event) => {
  const sectionToggle = event.target.closest("[data-section-toggle]");

  if (sectionToggle) {
    const sectionId = sectionToggle.dataset.sectionToggle;

    if (!sectionId) {
      return;
    }

    toggleSectionCollapsed(sectionId);
    render();
    return;
  }

  const dealEditorAction = event.target.closest("[data-deal-editor-action]");

  if (dealEditorAction) {
    const action = dealEditorAction.dataset.dealEditorAction;
    const dealId = dealEditorAction.dataset.dealId || state.adminDealId;

    if (!dealId) {
      return;
    }

    if (action === "add-timeline") {
      updateDealEditorDraft(dealId, (draft) => ({
        ...draft,
        timeline: [...draft.timeline, createTimelineDraft()]
      }));
      render();
      return;
    }

    if (action === "remove-timeline") {
      const index = Number(dealEditorAction.dataset.index);

      updateDealEditorDraft(dealId, (draft) => ({
        ...draft,
        timeline:
          draft.timeline.length > 1
            ? draft.timeline.filter((_, itemIndex) => itemIndex !== index)
            : [createTimelineDraft()]
      }));
      render();
      return;
    }

    if (action === "add-tier") {
      updateDealEditorDraft(dealId, (draft) => ({
        ...draft,
        promoteTiers: [
          ...draft.promoteTiers,
          createTierDraft({ investorShare: 0.7, sponsorShare: 0.3, isEnabled: true })
        ]
      }));
      render();
      return;
    }

    if (action === "create-issue") {
      const issueRoot = document.querySelector(`[data-deal-issue-root="${dealId}"]`);
      const titleInput = issueRoot?.querySelector('input[name="title"]');
      const thresholdInput = issueRoot?.querySelector('input[name="approvalThreshold"]');
      const closesOnInput = issueRoot?.querySelector('input[name="closesOn"]');
      const descriptionInput = issueRoot?.querySelector('textarea[name="description"]');
      const title = String(titleInput?.value ?? "").trim();
      const description = String(descriptionInput?.value ?? "").trim();
      const approvalThreshold = Number(thresholdInput?.value ?? 0.75);
      const closesOn = String(closesOnInput?.value ?? "").trim();

      if (!title || !description || !closesOn) {
        setMessage("issue", "error", "Issue title, close date, and description are required.");
        render();
        return;
      }

      try {
        const result = await api("/api/admin/issues", {
          method: "POST",
          body: JSON.stringify({
            dealId,
            title,
            description,
            approvalThreshold,
            closesOn
          })
        });
        await refreshDashboard();
        setMessage(
          "issue",
          "success",
          `Voting issue created. ${formatNotificationBatchSummary(result.notifications)}`
        );
      } catch (error) {
        setMessage("issue", "error", error.message);
      }

      render();
      return;
    }

    if (action === "remove-tier") {
      const index = Number(dealEditorAction.dataset.index);

      updateDealEditorDraft(dealId, (draft) => ({
        ...draft,
        promoteTiers:
          draft.promoteTiers.length > 1
            ? draft.promoteTiers.filter((_, itemIndex) => itemIndex !== index)
            : [createTierDraft({ investorShare: 0.7, sponsorShare: 0.3, isEnabled: true })]
      }));
      render();
      return;
    }

    if (action === "delete-deal") {
      const deal = getDealById(dealId);
      const confirmed = window.confirm(
        `Delete ${deal?.name ?? "this deal"}? All allocations, timeline items, contractor entries, and tiers tied to it will be removed.`
      );

      if (!confirmed) {
        return;
      }

      try {
        await api(`/api/admin/deals/${encodeURIComponent(dealId)}`, {
          method: "DELETE"
        });
        delete state.dealEditorDrafts[dealId];
        await refreshDashboard();
        setMessage("deal", "success", "Project deleted.");
      } catch (error) {
        setMessage("deal", "error", error.message);
      }

      render();
      return;
    }
  }

  const issueVoteButton = event.target.closest("[data-issue-vote]");

  if (issueVoteButton) {
    const issueId = issueVoteButton.dataset.issueId;
    const voteChoice = issueVoteButton.dataset.issueVote;

    if (!issueId || !voteChoice) {
      return;
    }

    try {
      await api(`/api/issues/${encodeURIComponent(issueId)}/vote`, {
        method: "PATCH",
        body: JSON.stringify({
          voteChoice
        })
      });
      await refreshDashboard();
      setMessage("vote", "success", `Your ${voteChoice} vote has been recorded.`);
    } catch (error) {
      setMessage("vote", "error", error.message);
    }

    render();
    return;
  }

  const actionButton = event.target.closest("[data-user-action]");

  if (actionButton) {
    const action = actionButton.dataset.userAction;
    const userId = actionButton.dataset.userId;

    if (!userId) {
      return;
    }

    try {
      if (action === "delete") {
        const confirmed = window.confirm(
          "Delete this user account? Login access will be removed and the action cannot be undone."
        );

        if (!confirmed) {
          return;
        }

        await api(`/api/admin/users/${encodeURIComponent(userId)}`, {
          method: "DELETE"
        });
        await refreshDashboard();
        setMessage("directory", "success", "User account deleted.");
      } else {
        await api(`/api/admin/users/${encodeURIComponent(userId)}/status`, {
          method: "PATCH",
          body: JSON.stringify({
            isActive: action === "enable"
          })
        });
        await refreshDashboard();
        setMessage(
          "directory",
          "success",
          action === "enable" ? "User account re-enabled." : "User account disabled."
        );
      }
    } catch (error) {
      setMessage("directory", "error", error.message);
    }

    render();
    return;
  }

  if (event.target.id === "allocation-page-prev") {
    state.allocationPage = Math.max(1, state.allocationPage - 1);
    render();
    return;
  }

  if (event.target.id === "allocation-page-next") {
    state.allocationPage += 1;
    render();
    return;
  }

  if (event.target.id === "logout-button") {
    await api("/api/logout", { method: "POST", body: JSON.stringify({}) });
    state.session = null;
    state.dashboard = null;
    state.calculator = null;
    state.calculatorSelectionId = null;
    state.adminDealId = null;
    state.rollupDealFilter = "";
    state.contractorDealFilter = "";
    state.allocationPage = 1;
    state.allocationFilters = {
      dealId: "",
      participantId: "",
      category: "",
      classType: ""
    };
    state.userFilters = {
      search: "",
      category: "",
      role: "",
      status: ""
    };
    state.loginError = "";
    clearMessages();
    render();
  }
});

loadSession();
