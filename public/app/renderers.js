import {
  ALLOCATION_PAGE_SIZE,
  COMPANY_NAME,
  DEFAULT_MANAGER_PAGE,
  LOGIN_PAGE_TITLE,
  app,
  state
} from "./state.js?v=20260417-frontend-2";
import {
  breakdownItem,
  escapeHtml,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatPercent,
  formatRate,
  inputValue,
  metricCard,
  renderCollapsibleSection,
  renderMessage,
  renderSectionToggle,
  summaryItem,
  titleCase
} from "./helpers.js?v=20260417-frontend-2";
import {
  applyAllocationFilters,
  applyContractorFilters,
  applyDistributionReviewFilters,
  applyInvestorIssueFilters,
  applyInvestorProjectFilters,
  applyUserFilters,
  buildContractorProjectRollups,
  getAllocationFilterOptions,
  getAllocatableDeals,
  getContractorFilterOptions,
  getCreateDealDefaults,
  getDealEditorDraft,
  getDistributionReviewFilterOptions,
  getDefaultVoteCloseDate,
  getFilteredRollupDeals,
  getInvestorIssueFilterOptions,
  getInvestorProjectFilterOptions,
  getManagerEditableDeal,
  getUserFilterOptions
} from "./data.js?v=20260417-frontend-2";

function renderLogin() {
  const errorMarkup = state.loginError
    ? `<div class="error-message">${escapeHtml(state.loginError)}</div>`
    : "";
  const authMessageMarkup = renderMessage(state.authMessage);

  const loginForm = `
    <form id="login-form">
      <label>
        Email
        <input type="email" name="email" placeholder="name@example.com" autocomplete="email" required />
      </label>
      <label>
        Password
        <input type="password" name="password" placeholder="Password" autocomplete="current-password" required />
      </label>
      <button class="button-primary" type="submit">Login</button>
    </form>
    <div class="auth-links">
      <button class="text-link" type="button" data-auth-view="forgot">
        Forgot password?
      </button>
    </div>
  `;

  const forgotPasswordForm = `
    <form id="forgot-password-form">
      <label>
        Account email
        <input type="email" name="email" placeholder="name@example.com" autocomplete="email" required />
      </label>
      <button class="button-primary" type="submit">Send reset link</button>
    </form>
    <div class="auth-links">
      <button class="text-link" type="button" data-auth-view="login">
        Back to login
      </button>
    </div>
  `;

  const resetPasswordForm = `
    <form id="reset-password-form">
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
      <button class="button-primary" type="submit">Reset password</button>
    </form>
    <div class="auth-links">
      <button class="text-link" type="button" data-auth-view="login">
        Back to login
      </button>
    </div>
  `;

  const authPanels = {
    login: {
      eyebrow: "Secure access",
      title: "Log in",
      copy:
        "Access the investor, contractor, or manager portal with your assigned email and password.",
      formMarkup: loginForm
    },
    forgot: {
      eyebrow: "Password help",
      title: "Forgot password",
      copy:
        "Enter your email address and we will send you a one-time link to choose a new password.",
      formMarkup: forgotPasswordForm
    },
    reset: {
      eyebrow: "Set a new password",
      title: "Reset password",
      copy:
        "Create a new password for your portal account. This reset link can only be used once.",
      formMarkup: resetPasswordForm
    }
  };

  const activePanel = authPanels[state.authMode] ?? authPanels.login;

  return `
    <div class="shell login-shell">
      <section class="hero login-hero">
        <div class="hero-copy">
          <p class="eyebrow">${escapeHtml(COMPANY_NAME)}</p>
          <p class="hero-kicker">Investor reporting, project oversight, and governance in one secure workspace.</p>
          <h1>${escapeHtml(LOGIN_PAGE_TITLE)}</h1>
          <p>
            ${escapeHtml(COMPANY_NAME)} provides a secure portal for investors, contractor
            participants, and internal managers to review project performance, monitor capital
            positions, manage voting items, and maintain payout details without exposing the full cap table.
          </p>
          <ul class="feature-list">
            <li>Role-based access for investors, contractor participants, and managers.</li>
            <li>Per-project reporting, distributions, timeline milestones, and governance tracking.</li>
            <li>Secure profile, payout, and password-management workflows backed by Postgres.</li>
          </ul>
          <div class="login-brand-meta">
            <div class="brand-stat">
              <span class="metric-label">Portal</span>
              <strong>Investor + Manager Access</strong>
            </div>
            <div class="brand-stat">
              <span class="metric-label">Company</span>
              <strong>${escapeHtml(COMPANY_NAME)}</strong>
            </div>
          </div>
        </div>
        <aside class="login-panel">
          <p class="eyebrow">${escapeHtml(activePanel.eyebrow)}</p>
          <h2>${escapeHtml(activePanel.title)}</h2>
          <p>${escapeHtml(activePanel.copy)}</p>
          ${errorMarkup}
          ${authMessageMarkup}
          ${activePanel.formMarkup}
          <p class="login-assistance">
            Need access or account help? Contact your ${escapeHtml(COMPANY_NAME)} administrator.
          </p>
        </aside>
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
  const isManager = viewer.role === "manager";

  const summaryItems = [
    summaryItem("Portal role", titleCase(viewer.role)),
    summaryItem("User category", titleCase(viewer.category ?? viewer.role))
  ];

  if (!isManager) {
    summaryItems.push(summaryItem("Driver's license", profile.driverLicenseNumber || "Not provided"));
    summaryItems.push(summaryItem("Attached ID", profile.idCardFileName || "No file attached"));
  }

  return renderCollapsibleSection({
    sectionId: `${viewer.role}-profile`,
    title: isManager ? "Profile Details" : "Profile & Payout Details",
    copy: isManager
      ? "Update your name, contact information, and addresses here."
      : "Update your contact information and payment instructions here. Deal-level positions remain read only.",
    message: renderMessage(state.messages.profile),
    body: `
      <div class="summary-grid">
        ${summaryItems.join("")}
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
        ${
          isManager
            ? ""
            : `
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
            `
        }
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
    summaryItem(issue.isClosed ? "Approved" : "Current yes", formatPercent(issue.yesPct)),
    summaryItem("No votes", formatPercent(issue.noPct)),
    summaryItem(
      issue.isClosed ? "Assumed approvals" : "Pending",
      formatPercent(issue.isClosed ? issue.assumedYesPct : issue.pendingPct)
    ),
    summaryItem("Vote closes", issue.closesOn || "Open ended")
  ];

  if (issue.issueType === "penalty_rate_change" && issue.proposedPenaltyRate !== null) {
    metrics.push(summaryItem("Proposed penalty rate", formatRate(issue.proposedPenaltyRate)));
  }

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

  if (
    issue.issueType === "penalty_rate_change" &&
    issue.resolutionResult === "passed" &&
    issue.resolutionAppliedAt
  ) {
    metrics.push(summaryItem("Applied to project", formatDateTime(issue.resolutionAppliedAt)));
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
          <h4>Participant Vote Ledger</h4>
          <p class="section-copy">
            Track each participant’s response and vote weight for this issue.
          </p>
        </div>
      </div>
      <div class="table-wrap">
        <table class="issue-results-table">
          <thead>
            <tr>
              <th>Participant</th>
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
          <span class="read-only-tag">${escapeHtml(
            issue.issueType === "penalty_rate_change" ? "Penalty rate vote" : "General vote"
          )}</span>
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
              ? `You can change your vote until ${issue.closesOn}.`
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
  const filteredIssues = applyInvestorIssueFilters(issues);
  const filterOptions = getInvestorIssueFilterOptions(issues);

  return renderCollapsibleSection({
    sectionId: "investor-governance",
    title: "Major Issue Voting",
    copy:
      "Your approval power is weighted by your invested percentage in each deal, and you can change your vote until the close date.",
    message: renderMessage(state.messages.vote),
    body: `
      <div class="table-toolbar">
        <div class="filter-grid filter-grid-2">
          <label>
            Project
            <select id="investor-issue-filter-deal">
              <option value="">All projects</option>
              ${filterOptions.deals
                .map(
                  (deal) => `
                    <option value="${escapeHtml(deal.id)}" ${
                      deal.id === state.investorIssueFilters.dealId ? "selected" : ""
                    }>
                      ${escapeHtml(deal.name)}
                    </option>
                  `
                )
                .join("")}
            </select>
          </label>
          <label>
            Vote status
            <select id="investor-issue-filter-status">
              <option value="">All voting statuses</option>
              ${filterOptions.statuses
                .map(
                  (status) => `
                    <option value="${escapeHtml(status)}" ${
                      status === state.investorIssueFilters.status ? "selected" : ""
                    }>
                      ${escapeHtml(titleCase(status))}
                    </option>
                  `
                )
                .join("")}
            </select>
          </label>
        </div>
        <span class="read-only-tag">
          Showing ${escapeHtml(String(filteredIssues.length))} of ${escapeHtml(String(issues.length))}
        </span>
      </div>
      <div class="issue-grid">
        ${
          filteredIssues.length
            ? filteredIssues.map((issue) => renderInvestorIssueCard(issue)).join("")
            : issues.length
              ? '<div class="empty-state">No voting issues match the current project and status filters.</div>'
              : '<div class="empty-state">No voting items are tied to your eligible investor positions.</div>'
        }
      </div>
    `
  });
}

