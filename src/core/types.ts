/**
 * Core TypeScript types
 */

// ============================================================================
// User Profile
// ============================================================================

/**
 * Identity - who you are
 * (education, skills, experience should be in resume.md/pdf)
 */
export interface Identity {
  name: string;
  email: string;
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
  interests?: string[];
}

/**
 * Preferences - run defaults
 */
export interface Preferences {
  defaultRoles: string[];
  defaultLocations?: string[];
  defaultIndustries?: string[];
  defaultTone?: "professional" | "casual" | "enthusiastic";
  defaultMaxOutreachPerRun?: number;
  defaultContactsPerCompany?: number;
  hardExclusions?: string[];
}

/**
 * User profile combining identity and default preferences
 */
export interface UserProfile extends Identity, Preferences {}

// ============================================================================
// Email and Messaging Types
// ============================================================================

/**
 * Email message draft for sending
 */
export interface EmailMessageDraft {
  to: string;
  toName?: string;
  subject: string;
  textBody: string;
  customId?: string;
  attachments?: Array<{
    filename: string;
    path: string;
  }>;
}

// ============================================================================
// Agent Stream Event Types
// ============================================================================

/**
 * Company item for human review
 */
export interface CompanyReviewItem {
  name: string;
  domain: string;
  description?: string;
  why_good_fit?: string;
}

/**
 * Stream event from LangGraph
 */
export interface StreamEvent {
  mode: "messages" | "updates";
  chunk: any;
}

/**
 * Interrupt chunk from LangGraph stream
 */
export interface InterruptChunk {
  __interrupt__?: Array<{
    value?: {
      actionRequests?: any[];
      [key: string]: any;
    };
    [key: string]: any;
  }>;
  [key: string]: any;
}

// ============================================================================
// Run Configuration (consolidated config + profile)
// ============================================================================

/**
 * Complete run configuration combining metadata and profile
 */
export interface RunConfig {
  runId: string;
  createdAt: string;
  profilePath: string;
  userPrompt: string | null;
  dryRun: boolean;
  sendEnabled: boolean;
  profile: UserProfile;
}

// ============================================================================
// Company Entry (consolidated format in companies.json)
// ============================================================================

/**
 * Company entry with research, selection status, and processing results
 */
export interface CompanyEntry {
  name: string;
  domain: string;
  description: string;
  why_good_fit?: string;
  selected: boolean;
  status?: "SUCCESS" | "FAILED" | "PENDING";
  contactsFound?: number;
  draftsGenerated?: number;
  processedAt?: string;
  failureReason?: string;
}

// ============================================================================
// Draft Entry (consolidated format in drafts.json)
// ============================================================================

/**
 * Draft email with contact info, content, and send status
 */
export interface DraftEntry {
  id: string; // e.g., "affirm_akhil_ghorpade"
  contact: { name: string; title: string; email: string };
  company: { name: string; domain: string };
  subject: string;
  body: string;
  personalization_notes?: string;
  status: "draft" | "sent" | "failed";
  sentAt?: string;
  messageId?: string;
  messageUUID?: string;
  error?: string;
}

// ============================================================================
// Artifact Types (for type safety in run outputs)
// ============================================================================
