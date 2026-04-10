const ALLOCATION_PAGE_SIZE = 50;

const state = {
  session: null,
  dashboard: null,
  calculator: null,
  calculatorSelectionId: null,
  adminDealId: null,
  rollupDealFilter: "",
  allocationPage: 1,
  allocationFilters: {
    dealId: "",
    participantId: "",
    category: "",
    classType: ""
  },
  loginError: "",
  loading: true,
  messages: {
    user: null,
    allocation: null,
    deal: null,
    dealCreate: null,
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
    timelineProgress: 0,
    fundedOn: new Date().toISOString().slice(0, 10)
  };
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

function getFilteredRollupDeals() {
  const deals = state.dashboard?.deals ?? [];
  return state.rollupDealFilter ? deals.filter((deal) => deal.id === state.rollupDealFilter) : deals;
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
    state.rollupDealFilter = "";
    state.allocationPage = 1;
    state.allocationFilters = {
      dealId: "",
      participantId: "",
      category: "",
      classType: ""
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

  return `
    <section class="panel">
      <div class="section-head">
        <div>
          <h3>Profile & Payout Details</h3>
          <p class="section-copy">
            Update your contact information and payment instructions here. Deal-level positions remain read only.
          </p>
        </div>
      </div>
      <div class="summary-grid">
        ${summaryItem("Portal role", titleCase(viewer.role))}
        ${summaryItem("User category", titleCase(viewer.category ?? viewer.role))}
        ${summaryItem("Driver's license", profile.driverLicenseNumber || "Not provided")}
        ${summaryItem("Attached ID", profile.idCardFileName || "No file attached")}
      </div>
      ${renderMessage(state.messages.profile)}
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
    </section>
  `;
}

function renderInvestorProject(project) {
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
        </div>
      </div>
      <div class="deal-body">
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
      </div>
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

      <section class="panel">
        <div class="section-head">
          <div>
            <h3>Personal Portfolio View</h3>
            <p class="section-copy">
              Totals across all deals tied to your login. No visibility into other investor amounts.
            </p>
          </div>
        </div>
        <div class="metrics-grid">
          ${metricCard("Total invested", formatCurrency(portfolio.totalInvested))}
          ${metricCard("Total returned", formatCurrency(portfolio.totalReturned))}
          ${metricCard("Current active investments", String(portfolio.activeInvestments))}
          ${metricCard("Current pref earned", formatCurrency(portfolio.currentPrefEarned))}
        </div>
      </section>

      <section class="panel">
        <div class="section-head">
          <div>
            <h3>Per-Project Breakdown</h3>
            <p class="section-copy">
              Each deal shows your amount invested, ownership, returns breakdown, project status, and timeline.
            </p>
          </div>
        </div>
        <div class="deal-grid">
          ${
            projects.length
              ? projects.map((project) => renderInvestorProject(project)).join("")
              : '<div class="empty-state">No positions are linked to this login.</div>'
          }
        </div>
      </section>
    </div>
  `;
}

function renderManagerDeal(deal) {
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
        </div>
      </div>
      <div class="deal-body">
        <div class="summary-grid">
          ${summaryItem("Tracked equity", formatCurrency(deal.totalEquity))}
          ${summaryItem("Debt", formatCurrency(deal.debt))}
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
      </div>
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

  return `
    <section class="calculator-layout">
      <div class="calculator-form">
        <p class="eyebrow">Sponsor Tool</p>
        <h3>Promote IRR Trigger Calculator</h3>
        <p class="section-copy">
          Plug in a sale price, hold length, and pref rate to see investor distributions,
          Class A vs Class C outputs, and the sponsor promote tier that gets triggered.
        </p>
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
                        <article class="tier-card ${tier.isActive ? "active" : ""}">
                          <h4>${escapeHtml(tier.label)}</h4>
                          <p>${escapeHtml(formatPercent(tier.hurdle))} hurdle</p>
                          <p>${escapeHtml(
                            `${Math.round(tier.investorShare * 100)}/${Math.round(
                              tier.sponsorShare * 100
                            )} investor/sponsor`
                          )}</p>
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
    </section>
  `;
}

function renderContractorTable() {
  const rows = state.dashboard.contractorLedger;

  return `
    <section class="panel">
      <div class="section-head">
        <div>
          <h3>Contractor Tracking System</h3>
          <p class="section-copy">
            Deferred labor is tracked separately from cash equity, tagged as Class C, and
            still participates in the deal waterfall.
          </p>
        </div>
      </div>
      <div class="table-wrap">
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
            ${rows
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
    </section>
  `;
}

function renderCreateUserPanel() {
  return `
    <article class="admin-card">
      <p class="eyebrow">Manager Control</p>
      <h3>Add Platform User</h3>
      <p class="section-copy">
        Creates the user profile, login, first-login password reset requirement, and credential notification.
      </p>
      ${renderMessage(state.messages.user)}
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
    </article>
  `;
}

function renderAllocationPanel() {
  const participants = state.dashboard.admin.participants;
  const deals = state.dashboard.deals;

  return `
    <article class="admin-card">
      <p class="eyebrow">Manager Control</p>
      <h3>Add Deal Allocation</h3>
      <p class="section-copy">
        Link a participant to a deal. Contractor fields are only required for contractor participants.
      </p>
      ${renderMessage(state.messages.allocation)}
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
    </article>
  `;
}

function renderCreateDealPanel() {
  const defaults = getCreateDealDefaults();

  return `
    <article class="admin-card">
      <p class="eyebrow">Manager Control</p>
      <h3>Create Project</h3>
      <p class="section-copy">
        Add a new deal to the database so it can be allocated to investors and contractors.
      </p>
      ${renderMessage(state.messages.dealCreate)}
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
    </article>
  `;
}

function renderDealEditorPanel() {
  const deal = getManagerEditableDeal();

  if (!deal) {
    return `
      <article class="admin-card">
        <h3>Update Project</h3>
        <div class="empty-state">No deals are available to edit.</div>
      </article>
    `;
  }

  return `
    <article class="admin-card admin-card-wide">
      <p class="eyebrow">Manager Control</p>
      <h3>Update Project</h3>
      <p class="section-copy">
        Save project status, phase, financial assumptions, and timeline progress to the database.
      </p>
      ${renderMessage(state.messages.deal)}
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
            <input type="text" name="name" value="${escapeHtml(deal.name)}" required />
          </label>
          <label>
            Location
            <input type="text" name="location" value="${escapeHtml(deal.location)}" required />
          </label>
        </div>
        <div class="form-grid-2">
          <label>
            Current phase
            <input
              type="text"
              name="currentPhase"
              value="${escapeHtml(deal.currentPhase)}"
              required
            />
          </label>
          <label>
            Status
            <select name="status" required>
              <option value="under_construction" ${
                deal.status === "under_construction" ? "selected" : ""
              }>Under construction</option>
              <option value="listed" ${deal.status === "listed" ? "selected" : ""}>Listed</option>
              <option value="sold" ${deal.status === "sold" ? "selected" : ""}>Sold</option>
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
              value="${escapeHtml(String(deal.totalProjectCost))}"
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
              value="${escapeHtml(String(deal.debt))}"
              required
            />
          </label>
        </div>
        <div class="form-grid-2">
          <label>
            Sale price
            <input
              type="number"
              name="salePrice"
              min="0"
              step="1000"
              value="${escapeHtml(String(deal.salePrice))}"
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
              value="${escapeHtml(String(deal.holdMonths))}"
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
              value="${escapeHtml(String(deal.prefRate))}"
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
              value="${escapeHtml(String(deal.timelineProgress))}"
              required
            />
          </label>
        </div>
        <div class="form-grid-2">
          <label>
            Funded on
            <input type="date" name="fundedOn" value="${escapeHtml(deal.fundedOn)}" required />
          </label>
          <label>
            Projected exit
            <input
              type="date"
              name="projectedExitOn"
              value="${escapeHtml(deal.projectedExitOn ?? "")}"
            />
          </label>
        </div>
        <label>
          Actual exit
          <input type="date" name="actualExitOn" value="${escapeHtml(deal.actualExitOn ?? "")}" />
        </label>
        <button class="button-primary" type="submit">Save project changes</button>
      </form>
    </article>
  `;
}

function renderUserDirectory() {
  const rows = state.dashboard.admin.users;
  const activeManagerCount = rows.filter((row) => row.role === "manager" && row.isActive).length;

  return `
    <section class="panel">
      <div class="section-head">
        <div>
          <h3>User Directory</h3>
          <p class="section-copy">
            Manage login access, status, and credential-delivery history without touching deal records.
          </p>
        </div>
      </div>
      ${renderMessage(state.messages.directory)}
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
            ${rows
              .map(
                (row) => {
                  const isSelf = row.id === state.session?.id;
                  const protectsFinalManager =
                    row.role === "manager" && row.isActive && activeManagerCount <= 1;

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
                          ${isSelf || protectsFinalManager ? "disabled" : ""}
                        >
                          ${row.isActive ? "Disable" : "Re-enable"}
                        </button>
                        <button
                          class="button-danger button-inline"
                          type="button"
                          data-user-action="delete"
                          data-user-id="${escapeHtml(row.id)}"
                          ${isSelf || protectsFinalManager ? "disabled" : ""}
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
    </section>
  `;
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

  return `
    <section class="panel">
      <div class="section-head">
        <div>
          <h3>Current Deal Allocations</h3>
          <p class="section-copy">
            Stored capital and deferred-comp participation records across all projects.
          </p>
        </div>
      </div>
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
    </section>
  `;
}

function renderManagerAdmin() {
  return `
    <section class="panel">
      <div class="section-head">
        <div>
          <h3>Admin Console</h3>
          <p class="section-copy">
            Manager-only controls for platform users, new deals, deal allocations, and project updates.
          </p>
        </div>
      </div>
      <div class="admin-grid">
        ${renderCreateUserPanel()}
        ${renderCreateDealPanel()}
        ${renderAllocationPanel()}
        ${renderDealEditorPanel()}
      </div>
    </section>
  `;
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

      <section class="panel">
        <div class="section-head">
          <div>
            <h3>Portfolio Controls</h3>
            <p class="section-copy">
              Sponsor-level snapshot across all tracked deals, including projected promote and contractor participation.
            </p>
          </div>
        </div>
        <div class="metrics-grid">
          ${metricCard("Tracked deals", String(overview.totalDeals))}
          ${metricCard("Active deals", String(overview.activeDeals))}
          ${metricCard("Tracked equity", formatCurrency(overview.totalTrackedEquity))}
          ${metricCard(
            "Projected sponsor promote",
            formatCurrency(overview.projectedSponsorPromote)
          )}
        </div>
      </section>

      ${renderProfilePanel()}
      ${renderManagerAdmin()}
      ${renderUserDirectory()}
      ${renderAllocationTable()}

      <section class="panel">
        <div class="section-head">
          <div>
            <h3>Deal Rollup</h3>
            <p class="section-copy">
              Current forecast by deal, with active promote tier and class-level payout totals.
            </p>
          </div>
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
        </div>
        <div class="project-grid">
          ${
            rollupDeals.length
              ? rollupDeals.map((deal) => renderManagerDeal(deal)).join("")
              : '<div class="empty-state">No deals match the selected rollup filter.</div>'
          }
        </div>
      </section>

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
      state.rollupDealFilter = "";
      state.allocationPage = 1;
      state.allocationFilters = {
        dealId: "",
        participantId: "",
        category: "",
        classType: ""
      };
    }
  } catch (error) {
    state.loginError = error.message;
    state.session = null;
    state.dashboard = null;
    state.calculator = null;
    state.calculatorSelectionId = null;
    state.adminDealId = null;
    state.rollupDealFilter = "";
    state.allocationPage = 1;
    state.allocationFilters = {
      dealId: "",
      participantId: "",
      category: "",
      classType: ""
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
    const formData = new FormData(event.target);
    const dealId = String(formData.get("dealId"));

    try {
      await api(`/api/admin/deals/${encodeURIComponent(dealId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: formData.get("name"),
          location: formData.get("location"),
          currentPhase: formData.get("currentPhase"),
          status: formData.get("status"),
          totalProjectCost: Number(formData.get("totalProjectCost")),
          debt: Number(formData.get("debt")),
          salePrice: Number(formData.get("salePrice")),
          holdMonths: Number(formData.get("holdMonths")),
          prefRate: Number(formData.get("prefRate")),
          timelineProgress: Number(formData.get("timelineProgress")),
          fundedOn: formData.get("fundedOn"),
          projectedExitOn: formData.get("projectedExitOn"),
          actualExitOn: formData.get("actualExitOn")
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

  if (event.target.id === "calculator-deal-select") {
    try {
      await loadCalculator(event.target.value);
    } catch {}
    render();
  }
});

document.addEventListener("click", async (event) => {
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
    state.allocationPage = 1;
    state.allocationFilters = {
      dealId: "",
      participantId: "",
      category: "",
      classType: ""
    };
    state.loginError = "";
    clearMessages();
    render();
  }
});

loadSession();