function resourceTypeLabel(resourceType) {
  const labels = {
    bylaw_document: "Bylaw document",
    announcement: "Announcement",
    project_balance_sheet: "Project balance sheet"
  };

  return labels[resourceType] ?? "Resource";
}

function renderCompanyResourceCard(resource, { showAdminActions = false } = {}) {
  const downloadHref = resource.hasFile
    ? `/api/resources/${encodeURIComponent(resource.id)}/download`
    : "";
  const downloadLabel =
    resource.resourceType === "project_balance_sheet"
      ? `Download ${resource.dealName || "balance sheet"}`
      : `Download ${resource.fileName || "file"}`;

  return `
    <article class="resource-card">
      <div class="section-head">
        <div>
          <div class="mini-head">
            <span class="class-pill">${escapeHtml(resourceTypeLabel(resource.resourceType))}</span>
            ${
              resource.dealName
                ? `<span class="read-only-tag">${escapeHtml(resource.dealName)}</span>`
                : ""
            }
            <span class="read-only-tag">${escapeHtml(formatDateTime(resource.publishedAt))}</span>
          </div>
          <h4>${escapeHtml(resource.title)}</h4>
          ${
            resource.summaryText
              ? `<p class="section-copy">${escapeHtml(resource.summaryText)}</p>`
              : ""
          }
        </div>
      </div>
      ${
        resource.bodyText
          ? `<div class="resource-body-copy">${escapeHtml(resource.bodyText)}</div>`
          : ""
      }
      <div class="button-row resource-actions">
        ${
          resource.hasFile
            ? `
              <a
                class="button-secondary button-inline resource-download-link"
                href="${escapeHtml(downloadHref)}"
                download="${escapeHtml(resource.fileName || resource.title)}"
              >
                ${escapeHtml(downloadLabel)}
              </a>
            `
            : '<span class="read-only-tag">No attachment</span>'
        }
        ${
          showAdminActions
            ? `
              <button
                class="button-danger button-inline"
                type="button"
                data-resource-action="delete"
                data-resource-id="${escapeHtml(resource.id)}"
              >
                Delete
              </button>
            `
            : ""
        }
      </div>
    </article>
  `;
}

function renderCompanyLibraryPanel({ showAdminActions = false } = {}) {
  const resources = state.dashboard.companyResources ?? [];
  const balanceSheets = resources.filter(
    (resource) => resource.resourceType === "project_balance_sheet"
  );
  const generalResources = resources.filter(
    (resource) => resource.resourceType !== "project_balance_sheet"
  );

  return renderCollapsibleSection({
    sectionId: `${state.dashboard.role}-company-library`,
    title: "Company Library",
    copy:
      "Published bylaws, announcements, and project balance sheets stay available here for review or download at any time.",
    message: showAdminActions ? renderMessage(state.messages.resource) : "",
    body: `
      <div class="metrics-grid">
        ${metricCard("Balance sheets", String(balanceSheets.length))}
        ${metricCard("Company resources", String(generalResources.length))}
        ${metricCard("Total published items", String(resources.length))}
      </div>
      <div class="resource-library-stack">
        <section class="resource-library-section">
          <div class="section-head">
            <div>
              <h4>Project Balance Sheets</h4>
              <p class="section-copy">
                Deal-specific balance sheets published for investor review and download.
              </p>
            </div>
          </div>
          <div class="resource-grid">
            ${
              balanceSheets.length
                ? balanceSheets
                    .map((resource) => renderCompanyResourceCard(resource, { showAdminActions }))
                    .join("")
                : '<div class="empty-state">No project balance sheets have been published yet.</div>'
            }
          </div>
        </section>
        <section class="resource-library-section">
          <div class="section-head">
            <div>
              <h4>Company Documents & Announcements</h4>
              <p class="section-copy">
                Governance documents and general company updates available in the portal.
              </p>
            </div>
          </div>
          <div class="resource-grid">
            ${
              generalResources.length
                ? generalResources
                    .map((resource) => renderCompanyResourceCard(resource, { showAdminActions }))
                    .join("")
                : '<div class="empty-state">No company documents or announcements have been published yet.</div>'
            }
          </div>
        </section>
      </div>
    `
  });
}

