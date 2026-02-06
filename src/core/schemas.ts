import { z } from "zod";

/**
 * Zod validation schemas for identity and preferences
 */

/**
 * Identity schema - who you are
 * (education, skills, experience should be in resume.md/pdf)
 */
export const IdentitySchema = z.object({
  name: z.string(),
  email: z.string().email(),
  linkedinUrl: z.string().optional(),
  githubUrl: z.string().optional(),
  portfolioUrl: z.string().optional(),
  interests: z.array(z.string()).optional(),
});

/**
 * Preferences schema - run defaults
 */
export const PreferencesSchema = z.object({
  defaultRoles: z.array(z.string()),
  defaultLocations: z.array(z.string()).optional(),
  defaultIndustries: z.array(z.string()).optional(),
  defaultTone: z.enum(["professional", "casual", "enthusiastic"]).optional(),
  defaultMaxOutreachPerRun: z.number().optional(),
  defaultContactsPerCompany: z.number().optional(),
  hardExclusions: z.array(z.string()).optional(),
});

/**
 * Combined user profile schema (identity + preferences)
 */
export const UserProfileSchema = IdentitySchema.merge(PreferencesSchema);
