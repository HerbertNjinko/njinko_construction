import { state } from "./state.js?v=20260501-frontend-10";
import {
  clearAuthFeedback,
  clearMessages,
  clearPasswordResetTokenFromLocation,
  escapeHtml,
  formatCurrency,
  formatDateTime,
  formatNotificationBatchSummary,
  formatNotificationStatus,
  readFileAsPayload,
  setAuthMessage,
  setAuthMode,
  setMessage,
  titleCase,
  toggleSectionCollapsed
} from "./helpers.js?v=20260501-frontend-10";
import {
  applyArchivedProjectFilters,
  applyQuestionnaireFilters,
  buildCreateDealDraft,
  createDebtServiceDraft,
  createExpenseDraft,
  createTierDraft,
  createTimelineDraft,
  getDealById,
  getCreateDealDraft,
  getDealEditorDraft,
  syncCreateDealField,
  syncDealEditorField,
  updateCreateDealDraft,
  updateDealEditorDraft
} from "./data.js?v=20260501-frontend-10";
import {
  api,
  applyLoggedOutState,
  loadCalculator,
  loadSession,
  recordSessionActivity,
  refreshDashboard
} from "./session.js?v=20260501-frontend-10";
import { render } from "./renderers.js?v=20260501-frontend-10";

let listenersBound = false;