function renderCompanyLibraryAdminPanel() {
  return renderCollapsibleSection({
    sectionId: "admin-company-library",
    title: "Company Documents, Announcements & Balance Sheets",
    copy:
      "Upload company bylaws, publish announcements, and attach project balance sheets that investors can access or download from their dashboard.",
    panelClass: "admin-card",
    body: `
      <p class="eyebrow">Manager Control</p>
      <form id="resource-form">
        <div class="form-grid-2">
          <label>
            Resource type
            <select name="resourceType" required>
              <option value="bylaw_document">Bylaw document</option>
              <option value="announcement">Announcement</option>
              <option value="project_balance_sheet">Project balance sheet</option>
            </select>
          </label>
          <label>
            Title
            <input type="text" name="title" placeholder="Company bylaws" required />
          </label>
        </div>
        <label>
          Linked project
          <select name="dealId">
            <option value="">No project selected</option>
            ${(state.dashboard?.deals ?? [])
              .map(
                (deal) => `
                  <option value="${escapeHtml(deal.id)}">${escapeHtml(deal.name)}</option>
                `
              )
              .join("")}
          </select>
        </label>
        <label>
          Summary
          <textarea
            name="summaryText"
            rows="2"
            placeholder="Short headline or context investors should see in the library."
          ></textarea>
        </label>
        <label>
          Announcement body
          <textarea
            name="bodyText"
            rows="4"
            placeholder="Optional long-form announcement text shown in the dashboard."
          ></textarea>
        </label>
        <label>
          Attachment
          <input type="file" name="resourceFile" accept=".pdf,.doc,.docx,.txt,image/*" />
        </label>
        <p class="helper-copy">
          Bylaw documents require a file. Announcements can include text, an attachment, or both. Project balance sheets must include a file and be linked to a project.
        </p>
        <button class="button-primary" type="submit">Publish resource</button>
      </form>
    `
  });
}

function distributionModeLabel(mode) {
  const labels = {
    payout_all: "Cash out all proceeds",
    reinvest_all: "Reinvest all proceeds",
    split_percentage: "Split by percentage",
    split_amount: "Split by amount"
  };

  return labels[mode] ?? "No election saved";
}

function payoutMethodLabel(method) {
  const labels = {
    bank: "Bank account",
    zelle: "Zelle",
    cash_app: "Cash App",
    other: "Other instructions"
  };

  return labels[method] ?? "No payout method saved";
}

function distributionApprovalStatusLabel(status) {
  const labels = {
    none: "No election submitted",
    pending: "Pending manager approval",
    approved: "Approved"
  };

  return labels[status] ?? "Pending manager approval";
}

function earlyWithdrawalStatusLabel(status) {
  const labels = {
    none: "No request submitted",
    pending: "Pending manager approval",
    approved: "Approved",
    rejected: "Rejected"
  };

  return labels[status] ?? "Pending manager approval";
}

function renderInvestorDistributionElectionCard(project) {
  const distribution = project.personalPosition.distributionElection;

  if (!distribution || project.status !== "sold" || project.personalPosition.totalPayout <= 0) {
    return "";
  }

  const sectionId = `investor-distribution-${project.id}`;
  const collapsed = Boolean(state.collapsedSections?.[sectionId]);
  const selectedMode = distribution.electionMode ?? "payout_all";
  const approvalStatusClass =
    distribution.approvalStatus === "approved"
      ? "reviewed"
      : distribution.hasElection
        ? "pending"
        : "empty";

  return `
    <article class="distribution-review-card">
      <div class="distribution-review-head">
        <div>
          <p class="eyebrow">${escapeHtml(project.name)}</p>
          <h4>${escapeHtml(project.location)}</h4>
          <p class="deal-location">${escapeHtml(project.currentPhase)}</p>
          <div class="mini-head">
            <span class="review-status-pill ${escapeHtml(approvalStatusClass)}">${escapeHtml(
              distributionApprovalStatusLabel(distribution.approvalStatus)
            )}</span>
            <span class="class-pill">${escapeHtml(
              distributionModeLabel(distribution.electionMode)
            )}</span>
            <span class="read-only-tag">${escapeHtml(
              payoutMethodLabel(distribution.payoutMethod)
            )}</span>
          </div>
        </div>
        <div class="distribution-review-toolbar">
          <div>
            <p class="metric-label">Total exit proceeds</p>
            <p class="metric-value">${escapeHtml(
              formatCurrency(project.personalPosition.totalPayout)
            )}</p>
          </div>
          ${renderSectionToggle(sectionId)}
        </div>
      </div>
      ${
        collapsed
          ? '<div class="deal-card-collapsed-note">Election minimized. Use Maximize to reopen this distribution request.</div>'
          : `
            <div class="distribution-review-body">
              <div class="summary-grid">
                ${summaryItem("Profit returned", formatCurrency(project.personalPosition.profitEarned))}
                ${summaryItem(
                  "Requested payout",
                  formatCurrency(distribution.requestedCashPayoutAmount)
                )}
                ${summaryItem(
                  "Requested reinvestment",
                  formatCurrency(distribution.requestedReinvestedAmount)
                )}
                ${summaryItem(
                  "Approved payout",
                  formatCurrency(distribution.approvedCashPayoutAmount)
                )}
                ${summaryItem(
                  "Approved reinvestment",
                  formatCurrency(distribution.approvedReinvestedAmount)
                )}
                ${summaryItem("Actual payout received", formatCurrency(distribution.actualPayoutAmount))}
                ${summaryItem(
                  "Expected payout date",
                  distribution.payoutExpectedOn ? formatDate(distribution.payoutExpectedOn) : "Not scheduled"
                )}
                ${summaryItem("Payout method", payoutMethodLabel(distribution.payoutMethod))}
              </div>
              <div class="distribution-review-meta">
                <p><strong>Status:</strong> ${escapeHtml(
                  distributionApprovalStatusLabel(distribution.approvalStatus)
                )}</p>
                <p><strong>Current instruction:</strong> ${escapeHtml(
                  distributionModeLabel(distribution.electionMode)
                )}</p>
                <p><strong>Target project:</strong> ${escapeHtml(
                  distribution.rolloverTargetDealName || "No target selected"
                )}</p>
                <p><strong>Notes:</strong> ${escapeHtml(distribution.notes || "None provided.")}</p>
                <p><strong>Manager notes:</strong> ${escapeHtml(
                  distribution.overrideNotes || "No manager notes yet."
                )}</p>
              </div>
              ${
                distribution.canSetDistributionElection
                  ? `
                    <form class="distribution-form" data-distribution-form="true" data-deal-id="${escapeHtml(
                      project.id
                    )}">
                      <div class="form-grid-2">
                        <label>
                          Election type
                          <select name="electionMode" required>
                            <option value="payout_all" ${
                              selectedMode === "payout_all" ? "selected" : ""
                            }>Cash out all proceeds</option>
                            <option value="reinvest_all" ${
                              selectedMode === "reinvest_all" ? "selected" : ""
                            }>Reinvest all proceeds</option>
                            <option value="split_percentage" ${
                              selectedMode === "split_percentage" ? "selected" : ""
                            }>Split by percentage</option>
                            <option value="split_amount" ${
                              selectedMode === "split_amount" ? "selected" : ""
                            }>Split by fixed amount</option>
                          </select>
                        </label>
                        <label>
                          Reinvestment target
                          <select name="targetDealId">
                            <option value="">No target selected</option>
                            ${project.reinvestmentTargets
                              .map(
                                (deal) => `
                                  <option value="${escapeHtml(deal.id)}" ${
                                    deal.id === distribution.rolloverTargetDealId ? "selected" : ""
                                  }>
                                    ${escapeHtml(deal.name)}
                                  </option>
                                `
                              )
                              .join("")}
                          </select>
                        </label>
                      </div>
                      <div class="form-grid-2">
                        <label>
                          Reinvest percentage
                          <input
                            type="number"
                            name="reinvestPercent"
                            min="0"
                            max="1"
                            step="0.01"
                            value="${inputValue(distribution.reinvestPercent)}"
                            placeholder="0.50"
                          />
                        </label>
                        <label>
                          Reinvest amount
                          <input
                            type="number"
                            name="reinvestAmount"
                            min="0"
                            step="100"
                            value="${inputValue(distribution.requestedReinvestAmount)}"
                            placeholder="${escapeHtml(String(project.personalPosition.totalPayout))}"
                          />
                        </label>
                      </div>
                      <label>
                        Notes
                        <textarea
                          name="notes"
                          rows="3"
                          placeholder="Optional instructions for how to handle this exited balance."
                        >${escapeHtml(distribution.notes)}</textarea>
                      </label>
                      <p class="helper-copy">
                        Use <code>split by percentage</code> to roll a portion of the full exit proceeds, or <code>split by fixed amount</code> to set an exact reinvestment amount. Your request remains pending until the manager approves it and schedules any cash payout.
                      </p>
                      <button class="button-primary" type="submit">Submit election for approval</button>
                    </form>
                  `
                  : '<p class="helper-copy">This election has already been approved. The approved rollover and payout schedule are shown above.</p>'
              }
            </div>
          `
      }
    </article>
  `;
}

