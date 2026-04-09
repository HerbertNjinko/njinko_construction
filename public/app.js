const state = {
  session: null,
  dashboard: null,
  calculator: null,
  loginError: "",
  loading: true
};

const app = document.querySelector("#app");

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

const preciseCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
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

function formatPreciseCurrency(value) {
  return preciseCurrency.format(value ?? 0);
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

function metricCard(label, value, tone = "") {
  return `
    <article class="metric-card ${tone}">
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

function renderLogin() {
  return `
    <div class="shell">
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">Investor Portal + Promote Calculator</p>
          <h1>Deal visibility without exposing the whole cap table.</h1>
          <p>
            Investors and contractor participants get a clean read-only dashboard:
            their capital, their preferred return, their projected payout, and the
            project-level signals that matter. Sponsor view includes the promote trigger
            calculator and Class C contractor tracking.
          </p>
          <ul class="feature-list">
            <li>Personal portfolio totals with active deal count and current pref accrual.</li>
            <li>Per-project ownership, payout breakdown, status, and timeline progress.</li>
            <li>Contractor deferred compensation tracked as Class C in the same waterfall.</li>
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
              and the sponsor calculator.
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
            ${summaryItem("Hold period", `${project.projectSummary.holdMonths} months`)}
            ${summaryItem("Gross project IRR", formatPercent(project.projectSummary.projectIrr))}
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
  const selectedDealId = state.calculator?.deal?.id ?? deals[0]?.id;
  const selectedPreset =
    deals.find((deal) => deal.id === selectedDealId) ??
    deals[0] ?? {
      id: "",
      salePrice: 0,
      holdMonths: 0,
      prefRate: 0
    };

  const result = state.calculator;

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
            <select name="dealId">
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
              <div class="panel" style="margin-top: 1rem; padding: 1rem;">
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
              <div class="panel" style="margin-top: 1rem; padding: 1rem;">
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
              <div class="table-wrap" style="margin-top: 1rem;">
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
                Submit a scenario to see distribute-able equity, tier selection, investor payouts,
                and sponsor promote.
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
      state.dashboard = await api("/api/dashboard", { method: "GET" });

      if (state.dashboard.role === "manager" && state.dashboard.calculator.deals.length) {
        state.calculator = await api("/api/calculator", {
          method: "POST",
          body: JSON.stringify({
            dealId: state.dashboard.calculator.deals[0].id,
            salePrice: state.dashboard.calculator.deals[0].salePrice,
            holdMonths: state.dashboard.calculator.deals[0].holdMonths,
            prefRate: state.dashboard.calculator.deals[0].prefRate
          })
        });
      }
    } else {
      state.dashboard = null;
      state.calculator = null;
    }
  } catch (error) {
    state.loginError = error.message;
    state.session = null;
    state.dashboard = null;
    state.calculator = null;
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
      await loadSession();
    } catch (error) {
      state.loading = false;
      state.loginError = error.message;
      render();
    }
  }

  if (event.target.id === "calculator-form") {
    event.preventDefault();
    const formData = new FormData(event.target);
    state.calculator = await api("/api/calculator", {
      method: "POST",
      body: JSON.stringify({
        dealId: formData.get("dealId"),
        salePrice: Number(formData.get("salePrice")),
        holdMonths: Number(formData.get("holdMonths")),
        prefRate: Number(formData.get("prefRate"))
      })
    });
    render();
  }
});

document.addEventListener("click", async (event) => {
  if (event.target.id === "logout-button") {
    await api("/api/logout", { method: "POST", body: JSON.stringify({}) });
    state.session = null;
    state.dashboard = null;
    state.calculator = null;
    state.loginError = "";
    render();
  }
});

loadSession();
