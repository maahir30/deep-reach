/**
 * deepreach init -- interactive setup wizard
 *
 * Creates a `.deepreach/` workspace in the current directory with:
 *   - profile.json   (identity)
 *   - preferences.json (run defaults)
 *   - resume/resume.pdf  (copied from user-provided path)
 *   - resume/resume.md   (optional, copied)
 *   - ../.env             (API keys, written to workspace root)
 */

import * as clack from "@clack/prompts";
import { existsSync } from "fs";
import { mkdir, copyFile, writeFile } from "fs/promises";
import { join, resolve } from "path";
import {
  WORKSPACE_DIR_NAME,
  configDir,
  resumeDir,
  envFilePath,
} from "./workspace";

// ============================================================================
// Init Command
// ============================================================================

export async function runInit() {
  const root = process.cwd();
  const wsDir = configDir(root);

  clack.intro("deepreach setup");

  // Warn if workspace already exists
  if (existsSync(wsDir)) {
    const overwrite = await clack.confirm({
      message: `A ${WORKSPACE_DIR_NAME}/ directory already exists here. Overwrite?`,
    });
    if (clack.isCancel(overwrite) || !overwrite) {
      clack.outro("Setup cancelled.");
      return;
    }
  }

  // ------------------------------------------------------------------
  // 1. Identity
  // ------------------------------------------------------------------

  const name = await clack.text({
    message: "What's your name?",
    placeholder: "Jane Doe",
    validate: (v) => (!v ? "Name is required" : undefined),
  });
  if (clack.isCancel(name)) return cancel();

  const email = await clack.text({
    message: "Email address?",
    placeholder: "jane@example.com",
    validate: (v) => {
      if (!v) return "Email is required";
      if (!v.includes("@")) return "Enter a valid email address";
      return undefined;
    },
  });
  if (clack.isCancel(email)) return cancel();

  const linkedinUrl = await clack.text({
    message: "LinkedIn URL (optional)",
    placeholder: "https://linkedin.com/in/janedoe",
  });
  if (clack.isCancel(linkedinUrl)) return cancel();

  const githubUrl = await clack.text({
    message: "GitHub URL (optional)",
    placeholder: "https://github.com/janedoe",
  });
  if (clack.isCancel(githubUrl)) return cancel();

  const interestsRaw = await clack.text({
    message: "Interests (comma-separated)",
    placeholder: "AI/ML, Backend Infrastructure, Full-Stack Development",
  });
  if (clack.isCancel(interestsRaw)) return cancel();

  const interests = interestsRaw
    ? interestsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  // ------------------------------------------------------------------
  // 2. Preferences
  // ------------------------------------------------------------------

  const rolesRaw = await clack.text({
    message: "Target roles (comma-separated)",
    placeholder: "Software Engineering Intern, ML Engineering Intern",
    validate: (v) => (!v ? "At least one role is required" : undefined),
  });
  if (clack.isCancel(rolesRaw)) return cancel();

  const roles = rolesRaw.split(",").map((s) => s.trim()).filter(Boolean);

  const locationsRaw = await clack.text({
    message: "Preferred locations (comma-separated, optional)",
    placeholder: "San Francisco, Remote",
  });
  if (clack.isCancel(locationsRaw)) return cancel();

  const locations = locationsRaw
    ? locationsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const industriesRaw = await clack.text({
    message: "Industries you're interested in (comma-separated, optional)",
    placeholder: "AI/ML, Developer Tools, Fintech, SaaS",
  });
  if (clack.isCancel(industriesRaw)) return cancel();

  const industries = industriesRaw
    ? industriesRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const tone = await clack.select({
    message: "Email tone",
    options: [
      { value: "professional", label: "Professional" },
      { value: "casual", label: "Casual" },
      { value: "enthusiastic", label: "Enthusiastic" },
    ],
  });
  if (clack.isCancel(tone)) return cancel();

  const maxOutreach = await clack.text({
    message: "Max companies per run",
    placeholder: "10",
    initialValue: "10",
    validate: (v) => {
      const n = Number(v);
      if (isNaN(n) || n < 1) return "Enter a positive number";
      return undefined;
    },
  });
  if (clack.isCancel(maxOutreach)) return cancel();

  const contactsPerCompany = await clack.text({
    message: "Max contacts per company",
    placeholder: "5",
    initialValue: "5",
    validate: (v) => {
      const n = Number(v);
      if (isNaN(n) || n < 1) return "Enter a positive number";
      return undefined;
    },
  });
  if (clack.isCancel(contactsPerCompany)) return cancel();

  // ------------------------------------------------------------------
  // 3. Resume
  // ------------------------------------------------------------------

  const resumePdfInput = await clack.text({
    message: "Path to your resume PDF",
    placeholder: "~/Documents/resume.pdf",
    validate: (v) => {
      if (!v) return "Resume PDF is required";
      const p = resolve(v.replace(/^~/, process.env.HOME || "~"));
      if (!existsSync(p)) return `File not found: ${p}`;
      return undefined;
    },
  });
  if (clack.isCancel(resumePdfInput)) return cancel();

  const resumeMdInput = await clack.text({
    message: "Path to your resume as Markdown (optional, helps AI write better emails)",
    placeholder: "~/Documents/resume.md",
    validate: (v) => {
      if (!v) return undefined; // optional
      const p = resolve(v.replace(/^~/, process.env.HOME || "~"));
      if (!existsSync(p)) return `File not found: ${p}`;
      return undefined;
    },
  });
  if (clack.isCancel(resumeMdInput)) return cancel();

  // ------------------------------------------------------------------
  // 4. API Keys
  // ------------------------------------------------------------------

  clack.note(
    [
      "You'll need API keys from these services:",
      "",
      "  LLM provider (pick one below)",
      "  Hunter.io  ->  https://hunter.io/api-keys",
      "  Tavily     ->  https://app.tavily.com/home",
      "",
      "Gmail credentials are optional (only needed for --send).",
    ].join("\n"),
    "API Keys"
  );

  const LLM_PROVIDERS = [
    { value: "anthropic",        label: "Anthropic",        envVar: "ANTHROPIC_API_KEY",  placeholder: "sk-ant-...",        defaultModel: "anthropic:claude-sonnet-4-20250514", hint: "console.anthropic.com" },
    { value: "openai",           label: "OpenAI",           envVar: "OPENAI_API_KEY",     placeholder: "sk-...",            defaultModel: "openai:gpt-4o",                      hint: "platform.openai.com" },
    { value: "google-vertexai",  label: "Google AI",        envVar: "GOOGLE_API_KEY",     placeholder: "AI...",             defaultModel: "google-vertexai:gemini-2.0-flash",   hint: "aistudio.google.com" },
    { value: "groq",             label: "Groq",             envVar: "GROQ_API_KEY",       placeholder: "gsk_...",           defaultModel: "groq:llama-3.3-70b-versatile",       hint: "console.groq.com" },
    { value: "mistralai",        label: "Mistral",          envVar: "MISTRAL_API_KEY",    placeholder: "...",               defaultModel: "mistralai:mistral-large-latest",     hint: "console.mistral.ai" },
  ] as const;

  const llmProvider = await clack.select({
    message: "Which LLM provider do you want to use?",
    options: LLM_PROVIDERS.map((p) => ({
      value: p.value,
      label: p.label,
      hint: p.hint,
    })),
  });
  if (clack.isCancel(llmProvider)) return cancel();

  const provider = LLM_PROVIDERS.find((p) => p.value === llmProvider)!;

  const llmApiKey = await clack.text({
    message: provider.envVar,
    placeholder: provider.placeholder,
    validate: (v) => (!v ? `${provider.label} API key is required` : undefined),
  });
  if (clack.isCancel(llmApiKey)) return cancel();

  const hunterKey = await clack.text({
    message: "HUNTER_API_KEY",
    placeholder: "Your Hunter.io API key",
    validate: (v) => (!v ? "Hunter API key is required" : undefined),
  });
  if (clack.isCancel(hunterKey)) return cancel();

  const tavilyKey = await clack.text({
    message: "TAVILY_API_KEY",
    placeholder: "tvly-...",
    validate: (v) => (!v ? "Tavily API key is required" : undefined),
  });
  if (clack.isCancel(tavilyKey)) return cancel();

  const gmailUser = await clack.text({
    message: "GMAIL_USER (optional, for --send)",
    placeholder: "you@gmail.com",
  });
  if (clack.isCancel(gmailUser)) return cancel();

  const gmailAppPassword = await clack.text({
    message: "GMAIL_APP_PASSWORD (optional, for --send)",
    placeholder: "xxxx-xxxx-xxxx-xxxx",
  });
  if (clack.isCancel(gmailAppPassword)) return cancel();

  // ------------------------------------------------------------------
  // 5. Write everything to disk
  // ------------------------------------------------------------------

  const s = clack.spinner();
  s.start("Writing workspace files...");

  // Create directories
  await mkdir(wsDir, { recursive: true });
  await mkdir(resumeDir(root), { recursive: true });

  // profile.json
  const profile: Record<string, unknown> = {
    name,
    email,
  };
  if (linkedinUrl) profile.linkedinUrl = linkedinUrl;
  if (githubUrl) profile.githubUrl = githubUrl;
  if (interests.length > 0) profile.interests = interests;

  await writeFile(
    join(wsDir, "profile.json"),
    JSON.stringify(profile, null, 2) + "\n"
  );

  // preferences.json
  const preferences: Record<string, unknown> = {
    defaultRoles: roles,
  };
  if (locations.length > 0) preferences.defaultLocations = locations;
  if (industries.length > 0) preferences.defaultIndustries = industries;
  preferences.defaultTone = tone;
  preferences.defaultMaxOutreachPerRun = Number(maxOutreach);
  preferences.defaultContactsPerCompany = Number(contactsPerCompany);
  preferences.hardExclusions = [];

  await writeFile(
    join(wsDir, "preferences.json"),
    JSON.stringify(preferences, null, 2) + "\n"
  );

  // Copy resume files
  const resolvedPdf = resolve(
    resumePdfInput.replace(/^~/, process.env.HOME || "~")
  );
  await copyFile(resolvedPdf, join(resumeDir(root), "resume.pdf"));

  if (resumeMdInput) {
    const resolvedMd = resolve(
      resumeMdInput.replace(/^~/, process.env.HOME || "~")
    );
    await copyFile(resolvedMd, join(resumeDir(root), "resume.md"));
  }

  // .env
  const envLines = [
    `CHAT_MODEL=${provider.defaultModel}`,
    `${provider.envVar}=${llmApiKey}`,
    `HUNTER_API_KEY=${hunterKey}`,
    `TAVILY_API_KEY=${tavilyKey}`,
  ];
  if (gmailUser) envLines.push(`GMAIL_USER=${gmailUser}`);
  if (gmailAppPassword) envLines.push(`GMAIL_APP_PASSWORD=${gmailAppPassword}`);
  envLines.push(""); // trailing newline

  await writeFile(envFilePath(root), envLines.join("\n"));

  s.stop("Workspace created!");

  // ------------------------------------------------------------------
  // 6. Summary
  // ------------------------------------------------------------------

  clack.note(
    [
      `${WORKSPACE_DIR_NAME}/`,
      "  profile.json",
      "  preferences.json",
      "  resume/",
      "    resume.pdf",
      resumeMdInput ? "    resume.md" : null,
      ".env",
    ]
      .filter(Boolean)
      .join("\n"),
    "Created"
  );

  clack.outro("Run your first outreach:  npx deepreach run");
}

// ============================================================================
// Helpers
// ============================================================================

function cancel() {
  clack.outro("Setup cancelled.");
}
