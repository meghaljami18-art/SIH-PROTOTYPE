export type Role = 'COMPLIANCE_ANALYST' | 'LEGAL_REVIEWER' | 'ADMIN' | 'VIEWER';

export interface UserIdentity {
  uid?: string;
  email: string;
  role: Role;
  name: string;
}

export type Decision = 'CONFIRMED' | 'DISMISSED' | 'MORE_EVIDENCE' | 'ESCALATED';

export type RuleStatus = 'PASS' | 'FAIL' | 'REVIEW' | 'NOT_APPLICABLE' | 'EXEMPT';

export interface InspectionContext {
  package_context: 'RETAIL' | 'WHOLESALE' | string;
  commodity_type: string;
  product_name?: string;
  brand_name?: string;
  date_required: string;
  medical_device: string;
}

export interface Candidate {
  value: string;
  confidence: number;
  evidence_excerpt?: string;
  evidence?: string;
  qualifier?: string;
  image_index?: number;
  method?: string;
}

export interface RuleEvidence {
  id: string;
  image_index?: number;
  confidence?: number;
  method?: string;
  excerpt?: string;
  value?: string;
}

export interface RuleResult {
  rule_id: string;
  title: string;
  source: string;
  status: RuleStatus;
  ui_label?: string;
  explanation: string;
  verification_mode?: string;
  legal_output?: string;
  evidence?: RuleEvidence[];
  next_action?: string;
}

export interface ProductParticulars {
  name?: string;
  brand?: string;
  commodity_type?: string;
  medical_device?: string;
}

export interface CoverageReport {
  package_sides_visible?: string[];
  mandatory_panel_visible?: string;
  notes?: string;
}

export interface InspectionExtraction {
  product?: ProductParticulars;
  coverage?: CoverageReport;
  fields: Record<string, Candidate[]>;
  raw_text_by_image?: Array<{ image_index: number; text: string }>;
}

export interface InspectionAssessment {
  overall_status: RuleStatus;
  overall_label?: string;
  counts?: {
    PASS?: number;
    REVIEW?: number;
    FAIL?: number;
    NOT_APPLICABLE?: number;
    EXEMPT?: number;
  };
  ruleset_version?: string;
  results?: RuleResult[];
}

export interface ImageQualityReport {
  status: 'GOOD' | 'WARN' | 'POOR';
  score: number;
  brightness?: number;
  contrast?: number;
  width?: number;
  height?: number;
  reasons: Array<{ code?: string; message: string }>;
}

export interface ImageQueueItem {
  id: string;
  file: File;
  preview: string;
  width: number;
  height: number;
  megapixels: number;
  quality: ImageQualityReport;
}

export interface InspectionRecord {
  id: string;
  user_id?: string;
  status: string;
  provider?: string;
  context: InspectionContext;
  quality?: ImageQualityReport;
  images?: string[];
  image_urls?: string[];
  extraction?: InspectionExtraction;
  assessment?: InspectionAssessment;
  review_decisions?: Record<string, string | { decision: string; reason?: string }>;
  created_at?: string;
  updated_at?: string;
}

export interface HealthResponse {
  status: string;
  database?: {
    configured: boolean;
    adapter: string;
  };
  vision?: {
    provider: string;
    configured: boolean;
  };
  ruleset?: {
    version: string;
    rules_count: number;
  };
  storage?: {
    direct_upload: boolean;
  };
}

export interface DatabaseRule {
  id: string;
  ruleId: string;
  title: string;
  source: string;
  purpose: string;
  category: string;
  verificationMode: string;
  fieldTarget?: string | null;
  statutoryThreshold?: string | null;
  validationRegex?: string | null;
  applicabilityPredicate?: Record<string, unknown> | null;
  active?: boolean;
}
