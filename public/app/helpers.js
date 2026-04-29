import { RESET_TOKEN_PARAM, createInitialMessages, state } from "./state.js?v=20260429-frontend-4";

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

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatCurrency(value) {
  return currency.format(value ?? 0);
}

export function formatPercent(value) {
  return percent.format(value ?? 0);
}

export function formatRate(value) {
  return precisePercent.format(value ?? 0);
}

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function inputValue(value) {
  return escapeHtml(String(value ?? ""));
}

export function titleCase(value) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function clearMessages() {
  state.messages = createInitialMessages();
}

export function clearAuthFeedback() {
  state.authMessage = null;
  state.loginError = "";
}

export function setMessage(section, type, text) {
  state.messages[section] = {
    type,
    text
  };
}

export function renderMessage(message) {
  if (!message) {
    return "";
  }

  return `
    <div class="status-message status-${escapeHtml(message.type)}">
      ${escapeHtml(message.text)}
    </div>
  `;
}

export function setAuthMessage(type, text) {
  state.authMessage = {
    type,
    text
  };
}

export function clearPasswordResetTokenFromLocation() {
  const url = new URL(window.location.href);
  url.searchParams.delete(RESET_TOKEN_PARAM);
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  state.passwordResetToken = null;
}

export function setAuthMode(mode) {
  state.authMode = mode;

  if (mode !== "reset") {
    clearPasswordResetTokenFromLocation();
  }
}

export function isSectionCollapsed(sectionId) {
  return Boolean(state.collapsedSections?.[sectionId]);
}

export function toggleSectionCollapsed(sectionId) {
  state.collapsedSections = {
    ...state.collapsedSections,
    [sectionId]: !isSectionCollapsed(sectionId)
  };
}

export function renderSectionToggle(sectionId) {
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

export function renderCollapsibleSection({
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

export function metricCard(label, value) {
  return `
    <article class="metric-card">
      <p class="metric-label">${escapeHtml(label)}</p>
      <p class="metric-value">${escapeHtml(value)}</p>
    </article>
  `;
}

export function summaryItem(label, value) {
  return `
    <article class="summary-item">
      <h4>${escapeHtml(label)}</h4>
      <p>${escapeHtml(value)}</p>
    </article>
  `;
}

export function breakdownItem(label, value) {
  return `
    <article class="breakdown-item">
      <h4>${escapeHtml(label)}</h4>
      <p>${escapeHtml(value)}</p>
    </article>
  `;
}

export function formatNotificationStatus(notification) {
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

export function formatNotificationBatchSummary(notifications = []) {
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

export function formatDateTime(value) {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

export function formatDate(value) {
  if (!value) {
    return "Not scheduled";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
}

export async function readFileAsPayload(file) {
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
