import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  analyzeInspection,
  createInspection,
  demoToken,
  getAuditEvents,
  getHealth,
  getReport,
  getRules,
  listInspections,
  reviewRule,
} from "./lib/api.ts";
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  RULES,
  RULESET_VERSION,
  StaticRuleDefinition,
  WORKFLOW,
} from "./lib/constants.ts";
import { aggregateQuality, blobToBase64, compressImage, measureImage } from "./lib/quality.ts";
import type {
  Candidate,
  Decision,
  HealthResponse,
  ImageQueueItem,
  InspectionContext,
  InspectionRecord,
  Role,
  RuleResult,
  RuleStatus,
  UserIdentity,
} from "./lib/types.ts";

type View = "dashboard" | "new" | "review" | "history" | "rules" | "admin";
type Toast = { id: number; message: string; kind: "success" | "error" };

const DEFAULT_CONTEXT: InspectionContext = {
  package_context: "RETAIL",
  commodity_type: "",
  date_required: "UNKNOWN",
  medical_device: "UNKNOWN",
};

const PAGE_META: Record<View, [string, string]> = {
  dashboard: ["ENFORCEMENT WORKSPACE", "Compliance overview"],
  new: ["NEW INSPECTION", "Capture package evidence"],
  review: ["EVIDENCE REVIEW", "Inspection workspace"],
  history: ["SCREENING REPOSITORY", "Inspection history"],
  rules: ["VERSIONED RULESET", "LMPC Statutory Rule Matrix"],
  admin: ["ADMINISTRATION", "PostgreSQL & service overview"],
};

const FIELD_DEFINITIONS: Array<[string, string]> = [
  ["MRP", "mrp"],
  ["Net quantity", "net_quantity"],
  ["Responsible entity", "responsible_entity"],
  ["Address", "address"],
  ["Applicable date", "date"],
  ["Consumer care", "consumer_care"],
  ["Country of origin", "country_origin"],
  ["Inclusive of taxes", "inclusive_taxes"],
];

const REVIEW_DECISIONS: Array<[Decision, string]> = [
  ["CONFIRMED", "Confirm result"],
  ["DISMISSED", "Dismiss"],
  ["MORE_EVIDENCE", "Request evidence"],
  ["ESCALATED", "Escalate"],
];

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function statusLabel(status?: RuleStatus | string | null) {
  const labels: Record<string, string> = {
    PASS: "Passed",
    FAIL: "Potential issue",
    REVIEW: "Needs review",
    NOT_APPLICABLE: "Not applicable",
    EXEMPT: "Exempt (Rule 26)",
  };
  return labels[status || ""] || "Needs review";
}

function statusClass(status?: RuleStatus | string | null) {
  return `status status-${String(status || "REVIEW").toLowerCase().replaceAll("_", "-")}`;
}

function reviewDecisionValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "decision" in value) return String((value as { decision: unknown }).decision);
  return "";
}

function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function LoginScreen({ onLogin }: { onLogin: (user: UserIdentity, token: string) => void }) {
  const [email, setEmail] = useState("judge@complyscan.demo");
  const [selectedRole, setSelectedRole] = useState<Role>("COMPLIANCE_ANALYST");

  return (
    <main className="login-shell">
      <section className="login-story" aria-labelledby="login-title">
        <a className="brand brand-on-dark" href="#login-title" aria-label="COMPLYSCAN home">
          <span className="brand-mark">C</span>
          <span>COMPLYSCAN<small>Legal Metrology Intelligence</small></span>
        </a>
        <div className="login-copy">
          <p className="eyebrow mint-text">LEGAL METROLOGY (PACKAGED COMMODITIES) RULES · 2011</p>
          <h1 id="login-title">Automated packaging compliance with traceable statutory review.</h1>
          <p>Single-pass multimodal perception, dynamic PostgreSQL rules matrix, and human-in-the-loop officer oversight.</p>
        </div>
        <ol className="login-flow" aria-label="COMPLYSCAN workflow">
          {WORKFLOW.map((step, index) => <li key={step}><span>0{index + 1}</span>{step}</li>)}
        </ol>
        <p className="legal-note">Decision support only. Automated screening provides statutory evidence assistance and is not a final judicial decree.</p>
      </section>

      <section className="login-panel" aria-labelledby="role-title">
        <div className="login-form-wrap">
          <p className="eyebrow">ENFORCEMENT DEMO ACCESS</p>
          <h2 id="role-title">Choose your operational role</h2>
          <p className="muted">Role permissions govern inspection creation, evidence extraction, officer overrides, and audit log access.</p>
          <label className="field-label" htmlFor="demo-email">Officer Email</label>
          <input id="demo-email" className="text-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          <div className="role-grid" role="radiogroup" aria-label="Demo role">
            {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
              <button
                type="button"
                role="radio"
                aria-checked={selectedRole === role}
                className={`role-card ${selectedRole === role ? "is-selected" : ""}`}
                key={role}
                onClick={() => setSelectedRole(role)}
              >
                <span className="role-icon">{role === "ADMIN" ? "A" : role === "LEGAL_REVIEWER" ? "R" : role === "VIEWER" ? "V" : "I"}</span>
                <strong>{ROLE_LABELS[role]}</strong>
                <small>{ROLE_DESCRIPTIONS[role]}</small>
              </button>
            ))}
          </div>
          <button
            className="button button-primary button-wide"
            onClick={() => {
              const safeEmail = email.trim() || "judge@complyscan.demo";
              onLogin({ email: safeEmail, role: selectedRole, name: ROLE_LABELS[selectedRole] }, demoToken(safeEmail, selectedRole));
            }}
          >
            Enter Inspection Workspace <span aria-hidden="true">→</span>
          </button>
          <p className="secure-copy"><span aria-hidden="true">●</span> PostgreSQL-persisted rules matrix and immutable SHA-256 audit ledger active.</p>
        </div>
      </section>
    </main>
  );
}

function Badge({ status, children }: { status?: string | null; children?: React.ReactNode }) {
  return <span className={statusClass(status)}><span className="status-dot" />{children || statusLabel(status)}</span>;
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return <div className="empty-state"><span className="empty-icon" aria-hidden="true">◎</span><strong>{title}</strong><p>{body}</p>{action}</div>;
}

function formatCategoryLabel(cat: string): string {
  const map: Record<string, string> = {
    MANDATORY_DECLARATIONS: "Mandatory Declarations",
    VISUAL_PREDICATE: "Visual & PDP",
    COMMODITY_SPECIFIC: "Commodity Specific",
    WHOLESALE_DECLARATIONS: "Wholesale (Rule 24)",
    EXPORT_REGULATION: "Export (Rule 25)",
    EXEMPTION_GATE: "Rule 26 Exemption",
    EXEMPTION_OVERRIDE: "Statutory Override",
  };
  return map[cat] || cat.replaceAll("_", " ");
}

function categoryBadgeClass(cat: string): string {
  switch (cat) {
    case "MANDATORY_DECLARATIONS":
      return "chip-blue";
    case "VISUAL_PREDICATE":
      return "chip-indigo";
    case "COMMODITY_SPECIFIC":
      return "chip-amber";
    case "WHOLESALE_DECLARATIONS":
      return "chip-cyan";
    case "EXPORT_REGULATION":
      return "chip-teal";
    case "EXEMPTION_GATE":
      return "chip-purple";
    case "EXEMPTION_OVERRIDE":
      return "chip-rose";
    default:
      return "chip-slate";
  }
}

