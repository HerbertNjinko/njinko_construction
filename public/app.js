const state = {
  session: null,
  dashboard: null,
  calculator: null,
  calculatorSelectionId: null,
  adminDealId: null,
  loginError: "",
  loading: true,
  messages: {
    user: null,
    allocation: null,
    deal: null
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
    deal: null
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
    if (
      !state.adminDealId ||
      !state.dashboard.deals.some((deal) => deal.id === state.adminDealId)
    ) {
      state.adminDealId = state.dashboard.deals[0]?.id ?? null;
    }

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
            Investors and contractor participants get a clean read-only dashboard:
            their capital, preferred return, projected payout, and the project-level
            signals that matter. Sponsor access includes manager controls backed by SQLite.
          </p>
          <ul class="feature-list">
            <li>Personal portfolio totals with active deal count and current pref accrual.</li>
            <li>Per-project ownership, payout breakdown, status, and timeline progress.</li>
            <li>Manager-side user creation, deal allocations, and project updates saved to the database.</li>
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
          <span class="read-only-tag">Read only dashboard</span>
          <button class="button-secondary" id="logout-button" type="button">Log out</button>
        </div>
      </section>

      <section class="panel">
        <div class="section-head">
          <div>
            <h3>Personal Portfolio View</h3>
            <p class="section-copy">
              Totals across all deals tied to your login. No editing, no visibility into other investor amounts.
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
      <h3>Add Investor Or Contractor User</h3>
      <p class="section-copy">
        Creates both the participant profile and login. New users are stored in SQLite immediately.
      </p>
      ${renderMessage(state.messages.user)}
      <form id="user-form">
        <label>
          Category
          <select name="category" required>
            <option value="investor">Investor</option>
            <option value="contractor">Contractor participant</option>
          </select>
        </label>
        <label>
          Full name
          <input type="text" name="name" placeholder="Jane Doe" minlength="2" required />
        </label>
        <label>
          Email
          <input type="email" name="email" placeholder="jane@example.com" required />
        </label>
        <label>
          Temporary password
          <input type="password" name="password" minlength="8" required />
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

  return `
    <section class="panel">
      <div class="section-head">
        <div>
          <h3>User Directory</h3>
          <p class="section-copy">
            Current login-enabled users. New manager-added accounts appear here after save.
          </p>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Email</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (row) => `
                  <tr>
                    <td>${escapeHtml(row.name)}</td>
                    <td>${escapeHtml(titleCase(row.category))}</td>
                    <td>${escapeHtml(row.email)}</td>
                    <td>${escapeHtml(titleCase(row.role))}</td>
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

function renderAllocationTable() {
  const rows = state.dashboard.admin.allocations;

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
            ${rows
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
            Manager-only controls for platform users, deal allocations, and project updates. Changes are persisted to SQLite.
          </p>
        </div>
      </div>
      <div class="admin-grid">
        ${renderCreateUserPanel()}
        ${renderAllocationPanel()}
        ${renderDealEditorPanel()}
      </div>
    </section>
  `;
}

function renderManagerDashboard() {
  const { viewer, overview, deals } = state.dashboard;

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
        </div>
        <div class="project-grid">
          ${deals.map((deal) => renderManagerDeal(deal)).join("")}
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

  app.innerHTML =
    state.dashboard?.role === "manager" ? renderManagerDashboard() : renderInvestorDashboard();
}

async function loadSession() {
  state.loading = true;
  render();

  try {
    const session = await api("/api/session", { method: "GET" });
    state.session = session.user;

    if (state.session) {
      await refreshDashboard();
    } else {
      state.dashboard = null;
      state.calculator = null;
      state.calculatorSelectionId = null;
      state.adminDealId = null;
    }
  } catch (error) {
    state.loginError = error.message;
    state.session = null;
    state.dashboard = null;
    state.calculator = null;
    state.calculatorSelectionId = null;
    state.adminDealId = null;
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
      await api("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          category: formData.get("category"),
          name: formData.get("name"),
          email: formData.get("email"),
          password: formData.get("password")
        })
      });
      await refreshDashboard();
      setMessage("user", "success", "User created and saved to the database.");
      event.target.reset();
    } catch (error) {
      setMessage("user", "error", error.message);
    }

    render();
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

  if (event.target.id === "calculator-deal-select") {
    try {
      await loadCalculator(event.target.value);
    } catch {}
    render();
  }
});

document.addEventListener("click", async (event) => {
  if (event.target.id === "logout-button") {
    await api("/api/logout", { method: "POST", body: JSON.stringify({}) });
    state.session = null;
    state.dashboard = null;
    state.calculator = null;
    state.calculatorSelectionId = null;
    state.adminDealId = null;
    state.loginError = "";
    clearMessages();
    render();
  }
});

loadSession();