function renderInvestorEarlyWithdrawalCard(project) {
  const withdrawal = project.withdrawalRequest;

  if (!withdrawal) {
    return "";
  }

  const sectionId = `investor-withdrawal-${project.id}`;
  const collapsed = Boolean(state.collapsedSections?.[sectionId]);
  const statusClass =
    withdrawal.requestStatus === "approved"
      ? "reviewed"
      : withdrawal.requestStatus === "rejected"
        ? "rejected"
        : withdrawal.hasRequest
          ? "pending"
          : "empty";

  return `
    <article class="distribution-review-card">
      <div class="distribution-review-head">
        <div>
          <p class="eyebrow">${escapeHtml(project.name)}</p>
          <h4>${escapeHtml(project.location)}</h4>
          <p class="deal-location">${escapeHtml(project.currentPhase)}</p>
          <div class="mini-head">
            <span class="review-status-pill ${escapeHtml(statusClass)}">${escapeHtml(
              earlyWithdrawalStatusLabel(withdrawal.requestStatus)
            )}</span>
            <span class="class-pill">${escapeHtml(withdrawal.classType || "Investor position")}</span>
            <span class="read-only-tag">${escapeHtml(
              payoutMethodLabel(withdrawal.payoutMethod)
            )}</span>
          </div>
        </div>
        <div class="distribution-review-toolbar">
          <div>
            <p class="metric-label">Current invested capital</p>
            <p class="metric-value">${escapeHtml(
              formatCurrency(withdrawal.currentContributionAmount || withdrawal.requestedCapitalAmount)
            )}</p>
          </div>
          ${renderSectionToggle(sectionId)}
        </div>
      </div>
      ${
        collapsed
          ? '<div class="deal-card-collapsed-note">Request minimized. Use Maximize to reopen this withdrawal request.</div>'
          : `
            <div class="distribution-review-body">
              <div class="summary-grid">
                ${summaryItem("Withdrawal request", formatCurrency(withdrawal.requestedCapitalAmount))}
                ${summaryItem("Penalty rate", formatRate(withdrawal.penaltyRate))}
                ${summaryItem("Forfeited capital", formatCurrency(withdrawal.penaltyAmount))}
                ${summaryItem("Estimated payout", formatCurrency(withdrawal.estimatedPayoutAmount))}
                ${summaryItem("Approved payout", formatCurrency(withdrawal.approvedPayoutAmount))}
                ${summaryItem(
                  "Expected payout date",
                  withdrawal.payoutExpectedOn ? formatDate(withdrawal.payoutExpectedOn) : "Not scheduled"
                )}
              </div>
              <div class="distribution-review-meta">
                <p><strong>Status:</strong> ${escapeHtml(
                  earlyWithdrawalStatusLabel(withdrawal.requestStatus)
                )}</p>
                <p><strong>Investment window closes:</strong> ${escapeHtml(
                  project.investmentCloseOn ? formatDate(project.investmentCloseOn) : "Not set"
                )}</p>
                <p><strong>Investor notes:</strong> ${escapeHtml(
                  withdrawal.investorNotes || "None provided."
                )}</p>
                <p><strong>Manager notes:</strong> ${escapeHtml(
                  withdrawal.managerNotes || "No manager notes yet."
                )}</p>
              </div>
              ${
                withdrawal.canRequest
                  ? `
                    <form class="distribution-form" data-withdrawal-form="true" data-deal-id="${escapeHtml(
                      project.id
                    )}">
                      <label>
                        Notes for the manager
                        <textarea
                          name="investorNotes"
                          rows="3"
                          placeholder="Share any context for why you need to withdraw before project completion."
                        >${escapeHtml(withdrawal.investorNotes)}</textarea>
                      </label>
                      <p class="helper-copy">
                        Company policy on this project returns ${escapeHtml(
                          formatRate(1 - project.earlyWithdrawalPenaltyRate)
                        )} of your invested capital and forfeits ${escapeHtml(
                          formatRate(project.earlyWithdrawalPenaltyRate)
                        )}. Your request stays pending until the manager approves or rejects it.
                      </p>
                      <button class="button-primary" type="submit">Submit withdrawal request</button>
                    </form>
                  `
                  : '<p class="helper-copy">This request has been reviewed. The final payout status and manager notes are shown above.</p>'
              }
            </div>
          `
      }
    </article>
  `;
}