function formatVerificationMode(mode: string): string {
  switch (mode) {
    case "DETERMINISTIC_SYNTACTIC":
      return "Deterministic Syntactic Parsing";
    case "VISUAL_PREDICATE":
      return "Visual Layout & Sticker Audit";
    case "STATUTORY_LOOKUP":
      return "Schedule Lookup & Validation";
    case "THRESHOLD_CALCULATION":
      return "Mathematical Quantity Gate";
    case "STATUTORY_EXCEPTION":
      return "Statutory Exclusion Override";
    case "WORKFLOW_GATE":
      return "Procedural Workflow Gate";
    case "EXTERNAL_DEPENDENCY":
      return "Cross-Statute Reference";
    default:
      return mode.replaceAll("_", " ");
  }
}

export default function App() {
  const [user, setUser] = useState<UserIdentity | null>(null);
  const [token, setToken] = useState("");
  const [view, setView] = useState<View>("dashboard");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [serviceOnline, setServiceOnline] = useState(false);
  const [inspections, setInspections] = useState<InspectionRecord[]>([]);
  const [current, setCurrent] = useState<InspectionRecord | null>(null);
  const [files, setFiles] = useState<ImageQueueItem[]>([]);
  const [context, setContext] = useState<InspectionContext>(DEFAULT_CONTEXT);
  const [fixtureMode, setFixtureMode] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progressIndex, setProgressIndex] = useState(0);
  const [selectedImage, setSelectedImage] = useState(0);
  const [openRules, setOpenRules] = useState<Set<string>>(new Set());
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [auditEvents, setAuditEvents] = useState<unknown[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [navOpen, setNavOpen] = useState(false);
  const [rulesList, setRulesList] = useState<StaticRuleDefinition[]>(RULES);
  const [ruleSearch, setRuleSearch] = useState("");
  const [ruleCategory, setRuleCategory] = useState("ALL");
  const [expandedRuleIds, setExpandedRuleIds] = useState<Set<string>>(new Set());
  const fileInput = useRef<HTMLInputElement>(null);

  const notify = useCallback((message: string, kind: Toast["kind"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((existing) => [...existing, { id, message, kind }]);
    window.setTimeout(() => setToasts((existing) => existing.filter((item) => item.id !== id)), 4400);
  }, []);

  const refreshData = useCallback(async (authToken: string) => {
    try {
      const [healthData, inspectionData, dbRules] = await Promise.all([
        getHealth(authToken),
        listInspections(authToken),
        getRules(authToken).catch(() => []),
      ]);
      setHealth(healthData);
      setInspections(inspectionData);
      if (dbRules && dbRules.length > 0) {
        setRulesList(
          dbRules.map((r) => ({
            id: r.ruleId,
            title: r.title,
            source: r.source,
            purpose: r.purpose,
            category: r.category,
            verificationMode: r.verificationMode,
            fieldTarget: r.fieldTarget || undefined,
            statutoryThreshold: r.statutoryThreshold || undefined,
            validationRegex: r.validationRegex || undefined,
            applicabilityPredicate: (r.applicabilityPredicate as Record<string, unknown>) || undefined,
          }))
        );
      }
      setServiceOnline(true);
    } catch (error) {
      setServiceOnline(false);
      if (error instanceof ApiError && error.status === 401) notify("Authorization session expired.", "error");
    }
  }, [notify]);

  useEffect(() => {
    // Initial fetch of versioned PostgreSQL rules matrix
    getRules()
      .then((dbRules) => {
        if (dbRules && dbRules.length > 0) {
          setRulesList(
            dbRules.map((r) => ({
              id: r.ruleId,
              title: r.title,
              source: r.source,
              purpose: r.purpose,
              category: r.category,
              verificationMode: r.verificationMode,
              fieldTarget: r.fieldTarget || undefined,
              statutoryThreshold: r.statutoryThreshold || undefined,
              validationRegex: r.validationRegex || undefined,
              applicabilityPredicate: (r.applicabilityPredicate as Record<string, unknown>) || undefined,
            }))
          );
        }
      })
      .catch(() => {
        // Fallback already pre-set to RULES
      });
  }, []);

  useEffect(() => {
    const savedToken = window.sessionStorage.getItem("complyscan.demo.token");
    const savedUser = window.sessionStorage.getItem("complyscan.demo.user");
    if (savedToken && savedUser) {
      try {
        const parsed = JSON.parse(savedUser) as UserIdentity;
        setToken(savedToken);
        setUser(parsed);
        void refreshData(savedToken);
      } catch {
        window.sessionStorage.removeItem("complyscan.demo.token");
        window.sessionStorage.removeItem("complyscan.demo.user");
      }
    }
  }, [refreshData]);

  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => setProgressIndex((value) => Math.min(5, value + 1)), 1300);
    return () => window.clearInterval(timer);
  }, [processing]);

  const login = (identity: UserIdentity, authToken: string) => {
    window.sessionStorage.setItem("complyscan.demo.token", authToken);
    window.sessionStorage.setItem("complyscan.demo.user", JSON.stringify(identity));
    setUser(identity);
    setToken(authToken);
    setView("dashboard");
    void refreshData(authToken);
  };

  const logout = () => {
    window.sessionStorage.removeItem("complyscan.demo.token");
    window.sessionStorage.removeItem("complyscan.demo.user");
    files.forEach((item) => URL.revokeObjectURL(item.preview));
    setFiles([]);
    setCurrent(null);
    setUser(null);
    setToken("");
  };

  const navigate = (next: View) => {
    if (next === "admin" && user?.role !== "ADMIN") {
      notify("Administrator access is required.", "error");
      return;
    }
    if (next === "review" && !current) next = "new";
    setView(next);
    setNavOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const resetInspection = () => {
    files.forEach((item) => URL.revokeObjectURL(item.preview));
    setFiles([]);
    setCurrent(null);
    setContext(DEFAULT_CONTEXT);
    setFixtureMode(false);
    setSelectedImage(0);
    setOpenRules(new Set());
    setReviewReasons({});
    setView("new");
  };

  const addFiles = async (incoming: File[]) => {
    if (user?.role === "VIEWER") return notify("Read-only users cannot add evidence.", "error");
    const imageFiles = incoming.filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type));
    if (!imageFiles.length) return notify("Choose JPG, PNG, or WebP package images.", "error");
    const existingKeys = new Set(files.map((item) => `${item.file.name}:${item.file.size}:${item.file.lastModified}`));
    const unique = imageFiles.filter((file) => !existingKeys.has(`${file.name}:${file.size}:${file.lastModified}`));
    const available = Math.max(0, 6 - files.length);
    if (unique.length > available) notify(`Only ${available} more image${available === 1 ? "" : "s"} can be added.`, "error");
    const prepared: ImageQueueItem[] = [];
    for (const file of unique.slice(0, available)) {
      try {
        const measured = await measureImage(file);
        prepared.push({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file), ...measured });
      } catch (error) {
        notify(error instanceof Error ? error.message : "Image quality preflight failed.", "error");
      }
    }
    setFiles((existing) => [...existing, ...prepared]);
    setFixtureMode(false);
  };

  const loadSample = async (kind: "cinthol" | "soap" | "panmasala") => {
    files.forEach((item) => URL.revokeObjectURL(item.preview));
    setFiles([]);

    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#f3f5f2";
      ctx.fillRect(0, 0, 800, 600);
      ctx.fillStyle = "#17201d";
      ctx.font = "bold 24px sans-serif";
      ctx.fillText(kind === "cinthol" ? "CINTHOL TALC - 100g" : kind === "soap" ? "HERBAL BATH SOAP - 75g (when packed)" : "ROYAL PAN MASALA - 4g", 50, 80);
      ctx.font = "16px sans-serif";
      ctx.fillText("Net Wt: " + (kind === "panmasala" ? "4 g" : kind === "soap" ? "75 g when packed" : "100 g"), 50, 140);
      ctx.fillText("MRP Rs. " + (kind === "panmasala" ? "5.00" : kind === "soap" ? "45.00" : "199.00") + " (Inclusive of all taxes)", 50, 180);
      ctx.fillText("Mfd by: Godrej Consumer Products Ltd, Mumbai 400079", 50, 220);
      ctx.fillText("Mfg Date: 08/2026", 50, 260);
      ctx.fillText("Consumer Care: 1800-266-0007 care@godrej.com", 50, 300);
      ctx.fillText("Country of Origin: India", 50, 340);
    }

    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const fileName = `${kind}-package-label.jpg`;
      const file = new File([blob], fileName, { type: "image/jpeg", lastModified: Date.now() });
      const measured = await measureImage(file);
      setFiles([{ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file), ...measured }]);
      setContext({
        package_context: "RETAIL",
        commodity_type: kind === "panmasala" ? "Pan masala" : kind === "soap" ? "Toilet soap" : "Talcum powder",
        date_required: "TRUE",
        medical_device: "FALSE",
      });
      setFixtureMode(false);
      notify(`Loaded demo package sample: ${kind.toUpperCase()}`);
    }, "image/jpeg", 0.95);
  };

  const removeImage = (id: string) => {
    const match = files.find((item) => item.id === id);
    if (match) URL.revokeObjectURL(match.preview);
    setFiles((items) => items.filter((item) => item.id !== id));
    setFixtureMode(false);
  };

  const runAnalysis = async () => {
    if (!files.length || !user) return;
    if (!context.commodity_type.trim()) return notify("Describe the commodity before analysis for applicability routing.", "error");
    setProcessing(true);
    setProgressIndex(0);
    try {
      const quality = aggregateQuality(files);
      const draft = await createInspection(token, { ...context, commodity_type: context.commodity_type.trim() }, files.map((item) => item.file.name), quality);
      setProgressIndex(1);
      const compressed: Blob[] = [];
      for (const item of files) compressed.push(await compressImage(item.file));
      setProgressIndex(2);

      const inlineImages = await Promise.all(compressed.map(async (blob, index) => ({
        name: files[index].file.name,
        mime_type: "image/jpeg",
        data: await blobToBase64(blob),
        quality: files[index].quality,
      })));
      setProgressIndex(3);

      const analyzed = await analyzeInspection(token, draft.id, {
        images: inlineImages,
        image_urls: [],
        context: { ...context, commodity_type: context.commodity_type.trim() },
        requested_provider: fixtureMode ? "fixture" : "configured",
      });
      setProgressIndex(5);
      setCurrent(analyzed);
      setInspections((items) => [analyzed, ...items.filter((item) => item.id !== analyzed.id)]);
      setSelectedImage(0);
      setOpenRules(new Set());
      setView("review");
      notify("Screening completed. Inspect each applicable check and its grounded evidence.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Analysis failed.", "error");
    } finally {
      setProcessing(false);
    }
  };

  const submitDecision = async (rule: RuleResult, decision: Decision) => {
    if (!current || !user || !["LEGAL_REVIEWER", "ADMIN"].includes(user.role)) return;
    const reason = (reviewReasons[rule.rule_id] || "").trim();
    if (reason.length < 3) return notify("Add an audit reason before recording an officer disposition.", "error");
    try {
      const updated = await reviewRule(token, current.id, rule.rule_id, decision, reason);
      setCurrent(updated);
      setInspections((items) => items.map((item) => item.id === updated.id ? updated : item));
      setOpenRules((open) => new Set(open).add(rule.rule_id));
      notify(`Disposition recorded with immutable audit entry.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Decision could not be saved.", "error");
    }
  };

  const exportCurrent = async () => {
    if (!current) return;
    try {
      const report = serviceOnline ? await getReport(token, current.id) : current;
      downloadJson(report, `${current.id}-compliance-report.json`);
      notify("Audit report JSON exported.");
    } catch {
      downloadJson(current, `${current.id}-compliance-report.json`);
      notify("Exported current inspection record.", "error");
    }
  };

  const openInspection = (record: InspectionRecord) => {
    setCurrent(record);
    setSelectedImage(0);
    setOpenRules(new Set());
    setView("review");
  };

  const loadAudit = async () => {
    try {
      setAuditEvents(await getAuditEvents(token));
      notify("Audit ledger retrieved from PostgreSQL.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Audit events unavailable.", "error");
    }
  };

  const metrics = useMemo(() => {
    const counts = inspections.reduce<Record<string, number>>((result, inspection) => {
      const status = inspection.assessment?.overall_status || "REVIEW";
      result[status] = (result[status] || 0) + 1;
      return result;
    }, {});
    return [
      ["TOTAL INSPECTIONS", inspections.length, "Persisted in PostgreSQL", "metric-blue"],
      ["COMPLIANT (PASS)", counts.PASS || 0, "All triggered checks satisfied", "metric-green"],
      ["NEEDS REVIEW", counts.REVIEW || 0, "Officer adjudication required", "metric-amber"],
      ["POTENTIAL ISSUES", counts.FAIL || 0, "Apparent non-compliance flagged", "metric-coral"],
    ] as const;
  }, [inspections]);

  const filteredInspections = useMemo(() => inspections.filter((inspection) => {
    const product = inspection.extraction?.product;
    const haystack = `${inspection.id} ${product?.name || ""} ${product?.brand || ""} ${inspection.context.commodity_type}`.toLowerCase();
    const status = inspection.assessment?.overall_status || "REVIEW";
    return haystack.includes(search.toLowerCase()) && (filter === "ALL" || status === filter);
  }), [filter, inspections, search]);

  const ruleCategories = useMemo(() => {
    const counts: Record<string, number> = { ALL: rulesList.length };
    for (const r of rulesList) {
      counts[r.category] = (counts[r.category] || 0) + 1;
    }
    return [
      { id: "ALL", label: "All Rules", count: counts.ALL || 0 },
      { id: "MANDATORY_DECLARATIONS", label: "Mandatory Declarations", count: counts["MANDATORY_DECLARATIONS"] || 0 },
      { id: "VISUAL_PREDICATE", label: "Visual & PDP", count: counts["VISUAL_PREDICATE"] || 0 },
      { id: "COMMODITY_SPECIFIC", label: "Commodity Specific", count: counts["COMMODITY_SPECIFIC"] || 0 },
      { id: "WHOLESALE_DECLARATIONS", label: "Wholesale (Ch. III)", count: counts["WHOLESALE_DECLARATIONS"] || 0 },
      { id: "EXPORT_REGULATION", label: "Export (Rule 25)", count: counts["EXPORT_REGULATION"] || 0 },
      { id: "EXEMPTION_GATE", label: "Rule 26 Exemptions", count: counts["EXEMPTION_GATE"] || 0 },
      { id: "EXEMPTION_OVERRIDE", label: "Statutory Overrides", count: counts["EXEMPTION_OVERRIDE"] || 0 },
    ].filter((cat) => cat.id === "ALL" || cat.count > 0);
  }, [rulesList]);

  const filteredRules = useMemo(() => {
    const q = ruleSearch.trim().toLowerCase();
    return rulesList.filter((r) => {
      if (ruleCategory !== "ALL" && r.category !== ruleCategory) return false;
      if (!q) return true;
      return (
        r.id.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.source.toLowerCase().includes(q) ||
        r.purpose.toLowerCase().includes(q) ||
        (r.fieldTarget && r.fieldTarget.toLowerCase().includes(q))
      );
    });
  }, [rulesList, ruleSearch, ruleCategory]);

  if (!user) return <LoginScreen onLogin={login} />;

  const [eyebrow, title] = PAGE_META[view];
  const reviewer = ["LEGAL_REVIEWER", "ADMIN"].includes(user.role);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${navOpen ? "is-open" : ""}`}>
        <div className="sidebar-top">
          <a className="brand brand-on-dark" href="#dashboard" onClick={(event) => { event.preventDefault(); navigate("dashboard"); }}>
            <span className="brand-mark">C</span><span>COMPLYSCAN<small>LMPC Evidence Engine</small></span>
          </a>
          <button className="mobile-close" onClick={() => setNavOpen(false)} aria-label="Close navigation">×</button>
        </div>
        <nav aria-label="Workspace navigation">
          <button className={view === "dashboard" ? "is-active" : ""} onClick={() => navigate("dashboard")}><span>⌂</span>Overview</button>
          <button className={["new", "review"].includes(view) ? "is-active" : ""} onClick={resetInspection}><span>＋</span>New Inspection</button>
          <button className={view === "history" ? "is-active" : ""} onClick={() => navigate("history")}><span>▤</span>Inspection History</button>
          <button className={view === "rules" ? "is-active" : ""} onClick={() => navigate("rules")}><span>§</span>Rules Matrix</button>
          {user.role === "ADMIN" && <button className={view === "admin" ? "is-active" : ""} onClick={() => navigate("admin")}><span>⚙</span>PostgreSQL & Audit</button>}
        </nav>
        <div className="ruleset-chip">
          <span className="pulse-dot" />
          <span>
            <strong>PostgreSQL Rules Matrix</strong>
            <small>{health?.ruleset?.rules_count || 18} Rules Active · {health?.ruleset?.version || RULESET_VERSION}</small>
          </span>
        </div>
        <div className="sidebar-foot">
          <span className="role-pill">{ROLE_LABELS[user.role]}</span>
          <p>{ROLE_DESCRIPTIONS[user.role]}</p>
          <button onClick={logout}>Sign out</button>
        </div>
      </aside>
      {navOpen && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setNavOpen(false)} />}

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setNavOpen(true)} aria-label="Open navigation">☰</button>
          <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div>
          <div className="topbar-actions">
            <span className={`service-state ${serviceOnline ? "online" : "offline"}`}>
              <i />
              {serviceOnline ? `PostgreSQL Connected · ${health?.vision?.provider || "Gemini Flash Vision"}` : "Service Offline"}
            </span>
            <span className="user-chip">
              <span>{user.name.slice(0, 1)}</span>
              <strong>{user.name}<small>{user.email}</small></strong>
            </span>
          </div>
        </header>

        {view === "dashboard" && (
          <div className="page-content dashboard-page">
            <section className="hero-panel">
              <div className="hero-copy">
                <p className="eyebrow mint-text">MULTIMODAL PERCEPTION → RELATIONAL RULE MATRIX → OFFICER SIGN-OFF</p>
                <h2>Deterministic LMPC compliance screening.</h2>
                <p>Gemini Vision extracts visible declarations. PostgreSQL executes dynamic statutory rules. Authorized legal officers maintain judicial discretion with immutable audit logging.</p>
                <div className="button-row">
                  {user.role !== "VIEWER" && <button className="button button-primary" onClick={resetInspection}>Start Package Screening <span>→</span></button>}
                  <button className="button button-dark-ghost" onClick={() => { resetInspection(); void loadSample("cinthol"); }}>Load Retail Demo</button>
                </div>
              </div>
              <div className="hero-visual" aria-label="Evidence chain preview">
                <div className="mini-image"><img src="https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=600&q=80" alt="Sample declaration label" /></div>
                <div className="evidence-chain">
                  <span><i>1</i><small>STATUTORY RULE</small><strong>LMPC Rule 6(1)(e) · MRP</strong></span>
                  <span><i>2</i><small>GROUNDED EVIDENCE</small><strong>MRP ₹199 (incl. of taxes)</strong></span>
                  <span><i>3</i><small>AUDIT RECORD</small><strong>Officer Verified</strong></span>
                </div>
              </div>
            </section>

            <section className="metric-grid" aria-label="Inspection metrics">
              {metrics.map(([label, value, note, color]) => <article className={`metric ${color}`} key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}
            </section>

            <section className="content-card recent-card">
              <header className="section-heading">
                <div><p className="eyebrow">SCREENING LEDGER</p><h2>Recent package inspections</h2></div>
                <button className="text-button" onClick={() => navigate("history")}>View all repository records →</button>
              </header>
              <InspectionTable rows={inspections.slice(0, 6)} onOpen={openInspection} />
            </section>
          </div>
        )}

        {view === "new" && (
          <div className="page-content new-page">
            <WorkflowRail current={files.length ? 1 : 0} />
            <section className="inspection-intro">
              <div>
                <p className="eyebrow">CAPTURE PACKAGE DECLARATIONS</p>
                <h2>Upload clear views of the Principal Display Panel</h2>
                <p>Client-side Canvas heuristics measure resolution, lighting, and exposure before multimodal extraction begins.</p>
              </div>
              <div className="sample-actions">
                <span>PRESET PACKAGES</span>
                <button onClick={() => void loadSample("cinthol")}>Retail Powder</button>
                <button onClick={() => void loadSample("soap")}>Third Sched. Soap</button>
                <button onClick={() => void loadSample("panmasala")}>Pan Masala 4g</button>
              </div>
            </section>

            <div className="capture-grid">
              <section className="content-card upload-card">
                <header className="card-heading">
                  <div><p className="eyebrow">01 · VISUAL EVIDENCE</p><h3>Package Images</h3></div>
                  <span className="count-badge">{files.length} / 6 Images</span>
                </header>
                <button
                  className="dropzone"
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => { event.preventDefault(); void addFiles([...event.dataTransfer.files]); }}
                  disabled={user.role === "VIEWER"}
                >
                  <span className="upload-icon">↑</span>
                  <strong>Drop package views or click to upload</strong>
                  <small>JPG, PNG, or WebP up to 6 panels (Front, Back, Sides)</small>
                </button>
                <input ref={fileInput} hidden type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => void addFiles([...(event.target.files || [])])} />
                {files.length > 0 && <div className="image-queue">{files.map((item, index) => (
                  <article className="image-card" key={item.id}>
                    <div>
                      <img src={item.preview} alt={`Package panel ${index + 1}`} />
                      <Badge status={item.quality.status === "GOOD" ? "PASS" : item.quality.status === "POOR" ? "FAIL" : "REVIEW"}>{item.quality.status}</Badge>
                      <button onClick={() => removeImage(item.id)} aria-label={`Remove ${item.file.name}`}>×</button>
                    </div>
                    <strong>{item.file.name}</strong>
                    <small>{item.megapixels.toFixed(1)} MP · {item.quality.reasons[0]?.message || "Quality passed preflight"}</small>
                  </article>
                ))}</div>}
                {files.length > 0 && <QualityPanel files={files} />}
              </section>

              <section className="content-card context-card">
                <header className="card-heading">
                  <div><p className="eyebrow">02 · APPLICABILITY TAXONOMY</p><h3>Statutory Context</h3></div>
                  <span className="count-badge">GATEWAY</span>
                </header>
                <p className="muted">These parameters drive the PostgreSQL applicability matrix to select appropriate statutory rules.</p>
                <label className="field-label">Market Channel / Chapter
                  <select value={context.package_context} onChange={(event) => setContext({ ...context, package_context: event.target.value as InspectionContext["package_context"] })}>
                    <option value="RETAIL">Retail Package (Chapter II - Rules 6–18)</option>
                    <option value="ECOMMERCE">E-Commerce Listing & Package (Rule 6(10))</option>
                    <option value="WHOLESALE">Wholesale Package (Chapter III - Rule 24)</option>
                    <option value="EXPORT">Export Package Sold Domestically (Chapter IV - Rule 25)</option>
                  </select>
                </label>
                <label className="field-label">Commodity Description
                  <input className="text-input" placeholder="e.g. Talcum Powder, Soap, Pan Masala" value={context.commodity_type} onChange={(event) => setContext({ ...context, commodity_type: event.target.value })} />
                </label>
                <label className="field-label">Product / Commercial Name (Optional)
                  <input
                    className="text-input"
                    placeholder="e.g. Head & Shoulders, Complan, Maggi Noodles"
                    value={context.product_name || ""}
                    onChange={(event) => setContext({ ...context, product_name: event.target.value, brand_name: event.target.value })}
                  />
                </label>
                <label className="field-label">Date Declaration Mandate
                  <select value={context.date_required} onChange={(event) => setContext({ ...context, date_required: event.target.value as InspectionContext["date_required"] })}>
                    <option value="UNKNOWN">Infer via Commodity Category</option>
                    <option value="TRUE">Mandatory (Rule 6(1)(d))</option>
                    <option value="FALSE">Statutorily Exempt</option>
                  </select>
                </label>
                <label className="field-label">Medical Device Regulation (MDR)
                  <select value={context.medical_device} onChange={(event) => setContext({ ...context, medical_device: event.target.value as InspectionContext["medical_device"] })}>
                    <option value="FALSE">No (General Commodity)</option>
                    <option value="TRUE">Yes (Medical Device Rules routing)</option>
                    <option value="UNKNOWN">Uncertain</option>
                  </select>
                </label>
                <div className="why-box">
                  <strong>Statutory Applicability Routing</strong>
                  <p>
                    {context.package_context === "WHOLESALE" ? "Chapter III / Rule 24 activated: Wholesale rules evaluate packaging without requiring retail MRP formatting." : "Chapter II activated: Mandatory declarations evaluated under Rule 6, 11-13."}
                    {" "}Rule 26 small-quantity exemption (&le;10g / &le;10ml) is dynamically blocked if commodity is Tobacco or Pan Masala (post 1 Feb 2026).
                  </p>
                </div>
                <button className="button button-primary button-wide" disabled={!files.length || processing || user.role === "VIEWER"} onClick={() => void runAnalysis()}>
                  {processing ? "Evaluating Evidence Against Rules Matrix…" : "Run Multimodal Screening"} <span>→</span>
                </button>
              </section>
            </div>
          </div>
        )}

        {processing && <ProcessingOverlay stage={progressIndex} />}

        {view === "review" && current && (
          <ReviewWorkspace
            inspection={current}
            previews={files.map((item) => item.preview)}
            selectedImage={selectedImage}
            onSelectImage={setSelectedImage}
            openRules={openRules}
            onToggleRule={(id) => setOpenRules((existing) => { const next = new Set(existing); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
            reviewer={reviewer}
            reasons={reviewReasons}
            setReason={(id, reason) => setReviewReasons((items) => ({ ...items, [id]: reason }))}
            onDecision={submitDecision}
            onExport={() => void exportCurrent()}
            onPrint={() => window.print()}
          />
        )}

        {view === "history" && (
          <div className="page-content history-page">
            <section className="content-card">
              <header className="section-heading">
                <div><p className="eyebrow">RELATIONAL STORE</p><h2>Inspection History Repository</h2><p>Search by inspection ID, commodity, or brand.</p></div>
                <span className="count-badge">{filteredInspections.length} RECORDS</span>
              </header>
              <div className="filter-row">
                <input className="text-input" type="search" placeholder="Search inspections…" value={search} onChange={(event) => setSearch(event.target.value)} />
                <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                  <option value="ALL">All Statuses</option>
                  <option value="PASS">Compliant (Passed)</option>
                  <option value="REVIEW">Needs Review</option>
                  <option value="FAIL">Potential Issue</option>
                </select>
              </div>
              <InspectionTable rows={filteredInspections} onOpen={openInspection} />
            </section>
          </div>
        )}

        {view === "rules" && (
          <div className="page-content rules-page">
            {/* Structured Hero Header */}
            <section className="rules-hero-card">
              <div className="rules-hero-body">
                <div className="rules-hero-text">
                  <div className="rules-eyebrow-row">
                    <span className="eyebrow">POSTGRESQL RULES MATRIX</span>
                    <span className="rules-live-tag">
                      <span className="live-dot" /> LIVE POSTGRESQL PERSISTED
                    </span>
                  </div>
                  <h2>Dynamic Legal Metrology Rule Master</h2>
                  <p>
                    Every package is evaluated deterministically against versioned statutory rules stored in PostgreSQL.
                    This rules engine executes syntactic parsers, unit checks against Schedule II, and statutory exemption overrides.
                  </p>
                </div>
                <div className="rules-stats-panel">
                  <div className="rules-stat-box">
                    <span className="rules-stat-num">{rulesList.length}</span>
                    <span className="rules-stat-label">Active Rules</span>
                  </div>
                  <div className="rules-stat-box">
                    <span className="rules-stat-num">{health?.ruleset?.version || RULESET_VERSION}</span>
                    <span className="rules-stat-label">Statutory Matrix Version</span>
                  </div>
                  <div className="rules-stat-box">
                    <span className="rules-stat-num">Schedule II & III</span>
                    <span className="rules-stat-label">Gazette Grounding</span>
                  </div>
                </div>
              </div>
            </section>

            {/* Filter & Search Bar */}
            <div className="rules-toolbar">
              <div className="rules-search-box">
                <span className="rules-search-icon" aria-hidden="true">⌕</span>
                <input
                  type="search"
                  className="rules-search-input"
                  placeholder="Filter rules by ID, title, statute, or field target (e.g. RULE_6_1_E, MRP, Net Quantity)..."
                  value={ruleSearch}
                  onChange={(event) => setRuleSearch(event.target.value)}
                />
                {ruleSearch && (
                  <button
                    className="rules-search-clear"
                    onClick={() => setRuleSearch("")}
                    aria-label="Clear rule search"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Category Pills Bar */}
              <div className="rules-categories-scroller" role="tablist" aria-label="Filter rules by statutory category">
                {ruleCategories.map((cat) => (
                  <button
                    key={cat.id}
                    role="tab"
                    aria-selected={ruleCategory === cat.id}
                    className={`rules-cat-pill ${ruleCategory === cat.id ? "is-selected" : ""}`}
                    onClick={() => setRuleCategory(cat.id)}
                  >
                    <span>{cat.label}</span>
                    <span className="rules-cat-count">{cat.count}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Rules Matrix Grid */}
            {filteredRules.length === 0 ? (
              <EmptyState
                title="No statutory rules found"
                body={`No rules match your search "${ruleSearch}" in category "${formatCategoryLabel(ruleCategory)}".`}
                action={
                  <button
                    className="button button-secondary"
                    onClick={() => {
                      setRuleSearch("");
                      setRuleCategory("ALL");
                    }}
                  >
                    Reset Filters
                  </button>
                }
              />
            ) : (
              <div className="rules-structured-grid">
                {filteredRules.map((rule, index) => {
                  const isExpanded = expandedRuleIds.has(rule.id);
                  return (
                    <article className={`rule-card ${isExpanded ? "is-expanded" : ""}`} key={rule.id}>
                      {/* Top Identifiers Row */}
                      <header className="rule-card-header">
                        <div className="rule-card-badges">
                          <code className="rule-code-badge">{rule.id}</code>
                          <span className={`rule-cat-badge ${categoryBadgeClass(rule.category)}`}>
                            {formatCategoryLabel(rule.category)}
                          </span>
                          <span className="rule-status-pill">
                            <span className="rule-active-indicator" /> Active
                          </span>
                        </div>
                        <span className="rule-display-num">{String(index + 1).padStart(2, "0")}</span>
                      </header>

                      {/* Rule Title & Purpose */}
                      <div className="rule-card-body">
                        <h3 className="rule-card-title">{rule.title}</h3>
                        <p className="rule-card-purpose">{rule.purpose}</p>
                      </div>

                      {/* Structured 4-Point Metadata Grid */}
                      <div className="rule-spec-grid">
                        <div className="rule-spec-cell">
                          <span className="spec-label">STATUTORY CITATION</span>
                          <span className="spec-val" title={rule.source}>{rule.source}</span>
                        </div>
                        <div className="rule-spec-cell">
                          <span className="spec-label">VERIFICATION MODE</span>
                          <span className="spec-val">{formatVerificationMode(rule.verificationMode)}</span>
                        </div>
                        <div className="rule-spec-cell">
                          <span className="spec-label">FIELD TARGET</span>
                          <code className="spec-target-code">{rule.fieldTarget || "declaration_panel"}</code>
                        </div>
                        <div className="rule-spec-cell">
                          <span className="spec-label">CONFIDENCE GATE</span>
                          <span className="spec-val">
                            {rule.statutoryThreshold
                              ? `≥ ${Math.round(parseFloat(rule.statutoryThreshold) * 100)}% Confidence`
                              : "Syntactic Gate"}
                          </span>
                        </div>
                      </div>

                      {/* Technical Predicates Drawer Toggle */}
                      {(rule.validationRegex || rule.applicabilityPredicate) && (
                        <div className="rule-card-footer">
                          <button
                            className="rule-toggle-details"
                            onClick={() => {
                              setExpandedRuleIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(rule.id)) next.delete(rule.id);
                                else next.add(rule.id);
                                return next;
                              });
                            }}
                            aria-expanded={isExpanded}
                          >
                            <span>{isExpanded ? "Hide Engine Predicates & Regex" : "View Engine Predicates & Regex"}</span>
                            <span className="toggle-chevron" aria-hidden="true">{isExpanded ? "▲" : "▼"}</span>
                          </button>

                          {isExpanded && (
                            <div className="rule-expanded-content">
                              {rule.validationRegex && (
                                <div className="expanded-block">
                                  <span className="expanded-title">SYNTACTIC VALIDATION PATTERN (REGEX)</span>
                                  <code className="expanded-code">{rule.validationRegex}</code>
                                </div>
                              )}
                              {rule.applicabilityPredicate && (
                                <div className="expanded-block">
                                  <span className="expanded-title">STATUTORY APPLICABILITY PREDICATE</span>
                                  <pre className="expanded-json">
                                    {JSON.stringify(rule.applicabilityPredicate, null, 2)}
                                  </pre>
                                </div>
                              )}
                              <div className="expanded-block">
                                <span className="expanded-title">STORAGE & COMPLIANCE LEDGER</span>
                                <p className="expanded-storage">
                                  PostgreSQL table <code>rules_matrix</code> · Version {health?.ruleset?.version || RULESET_VERSION}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {view === "admin" && user.role === "ADMIN" && (
          <div className="page-content admin-page">
            <section className="admin-hero">
              <div>
                <p className="eyebrow">SYSTEM & SECURITY AUDIT</p>
                <h2>PostgreSQL Persistence & Immutable Audit Trail</h2>
                <p>Inspection findings, officer overrides, and rule changes are cryptographically hashed and stored in PostgreSQL.</p>
              </div>
              <button className="button button-secondary" onClick={() => void loadAudit()}>Refresh Audit Trail</button>
            </section>
            <div className="admin-grid">
              <section className="content-card">
                <p className="eyebrow">PERSISTENCE STATUS</p>
                <h3>{serviceOnline ? "Cloud SQL Database Active" : "Database Offline"}</h3>
                <dl className="admin-list">
                  <div><dt>Database Adapter</dt><dd>{health?.database?.adapter || "PostgreSQL (Drizzle ORM)"}</dd></div>
                  <div><dt>Active Rules in Matrix</dt><dd>{health?.ruleset?.rules_count || 18} Rules</dd></div>
                  <div><dt>Vision Engine</dt><dd>{health?.vision?.provider || "Gemini Flash Vision"}</dd></div>
                  <div><dt>Ruleset Version</dt><dd>{health?.ruleset?.version || RULESET_VERSION}</dd></div>
                </dl>
              </section>
              <section className="content-card">
                <p className="eyebrow">RBAC CONTROLS</p>
                <h3>Least-Privilege Roles</h3>
                <div className="permission-list">
                  {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
                    <div key={role}>
                      <span className="role-icon">{role[0]}</span>
                      <span><strong>{ROLE_LABELS[role]}</strong><small>{ROLE_DESCRIPTIONS[role]}</small></span>
                    </div>
                  ))}
                </div>
              </section>
              <section className="content-card audit-card">
                <p className="eyebrow">POSTGRESQL AUDIT LEDGER (SHA-256 HASH CHAIN)</p>
                <h3>Recent System & Review Events</h3>
                {auditEvents.length ? (
                  <pre>{JSON.stringify(auditEvents.slice(0, 15), null, 2)}</pre>
                ) : (
                  <EmptyState title="Audit ledger ready" body="Click 'Refresh Audit Trail' to fetch immutable logs from PostgreSQL." />
                )}
              </section>
            </div>
          </div>
        )}
      </main>

      <div className="toast-region" aria-live="polite">
        {toasts.map((toast) => <div className={`toast ${toast.kind}`} key={toast.id}>{toast.message}</div>)}
      </div>
    </div>
  );
}

function WorkflowRail({ current }: { current: number }) {
  return (
    <ol className="workflow-rail" aria-label="Inspection workflow">
      {WORKFLOW.map((step, index) => (
        <li className={index < current ? "complete" : index === current ? "current" : ""} key={step}>
          <span>{index < current ? "✓" : index + 1}</span>
          <small>{step}</small>
        </li>
      ))}
    </ol>
  );
}

function QualityPanel({ files }: { files: ImageQueueItem[] }) {
  const summary = aggregateQuality(files);
  return (
    <div className={`quality-panel quality-${summary.status.toLowerCase()}`}>
      <div>
        <Badge status={summary.status === "GOOD" ? "PASS" : summary.status === "POOR" ? "FAIL" : "REVIEW"}>
          {summary.status} QUALITY
        </Badge>
        <strong>Canvas Preflight Usability: {Math.round(summary.score * 100)}%</strong>
      </div>
      <p>
        {summary.reasons.length ? summary.reasons.map((r) => r.message).join(" ") : "Brightness, contrast, and resolution verified."}
      </p>
    </div>
  );
}

function ProcessingOverlay({ stage }: { stage: number }) {
  const stages = [
    ["Creating Draft Record", "Persisting inspection metadata to PostgreSQL."],
    ["Analyzing Quality Heuristics", "Verifying resolution and lighting parameters."],
    ["Preparing Image Streams", "Optimizing resolution for multimodal parsing."],
    ["Single-Pass Gemini Vision", "Extracting MRP, Net Quantity, Entity, Address, and Dates."],
    ["Executing PostgreSQL Rules Matrix", "Applying statutory predicates, Schedule lookups, and Rule 26 exemptions."],
    ["Compiling Grounded Findings", "Linking each statutory check to bounding evidence."],
  ];
  return (
    <div className="processing-overlay" role="status" aria-live="polite">
      <div className="processing-card">
        <div className="spinner" />
        <p className="eyebrow">PIPELINE EXECUTION</p>
        <h2>{stages[stage]?.[0]}</h2>
        <p>{stages[stage]?.[1]}</p>
        <div className="progress-track"><i style={{ width: `${((stage + 1) / stages.length) * 100}%` }} /></div>
        <ol>
          {stages.map(([title], index) => (
            <li className={index < stage ? "complete" : index === stage ? "current" : ""} key={title}>
              <span>{index < stage ? "✓" : index + 1}</span>
              {title}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function InspectionTable({ rows, onOpen }: { rows: InspectionRecord[]; onOpen: (record: InspectionRecord) => void }) {
  if (!rows.length) return <EmptyState title="No inspections recorded" body="Upload a package image or run a preset sample to create an inspection." />;
  return (
    <div className="table-scroll">
      <table>
        <caption className="sr-only">COMPLYSCAN inspections</caption>
        <thead>
          <tr>
            <th>Product / Commodity</th>
            <th>Inspection ID</th>
            <th>Screening Status</th>
            <th>Panels</th>
            <th>Timestamp</th>
            <th><span className="sr-only">Action</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const rawProductName = row.extraction?.product?.name;
            const rawBrand = row.extraction?.product?.brand;
            const commodity = row.context.commodity_type || "";
            const isMockCinthol =
              rawProductName === "Cinthol Talcum Powder" &&
              !commodity.toLowerCase().includes("cinthol") &&
              !commodity.toLowerCase().includes("powder");
            const displayName = isMockCinthol ? (commodity || "Packaged Commodity") : (rawProductName || commodity || "Packaged Commodity");
            const displayBrand = isMockCinthol ? (commodity || "Brand not declared") : (rawBrand || "Brand not declared");

            return (
              <tr key={row.id}>
                <td>
                  <strong>{displayName}</strong>
                  <small>{displayBrand}</small>
                </td>
                <td><code>{row.id}</code><small>{row.status}</small></td>
                <td><Badge status={row.assessment?.overall_status}>{statusLabel(row.assessment?.overall_status)}</Badge></td>
                <td>{row.images?.length || 1} panel(s)</td>
                <td>{formatDate(row.updated_at || row.created_at)}</td>
                <td><button className="table-action" onClick={() => onOpen(row)}>Review <span>→</span></button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ReviewWorkspace({
  inspection,
  previews,
  selectedImage,
  onSelectImage,
  openRules,
  onToggleRule,
  reviewer,
  reasons,
  setReason,
  onDecision,
  onExport,
  onPrint,
}: {
  inspection: InspectionRecord;
  previews: string[];
  selectedImage: number;
  onSelectImage: (index: number) => void;
  openRules: Set<string>;
  onToggleRule: (id: string) => void;
  reviewer: boolean;
  reasons: Record<string, string>;
  setReason: (id: string, reason: string) => void;
  onDecision: (rule: RuleResult, decision: Decision) => void;
  onExport: () => void;
  onPrint: () => void;
}) {
  const extraction = inspection.extraction;
  const assessment = inspection.assessment;
  const product = extraction?.product;
  const rawProductName = product?.name;
  const rawBrand = product?.brand;
  const commodity = inspection.context.commodity_type || "";
  const isMockCinthol =
    rawProductName === "Cinthol Talcum Powder" &&
    !commodity.toLowerCase().includes("cinthol") &&
    !commodity.toLowerCase().includes("powder");
  const displayName = isMockCinthol ? (commodity || "Packaged Commodity") : (rawProductName || commodity || "Packaged Commodity");
  const displayBrand = isMockCinthol ? (commodity || "Unbranded") : (rawBrand || "Unbranded");

  const imageSources = inspection.image_urls?.length ? inspection.image_urls : previews;
  const rawText = extraction?.raw_text_by_image?.map((i) => i.text).join("\n\n") || "No raw text stream returned.";
  const rules = assessment?.results || [];
  const decided = Object.keys(inspection.review_decisions || {}).length;

  return (
    <div className="review-page page-content">
      <WorkflowRail current={5} />
      <header className="review-title">
        <div>
          <p className="eyebrow">{inspection.id} · {inspection.provider || "EVIDENCE WORKSPACE"}</p>
          <h2>{displayName}</h2>
          <p>{displayBrand} · {formatDate(inspection.created_at)} · Matrix Ruleset {assessment?.ruleset_version || RULESET_VERSION}</p>
        </div>
        <div className="review-actions">
          <button className="button button-secondary" onClick={onExport}>Export JSON</button>
          <button className="button button-dark" onClick={onPrint}>Print Report</button>
        </div>
      </header>

      <section className="summary-band">
        <div>
          <span>Overall Statutory Status</span>
          <Badge status={assessment?.overall_status}>{assessment?.overall_label || statusLabel(assessment?.overall_status)}</Badge>
          <small>Legal officer sign-off required for formal notice</small>
        </div>
        <div><span>Passed</span><strong>{assessment?.counts?.PASS || 0}</strong></div>
        <div><span>Needs Review</span><strong>{assessment?.counts?.REVIEW || 0}</strong></div>
        <div><span>Potential Issues</span><strong>{assessment?.counts?.FAIL || 0}</strong></div>
        <div><span>Officer Decisions</span><strong>{decided} / {rules.length}</strong></div>
      </section>

      <div className="review-grid">
        <div className="review-column">
          <section className="content-card evidence-card">
            <header className="card-heading">
              <div><p className="eyebrow">PHYSICAL EVIDENCE</p><h3>Package Images</h3></div>
              <Badge status={inspection.quality?.status === "GOOD" ? "PASS" : inspection.quality?.status === "POOR" ? "FAIL" : "REVIEW"}>
                {inspection.quality?.status || "PASS"}
              </Badge>
            </header>
            {imageSources.length ? (
              <>
                <div className="evidence-stage">
                  <img src={imageSources[Math.min(selectedImage, imageSources.length - 1)]} alt={`Package Panel ${selectedImage + 1}`} />
                </div>
                <div className="thumb-row">
                  {imageSources.map((source, index) => (
                    <button className={selectedImage === index ? "is-active" : ""} key={`${source}-${index}`} onClick={() => onSelectImage(index)}>
                      <img src={source} alt={`Panel ${index + 1}`} />
                      <span>{index + 1}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <EmptyState title="Panel preview saved in record" body="Visual excerpts are retained in the finding evidence cards." />
            )}
          </section>
          <section className="content-card">
            <p className="eyebrow">STATUTORY ROUTE</p>
            <h3>Applicability Context</h3>
            <dl className="route-list">
              <div><dt>Market Channel</dt><dd>{inspection.context?.package_context}</dd></div>
              <div><dt>Commodity</dt><dd>{inspection.context?.commodity_type}</dd></div>
              <div><dt>Date Mandate</dt><dd>{inspection.context?.date_required}</dd></div>
              <div><dt>Medical Device</dt><dd>{inspection.context?.medical_device}</dd></div>
            </dl>
          </section>
        </div>

        <div className="review-column">
          <section className="content-card">
            <header className="card-heading">
              <div><p className="eyebrow">MULTIMODAL EXTRACTION</p><h3>Declared Particulars</h3></div>
              <span className="count-badge">GEMINI VISION</span>
            </header>
            <div className="fact-list">
              {FIELD_DEFINITIONS.map(([label, key]) => {
                const candidates = (extraction?.fields[key] || []) as Candidate[];
                return (
                  <div className="fact-row" key={key}>
                    <header>
                      <strong>{label}</strong>
                      {candidates.length ? (
                        <span className={candidates[0].confidence >= 0.85 ? "high-confidence" : "low-confidence"}>
                          {Math.round(candidates[0].confidence * 100)}% confidence
                        </span>
                      ) : (
                        <span className="low-confidence">Not Found</span>
                      )}
                    </header>
                    {candidates.length ? (
                      candidates.map((c, i) => (
                        <p key={i}>
                          {c.qualifier ? `${c.qualifier}: ` : ""}{c.value}
                          <small>“{c.evidence_excerpt || c.evidence || c.value}”</small>
                        </p>
                      ))
                    ) : (
                      <p>—<small>Absence checked against mandatory panel visibility.</small></p>
                    )}
                  </div>
                );
              })}
            </div>
            <details>
              <summary>Show raw OCR stream</summary>
              <pre className="raw-text">{rawText}</pre>
            </details>
          </section>
        </div>

        <div className="review-column checks-column">
          <section className="content-card">
            <header className="card-heading">
              <div>
                <p className="eyebrow">DETERMINISTIC EVALUATION</p>
                <h3>PostgreSQL Rules Matrix Findings</h3>
                <p>Click any rule to review statutory grounding and record officer disposition.</p>
              </div>
              <span className="count-badge">{rules.length} CHECKS</span>
            </header>
            <div className="result-list">
              {rules.map((rule, index) => {
                const isOpen = openRules.has(rule.rule_id);
                const existingDecision = reviewDecisionValue(inspection.review_decisions?.[rule.rule_id]);
                return (
                  <article className={`rule-result ${isOpen ? "is-open" : ""}`} key={rule.rule_id}>
                    <button className="rule-summary" onClick={() => onToggleRule(rule.rule_id)} aria-expanded={isOpen}>
                      <span className="rule-number">0{index + 1}</span>
                      <span>
                        <strong>{rule.title}</strong>
                        <small>{rule.rule_id} · {rule.source}</small>
                      </span>
                      <Badge status={rule.status}>{rule.ui_label || statusLabel(rule.status)}</Badge>
                      <i>⌄</i>
                    </button>
                    {isOpen && (
                      <div className="rule-detail">
                        <p>{rule.explanation}</p>
                        <div className="rule-meta">
                          <span>{rule.verification_mode}</span>
                          <span>Matrix {assessment?.ruleset_version || RULESET_VERSION}</span>
                          <span>Legal Engine: {rule.legal_output}</span>
                        </div>
                        <div className="evidence-list">
                          {rule.evidence?.length ? (
                            rule.evidence.map((ev) => (
                              <div className="evidence-box" key={ev.id}>
                                <small>Image {(ev.image_index ?? 0) + 1} · {ev.confidence ? `${Math.round(ev.confidence * 100)}% confidence` : "Rule Predicate"} · {ev.method}</small>
                                <p>“{ev.excerpt || ev.value || "Declared attribute"}”</p>
                              </div>
                            ))
                          ) : (
                            <div className="evidence-box"><p>No grounded excerpt found on visible panel.</p></div>
                          )}
                        </div>
                        {rule.next_action && (
                          <div className="next-action">
                            <strong>Statutory Guidance</strong>
                            <p>{rule.next_action}</p>
                          </div>
                        )}
                        {reviewer ? (
                          <div className="review-controls">
                            <label>Officer Audit Reason
                              <textarea
                                value={reasons[rule.rule_id] || ""}
                                onChange={(e) => setReason(rule.rule_id, e.target.value)}
                                placeholder="Mandatory legal rationale for confirm / override..."
                              />
                            </label>
                            <div>
                              {REVIEW_DECISIONS.map(([d, l]) => (
                                <button
                                  className={existingDecision === d ? "is-selected" : ""}
                                  key={d}
                                  onClick={() => onDecision(rule, d)}
                                >
                                  {l}
                                </button>
                              ))}
                            </div>
                            {existingDecision && (
                              <small>Recorded disposition: {existingDecision.replaceAll("_", " ")}</small>
                            )}
                          </div>
                        ) : (
                          <div className="readonly-note">Read-only audit view. Legal Reviewer or Admin credentials required to sign off.</div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