function handleSessionActivity(event) {
  if (!state.session) {
    return;
  }

  const force = !["mousemove", "scroll"].includes(event.type);
  recordSessionActivity(force);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function syncEnrollmentAmountSelection(selectElement, amountFieldName) {
  const form = selectElement.form;
  const selectedOption = selectElement.selectedOptions?.[0];
  const hint = form?.querySelector("[data-enrollment-amount-hint='true']");
  const amountInput = form?.elements?.[amountFieldName];
  const suggestedAmount = Number(selectedOption?.dataset?.suggestedAmount ?? 0);
  const enrollmentLabel = String(selectedOption?.dataset?.enrollmentLabel ?? "").trim();

  if (hint) {
    hint.textContent = enrollmentLabel || "No enrollment amount recorded";
  }

  if (!amountInput) {
    return;
  }

  amountInput.value = suggestedAmount > 0 ? String(suggestedAmount) : "";
}

function buildArchivedProjectsCsv(archivedProjects = []) {
  const rows = [
    [
      "Project",
      "Archived at",
      "Archived by",
      "Sale price",
      "Total project cost",
      "Tracked equity",
      "Total debt",
      "Net project profit",
      "Sponsor promote",
      "Investor",
      "Class",
      "Total invested",
      "Total returned",
      "Cash payout",
      "Reinvested amount",
      "Rollover target",
      "Election status"
    ]
  ];

  for (const project of archivedProjects) {
    const investorRows = project.investorRows?.length ? project.investorRows : [{}];

    for (const investor of investorRows) {
      rows.push([
        project.name,
        project.archivedAt,
        project.archivedByName || project.archivedByEmail,
        project.salePrice,
        project.totalProjectCost,
        project.totalEquity,
        project.totalDebt,
        project.netProjectProfit,
        project.sponsorPromote,
        investor.participantName,
        investor.classType,
        investor.totalInvested,
        investor.totalReturned,
        investor.totalAmountPayout,
        investor.reinvestedAmount,
        investor.rolloverTargetDealName,
        investor.electionStatus
      ]);
    }
  }

  return rows.map((row) => row.map((cell) => csvCell(cell)).join(",")).join("\n");
}

function questionnaireCheckLabel(value) {
  return value ? "Checked" : "Not checked";
}

function buildInvestorQuestionnairesText(questionnaires = []) {
  return questionnaires
    .map(
      (questionnaire, index) => `PART II - INVESTOR QUESTIONNAIRE ${index + 1}

User: ${questionnaire.userName ?? ""}
Category: ${titleCase(questionnaire.category ?? "")}
Submitted: ${formatDateTime(questionnaire.submittedAt)}

PERSONAL / ENTITY INFORMATION
Name / Entity: ${questionnaire.nameEntity ?? ""}
Address: ${questionnaire.address ?? ""}
Email: ${questionnaire.email ?? ""}
Phone: ${questionnaire.phone ?? ""}

ACCREDITATION CHECK
Income over $200,000 ($300,000 with spouse): ${questionnaireCheckLabel(questionnaire.incomeOver200k)}
Net worth over $100,000: ${questionnaireCheckLabel(questionnaire.netWorthOver100k)}
Entity with over $5,000,000 in assets: ${questionnaireCheckLabel(questionnaire.entityOver5mAssets)}

INVESTMENT EXPERIENCE
${questionnaire.investmentExperience ?? ""}
`
    )
    .join("\n----------------------------------------\n\n");
}

function buildInvestorQuestionnairesPrintHtml(questionnaires = []) {
  const generatedAt = formatDateTime(new Date().toISOString());

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Investor Questionnaires</title>
    <style>
      body {
        color: #1f1a17;
        font-family: Arial, sans-serif;
        line-height: 1.45;
        margin: 32px;
      }

      h1,
      h2,
      h3 {
        margin: 0 0 10px;
      }

      .meta {
        color: #5f554d;
        margin: 0 0 24px;
      }

      .questionnaire {
        border-top: 1px solid #d8d0c7;
        break-inside: avoid;
        margin-top: 24px;
        padding-top: 20px;
      }

      dl {
        display: grid;
        gap: 8px 16px;
        grid-template-columns: 180px 1fr;
      }

      dt {
        font-weight: 700;
      }

      dd {
        margin: 0;
        white-space: pre-wrap;
      }

      @media print {
        body {
          margin: 0.6in;
        }

        button {
          display: none;
        }
      }
    </style>
  </head>
  <body>
    <button type="button" onclick="window.print()">Print / Save PDF</button>
    <h1>Investor Questionnaires</h1>
    <p class="meta">Generated ${escapeHtml(generatedAt)} · ${escapeHtml(
      String(questionnaires.length)
    )} submission${questionnaires.length === 1 ? "" : "s"}</p>
    ${questionnaires
      .map(
        (questionnaire) => `
          <section class="questionnaire">
            <h2>${escapeHtml(questionnaire.userName ?? questionnaire.nameEntity ?? "")}</h2>
            <p class="meta">${escapeHtml(titleCase(questionnaire.category ?? ""))} · ${escapeHtml(
              questionnaire.userEmail ?? questionnaire.email ?? ""
            )} · Submitted ${escapeHtml(formatDateTime(questionnaire.submittedAt))}</p>
            <h3>Personal / Entity Information</h3>
            <dl>
              <dt>Name / Entity</dt>
              <dd>${escapeHtml(questionnaire.nameEntity ?? "")}</dd>
              <dt>Address</dt>
              <dd>${escapeHtml(questionnaire.address ?? "")}</dd>
              <dt>Email</dt>
              <dd>${escapeHtml(questionnaire.email ?? "")}</dd>
              <dt>Phone</dt>
              <dd>${escapeHtml(questionnaire.phone ?? "")}</dd>
            </dl>
            <h3>Accreditation Check</h3>
            <dl>
              <dt>Income threshold</dt>
              <dd>${escapeHtml(questionnaireCheckLabel(questionnaire.incomeOver200k))}</dd>
              <dt>Net worth threshold</dt>
              <dd>${escapeHtml(questionnaireCheckLabel(questionnaire.netWorthOver100k))}</dd>
              <dt>Entity assets threshold</dt>
              <dd>${escapeHtml(questionnaireCheckLabel(questionnaire.entityOver5mAssets))}</dd>
            </dl>
            <h3>Investment Experience</h3>
            <p>${escapeHtml(questionnaire.investmentExperience ?? "")}</p>
          </section>
        `
      )
      .join("")}
  </body>
</html>`;
}

function openInvestorQuestionnairesPdfExport(questionnaires = []) {
  const reportWindow = window.open("", "_blank");

  if (!reportWindow) {
    throw new Error("Allow popups to export the PDF report.");
  }

  reportWindow.document.open();
  reportWindow.document.write(buildInvestorQuestionnairesPrintHtml(questionnaires));
  reportWindow.document.close();
  reportWindow.focus();
  reportWindow.print();
}

function downloadTextFile(fileName, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function setupEventListeners() {
  if (listenersBound) {
    return;
  }

  listenersBound = true;

  document.addEventListener("submit", async (event) => {
    if (event.target.id === "login-form") {
      event.preventDefault();
      const formData = new FormData(event.target);
      clearAuthFeedback();
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

    if (event.target.id === "forgot-password-form") {
      event.preventDefault();
      const formData = new FormData(event.target);
      clearAuthFeedback();

      try {
        const result = await api("/api/password/forgot", {
          method: "POST",
          body: JSON.stringify({
            email: formData.get("email")
          })
        });
        setAuthMessage("success", result.message);
        render();
      } catch (error) {
        state.loginError = error.message;
        render();
      }

      return;
    }

    if (event.target.id === "reset-password-form") {
      event.preventDefault();
      const formData = new FormData(event.target);
      const newPassword = String(formData.get("newPassword") ?? "");
      const confirmPassword = String(formData.get("confirmPassword") ?? "");

      clearAuthFeedback();

      if (!state.passwordResetToken) {
        state.loginError = "This password reset link is invalid or has expired.";
        render();
        return;
      }

      if (newPassword !== confirmPassword) {
        state.loginError = "New password and confirmation do not match.";
        render();
        return;
      }

      try {
        await api("/api/password/reset", {
          method: "POST",
          body: JSON.stringify({
            token: state.passwordResetToken,
            newPassword
          })
        });
        clearPasswordResetTokenFromLocation();
        state.authMode = "login";
        setAuthMessage("success", "Password reset complete. You can now log in with your new password.");
        render();
      } catch (error) {
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

    if (event.target.id === "identity-review-form") {
      event.preventDefault();
      const formData = new FormData(event.target);

      try {
        const idCardFile = await readFileAsPayload(event.target.elements.idCard.files[0]);
        const requiredLegalDocuments = Array.isArray(state.session?.requiredLegalDocuments)
          ? state.session.requiredLegalDocuments
          : [];
        const legalAcknowledgements = await Promise.all(
          requiredLegalDocuments.map(async (document) => {
            const proofInput = event.target.elements[`legalPaymentProof:${document.key}`];
            const proofOfPaymentFile = await readFileAsPayload(proofInput?.files?.[0]);

            return {
              documentKey: document.key,
              documentVersion: document.version,
              accepted: formData.get(`legalAck:${document.key}`) === "on",
              signerName: formData.get(`legalSigner:${document.key}`),
              investmentAmount: formData.get(`legalInvestmentAmount:${document.key}`),
              deferredAmount: formData.get(`legalDeferredAmount:${document.key}`),
              proofOfPaymentFile
            };
          })
        );
        const result = await api("/api/profile/identity-review", {
          method: "POST",
          body: JSON.stringify({
            contactPhone: formData.get("contactPhone"),
            driverLicenseNumber: formData.get("driverLicenseNumber"),
            idDocumentIssueDate: formData.get("idDocumentIssueDate"),
            idDocumentExpirationDate: formData.get("idDocumentExpirationDate"),
            currentAddress: formData.get("currentAddress"),
            mailingAddress: formData.get("mailingAddress"),
            idCardFile,
            investorQuestionnaire: state.session?.requiresInvestorQuestionnaire
              ? {
                  nameEntity: formData.get("questionnaireNameEntity"),
                  address: formData.get("questionnaireAddress"),
                  email: formData.get("questionnaireEmail"),
                  phone: formData.get("questionnairePhone"),
                  incomeOver200k: formData.get("questionnaireIncomeOver200k") === "on",
                  netWorthOver100k: formData.get("questionnaireNetWorthOver100k") === "on",
                  entityOver5mAssets: formData.get("questionnaireEntityOver5mAssets") === "on",
                  investmentExperience: formData.get("questionnaireInvestmentExperience")
                }
              : null,
            legalAcknowledgements
          })
        });
        state.session = result.user;
        setMessage(
          "identity",
          "success",
          "Identity information submitted. You will receive an email after manager review."
        );
        render();
      } catch (error) {
        setMessage("identity", "error", error.message);
        render();
      }

      return;
    }

    if (event.target.id === "legal-acknowledgement-form") {
      event.preventDefault();
      const formData = new FormData(event.target);
      const pendingLegalDocuments = Array.isArray(state.session?.pendingLegalDocuments)
        ? state.session.pendingLegalDocuments
        : [];

      try {
        const result = await api("/api/profile/legal-acknowledgements", {
          method: "POST",
          body: JSON.stringify({
            legalAcknowledgements: pendingLegalDocuments.map((document) => ({
              documentKey: document.key,
              documentVersion: document.version,
              accepted: formData.get(`legalAck:${document.key}`) === "on",
              signerName: formData.get(`legalSigner:${document.key}`)
            }))
          })
        });
        state.session = result.user;
        setMessage("legal", "success", "Legal document acknowledgements submitted.");
        await loadSession();
      } catch (error) {
        setMessage("legal", "error", error.message);
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
          totalProjectCost: Number(formData.get("totalProjectCost")),
          holdMonths: Number(formData.get("holdMonths")),
          prefRate: Number(formData.get("prefRate")),
          taxExpense: Number(formData.get("taxExpense"))
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
        const result = await api("/api/admin/users", {
          method: "POST",
          body: JSON.stringify({
            firstName: formData.get("firstName"),
            middleName: formData.get("middleName"),
            lastName: formData.get("lastName"),
            email: formData.get("email"),
            password: formData.get("password"),
            category: formData.get("category")
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

    if (event.target.id === "pool-form") {
      event.preventDefault();
      const formData = new FormData(event.target);

      try {
        await api("/api/admin/pools", {
          method: "POST",
          body: JSON.stringify({
            name: formData.get("name"),
            minimumCapitalAmount: Number(formData.get("minimumCapitalAmount")),
            voteClosesOn: formData.get("voteClosesOn")
          })
        });
        await refreshDashboard();
        setMessage("pool", "success", "Pooled capital group created.");
        event.target.reset();
      } catch (error) {
        setMessage("pool", "error", error.message);
      }

      render();
      return;
    }

    if (event.target.dataset.poolCommitmentForm === "true") {
      event.preventDefault();
      const formData = new FormData(event.target);
      const poolId = String(event.target.dataset.poolId ?? "");

      if (!poolId) {
        setMessage("pool", "error", "A valid pooled capital group is required.");
        render();
        return;
      }

      try {
        const result = await api(`/api/admin/pools/${encodeURIComponent(poolId)}/commitments`, {
          method: "POST",
          body: JSON.stringify({
            participantId: formData.get("participantId"),
            commitmentAmount: Number(formData.get("commitmentAmount"))
          })
        });
        await refreshDashboard();
        setMessage(
          "pool",
          "success",
          `Pool commitment saved. ${formatNotificationStatus(result.notification)}`
        );
        event.target.reset();
      } catch (error) {
        setMessage("pool", "error", error.message);
      }

      render();
      return;
    }

    if (event.target.id === "profile-form") {
      event.preventDefault();
      const formData = new FormData(event.target);
      const payload = {
        firstName: formData.get("firstName"),
        middleName: formData.get("middleName"),
        lastName: formData.get("lastName"),
        email: formData.get("email"),
        contactPhone: formData.get("contactPhone"),
        currentAddress: formData.get("currentAddress"),
        mailingAddress: formData.get("mailingAddress")
      };

      if (state.dashboard?.role !== "manager") {
        Object.assign(payload, {
          payoutMethod: formData.get("payoutMethod"),
          bankAccountName: formData.get("bankAccountName"),
          bankName: formData.get("bankName"),
          bankRoutingNumber: formData.get("bankRoutingNumber"),
          bankAccountNumber: formData.get("bankAccountNumber"),
          zelleDetails: formData.get("zelleDetails"),
          cashAppHandle: formData.get("cashAppHandle"),
          payoutNotes: formData.get("payoutNotes")
        });
      }

      try {
        await api("/api/profile", {
          method: "PATCH",
          body: JSON.stringify(payload)
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

    if (event.target.dataset.userCategoryForm === "true") {
      event.preventDefault();
      const formData = new FormData(event.target);
      const userId = String(event.target.dataset.userId ?? "");

      if (!userId) {
        setMessage("directory", "error", "A valid user account is required.");
        render();
        return;
      }

      try {
        await api(`/api/admin/users/${encodeURIComponent(userId)}/category`, {
          method: "PATCH",
          body: JSON.stringify({
            category: formData.get("category")
          })
        });
        await refreshDashboard();
        setMessage("directory", "success", "User category updated.");
      } catch (error) {
        setMessage("directory", "error", error.message);
      }

      render();
      return;
    }

    if (event.target.dataset.poolVoteForm === "true") {
      event.preventDefault();
      const formData = new FormData(event.target);
      const poolId = String(event.target.dataset.poolId ?? "");

      if (!poolId) {
        setMessage("pool", "error", "A valid pooled capital group is required.");
        render();
        return;
      }

      try {
        const result = await api(`/api/pools/${encodeURIComponent(poolId)}/vote`, {
          method: "PUT",
          body: JSON.stringify({
            dealId: formData.get("dealId")
          })
        });
        await refreshDashboard();
        setMessage(
          "pool",
          "success",
          `Weighted project vote saved. ${formatNotificationBatchSummary(
            result.vote?.notifications ?? []
          )}`
        );
      } catch (error) {
        setMessage("pool", "error", error.message);
      }

      render();
      return;
    }

    if (event.target.id === "resource-form") {
      event.preventDefault();
      const formData = new FormData(event.target);

      try {
        const resourceFile = await readFileAsPayload(event.target.elements.resourceFile.files[0]);
        await api("/api/admin/resources", {
          method: "POST",
          body: JSON.stringify({
            title: formData.get("title"),
            dealId: formData.get("dealId"),
            resourceType: formData.get("resourceType"),
            summaryText: formData.get("summaryText"),
            bodyText: formData.get("bodyText"),
            resourceFile
          })
        });
        await refreshDashboard();
        setMessage("resource", "success", "Company resource published and available to investors.");
        event.target.reset();
      } catch (error) {
        setMessage("resource", "error", error.message);
      }

      render();
      return;
    }

    if (event.target.dataset.poolFundForm === "true") {
      event.preventDefault();
      const formData = new FormData(event.target);
      const poolId = String(event.target.dataset.poolId ?? "");

      if (!poolId) {
        setMessage("pool", "error", "A valid pooled capital group is required.");
        render();
        return;
      }

      try {
        await api(`/api/admin/pools/${encodeURIComponent(poolId)}/fund`, {
          method: "POST",
          body: JSON.stringify({
            dealId: formData.get("dealId")
          })
        });
        await refreshDashboard();
        setMessage("pool", "success", "Pooled capital group funded into the selected project.");
      } catch (error) {
        setMessage("pool", "error", error.message);
      }

      render();
      return;
    }

    if (event.target.dataset.distributionForm === "true") {
      event.preventDefault();
      const formData = new FormData(event.target);
      const dealId = String(event.target.dataset.dealId ?? "");

      if (!dealId) {
        setMessage("distribution", "error", "A valid sold project is required.");
        render();
        return;
      }

      try {
        const result = await api(`/api/deals/${encodeURIComponent(dealId)}/distribution-election`, {
          method: "PUT",
          body: JSON.stringify({
            electionMode: formData.get("electionMode"),
            reinvestPercent: formData.get("reinvestPercent"),
            reinvestAmount: formData.get("reinvestAmount"),
            targetDealId: formData.get("targetDealId"),
            notes: formData.get("notes")
          })
        });
        await refreshDashboard();
        setMessage(
          "distribution",
          "success",
          `Distribution election submitted for manager approval. ${formatNotificationBatchSummary(
            result.election?.notifications ?? []
          )} Approved payout and rollover amounts will appear after manager approval.`
        );
      } catch (error) {
        setMessage("distribution", "error", error.message);
      }

      render();
      return;
    }

    if (event.target.dataset.withdrawalForm === "true") {
      event.preventDefault();
      const formData = new FormData(event.target);
      const dealId = String(event.target.dataset.dealId ?? "");

      if (!dealId) {
        setMessage("withdrawal", "error", "A valid active project is required.");
        render();
        return;
      }

      try {
        const result = await api(`/api/deals/${encodeURIComponent(dealId)}/withdrawal-request`, {
          method: "PUT",
          body: JSON.stringify({
            investorNotes: formData.get("investorNotes")
          })
        });
        await refreshDashboard();
        setMessage(
          "withdrawal",
          "success",
          `Early withdrawal request submitted for manager approval. ${formatNotificationBatchSummary(
            result.request?.notifications ?? []
          )}`
        );
      } catch (error) {
        setMessage("withdrawal", "error", error.message);
      }

      render();
      return;
    }

    if (event.target.dataset.managerDistributionForm === "true") {
      event.preventDefault();
      const formData = new FormData(event.target);
      const dealId = String(event.target.dataset.dealId ?? "");
      const participantId = String(event.target.dataset.participantId ?? "");

      if (!dealId || !participantId) {
        setMessage(
          "distribution",
          "error",
          "A sold project and investor position are required for manager review."
        );
        render();
        return;
      }

      try {
        const result = await api(
          `/api/admin/deals/${encodeURIComponent(dealId)}/distribution-elections/${encodeURIComponent(
            participantId
          )}`,
          {
            method: "PUT",
            body: JSON.stringify({
              electionMode: formData.get("electionMode"),
              reinvestPercent: formData.get("reinvestPercent"),
              reinvestAmount: formData.get("reinvestAmount"),
              targetDealId: formData.get("targetDealId"),
              notes: formData.get("notes"),
              payoutExpectedOn: formData.get("payoutExpectedOn"),
              overrideNotes: formData.get("overrideNotes")
            })
          }
        );
        await refreshDashboard();
        setMessage(
          "distribution",
          "success",
          `Distribution election approved. ${formatNotificationBatchSummary(
            result.election?.notifications ?? []
          )}${
            result.election?.managerOverride
              ? " Manager override was applied before approval."
              : " Investor instruction was approved as submitted."
          }`
        );
      } catch (error) {
        setMessage("distribution", "error", error.message);
      }

      render();
      return;
    }

    if (event.target.dataset.managerWithdrawalForm === "true") {
      event.preventDefault();
      const formData = new FormData(event.target);
      const dealId = String(event.target.dataset.dealId ?? "");
      const participantId = String(event.target.dataset.participantId ?? "");
      const decision = String(event.submitter?.value ?? "").trim();

      if (!dealId || !participantId) {
        setMessage(
          "withdrawal",
          "error",
          "A valid project and investor are required for withdrawal review."
        );
        render();
        return;
      }

      try {
        const result = await api(
          `/api/admin/deals/${encodeURIComponent(dealId)}/withdrawal-requests/${encodeURIComponent(
            participantId
          )}`,
          {
            method: "PUT",
            body: JSON.stringify({
              decision,
              payoutExpectedOn: formData.get("payoutExpectedOn"),
              managerNotes: formData.get("managerNotes")
            })
          }
        );
        await refreshDashboard();
        setMessage(
          "withdrawal",
          "success",
          decision === "approve"
            ? `Early withdrawal request approved. ${formatNotificationBatchSummary(
                result.request?.notifications ?? []
              )}`
            : `Early withdrawal request rejected. ${formatNotificationBatchSummary(
                result.request?.notifications ?? []
              )}`
        );
      } catch (error) {
        setMessage("withdrawal", "error", error.message);
      }

      render();
      return;
    }

    if (event.target.id === "allocation-form") {
      event.preventDefault();
      const formData = new FormData(event.target);

      try {
        const result = await api("/api/admin/allocations", {
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
        setMessage(
          "allocation",
          "success",
          `${
            result.action === "increased"
              ? "Existing position increased successfully."
              : "Deal allocation saved to the database."
          } ${formatNotificationStatus(result.notification)}`
        );
        event.target.reset();
      } catch (error) {
        setMessage("allocation", "error", error.message);
      }

      render();
      return;
    }

    if (event.target.id === "capital-deposit-form") {
      event.preventDefault();
      const formData = new FormData(event.target);

      try {
        const proofFile = await readFileAsPayload(event.target.elements.proofFile.files[0]);
        await api("/api/capital-deposits", {
          method: "POST",
          body: JSON.stringify({
            amount: Number(formData.get("amount")),
            proofFile,
            notes: formData.get("notes")
          })
        });
        await refreshDashboard();
        setMessage("capital", "success", "Deposit submitted for manager review.");
        event.target.reset();
      } catch (error) {
        setMessage("capital", "error", error.message);
      }

      render();
      return;
    }

    if (event.target.id === "allocation-request-form") {
      event.preventDefault();
      const formData = new FormData(event.target);

      try {
        await api("/api/allocation-requests", {
          method: "POST",
          body: JSON.stringify({
            dealId: formData.get("dealId"),
            amount: Number(formData.get("amount")),
            allocationMode: formData.get("allocationMode"),
            trade: formData.get("trade"),
            notes: formData.get("notes")
          })
        });
        await refreshDashboard();
        setMessage("capital", "success", "Allocation request submitted for manager review.");
        event.target.reset();
      } catch (error) {
        setMessage("capital", "error", error.message);
      }

      render();
      return;
    }

    if (event.target.id === "admin-capital-deposit-form") {
      event.preventDefault();
      const formData = new FormData(event.target);

      try {
        const proofFile = await readFileAsPayload(event.target.elements.proofFile.files[0]);
        const result = await api("/api/admin/capital-deposits", {
          method: "POST",
          body: JSON.stringify({
            participantId: formData.get("participantId"),
            amount: Number(formData.get("amount")),
            proofFile,
            notes: formData.get("notes"),
            managerNotes: formData.get("managerNotes")
          })
        });
        await refreshDashboard();
        setMessage(
          "capital",
          "success",
          `Approved account funds recorded. ${formatNotificationStatus(result.notification)}`
        );
        event.target.reset();
      } catch (error) {
        setMessage("capital", "error", error.message);
      }

      render();
      return;
    }

    if (event.target.dataset.capitalDepositReviewForm === "true") {
      event.preventDefault();
      const formData = new FormData(event.target);
      const depositId = String(event.target.dataset.depositId ?? "");
      const decision = event.submitter?.value || formData.get("decision");

      if (!depositId) {
        setMessage("capital", "error", "A valid deposit request is required.");
        render();
        return;
      }

      try {
        const result = await api(`/api/admin/capital-deposits/${encodeURIComponent(depositId)}`, {
          method: "PUT",
          body: JSON.stringify({
            decision,
            managerNotes: formData.get("managerNotes")
          })
        });
        await refreshDashboard();
        setMessage(
          "capital",
          "success",
          `Deposit ${decision === "approved" ? "approved" : "rejected"}. ${formatNotificationStatus(
            result.notification
          )}`
        );
      } catch (error) {
        setMessage("capital", "error", error.message);
      }

      render();
      return;
    }

    if (event.target.dataset.projectPoolVoteForm === "true") {
      event.preventDefault();
      const formData = new FormData(event.target);
      const dealId = String(event.target.dataset.dealId ?? "");

      if (!dealId) {
        setMessage("capital", "error", "A valid project pool is required.");
        render();
        return;
      }

      try {
        await api(`/api/deals/${encodeURIComponent(dealId)}/project-pool-vote`, {
          method: "PUT",
          body: JSON.stringify({
            voteChoice: formData.get("voteChoice")
          })
        });
        await refreshDashboard();
        setMessage("capital", "success", "Project pool vote saved.");
      } catch (error) {
        setMessage("capital", "error", error.message);
      }

      render();
      return;
    }

    if (event.target.dataset.projectPoolFundingForm === "true") {
      event.preventDefault();
      const dealId = String(event.target.dataset.dealId ?? "");

      if (!dealId) {
        setMessage("allocation", "error", "A valid project is required.");
        render();
        return;
      }

      try {
        const result = await api(
          `/api/admin/deals/${encodeURIComponent(dealId)}/pooled-requests/fund`,
          {
            method: "POST",
            body: JSON.stringify({})
          }
        );
        await refreshDashboard();
        setMessage(
          "allocation",
          "success",
          `Pooled requests funded into the project cap table: ${formatCurrency(
            result.fundedAmount
          )}.`
        );
      } catch (error) {
        setMessage("allocation", "error", error.message);
      }

      render();
      return;
    }

    if (event.target.dataset.allocationRequestReviewForm === "true") {
      event.preventDefault();
      const formData = new FormData(event.target);
      const requestId = String(event.target.dataset.requestId ?? "");
      const decision = event.submitter?.value || formData.get("decision");

      if (!requestId) {
        setMessage("allocation", "error", "A valid allocation request is required.");
        render();
        return;
      }

      try {
        const result = await api(`/api/admin/allocation-requests/${encodeURIComponent(requestId)}`, {
          method: "PUT",
          body: JSON.stringify({
            decision,
            managerNotes: formData.get("managerNotes")
          })
        });
        await refreshDashboard();
        setMessage(
          "allocation",
          "success",
          `Allocation request ${decision === "approved" ? "approved" : "rejected"}. ${formatNotificationStatus(
            result.notification
          )}`
        );
      } catch (error) {
        setMessage("allocation", "error", error.message);
      }

      render();
      return;
    }

    if (event.target.id === "create-deal-form") {
      event.preventDefault();
      const draft = getCreateDealDraft();

      try {
        const result = await api("/api/admin/deals", {
          method: "POST",
          body: JSON.stringify({
            name: draft.name,
            location: draft.location,
            currentPhase: draft.currentPhase,
            status: draft.status,
            budgetedProjectCost: draft.budgetedProjectCost,
            debt: draft.debt,
            taxExpense: draft.taxExpense,
            earlyWithdrawalPenaltyRate: draft.earlyWithdrawalPenaltyRate,
            debtInterestRate: draft.debtInterestRate,
            salePrice: draft.salePrice,
            holdMonths: draft.holdMonths,
            prefRate: draft.prefRate,
            timelineProgress: draft.timelineProgress,
            fundedOn: draft.fundedOn,
            investmentCloseOn: draft.investmentCloseOn,
            directInvestmentMinimum: draft.directInvestmentMinimum,
            pooledInvestmentAllowed: draft.pooledInvestmentAllowed,
            pooledInvestmentTarget: draft.pooledInvestmentTarget,
            pooledVoteThreshold: draft.pooledVoteThreshold,
            pooledVoteClosesOn: draft.pooledVoteClosesOn,
            projectedExitOn: draft.projectedExitOn,
            actualExitOn: draft.actualExitOn,
            expenseEntries: draft.expenseEntries,
            debtServiceEntries: draft.debtServiceEntries
          })
        });
        state.adminDealId = result.deal.id;
        state.rollupDealFilter = result.deal.id;
        state.createDealDraft = buildCreateDealDraft();
        await refreshDashboard();
        setMessage(
          "dealCreate",
          "success",
          `Project created and ready for allocations. ${formatNotificationBatchSummary(
            result.notifications ?? []
          )}`
        );
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
            budgetedProjectCost: draft.budgetedProjectCost,
            debt: draft.debt,
            taxExpense: draft.taxExpense,
            earlyWithdrawalPenaltyRate: draft.earlyWithdrawalPenaltyRate,
            debtInterestRate: draft.debtInterestRate,
            salePrice: draft.salePrice,
            holdMonths: draft.holdMonths,
            prefRate: draft.prefRate,
            timelineProgress: draft.timelineProgress,
            fundedOn: draft.fundedOn,
            investmentCloseOn: draft.investmentCloseOn,
            directInvestmentMinimum: draft.directInvestmentMinimum,
            pooledInvestmentAllowed: draft.pooledInvestmentAllowed,
            pooledInvestmentTarget: draft.pooledInvestmentTarget,
            pooledVoteThreshold: draft.pooledVoteThreshold,
            pooledVoteClosesOn: draft.pooledVoteClosesOn,
            projectedExitOn: draft.projectedExitOn,
            actualExitOn: draft.actualExitOn,
            expenseEntries: draft.expenseEntries,
            debtServiceEntries: draft.debtServiceEntries,
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
    if (syncCreateDealField(event.target)) {
      return;
    }

    if (syncDealEditorField(event.target)) {
      return;
    }

    if (event.target.matches("#allocation-form select[name='participantId']")) {
      syncEnrollmentAmountSelection(event.target, "contributionAmount");
      return;
    }

    if (event.target.matches("[data-pool-commitment-form='true'] select[name='participantId']")) {
      syncEnrollmentAmountSelection(event.target, "commitmentAmount");
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

    if (event.target.id === "distribution-review-filter-deal") {
      state.distributionReviewFilters.dealId = event.target.value;
      render();
      return;
    }

    if (event.target.id === "distribution-review-filter-participant") {
      state.distributionReviewFilters.participantId = event.target.value;
      render();
      return;
    }

    if (event.target.id === "investor-project-filter-deal") {
      state.investorProjectFilters.dealId = event.target.value;
      render();
      return;
    }

    if (event.target.id === "investor-project-filter-status") {
      state.investorProjectFilters.status = event.target.value;
      render();
      return;
    }

    if (event.target.id === "investor-issue-filter-deal") {
      state.investorIssueFilters.dealId = event.target.value;
      render();
      return;
    }

    if (event.target.id === "investor-issue-filter-status") {
      state.investorIssueFilters.status = event.target.value;
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

    if (event.target.id === "archived-project-filter-search") {
      state.archivedProjectFilter = event.target.value;
      render();
      return;
    }

    if (event.target.id === "questionnaire-filter-search") {
      state.questionnaireFilters.search = event.target.value;
      render();
      return;
    }

    if (syncCreateDealField(event.target)) {
      return;
    }

    syncDealEditorField(event.target);
  });

  document.addEventListener("pointerdown", handleSessionActivity);
  document.addEventListener("keydown", handleSessionActivity);
  document.addEventListener("touchstart", handleSessionActivity, { passive: true });
  document.addEventListener("mousemove", handleSessionActivity, { passive: true });
  document.addEventListener("scroll", handleSessionActivity, { passive: true });

  document.addEventListener("click", async (event) => {
    const authViewButton = event.target.closest("[data-auth-view]");

    if (authViewButton) {
      const nextView = authViewButton.dataset.authView;

      if (!nextView) {
        return;
      }

      clearAuthFeedback();
      setAuthMode(nextView);
      render();
      return;
    }

    const managerPageButton = event.target.closest("[data-manager-page]");

    if (managerPageButton) {
      const nextPage = String(managerPageButton.dataset.managerPage ?? "").trim();

      if (!nextPage) {
        return;
      }

      state.managerPage = nextPage;
      state.notificationPanelOpen = false;
      window.scrollTo({ top: 0, behavior: "smooth" });
      render();
      return;
    }

    const notificationBellButton = event.target.closest("#notification-bell-button");

    if (notificationBellButton) {
      const willOpen = !state.notificationPanelOpen;
      const unreadCount = Number(state.dashboard?.notifications?.unreadCount ?? 0);
      state.notificationPanelOpen = willOpen;
      render();

      if (willOpen && unreadCount > 0) {
        try {
          await api("/api/notifications/read", {
            method: "POST",
            body: JSON.stringify({})
          });
          await refreshDashboard();
          state.notificationPanelOpen = true;
        } catch (error) {
          setMessage("profile", "error", error.message);
        }

        render();
      }

      return;
    }

    const accountDetailsButton = event.target.closest("#account-details-button");

    if (accountDetailsButton) {
      state.accountDetailsOpen = !state.accountDetailsOpen;
      state.notificationPanelOpen = false;
      render();
      return;
    }

    const poolCollapseButton = event.target.closest("[data-pool-collapse]");

    if (poolCollapseButton) {
      const collapseMode = poolCollapseButton.dataset.poolCollapse;
      const collapsePools = collapseMode === "all";
      const pools = state.dashboard?.admin?.investorPools ?? [];

      state.collapsedSections = {
        ...state.collapsedSections,
        ...Object.fromEntries(
          pools.map((pool) => [`manager-pool-${pool.id}`, collapsePools])
        )
      };
      render();
      return;
    }

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

      if (action === "add-debt-service") {
        updateDealEditorDraft(dealId, (draft) => ({
          ...draft,
          debtServiceEntries: [...draft.debtServiceEntries, createDebtServiceDraft()]
        }));
        render();
        return;
      }

      if (action === "remove-debt-service") {
        const index = Number(dealEditorAction.dataset.index);

        updateDealEditorDraft(dealId, (draft) => ({
          ...draft,
          debtServiceEntries:
            draft.debtServiceEntries.length > 1
              ? draft.debtServiceEntries.filter((_, entryIndex) => entryIndex !== index)
              : [createDebtServiceDraft()]
        }));
        render();
        return;
      }

      if (action === "add-expense") {
        updateDealEditorDraft(dealId, (draft) => ({
          ...draft,
          expenseEntries: [...draft.expenseEntries, createExpenseDraft()]
        }));
        render();
        return;
      }

      if (action === "remove-expense") {
        const index = Number(dealEditorAction.dataset.index);

        updateDealEditorDraft(dealId, (draft) => ({
          ...draft,
          expenseEntries:
            draft.expenseEntries.length > 1
              ? draft.expenseEntries.filter((_, entryIndex) => entryIndex !== index)
              : [createExpenseDraft()]
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
        const issueTypeInput = issueRoot?.querySelector('select[name="issueType"]');
        const thresholdInput = issueRoot?.querySelector('input[name="approvalThreshold"]');
        const proposedPenaltyRateInput = issueRoot?.querySelector(
          'input[name="proposedPenaltyRate"]'
        );
        const closesOnInput = issueRoot?.querySelector('input[name="closesOn"]');
        const descriptionInput = issueRoot?.querySelector('textarea[name="description"]');
        const title = String(titleInput?.value ?? "").trim();
        const issueType = String(issueTypeInput?.value ?? "general").trim();
        const description = String(descriptionInput?.value ?? "").trim();
        const approvalThreshold = Number(thresholdInput?.value ?? 0.75);
        const proposedPenaltyRate = String(proposedPenaltyRateInput?.value ?? "").trim();
        const closesOn = String(closesOnInput?.value ?? "").trim();

        if (!title || !description || !closesOn) {
          setMessage("issue", "error", "Issue title, close date, and description are required.");
          render();
          return;
        }

        if (issueType === "penalty_rate_change" && !proposedPenaltyRate) {
          setMessage("issue", "error", "A proposed penalty rate is required for a penalty vote.");
          render();
          return;
        }

        try {
          const result = await api("/api/admin/issues", {
            method: "POST",
            body: JSON.stringify({
              dealId,
              issueType,
              title,
              description,
              approvalThreshold,
              proposedPenaltyRate,
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
          `Delete ${deal?.name ?? "this deal"}? All allocations, expenses, interest rows, timeline items, contractor entries, and tiers tied to it will be removed. Sold projects must be archived instead.`
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

      if (action === "archive-deal") {
        const deal = getDealById(dealId);
        const confirmed = window.confirm(
          `Archive ${deal?.name ?? "this project"}? The sold project will be removed from active screens and preserved in archive history.`
        );

        if (!confirmed) {
          return;
        }

        try {
          await api(`/api/admin/deals/${encodeURIComponent(dealId)}/archive`, {
            method: "POST",
            body: JSON.stringify({})
          });
          delete state.dealEditorDrafts[dealId];
          state.adminDealId = null;
          await refreshDashboard();
          setMessage("deal", "success", "Sold project archived.");
        } catch (error) {
          setMessage("deal", "error", error.message);
        }

        render();
        return;
      }
    }

    const createDealAction = event.target.closest("[data-create-deal-action]");

    if (createDealAction) {
      const action = createDealAction.dataset.createDealAction;

      if (action === "add-debt-service") {
        updateCreateDealDraft((draft) => ({
          ...draft,
          debtServiceEntries: [...draft.debtServiceEntries, createDebtServiceDraft()]
        }));
        render();
        return;
      }

      if (action === "remove-debt-service") {
        const index = Number(createDealAction.dataset.index);

        updateCreateDealDraft((draft) => ({
          ...draft,
          debtServiceEntries:
            draft.debtServiceEntries.length > 1
              ? draft.debtServiceEntries.filter((_, entryIndex) => entryIndex !== index)
              : [createDebtServiceDraft()]
        }));
        render();
        return;
      }

      if (action === "add-expense") {
        updateCreateDealDraft((draft) => ({
          ...draft,
          expenseEntries: [...draft.expenseEntries, createExpenseDraft()]
        }));
        render();
        return;
      }

      if (action === "remove-expense") {
        const index = Number(createDealAction.dataset.index);

        updateCreateDealDraft((draft) => ({
          ...draft,
          expenseEntries:
            draft.expenseEntries.length > 1
              ? draft.expenseEntries.filter((_, entryIndex) => entryIndex !== index)
              : [createExpenseDraft()]
        }));
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
        setMessage(
          "vote",
          "success",
          `Your ${voteChoice} vote has been recorded. You can change it any time before the close date.`
        );
      } catch (error) {
        setMessage("vote", "error", error.message);
      }

      render();
      return;
    }

    const resourceActionButton = event.target.closest("[data-resource-action]");

    if (resourceActionButton) {
      const action = resourceActionButton.dataset.resourceAction;
      const resourceId = resourceActionButton.dataset.resourceId;

      if (!resourceId) {
        return;
      }

      if (action === "delete") {
        const confirmed = window.confirm(
          "Delete this company resource? Investors will no longer be able to access it."
        );

        if (!confirmed) {
          return;
        }

        try {
          await api(`/api/admin/resources/${encodeURIComponent(resourceId)}`, {
            method: "DELETE"
          });
          await refreshDashboard();
          setMessage("resource", "success", "Company resource deleted.");
        } catch (error) {
          setMessage("resource", "error", error.message);
        }

        render();
      }

      return;
    }

    const archiveExportButton = event.target.closest("[data-archive-export]");

    if (archiveExportButton) {
      const format = archiveExportButton.dataset.archiveExport;
      const archivedProjects = applyArchivedProjectFilters(
        state.dashboard?.admin?.archivedProjects ?? []
      );
      const dateStamp = new Date().toISOString().slice(0, 10);

      if (!archivedProjects.length) {
        setMessage("deal", "error", "No archived projects match the current filter.");
        render();
        return;
      }

      if (format === "json") {
        downloadTextFile(
          `archived-projects-${dateStamp}.json`,
          JSON.stringify(archivedProjects, null, 2),
          "application/json"
        );
      } else {
        downloadTextFile(
          `archived-projects-${dateStamp}.csv`,
          buildArchivedProjectsCsv(archivedProjects),
          "text/csv"
        );
      }

      return;
    }

    const questionnaireExportButton = event.target.closest("[data-questionnaire-export]");

    if (questionnaireExportButton) {
      const format = questionnaireExportButton.dataset.questionnaireExport;
      const questionnaires = applyQuestionnaireFilters(
        state.dashboard?.admin?.investorQuestionnaires ?? []
      );
      const dateStamp = new Date().toISOString().slice(0, 10);

      if (!questionnaires.length) {
        setMessage("questionnaire", "error", "No investor questionnaires match the current filter.");
        render();
        return;
      }

      try {
        if (format === "pdf") {
          openInvestorQuestionnairesPdfExport(questionnaires);
        } else {
          downloadTextFile(
            `investor-questionnaires-${dateStamp}.txt`,
            buildInvestorQuestionnairesText(questionnaires),
            "text/plain"
          );
        }
        setMessage("questionnaire", "success", "Investor questionnaire export prepared.");
      } catch (error) {
        setMessage("questionnaire", "error", error.message);
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
        } else if (action === "approve-identity" || action === "reject-identity") {
          const reviewCell =
            actionButton.closest(".identity-review-actions") ?? actionButton.closest("td");
          const comment = String(
            reviewCell?.querySelector("[name='identityReviewComment']")?.value ?? ""
          ).trim();

          if (action === "reject-identity" && comment.length < 3) {
            setMessage("directory", "error", "A rejection comment is required.");
            render();
            return;
          }

          const result = await api(
            `/api/admin/users/${encodeURIComponent(userId)}/identity-review`,
            {
              method: "POST",
              body: JSON.stringify({
                decision: action === "approve-identity" ? "approved" : "rejected",
                comment
              })
            }
          );
          await refreshDashboard();
          setMessage(
            "directory",
            "success",
            action === "approve-identity"
              ? `Account approved. ${formatNotificationStatus(result.notification)}`
              : `More information requested. ${formatNotificationStatus(result.notification)}`
          );
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
      try {
        await api("/api/logout", { method: "POST", body: JSON.stringify({}) });
      } catch {}

      applyLoggedOutState();
    }
  });
}
