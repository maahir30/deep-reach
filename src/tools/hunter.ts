import { tool } from "langchain";
import { z } from "zod/v4";
import { logger } from "@/utils/logger";

const log = logger.hunter;

function getHunterKey(): string {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) {
    const error = "HUNTER_API_KEY environment variable not set";
    log.error(error);
    throw new Error(error);
  }
  return apiKey;
}

/**
 * Builds a URL for the Hunter.io API.
 * @param path - The path to the API endpoint.
 * @param params - The parameters to pass to the API endpoint.
 * @returns The URL for the API endpoint.
 */
function buildHunterUrl(path: string, params: Record<string, string | number | undefined>) {
  const url = new URL(`https://api.hunter.io/v2/${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

/**
 * Parses a Hunter.io API error response.
 * @param response - The response from the API.
 * @returns The error message.
 */
async function parseHunterError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data === "object" && data !== null && "errors" in data && Array.isArray(data.errors)) {
      return data.errors
        .map((err: { code?: number; details?: string; id?: string }) =>
          [err.code, err.id, err.details].filter(Boolean).join(" ")
        )
        .join("; ");
    }
    return JSON.stringify(data);
  } catch {
    return await response.text();
  }
}

interface HunterResponse {
  data?: {
    emails: {
      first_name: string; last_name: string; position: string; value: string
    }[];
    organization: string;
    domain: string
  }
}

/**
 * Makes a GET request to the Hunter.io API.
 * @param path - The path to the API endpoint.
 * @param params - The parameters to pass to the API endpoint.
 * @returns The response from the API.
 */
async function hunterGet(
  path: string,
  params: Record<string, string | number | undefined>
) {
  const url = buildHunterUrl(path, params);

  // Redact sensitive params for logging
  const safeParams = { ...params };
  log.debug("Hunter API request", { endpoint: path, params: safeParams });

  const start = performance.now();
  const response = await fetch(url, {
    headers: {
      "X-API-KEY": getHunterKey(),
    },
  });
  const duration = Math.round(performance.now() - start);

  log.debug("Hunter API response", {
    endpoint: path,
    status: response.status,
    statusText: response.statusText,
    durationMs: duration,
  });

  return response;
}

/**
 * Creates a tool that can be used to find engineers at a company.
 * @param contactsLimit - The maximum number of contacts to return per company.
 * @returns A tool that can be used to find engineers at a company.
 */
export function createHunterDomainSearchTool(contactsLimit: number = 10) {
  // Hunter.io domain search supports up to 100 results per request
  const limit = Math.min(Math.max(contactsLimit, 1), 100);

  return tool(async ({ domain, company }) => {
    log.info("People lookup called", { domain, company, limit });

    if (!domain && !company) {
      log.warn("People lookup validation failed: missing domain/company");
      throw new Error("people_lookup requires either domain or company");
    }

    // Request contacts from IT department (engineers) with configured limit
    const requestParams = {
      domain,
      company,
      limit,
      department: "it",
    };

    const response = await hunterGet("domain-search", requestParams);

    if (!response.ok) {
      const errorText = await parseHunterError(response);
      log.error("People lookup request failed", { status: response.status, error: errorText });
      throw new Error(`Hunter domain search failed (${response.status}): ${errorText}`);
    }

    const data = await response.json() as HunterResponse;
    const emails = data?.data?.emails ?? [];
    const organization = data?.data?.organization;

    log.info("People lookup result", {
      domain: domain || company,
      organization,
      peopleFound: emails.length,
    });

    // Transform to clean, simple format (respect the configured limit)
    const people = emails.slice(0, limit).map((email: any) => ({
      name: `${email.first_name || ''} ${email.last_name || ''}`.trim(),
      title: email.position || 'Unknown',
      email: email.value,
    }));

    // Handle NO CONTACTS case with explicit failure state
    if (people.length === 0) {
      log.warn("No contacts found - returning explicit failure", {
        domain: domain || company,
        organization,
      });

      return JSON.stringify({
        success: false,
        error: "NO_CONTACTS_FOUND",
        message: `Hunter.io returned 0 contacts for ${organization || domain || company}. This company has no public email data available in Hunter's database. You MUST skip this company, save a failure report, and move on. DO NOT make up or invent any contact information.`,
        company: organization || company || "Unknown",
        domain: domain || data?.data?.domain || "Unknown",
        people: [],
        total: 0,
      });
    }

    if (people.length > 0) {
      log.debug("Sample contacts found", {
        sample: people.slice(0, 3).map((p: { name: string; title: string }) => ({
          name: p.name,
          title: p.title,
        })),
      });
    }

    return JSON.stringify({
      success: true,
      company: organization,
      domain: domain || data?.data?.domain,
      people,
      total: people.length,
    });
  }, {
    name: "people_lookup",
    description: `Find engineers at a company. Provide either the company domain (e.g., 'stripe.com') or company name. Returns up to ${limit} engineers with their names, titles, and emails.`,
    schema: z.object({
      domain: z.string().describe("Company domain (e.g., 'stripe.com')").optional(),
      company: z.string().describe("Company name (e.g., 'Stripe')").optional(),
    }),
  });
}
