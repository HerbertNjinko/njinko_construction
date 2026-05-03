import { createHmac, timingSafeEqual } from "node:crypto";

const DWOLLA_HAL_CONTENT_TYPE = "application/vnd.dwolla.v1.hal+json";
const DWOLLA_JSON_CONTENT_TYPE = "application/json";
const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

let cachedAccessToken = null;

function normalizeConfigValue(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+#.*$/, "")
    .trim();
}

function normalizeEnvironment(value) {
  const normalized = normalizeConfigValue(value).toLowerCase();

  return normalized === "production" ? "production" : "sandbox";
}

function getBaseUrl(environment = normalizeEnvironment(process.env.DWOLLA_ENVIRONMENT)) {
  return environment === "production" ? "https://api.dwolla.com" : "https://api-sandbox.dwolla.com";
}

function getCredentialConfig() {
  const environment = normalizeEnvironment(process.env.DWOLLA_ENVIRONMENT);
  const key = normalizeConfigValue(process.env.DWOLLA_KEY ?? process.env.DWOLLA_CLIENT_ID);
  const secret = normalizeConfigValue(
    process.env.DWOLLA_SECRET ?? process.env.DWOLLA_CLIENT_SECRET
  );
  const destinationFundingSourceUrl = normalizeConfigValue(
    process.env.DWOLLA_COMPANY_FUNDING_SOURCE_URL ??
      process.env.DWOLLA_DESTINATION_FUNDING_SOURCE_URL
  );
  const webhookSecret = normalizeConfigValue(process.env.DWOLLA_WEBHOOK_SECRET);
  const enabled = normalizeConfigValue(process.env.DWOLLA_ENABLED).toLowerCase() === "true";

  return {
    enabled,
    environment,
    baseUrl: getBaseUrl(environment),
    key,
    secret,
    destinationFundingSourceUrl,
    webhookSecret,
    customerType: "unverified"
  };
}

export function getDwollaPublicConfig() {
  const config = getCredentialConfig();
  const configured = Boolean(
    config.enabled &&
      config.key &&
      config.secret &&
      config.destinationFundingSourceUrl &&
      config.webhookSecret
  );

  return {
    enabled: configured,
    environment: config.environment,
    webhookPath: "/api/webhooks/dwolla"
  };
}

export function assertDwollaConfigured() {
  const config = getCredentialConfig();

  if (!config.enabled) {
    throw new Error("Dwolla ACH is not enabled. Set DWOLLA_ENABLED=true after onboarding.");
  }

  if (!config.key || !config.secret) {
    throw new Error("Dwolla ACH is missing DWOLLA_KEY and DWOLLA_SECRET.");
  }

  if (!config.destinationFundingSourceUrl) {
    throw new Error("Dwolla ACH is missing DWOLLA_COMPANY_FUNDING_SOURCE_URL.");
  }

  return config;
}

export function assertDwollaWebhookConfigured() {
  const config = assertDwollaConfigured();

  if (!config.webhookSecret) {
    throw new Error("Dwolla webhook verification is missing DWOLLA_WEBHOOK_SECRET.");
  }

  return config;
}

function buildDwollaUrl(pathOrUrl, config) {
  const value = String(pathOrUrl ?? "").trim();

  if (/^https:\/\//i.test(value)) {
    return value;
  }

  return `${config.baseUrl}${value.startsWith("/") ? value : `/${value}`}`;
}

function extractIdFromUrl(url) {
  return String(url ?? "").split("/").filter(Boolean).at(-1) ?? "";
}

async function getAccessToken(config = assertDwollaConfigured()) {
  const now = Date.now();

  if (cachedAccessToken && cachedAccessToken.expiresAt > now + TOKEN_REFRESH_SKEW_MS) {
    return cachedAccessToken.token;
  }

  const credentials = Buffer.from(`${config.key}:${config.secret}`).toString("base64");
  const response = await fetch(`${config.baseUrl}/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      Accept: DWOLLA_JSON_CONTENT_TYPE,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ grant_type: "client_credentials" })
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload.access_token) {
    throw new Error(payload.message || payload.error_description || "Dwolla authentication failed.");
  }

  cachedAccessToken = {
    token: payload.access_token,
    expiresAt: now + Number(payload.expires_in ?? 3600) * 1000
  };

  return cachedAccessToken.token;
}

export async function dwollaRequest(pathOrUrl, options = {}) {
  const config = assertDwollaConfigured();
  const accessToken = await getAccessToken(config);
  const contentType = options.contentType ?? DWOLLA_HAL_CONTENT_TYPE;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: options.accept ?? DWOLLA_HAL_CONTENT_TYPE,
    ...(options.body === undefined ? {} : { "Content-Type": contentType }),
    ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
    ...(options.headers ?? {})
  };
  const response = await fetch(buildDwollaUrl(pathOrUrl, config), {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    throw new Error(payload?.message || payload?.error_description || "Dwolla request failed.");
  }

  return {
    status: response.status,
    headers: response.headers,
    body: payload
  };
}

export async function createDwollaCustomer({ user, ipAddress }) {
  const config = assertDwollaConfigured();
  const body = {
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    type: "unverified",
    ipAddress,
    correlationId: user.id
  };
  const response = await dwollaRequest("/customers", {
    method: "POST",
    body,
    idempotencyKey: `customer-${user.id}`
  });
  const location = response.headers.get("location") ?? "";

  return {
    customerUrl: location,
    customerId: extractIdFromUrl(location),
    customerStatus: config.customerType
  };
}

export async function retrieveDwollaResource(resourceUrl) {
  const response = await dwollaRequest(resourceUrl);

  return response.body;
}

export async function listDwollaFundingSources(customerUrl) {
  const response = await dwollaRequest(`${String(customerUrl).replace(/\/+$/, "")}/funding-sources`);

  return response.body?._embedded?.["funding-sources"] ?? [];
}

export async function createDwollaClientToken(body) {
  const response = await dwollaRequest("/client-tokens", {
    method: "POST",
    body,
    accept: DWOLLA_JSON_CONTENT_TYPE,
    contentType: DWOLLA_JSON_CONTENT_TYPE
  });

  return response.body;
}

export async function initiateDwollaAchTransfer({ depositId, sourceFundingSourceUrl, amount, notes }) {
  const config = assertDwollaConfigured();
  const amountValue = Number(amount).toFixed(2);
  const response = await dwollaRequest("/transfers", {
    method: "POST",
    idempotencyKey: depositId,
    body: {
      _links: {
        source: {
          href: sourceFundingSourceUrl
        },
        destination: {
          href: config.destinationFundingSourceUrl
        }
      },
      amount: {
        currency: "USD",
        value: amountValue
      },
      metadata: {
        depositId,
        notes: String(notes ?? "").slice(0, 255)
      },
      correlationId: depositId
    }
  });
  const location = response.headers.get("location") ?? "";

  return {
    transferUrl: location,
    transferId: extractIdFromUrl(location),
    transferStatus: "pending"
  };
}

export function verifyDwollaWebhookSignature(rawBody, signature) {
  const config = assertDwollaWebhookConfigured();
  const expected = createHmac("sha256", config.webhookSecret).update(rawBody).digest("hex");
  const actualBuffer = Buffer.from(String(signature ?? ""), "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
