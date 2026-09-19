import type {
  DatabaseRule,
  Decision,
  HealthResponse,
  ImageQualityReport,
  InspectionContext,
  InspectionRecord,
  Role,
} from './types.ts';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function demoToken(email: string, role: Role): string {
  const payload = { email, role, timestamp: Date.now() };
  return btoa(JSON.stringify(payload));
}

async function fetchJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    let errorMsg = `API request failed with status ${response.status}`;
    try {
      const data = await response.json();
      if (data.error) errorMsg = data.error;
      else if (data.message) errorMsg = data.message;
    } catch {
      // Ignore JSON parse errors on non-200
    }
    throw new ApiError(errorMsg, response.status);
  }

  return response.json() as Promise<T>;
}

export async function getHealth(token?: string): Promise<HealthResponse> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetchJson<HealthResponse>('/api/health', { headers });
}

export async function getRules(token?: string): Promise<DatabaseRule[]> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetchJson<DatabaseRule[]>('/api/rules', { headers });
}

export async function listInspections(token: string): Promise<InspectionRecord[]> {
  return fetchJson<InspectionRecord[]>('/api/inspections', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createInspection(
  token: string,
  context: InspectionContext,
  imageNames: string[],
  quality: ImageQualityReport
): Promise<InspectionRecord> {
  return fetchJson<InspectionRecord>('/api/inspections', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      context,
      image_names: imageNames,
      quality,
    }),
  });
}

export async function analyzeInspection(
  token: string,
  id: string,
  payload: {
    images: Array<{ name: string; mime_type: string; data: string; quality: ImageQualityReport }>;
    image_urls?: string[];
    context: InspectionContext;
    requested_provider?: string;
  }
): Promise<InspectionRecord> {
  return fetchJson<InspectionRecord>(`/api/inspections/${id}/analyze`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

export async function reviewRule(
  token: string,
  id: string,
  ruleId: string,
  decision: Decision,
  reason: string
): Promise<InspectionRecord> {
  return fetchJson<InspectionRecord>(`/api/inspections/${id}/review`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      rule_id: ruleId,
      decision,
      reason,
    }),
  });
}

export async function getReport(token: string, id: string): Promise<unknown> {
  return fetchJson<unknown>(`/api/inspections/${id}/report`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getAuditEvents(token: string): Promise<unknown[]> {
  return fetchJson<unknown[]>('/api/audit-events', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function directUploadImages(
  _token: string,
  _files: File[]
): Promise<string[]> {
  return [];
}
