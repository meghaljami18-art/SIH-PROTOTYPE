import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: text('role').default('COMPLIANCE_ANALYST').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const inspections = pgTable('inspections', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  status: text('status').default('DRAFT').notNull(),
  packageContext: text('package_context').default('RETAIL').notNull(),
  commodityType: text('commodity_type').notNull(),
  dateRequired: text('date_required').default('UNKNOWN').notNull(),
  medicalDevice: text('medical_device').default('UNKNOWN').notNull(),
  qualityScore: text('quality_score'),
  qualityStatus: text('quality_status'),
  qualityDetails: jsonb('quality_details'),
  imageNames: jsonb('image_names'),
  imageUrls: jsonb('image_urls'),
  extraction: jsonb('extraction'),
  assessment: jsonb('assessment'),
  reviewDecisions: jsonb('review_decisions'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const rulesMatrix = pgTable('rules_matrix', {
  id: serial('id').primaryKey(),
  ruleId: text('rule_id').notNull(),
  version: text('version').notNull(),
  title: text('title').notNull(),
  source: text('source').notNull(),
  purpose: text('purpose').notNull(),
  category: text('category').notNull(),
  verificationMode: text('verification_mode').notNull(),
  fieldTarget: text('field_target').notNull(),
  statutoryThreshold: text('statutory_threshold'),
  validationRegex: text('validation_regex'),
  applicabilityPredicate: jsonb('applicability_predicate'),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const auditEvents = pgTable('audit_events', {
  id: serial('id').primaryKey(),
  inspectionId: text('inspection_id').notNull(),
  actorUid: text('actor_uid').notNull(),
  actorEmail: text('actor_email').notNull(),
  actorRole: text('actor_role').notNull(),
  action: text('action').notNull(),
  ruleId: text('rule_id'),
  decision: text('decision'),
  reason: text('reason'),
  previousState: jsonb('previous_state'),
  newState: jsonb('new_state'),
  hash: text('hash'),
  createdAt: timestamp('created_at').defaultNow(),
});