function renderManagerDistributionReviewCard(review) {
  const sectionId = `manager-distribution-review-${review.dealId}-${review.participantId}`;
  const collapsed = Boolean(state.collapsedSections?.[sectionId]);
  const selectedMode = review.electionMode ?? "payout_all";
  const submissionSummary = review.submittedByRole
    ? `${titleCase(review.submittedByRole)}${review.submittedByName ? ` · ${review.submittedByName}` : ""}`
    : "No election submitted";
  const reviewSummary = review.reviewedAt
    ? `${review.reviewedByName ?? "Manager"} · ${formatDateTime(review.reviewedAt)}`
    : "Not reviewed";
  const statusClass = review.needsReview
    ? "pending"
    : review.managerOverride
      ? "override"
      : "reviewed";

  return `
    <article class="distribution-review-card">
      <div class="distribution-review-head">
        <div>
          <p class="eyebrow">${escapeHtml(review.dealName)}</p>
          <h4>${escapeHtml(review.participantName)}</h4>
          <p class="deal-location">${escapeHtml(review.participantEmail || "No linked portal email")}</p>
          <div class="mini-head">
            <span class="review-status-pill ${escapeHtml(statusClass)}">${escapeHtml(
              review.reviewStatus
            )}</span>
            <span class="class-pill">${escapeHtml(
              review.electionMode ? distributionModeLabel(review.electionMode) : "No election saved"
            )}</span>
            <span class="read-only-tag">${escapeHtml(
              payoutMethodLabel(review.payoutMethod)
            )}</span>
          </div>
        </div>
        <div class="distribution-review-toolbar">
          <div>
            <p class="metric-label">Total exit proceeds</p>
            <p class="metric-value">${escapeHtml(formatCurrency(review.totalPayout))}</p>
          </div>
          ${renderSectionToggle(sectionId)}
        </div>
      </div>
      ${
        collapsed
          ? '<div class="deal-card-collapsed-note">Review minimized. Use Maximize to reopen this election.</div>'
          : `
            <div class="distribution-review-body">
              <div class="summary-grid">
                ${summaryItem("Capital returned", formatCurrency(review.capitalReturned))}
                ${summaryItem("Profit returned", formatCurrency(review.profitReturned))}
                ${summaryItem(
                  "Requested payout",
                  formatCurrency(review.requestedCashPayoutAmount)
                )}
                ${summaryItem(
                  "Requested reinvestment",
                  formatCurrency(review.requestedReinvestedAmount)
                )}
                ${summaryItem("Approved payout", formatCurrency(review.approvedCashPayoutAmount))}
                ${summaryItem(
                  "Approved reinvestment",
                  formatCurrency(review.approvedReinvestedAmount)
                )}
                ${summaryItem("Actual payout recorded", formatCurrency(review.actualPayoutAmount))}
                ${summaryItem(
                  "Rollover target",
                  review.rolloverTargetDealName || "No target selected"
                )}
              </div>
              <div class="distribution-review-meta">
                <p><strong>Submitted:</strong> ${escapeHtml(submissionSummary)}</p>
                <p><strong>Last updated:</strong> ${escapeHtml(formatDateTime(review.updatedAt))}</p>
                <p><strong>Approved:</strong> ${escapeHtml(reviewSummary)}</p>
                <p><strong>Approval status:</strong> ${escapeHtml(
                  distributionApprovalStatusLabel(review.approvalStatus)
                )}</p>
                <p><strong>Expected payout date:</strong> ${escapeHtml(
                  review.payoutExpectedOn ? formatDate(review.payoutExpectedOn) : "Not scheduled"
                )}</p>
                <p><strong>Investor notes:</strong> ${escapeHtml(review.notes || "None provided.")}</p>
                <p><strong>Manager notes:</strong> ${escapeHtml(review.overrideNotes || "None recorded.")}</p>
              </div>
              ${
                review.canApprove
                  ? `
                    <form
                      class="distribution-form"
                      data-manager-distribution-form="true"
                      data-deal-id="${escapeHtml(review.dealId)}"
                      data-participant-id="${escapeHtml(review.participantId)}"
                    >
                      <div class="form-grid-2">
                        <label>
                          Election type
                          <select name="electionMode" required>
                            <option value="payout_all" ${
                              selectedMode === "payout_all" ? "selected" : ""
                            }>Cash out all proceeds</option>
                            <option value="reinvest_all" ${
                              selectedMode === "reinvest_all" ? "selected" : ""
                            }>Reinvest all proceeds</option>
                            <option value="split_percentage" ${
                              selectedMode === "split_percentage" ? "selected" : ""
                            }>Split by percentage</option>
                            <option value="split_amount" ${
                              selectedMode === "split_amount" ? "selected" : ""
                            }>Split by fixed amount</option>
                          </select>
                        </label>
                        <label>
                          Reinvestment target
                          <select name="targetDealId">
                            <option value="">No target selected</option>
                            ${review.reinvestmentTargets
                              .map(
                                (deal) => `
                                  <option value="${escapeHtml(deal.id)}" ${
                                    deal.id === review.rolloverTargetDealId ? "selected" : ""
                                  }>
                                    ${escapeHtml(deal.name)}
                                  </option>
                                `
                              )
                              .join("")}
                          </select>
                        </label>
                      </div>
                      <div class="form-grid-2">
                        <label>
                          Reinvest percentage
                          <input
                            type="number"
                            name="reinvestPercent"
                            min="0"
                            max="1"
                            step="0.01"
                            value="${inputValue(review.reinvestPercent)}"
                            placeholder="0.50"
                          />
                        </label>
                        <label>
                          Reinvest amount
                          <input
                            type="number"
                            name="reinvestAmount"
                            min="0"
                            step="100"
                            value="${inputValue(review.requestedReinvestAmount)}"
                            placeholder="${escapeHtml(String(review.totalPayout))}"
                          />
                        </label>
                      </div>
                      <div class="form-grid-2">
                        <label>
                          Expected payout date
                          <input
                            type="date"
                            name="payoutExpectedOn"
                            value="${inputValue(review.payoutExpectedOn)}"
                          />
                        </label>
                        <label>
                          Distribution notes
                          <textarea
                            name="notes"
                            rows="3"
                            placeholder="Investor or manager notes about how this sold balance should be handled."
                          >${escapeHtml(review.notes)}</textarea>
                        </label>
                      </div>
                      <label>
                        Manager approval or override notes
                        <textarea
                          name="overrideNotes"
                          rows="3"
                          placeholder="Document the approval decision, any override reason, and payout timing context."
                        >${escapeHtml(review.overrideNotes)}</textarea>
                      </label>
                      <p class="helper-copy">
                        Approval applies the reinvestment to the selected target project immediately.
                        Any cash portion is scheduled using the expected payout date and the investor
                        receives an approval email with that timestamp.
                      </p>
                      <button class="button-primary" type="submit">Approve election</button>
                    </form>
                  `
                  : '<p class="helper-copy">This distribution plan has already been approved and applied. No further manager action is required in this queue.</p>'
              }
            </div>
          `
      }
    </article>
  `;
}

