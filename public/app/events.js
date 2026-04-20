import { state } from "./state.js?v=20260417-frontend-2";
import {
  clearAuthFeedback,
  clearMessages,
  clearPasswordResetTokenFromLocation,
  formatNotificationBatchSummary,
  formatNotificationStatus,
  readFileAsPayload,
  setAuthMessage,
  setAuthMode,
  setMessage,
  toggleSectionCollapsed
} from "./helpers.js?v=20260417-frontend-2";
import {
  createTierDraft,
  createTimelineDraft,
  getDealById,
  getDealEditorDraft,
  syncDealEditorField,
  updateDealEditorDraft
} from "./data.js?v=20260417-frontend-2";
import {
  api,
  applyLoggedOutState,
  loadCalculator,
  loadSession,
  recordSessionActivity,
  refreshDashboard
} from "./session.js?v=20260417-frontend-2";
import { render } from "./renderers.js?v=20260417-frontend-2";

let listenersBound = false;

function handleSessionActivity(event) {
  if (!state.session) {
    return;
  }

  const force = !["mousemove", "scroll"].includes(event.type);
  recordSessionActivity(force);
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

    if (event.target.id === "calculator-form") {
      event.preventDefault();
      const formData = new FormData(event.target);

      try {
        await loadCalculator(String(formData.get("dealId")), {
          dealId: formData.get("dealId"),
          salePrice: Number(formData.get("salePrice")),
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
          result.action === "increased"
            ? "Existing position increased successfully."
            : "Deal allocation saved to the database."
        );
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
            taxExpense: Number(formData.get("taxExpense")),
            debtInterestRate: Number(formData.get("debtInterestRate")),
            totalInterestPaid: Number(formData.get("totalInterestPaid")),
            salePrice: Number(formData.get("salePrice")),
            holdMonths: Number(formData.get("holdMonths")),
            prefRate: Number(formData.get("prefRate")),
            timelineProgress: Number(formData.get("timelineProgress")),
            fundedOn: formData.get("fundedOn"),
            investmentCloseOn: formData.get("investmentCloseOn"),
            projectedExitOn: formData.get("projectedExitOn"),
            actualExitOn: formData.get("actualExitOn")
          })
        });
        state.adminDealId = result.deal.id;
        state.rollupDealFilter = result.deal.id;
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
            totalProjectCost: draft.totalProjectCost,
            debt: draft.debt,
            taxExpense: draft.taxExpense,
            debtInterestRate: draft.debtInterestRate,
            totalInterestPaid: draft.totalInterestPaid,
            salePrice: draft.salePrice,
            holdMonths: draft.holdMonths,
            prefRate: draft.prefRate,
            timelineProgress: draft.timelineProgress,
            fundedOn: draft.fundedOn,
            investmentCloseOn: draft.investmentCloseOn,
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
      window.scrollTo({ top: 0, behavior: "smooth" });
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
      try {
        await api("/api/logout", { method: "POST", body: JSON.stringify({}) });
      } catch {}

      applyLoggedOutState();
    }
  });
}