function renderManagerEarlyWithdrawalReviewCard(review) {
  const sectionId = `manager-withdrawal-review-${review.dealId}-${review.participantId}`;
  const collapsed = Boolean(state.collapsedSections?.[sectionId]);
  const submissionSummary = review.submittedByName ? review.submittedByName : "Investor";
  const reviewSummary = review.reviewedAt
    ? `${review.reviewedByName ?? "Manager"} · ${formatDateTime(review.reviewedAt)}`
    : "Not reviewed";
  const statusClass =
    review.requestStatus === "approved"
      ? "reviewed"
      : review.requestStatus === "rejected"
        ? "rejected"
        : "pending";

  return `
    <article class="distribution-review-card">
      <div class="distribution-review-head">
        <div>
          <p class="eyebrow">${escapeHtml(review.dealName)}</p>
          <h4>${escapeHtml(review.participantName)}</h4>
          <p class="deal-location">${escapeHtml(review.participantEmail || "No linked portal email")}</p>
          <div class="mini-head">
            <span class="review-status-pill ${escapeHtml(statusClass)}">${escapeHtml(
              earlyWithdrawalStatusLabel(review.requestStatus)
            )}</span>
            <span class="class-pill">${escapeHtml(review.classType || "Investor position")}</span>
            <span class="read-only-tag">${escapeHtml(
              payoutMethodLabel(review.payoutMethod)
            )}</span>
          </div>
        </div>
        <div class="distribution-review-toolbar">
          <div>
            <p class="metric-label">Requested capital</p>
            <p class="metric-value">${escapeHtml(formatCurrency(review.requestedCapitalAmount))}</p>
          </div>
          ${renderSectionToggle(sectionId)}
        </div>
      </div>
      ${
        collapsed
          ? '<div class="deal-card-collapsed-note">Review minimized. Use Maximize to reopen this withdrawal request.</div>'
          : `
            <div class="distribution-review-body">
              <div class="summary-grid">
                ${summaryItem("Current capital still in deal", formatCurrency(review.currentContributionAmount))}
                ${summaryItem("Penalty rate", formatRate(review.penaltyRate))}
                ${summaryItem("Forfeited capital", formatCurrency(review.penaltyAmount))}
                ${summaryItem("Estimated payout", formatCurrency(review.estimatedPayoutAmount))}
                ${summaryItem("Approved payout", formatCurrency(review.approvedPayoutAmount))}
                ${summaryItem(
                  "Expected payout date",
                  review.payoutExpectedOn ? formatDate(review.payoutExpectedOn) : "Not scheduled"
                )}
              </div>
              <div class="distribution-review-meta">
                <p><strong>Submitted by:</strong> ${escapeHtml(submissionSummary)}</p>
                <p><strong>Last updated:</strong> ${escapeHtml(formatDateTime(review.updatedAt))}</p>
                <p><strong>Reviewed by:</strong> ${escapeHtml(reviewSummary)}</p>
                <p><strong>Status:</strong> ${escapeHtml(
                  earlyWithdrawalStatusLabel(review.requestStatus)
                )}</p>
                <p><strong>Participant notes:</strong> ${escapeHtml(
                  review.investorNotes || "None provided."
                )}</p>
                <p><strong>Manager notes:</strong> ${escapeHtml(
                  review.managerNotes || "None recorded."
                )}</p>
              </div>
              ${
                review.canReview
                  ? `
                    <form
                      class="distribution-form"
                      data-manager-withdrawal-form="true"
                      data-deal-id="${escapeHtml(review.dealId)}"
                      data-participant-id="${escapeHtml(review.participantId)}"
                    >
                      <div class="form-grid-2">
                        <label>
                          Expected payout date
                          <input
                            type="date"
                            name="payoutExpectedOn"
                            value="${inputValue(review.payoutExpectedOn)}"
                          />
                        </label>
                        <label>
                          Manager notes
                          <textarea
                            name="managerNotes"
                            rows="3"
                            placeholder="Document approval timing or the reason for rejection."
                          >${escapeHtml(review.managerNotes)}</textarea>
                        </label>
                      </div>
                      <p class="helper-copy">
                        Approval removes the investor’s active capital from the deal immediately and schedules the net payout after the policy penalty.
                      </p>
                      <div class="button-row">
                        <button class="button-primary" type="submit" name="decision" value="approve">
                          Approve request
                        </button>
                        <button class="button-secondary" type="submit" name="decision" value="reject">
                          Reject request
                        </button>
                      </div>
                    </form>
                  `
                  : '<p class="helper-copy">This withdrawal request has already been reviewed. No further manager action is required in this queue.</p>'
              }
            </div>
          `
      }
    </article>
  `;
}

function renderDistributionReviewSection() {
  const reviews = state.dashboard.admin.distributionReviews ?? [];
  const withdrawalReviews = state.dashboard.admin.earlyWithdrawalReviews ?? [];
  const filterOptions = getDistributionReviewFilterOptions([...reviews, ...withdrawalReviews]);
  const filteredReviews = applyDistributionReviewFilters(reviews);
  const filteredWithdrawalReviews = applyDistributionReviewFilters(withdrawalReviews);
  const pendingReviewCount = filteredReviews.filter((review) => review.needsReview).length;
  const overrideCount = filteredReviews.filter((review) => review.managerOverride).length;
  const backfillCount = filteredReviews.filter((review) => !review.electionMode).length;
  const trackedCashPayout = filteredReviews.reduce(
    (sum, review) => sum + (review.actualPayoutAmount ?? 0),
    0
  );
  const pendingWithdrawalCount = filteredWithdrawalReviews.filter((review) => review.needsReview).length;
  const approvedWithdrawalCount = filteredWithdrawalReviews.filter(
    (review) => review.requestStatus === "approved"
  ).length;
  const rejectedWithdrawalCount = filteredWithdrawalReviews.filter(
    (review) => review.requestStatus === "rejected"
  ).length;
  const scheduledWithdrawalPayout = filteredWithdrawalReviews.reduce(
    (sum, review) => sum + (review.approvedPayoutAmount ?? 0),
    0
  );

  return renderCollapsibleSection({
    sectionId: "manager-distribution-reviews",
    title: "Distribution Elections Review",
    copy:
      "Review sold-project distribution elections and active-project early withdrawal requests from one manager queue.",
    message: renderMessage(state.messages.distribution),
    body: `
      <div class="table-toolbar">
        <div class="filter-grid filter-grid-2">
          <label>
            Project
            <select id="distribution-review-filter-deal">
              <option value="">All projects</option>
              ${filterOptions.deals
                .map(
                  (deal) => `
                    <option value="${escapeHtml(deal.id)}" ${
                      deal.id === state.distributionReviewFilters.dealId ? "selected" : ""
                    }>
                      ${escapeHtml(deal.name)}
                    </option>
                  `
                )
                .join("")}
            </select>
          </label>
          <label>
            Investor
            <select id="distribution-review-filter-participant">
              <option value="">All participants</option>
              ${filterOptions.participants
                .map(
                  (participant) => `
                    <option value="${escapeHtml(participant.id)}" ${
                      participant.id === state.distributionReviewFilters.participantId
                        ? "selected"
                        : ""
                    }>
                      ${escapeHtml(participant.name)}
                    </option>
                  `
                )
                .join("")}
            </select>
          </label>
        </div>
        <span class="read-only-tag">
          Showing ${escapeHtml(
            String(filteredReviews.length + filteredWithdrawalReviews.length)
          )} of ${escapeHtml(String(reviews.length + withdrawalReviews.length))}
        </span>
      </div>
      <div class="review-subsection">
        <div class="section-head section-head-tight">
          <div>
            <p class="eyebrow">Sold Projects</p>
            <h3>Distribution Elections</h3>
            <p class="section-copy">
              Approve rollover elections, confirm cash payouts, and review any manager overrides.
            </p>
          </div>
        </div>
        <div class="metrics-grid">
          ${metricCard("Pending approvals", String(pendingReviewCount))}
          ${metricCard("Manager overrides", String(overrideCount))}
          ${metricCard("Backfill needed", String(backfillCount))}
          ${metricCard("Tracked cash payouts", formatCurrency(trackedCashPayout))}
        </div>
        <div class="distribution-review-list">
          ${
            filteredReviews.length
              ? filteredReviews.map((review) => renderManagerDistributionReviewCard(review)).join("")
              : '<div class="empty-state">No distribution reviews match the current investor and project filters.</div>'
          }
        </div>
      </div>
      <div class="review-subsection">
        <div class="section-head section-head-tight">
          <div>
            <p class="eyebrow">Active Projects</p>
            <h3>Early Withdrawal Requests</h3>
            <p class="section-copy">
              Review investor back-out requests, apply the project penalty, and schedule or reject payouts.
            </p>
          </div>
        </div>
        ${renderMessage(state.messages.withdrawal)}
        <div class="metrics-grid">
          ${metricCard("Pending requests", String(pendingWithdrawalCount))}
          ${metricCard("Approved requests", String(approvedWithdrawalCount))}
          ${metricCard("Rejected requests", String(rejectedWithdrawalCount))}
          ${metricCard("Scheduled withdrawal payouts", formatCurrency(scheduledWithdrawalPayout))}
        </div>
        <div class="distribution-review-list">
          ${
            filteredWithdrawalReviews.length
              ? filteredWithdrawalReviews
                  .map((review) => renderManagerEarlyWithdrawalReviewCard(review))
                  .join("")
              : '<div class="empty-state">No early withdrawal requests match the current investor and project filters.</div>'
          }
        </div>
      </div>
    `
  });
}

function renderInvestorProject(project) {
  const sectionId = `investor-project-${project.id}`;
  const collapsed = Boolean(state.collapsedSections?.[sectionId]);

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
            ${breakdownItem(
              "Total exit proceeds",
              formatCurrency(project.personalPosition.totalPayout)
            )}
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
            ${summaryItem("Tax expense", formatCurrency(project.projectSummary.taxExpense))}
            ${summaryItem("Loan interest rate", formatRate(project.projectSummary.debtInterestRate))}
            ${summaryItem(
              "Interest paid",
              formatCurrency(project.projectSummary.totalInterestPaid)
            )}
            ${summaryItem(
              "Early withdrawal penalty",
              formatRate(project.earlyWithdrawalPenaltyRate)
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
  const { viewer, portfolio, projects, withdrawalRequests = [] } = state.dashboard;
  const filteredProjects = applyInvestorProjectFilters(projects);
  const projectFilterOptions = getInvestorProjectFilterOptions(projects);
  const distributionProjects = projects.filter(
    (project) => project.status === "sold" && project.personalPosition.totalPayout > 0
  );

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
      ${renderCompanyLibraryPanel()}

      ${renderCollapsibleSection({
        sectionId: "investor-portfolio",
        title: "Personal Portfolio View",
        copy:
          "Totals across all deals tied to your login. Total returned reflects profit only, while total amount payout reflects cash actually pulled out.",
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

      ${renderCollapsibleSection({
        sectionId: "investor-distribution-elections",
        title: "Reinvestment or Payout Elections",
        copy:
          "Sold-project proceeds are requested here and stay pending until the manager approves the rollover and schedules any cash payout.",
        message: renderMessage(state.messages.distribution),
        body: `
          <div class="distribution-review-list">
            ${
              distributionProjects.length
                ? distributionProjects
                    .map((project) => renderInvestorDistributionElectionCard(project))
                    .join("")
                : '<div class="empty-state">No sold projects currently require a reinvestment or payout election.</div>'
            }
          </div>
        `
      })}

      ${renderCollapsibleSection({
        sectionId: "investor-early-withdrawals",
        title: "Early Withdrawal Requests",
        copy:
          "If you need to exit an active project before completion, submit the request here. The manager must approve or reject it, and any approved payout is reduced by the project penalty policy.",
        message: renderMessage(state.messages.withdrawal),
        body: `
          <div class="distribution-review-list">
            ${
              withdrawalRequests.length
                ? withdrawalRequests
                    .map((project) => renderInvestorEarlyWithdrawalCard(project))
                    .join("")
                : '<div class="empty-state">No active participant positions currently qualify for an early withdrawal request.</div>'
            }
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
          <div class="table-toolbar">
            <div class="filter-grid filter-grid-2">
              <label>
                Project
                <select id="investor-project-filter-deal">
                  <option value="">All projects</option>
                  ${projectFilterOptions.deals
                    .map(
                      (deal) => `
                        <option value="${escapeHtml(deal.id)}" ${
                          deal.id === state.investorProjectFilters.dealId ? "selected" : ""
                        }>
                          ${escapeHtml(deal.name)}
                        </option>
                      `
                    )
                    .join("")}
                </select>
              </label>
              <label>
                Project status
                <select id="investor-project-filter-status">
                  <option value="">All statuses</option>
                  ${projectFilterOptions.statuses
                    .map(
                      (status) => `
                        <option value="${escapeHtml(status)}" ${
                          status === state.investorProjectFilters.status ? "selected" : ""
                        }>
                          ${escapeHtml(titleCase(status))}
                        </option>
                      `
                    )
                    .join("")}
                </select>
              </label>
            </div>
            <span class="read-only-tag">
              Showing ${escapeHtml(String(filteredProjects.length))} of ${escapeHtml(String(projects.length))}
            </span>
          </div>
          <div class="deal-grid">
            ${
              filteredProjects.length
                ? filteredProjects.map((project) => renderInvestorProject(project)).join("")
                : projects.length
                  ? '<div class="empty-state">No project breakdowns match the current project and status filters.</div>'
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
  const collapsed = Boolean(state.collapsedSections?.[sectionId]);

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
          ${summaryItem("Tax expense", formatCurrency(deal.taxExpense))}
          ${summaryItem("Loan rate", formatRate(deal.debtInterestRate))}
          ${summaryItem("Interest paid", formatCurrency(deal.totalInterestPaid))}
          ${summaryItem(
            "Early withdrawal penalty",
            formatRate(deal.earlyWithdrawalPenaltyRate)
          )}
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
      prefRate: 0,
      taxExpense: 0
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
            <label>
              Tax expense
              <input
                type="number"
                min="0"
                step="1000"
                name="taxExpense"
                value="${escapeHtml(String(result?.inputs.taxExpense ?? selectedPreset.taxExpense ?? 0))}"
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
                  ${metricCard("Tax expense", formatCurrency(result.outputs.taxExpense))}
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
  const deals = getAllocatableDeals(state.dashboard.deals);

  return renderCollapsibleSection({
    sectionId: "admin-add-allocation",
    title: "Add Deal Allocation",
    copy:
      "Link a participant to a deal or increase an existing position while the investment window is still open. Contractor fields are only required for contractor participants.",
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
                  <option value="${escapeHtml(deal.id)}">
                    ${escapeHtml(
                      deal.investmentCloseOn
                        ? `${deal.name} · closes ${formatDate(deal.investmentCloseOn)}`
                        : `${deal.name} · no close date`
                    )}
                  </option>
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
          Only projects whose investment window is still open can accept new allocations or position increases.
        </p>
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
            Tax expense
            <input
              type="number"
              name="taxExpense"
              min="0"
              step="1000"
              value="${escapeHtml(String(defaults.taxExpense))}"
              required
            />
          </label>
          <label>
            Early withdrawal penalty rate
            <input
              type="number"
              name="earlyWithdrawalPenaltyRate"
              min="0"
              max="1"
              step="0.01"
              value="${escapeHtml(String(defaults.earlyWithdrawalPenaltyRate))}"
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
            Investment close date
            <input
              type="date"
              name="investmentCloseOn"
              value="${escapeHtml(defaults.investmentCloseOn)}"
              required
            />
          </label>
        </div>
        <div class="form-grid-2">
          <label>
            Projected exit
            <input type="date" name="projectedExitOn" />
          </label>
          <label>
            Actual exit
            <input type="date" name="actualExitOn" />
          </label>
        </div>
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
          ${summaryItem(
            "Investment closes",
            deal.investmentCloseOn ? formatDate(deal.investmentCloseOn) : "No deadline"
          )}
          ${summaryItem(
            "Early withdrawal penalty",
            formatRate(draft.earlyWithdrawalPenaltyRate)
          )}
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
            Tax expense
            <input
              type="number"
              name="taxExpense"
              min="0"
              step="1000"
              value="${inputValue(draft.taxExpense)}"
              data-deal-field="taxExpense"
              required
            />
          </label>
          <label>
            Early withdrawal penalty rate
            <input
              type="number"
              name="earlyWithdrawalPenaltyRate"
              min="0"
              max="1"
              step="0.01"
              value="${inputValue(draft.earlyWithdrawalPenaltyRate)}"
              data-deal-field="earlyWithdrawalPenaltyRate"
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
            Investment close date
            <input
              type="date"
              name="investmentCloseOn"
              value="${inputValue(draft.investmentCloseOn)}"
              data-deal-field="investmentCloseOn"
              required
            />
          </label>
        </div>
        <div class="form-grid-2">
          <label>
            Projected exit
            <input
              type="date"
              name="projectedExitOn"
              value="${inputValue(draft.projectedExitOn)}"
              data-deal-field="projectedExitOn"
            />
          </label>
          <label>
            Actual exit
            <input
              type="date"
              name="actualExitOn"
              value="${inputValue(draft.actualExitOn)}"
              data-deal-field="actualExitOn"
            />
          </label>
        </div>

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
          copy:
            "Create participant votes tied to this project. Approval is weighted by invested capital, and eligible participants can update their response until voting closes.",
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
                  Issue type
                  <select name="issueType">
                    <option value="general">General issue</option>
                    <option value="penalty_rate_change">Penalty rate vote</option>
                  </select>
                </label>
              </div>
              <div class="form-grid-2">
                <label>
                  Approval threshold
                  <input type="number" name="approvalThreshold" min="0.01" max="1" step="0.01" value="0.75" />
                </label>
                <label>
                  Proposed penalty rate
                  <input
                    type="number"
                    name="proposedPenaltyRate"
                    min="0"
                    max="1"
                    step="0.01"
                    value="${inputValue(draft.earlyWithdrawalPenaltyRate)}"
                    placeholder="0.30"
                  />
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
                                <span class="read-only-tag">${escapeHtml(
                                  issue.issueType === "penalty_rate_change"
                                    ? "Penalty rate vote"
                                    : "General vote"
                                )}</span>
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

const MANAGER_PAGE_ITEMS = [
  {
    id: "overview",
    label: "Overview",
    copy: "Profile and sponsor-level portfolio snapshot."
  },
  {
    id: "project-admin",
    label: "Project Admin",
    copy: "Create deals and update project assumptions, milestones, tiers, and votes."
  },
  {
    id: "distribution-reviews",
    label: "Distribution Reviews",
    copy: "Review sold-project elections and active-project withdrawal requests."
  },
  {
    id: "company-library",
    label: "Company Library",
    copy: "Publish bylaws and announcements for investor access."
  },
  {
    id: "user-directory",
    label: "User Directory",
    copy: "Create users and manage account access."
  },
  {
    id: "allocations",
    label: "Deal Allocations",
    copy: "Create allocations and review the current participation ledger."
  },
  {
    id: "deal-rollup",
    label: "Deal Rollup",
    copy: "Review current deal forecasts, class payout totals, and promote triggers."
  },
  {
    id: "calculator",
    label: "Promote Calculator",
    copy: "Run scenario analysis on sale price, hold period, and pref assumptions."
  },
  {
    id: "contractor-tracking",
    label: "Contractor Tracking",
    copy: "Monitor deferred compensation and project-level contractor payouts."
  }
];

function getActiveManagerPage() {
  return (
    MANAGER_PAGE_ITEMS.find((item) => item.id === state.managerPage) ??
    MANAGER_PAGE_ITEMS.find((item) => item.id === DEFAULT_MANAGER_PAGE) ??
    MANAGER_PAGE_ITEMS[0]
  );
}

function renderManagerNavigation() {
  const activePage = getActiveManagerPage();

  return `
    <aside class="panel manager-nav-panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">Manager Portal</p>
          <h3>Navigation</h3>
          <p class="section-copy">
            Open one work area at a time instead of keeping the full manager stack on screen.
          </p>
        </div>
      </div>
      <div class="manager-nav-list" role="tablist" aria-label="Manager pages">
        ${MANAGER_PAGE_ITEMS.map(
          (item) => `
            <button
              class="manager-nav-button ${item.id === activePage.id ? "active" : ""}"
              type="button"
              data-manager-page="${escapeHtml(item.id)}"
              role="tab"
              aria-selected="${item.id === activePage.id ? "true" : "false"}"
            >
              <span class="manager-nav-label">${escapeHtml(item.label)}</span>
              <span class="manager-nav-copy">${escapeHtml(item.copy)}</span>
            </button>
          `
        ).join("")}
      </div>
    </aside>
  `;
}

function renderManagerPageIntro(page) {
  return `
    <section class="panel manager-page-intro">
      <p class="eyebrow">Workspace</p>
      <h3>${escapeHtml(page.label)}</h3>
      <p class="section-copy">${escapeHtml(page.copy)}</p>
    </section>
  `;
}

function renderManagerOverviewPage(overview) {
  return `
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
  `;
}

function renderManagerProjectAdminPage() {
  return `
    <div class="admin-grid">
      ${renderCreateDealPanel()}
      ${renderDealEditorPanel()}
    </div>
  `;
}

function renderManagerCompanyLibraryPage() {
  return `
    <div class="admin-grid">
      ${renderCompanyLibraryAdminPanel()}
    </div>
    ${renderCompanyLibraryPanel({ showAdminActions: true })}
  `;
}

function renderManagerUserDirectoryPage() {
  return `
    <div class="admin-grid">
      ${renderCreateUserPanel()}
    </div>
    ${renderUserDirectory()}
  `;
}

function renderManagerAllocationsPage() {
  return `
    <div class="admin-grid">
      ${renderAllocationPanel()}
    </div>
    ${renderAllocationTable()}
  `;
}

function renderManagerDealRollupPage(deals) {
  const rollupDeals = getFilteredRollupDeals();

  return renderCollapsibleSection({
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
  });
}

function renderManagerPageContent(page, { overview, deals }) {
  switch (page.id) {
    case "overview":
      return renderManagerOverviewPage(overview);
    case "project-admin":
      return renderManagerProjectAdminPage();
    case "distribution-reviews":
      return renderDistributionReviewSection();
    case "company-library":
      return renderManagerCompanyLibraryPage();
    case "user-directory":
      return renderManagerUserDirectoryPage();
    case "allocations":
      return renderManagerAllocationsPage();
    case "deal-rollup":
      return renderManagerDealRollupPage(deals);
    case "calculator":
      return renderCalculator();
    case "contractor-tracking":
      return renderContractorTable();
    default:
      return renderManagerOverviewPage(overview);
  }
}

function renderManagerDashboard() {
  const { viewer, overview, deals } = state.dashboard;
  const activePage = getActiveManagerPage();

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

      <div class="manager-layout">
        ${renderManagerNavigation()}
        <div class="manager-page-column">
          ${renderManagerPageIntro(activePage)}
          ${renderManagerPageContent(activePage, { overview, deals })}
        </div>
      </div>
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

export function render() {
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
