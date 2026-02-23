from __future__ import annotations

import io
import os
import re
from datetime import datetime, timezone
from typing import Any

import PyPDF2
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydantic import BaseModel

load_dotenv()

app = FastAPI()


def parse_cors_origins(raw_origins: str | None) -> list[str]:
    if not raw_origins:
        return ["http://localhost:3000", "http://127.0.0.1:3000"]
    origins = [origin.strip().rstrip("/") for origin in raw_origins.split(",") if origin.strip()]
    return origins or ["http://localhost:3000", "http://127.0.0.1:3000"]


cors_origins = parse_cors_origins(os.getenv("CORS_ALLOW_ORIGINS"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

openai_api_key = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=openai_api_key) if openai_api_key else None


class ResumeRequest(BaseModel):
    industry: str
    role: str
    skills: str | None = None
    description: str | None = None
    plan: str | None = None
    session_id: str | None = None


class ResumeBuildRequest(BaseModel):
    name: str
    industry: str
    role: str
    experience_years: str
    skills: str
    work_experience: str
    projects: str
    education: str
    plan: str | None = None
    session_id: str | None = None


class ResumeImproviseRequest(BaseModel):
    industry: str
    role: str
    resume_text: str
    current_skills: str | None = None
    focus_areas: list[str] | None = None
    plan: str | None = None
    session_id: str | None = None


PLAN_RULES: dict[str, dict[str, Any]] = {
    "free": {
        "analyze_limit": 8,
        "suggest_limit": 8,
        "generation_limit": 1,
        "pdf_polish_limit": 0,
        "allowed_templates": ["minimal"],
        "can_upload_pdf": False,
        "can_ai_enhance": False,
    },
    "starter": {
        "analyze_limit": 80,
        "suggest_limit": 80,
        "generation_limit": 15,
        "pdf_polish_limit": 6,
        "allowed_templates": ["minimal", "executive"],
        "can_upload_pdf": True,
        "can_ai_enhance": True,
    },
    "pro": {
        "analyze_limit": 320,
        "suggest_limit": 320,
        "generation_limit": 90,
        "pdf_polish_limit": 40,
        "allowed_templates": ["minimal", "executive", "quantum"],
        "can_upload_pdf": True,
        "can_ai_enhance": True,
    },
    "elite": {
        "analyze_limit": 1200,
        "suggest_limit": 1200,
        "generation_limit": 320,
        "pdf_polish_limit": 160,
        "allowed_templates": ["minimal", "executive", "quantum"],
        "can_upload_pdf": True,
        "can_ai_enhance": True,
    },
}

USAGE_TRACKER: dict[str, dict[str, int]] = {}


STOPWORDS = {
    "and",
    "the",
    "for",
    "with",
    "from",
    "into",
    "that",
    "this",
    "your",
    "have",
    "using",
    "within",
    "role",
    "industry",
    "job",
    "resume",
    "candidate",
    "senior",
    "junior",
    "lead",
    "engineer",
    "developer",
    "manager",
    "specialist",
    "software",
    "technology",
    "tech",
    "general",
    "professional",
}

SKILL_ALIASES = {
    "js": "javascript",
    "ts": "typescript",
    "nodejs": "node.js",
    "node": "node.js",
    "reactjs": "react",
    "nextjs": "next.js",
    "py": "python",
    "postgres": "postgresql",
    "postgre": "postgresql",
    "k8s": "kubernetes",
    "tf": "tensorflow",
    "pytorch": "pytorch",
    "ml": "machine learning",
    "ai": "artificial intelligence",
    "nlp": "natural language processing",
    "gcp": "gcp",
    "aws": "aws",
    "team handling": "team management",
    "team lead": "team leadership",
    "closure": "deal closing",
    "closing": "deal closing",
    "product demonstration": "product demo",
    "client handling": "client relationship management",
    "crm tools": "crm",
}

ROLE_BLUEPRINTS: dict[str, dict[str, list[str]]] = {
    "backend": {
        "core": [
            "python",
            "java",
            "node.js",
            "sql",
            "api design",
            "postgresql",
            "system design",
        ],
        "adjacent": [
            "docker",
            "kubernetes",
            "redis",
            "microservices",
            "aws",
            "gcp",
            "testing",
            "ci/cd",
        ],
        "projects": [
            "Build a scalable REST API with auth, caching, and monitoring.",
            "Ship a microservice-based backend with queue processing and retries.",
            "Design a high-traffic service architecture with performance benchmarks.",
        ],
    },
    "frontend": {
        "core": ["javascript", "typescript", "react", "next.js", "html", "css", "state management"],
        "adjacent": ["tailwind", "testing", "accessibility", "web performance", "design systems", "api integration"],
        "projects": [
            "Create a responsive production dashboard with role-based views.",
            "Build a reusable component library with accessibility support.",
            "Optimize a large frontend app for lighthouse performance targets.",
        ],
    },
    "data": {
        "core": ["python", "sql", "statistics", "data analysis", "machine learning", "data visualization"],
        "adjacent": ["pandas", "numpy", "tensorflow", "pytorch", "feature engineering", "experimentation", "tableau"],
        "projects": [
            "Build an end-to-end churn prediction pipeline with model monitoring.",
            "Create a business KPI analytics dashboard from raw transactional data.",
            "Run an A/B testing framework and present decision-ready insights.",
        ],
    },
    "product": {
        "core": ["product strategy", "roadmapping", "user research", "metrics", "prioritization", "stakeholder management"],
        "adjacent": ["sql", "experimentation", "wireframing", "go-to-market", "funnel analysis", "storytelling"],
        "projects": [
            "Define and launch a feature roadmap backed by customer interviews.",
            "Design and measure a retention improvement experiment.",
            "Build a product KPI framework with weekly decision reviews.",
        ],
    },
    "sales": {
        "core": [
            "lead generation",
            "pipeline management",
            "negotiation",
            "deal closing",
            "crm",
            "client relationship management",
        ],
        "adjacent": [
            "salesforce",
            "hubspot",
            "inside sales",
            "b2b sales",
            "pre sales",
            "product demo",
            "territory planning",
            "forecasting",
        ],
        "projects": [
            "Build a role-ready sales portfolio showing prospecting to closure workflow with measurable conversion lifts.",
            "Create a target-account strategy with qualification criteria, outreach sequences, and pipeline stages.",
            "Design a sales forecasting model from historic opportunity data and present weekly decision reports.",
        ],
    },
    "marketing": {
        "core": [
            "campaign management",
            "content strategy",
            "seo",
            "performance marketing",
            "analytics",
            "brand strategy",
        ],
        "adjacent": [
            "google ads",
            "meta ads",
            "email marketing",
            "crm",
            "copywriting",
            "market research",
            "social media",
            "a/b testing",
        ],
        "projects": [
            "Design a full-funnel campaign and report measurable CAC and conversion improvements.",
            "Build an SEO and content roadmap with keyword clusters and ranking uplift targets.",
            "Create a paid-media experiment framework with budget allocation and ROI analysis.",
        ],
    },
    "finance": {
        "core": [
            "financial analysis",
            "forecasting",
            "budgeting",
            "valuation",
            "excel",
            "reporting",
        ],
        "adjacent": [
            "financial modeling",
            "power bi",
            "tableau",
            "risk analysis",
            "compliance",
            "accounting",
            "erp",
            "variance analysis",
        ],
        "projects": [
            "Build a financial model and dashboard to track revenue, margin, and cash flow scenarios.",
            "Create a budgeting and forecasting framework with monthly variance reviews.",
            "Deliver a valuation case with clear assumptions and sensitivity analysis.",
        ],
    },
    "operations": {
        "core": [
            "process improvement",
            "stakeholder management",
            "kpi tracking",
            "project management",
            "vendor management",
            "problem solving",
        ],
        "adjacent": [
            "sop",
            "quality management",
            "supply chain",
            "forecasting",
            "resource planning",
            "data analysis",
            "excel",
            "erp",
        ],
        "projects": [
            "Optimize a core business process and show cycle-time and cost reduction impact.",
            "Build an operations KPI dashboard with weekly review cadence and corrective actions.",
            "Design a vendor performance framework with measurable SLA adherence.",
        ],
    },
    "hr": {
        "core": [
            "recruitment",
            "talent acquisition",
            "employee engagement",
            "performance management",
            "hr operations",
            "communication",
        ],
        "adjacent": [
            "ats",
            "onboarding",
            "hr analytics",
            "policy drafting",
            "labor law",
            "compensation",
            "training",
            "employee relations",
        ],
        "projects": [
            "Build a hiring pipeline playbook to improve time-to-hire and offer acceptance.",
            "Design an onboarding process with clear 30-60-90 day outcomes.",
            "Create an employee engagement measurement framework with action plans.",
        ],
    },
    "design": {
        "core": [
            "ui design",
            "ux research",
            "wireframing",
            "prototyping",
            "design systems",
            "visual design",
        ],
        "adjacent": [
            "figma",
            "accessibility",
            "interaction design",
            "usability testing",
            "information architecture",
            "html",
            "css",
            "product thinking",
        ],
        "projects": [
            "Design an end-to-end user flow with measurable usability improvements.",
            "Create a scalable design system with reusable components and accessibility standards.",
            "Run a usability study and translate findings into product-ready design changes.",
        ],
    },
    "devops": {
        "core": [
            "linux",
            "ci/cd",
            "docker",
            "kubernetes",
            "infrastructure as code",
            "monitoring",
        ],
        "adjacent": [
            "terraform",
            "aws",
            "gcp",
            "azure",
            "scripting",
            "observability",
            "incident management",
            "security",
        ],
        "projects": [
            "Build a production CI/CD pipeline with automated testing and deployment gates.",
            "Design an IaC environment with repeatable provisioning and rollback strategy.",
            "Create an observability stack with SLOs, alerts, and incident response playbooks.",
        ],
    },
    "qa": {
        "core": [
            "test planning",
            "manual testing",
            "automation testing",
            "bug tracking",
            "regression testing",
            "quality assurance",
        ],
        "adjacent": [
            "selenium",
            "cypress",
            "postman",
            "api testing",
            "performance testing",
            "test cases",
            "jira",
            "ci/cd",
        ],
        "projects": [
            "Create a test strategy covering functional, regression, and API validation paths.",
            "Build a UI test automation suite with stable selectors and reliable CI execution.",
            "Design a quality dashboard showing defect leakage and release readiness trends.",
        ],
    },
    "support": {
        "core": [
            "customer support",
            "ticket management",
            "issue resolution",
            "communication",
            "product knowledge",
            "service quality",
        ],
        "adjacent": [
            "zendesk",
            "freshdesk",
            "sla",
            "troubleshooting",
            "knowledge base",
            "crm",
            "escalation handling",
            "csat",
        ],
        "projects": [
            "Design a support workflow that improves first response and resolution time.",
            "Build a knowledge base taxonomy to reduce repetitive ticket volume.",
            "Create a customer feedback loop with measurable CSAT/NPS improvement actions.",
        ],
    },
    "legal": {
        "core": [
            "legal research",
            "contract drafting",
            "compliance",
            "risk assessment",
            "documentation",
            "communication",
        ],
        "adjacent": [
            "regulatory analysis",
            "due diligence",
            "policy review",
            "negotiation",
            "case analysis",
            "corporate law",
            "ip law",
            "data privacy",
        ],
        "projects": [
            "Build a compliance checklist and risk register for a real-world business scenario.",
            "Draft and review contract templates with clause-level risk notes.",
            "Create a legal research brief translating regulation into business action items.",
        ],
    },
    "healthcare": {
        "core": [
            "patient care",
            "clinical documentation",
            "care coordination",
            "medical knowledge",
            "communication",
            "safety protocols",
        ],
        "adjacent": [
            "emr",
            "ehr",
            "triage",
            "clinical assessment",
            "infection control",
            "healthcare compliance",
            "team collaboration",
            "patient counseling",
        ],
        "projects": [
            "Design a patient-flow improvement initiative with reduced wait-time outcomes.",
            "Create a clinical documentation quality checklist with audit-ready standards.",
            "Build a care coordination workflow for better follow-up and adherence outcomes.",
        ],
    },
    "education": {
        "core": [
            "teaching",
            "curriculum design",
            "classroom management",
            "student assessment",
            "communication",
            "lesson planning",
        ],
        "adjacent": [
            "instructional design",
            "edtech",
            "learning management system",
            "mentoring",
            "content development",
            "evaluation",
            "student engagement",
            "training delivery",
        ],
        "projects": [
            "Create a curriculum module with measurable learning-outcome improvements.",
            "Design an assessment framework with actionable feedback loops.",
            "Build an edtech-enabled teaching plan for blended learning delivery.",
        ],
    },
    "general": {
        "core": ["communication", "problem solving", "collaboration", "domain knowledge"],
        "adjacent": ["analytics", "documentation", "execution", "stakeholder management"],
        "projects": [
            "Build a portfolio project that clearly maps to your target role.",
            "Document outcomes with measurable impact and lessons learned.",
            "Create one project per core role requirement to close skill gaps.",
        ],
    },
}

ROLE_TRACK_KEYWORDS = {
    "backend": ["backend", "api", "server", "python", "java", "node", "platform", "sre"],
    "frontend": ["frontend", "ui", "web", "react", "next", "javascript", "typescript", "ux"],
    "data": ["data", "analyst", "scientist", "ml", "ai", "analytics", "bi"],
    "product": ["product", "pm", "growth", "strategy", "roadmap"],
    "sales": ["sales", "account executive", "business development", "bdm", "inside sales", "pre sales"],
    "marketing": ["marketing", "digital marketing", "seo", "sem", "brand", "campaign", "performance marketing"],
    "finance": ["finance", "financial", "fp&a", "accounting", "investment", "audit", "analyst"],
    "operations": ["operations", "ops", "supply chain", "process", "logistics", "procurement"],
    "hr": ["hr", "human resources", "talent", "recruiter", "recruitment", "people operations"],
    "design": ["designer", "design", "ui", "ux", "product design", "graphic design"],
    "devops": ["devops", "sre", "site reliability", "platform", "infrastructure", "cloud engineer"],
    "qa": ["qa", "quality assurance", "tester", "test engineer", "automation tester"],
    "support": ["support", "customer success", "customer support", "service desk", "helpdesk"],
    "legal": ["legal", "lawyer", "advocate", "attorney", "compliance", "contract"],
    "healthcare": ["healthcare", "nurse", "doctor", "clinical", "medical", "hospital", "pharma"],
    "education": ["teacher", "educator", "trainer", "professor", "instructor", "education"],
}

ROLE_CRITICAL_SKILLS = {
    "backend": ["python", "sql", "api design"],
    "frontend": ["javascript", "react", "html"],
    "data": ["python", "sql", "data analysis"],
    "product": ["product strategy", "metrics", "user research"],
    "sales": ["pipeline management", "negotiation", "deal closing"],
    "marketing": ["campaign management", "analytics", "content strategy"],
    "finance": ["financial analysis", "forecasting", "excel"],
    "operations": ["process improvement", "kpi tracking", "project management"],
    "hr": ["recruitment", "employee engagement", "hr operations"],
    "design": ["ui design", "ux research", "prototyping"],
    "devops": ["ci/cd", "docker", "kubernetes"],
    "qa": ["test planning", "automation testing", "quality assurance"],
    "support": ["customer support", "ticket management", "issue resolution"],
    "legal": ["legal research", "contract drafting", "compliance"],
    "healthcare": ["patient care", "clinical documentation", "safety protocols"],
    "education": ["teaching", "curriculum design", "student assessment"],
    "general": ["communication", "problem solving"],
}

SPECIFICITY_KEYWORDS = {
    "aws",
    "gcp",
    "azure",
    "docker",
    "kubernetes",
    "postgresql",
    "mongodb",
    "redis",
    "fastapi",
    "react",
    "next.js",
    "typescript",
    "node.js",
    "java",
    "python",
    "sql",
    "tensorflow",
    "pytorch",
    "microservices",
    "system design",
    "ci/cd",
    "salesforce",
    "hubspot",
    "crm",
    "lead generation",
    "pipeline management",
    "deal closing",
    "negotiation",
    "b2b sales",
    "inside sales",
    "pre sales",
    "forecasting",
    "territory planning",
    "google ads",
    "meta ads",
    "seo",
    "power bi",
    "tableau",
    "erp",
    "figma",
    "terraform",
    "observability",
    "selenium",
    "cypress",
    "postman",
    "zendesk",
    "freshdesk",
    "ehr",
    "emr",
    "lms",
}

SENIORITY_KEYWORDS = {
    "junior": ["intern", "entry", "junior", "fresher", "associate", "trainee"],
    "mid": ["engineer", "analyst", "specialist", "developer", "manager"],
    "senior": ["senior", "lead", "principal", "staff", "architect", "head"],
}

GENERIC_ROLE_WORDS = {
    "engineer",
    "developer",
    "manager",
    "specialist",
    "software",
    "technology",
    "tech",
    "professional",
    "role",
    "industry",
}


def clamp(value: float, lower: int = 0, upper: int = 100) -> int:
    return max(lower, min(upper, int(round(value))))


def safe_text(value: str | None) -> str:
    return (value or "").strip()


def usage_window_key() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def normalize_plan(plan: str | None) -> str:
    normalized = safe_text(plan).lower()
    return normalized if normalized in PLAN_RULES else "free"


def normalize_session_id(session_id: str | None) -> str:
    token = safe_text(session_id)
    return token or "anonymous"


def usage_bucket(plan: str, session_id: str) -> dict[str, int]:
    key = f"{usage_window_key()}::{plan}::{session_id}"
    if key not in USAGE_TRACKER:
        USAGE_TRACKER[key] = {
            "analyze_used": 0,
            "suggest_used": 0,
            "generation_used": 0,
            "pdf_polish_used": 0,
        }
    return USAGE_TRACKER[key]


def plan_enforcement_payload(plan: str, session_id: str) -> dict[str, Any]:
    rules = PLAN_RULES[plan]
    usage = usage_bucket(plan, session_id)

    return {
        "plan": plan,
        "session_id": session_id,
        "window": "daily",
        "usage": {
            "analyze_used": usage["analyze_used"],
            "suggest_used": usage["suggest_used"],
            "generation_used": usage["generation_used"],
            "pdf_polish_used": usage["pdf_polish_used"],
        },
        "limits": {
            "analyze_limit": rules["analyze_limit"],
            "suggest_limit": rules["suggest_limit"],
            "generation_limit": rules["generation_limit"],
            "pdf_polish_limit": rules["pdf_polish_limit"],
        },
        "features": {
            "allowed_templates": rules["allowed_templates"],
            "can_upload_pdf": rules["can_upload_pdf"],
            "can_ai_enhance": rules["can_ai_enhance"],
        },
    }


def quota_error(message: str, plan: str, session_id: str, status_code: int) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={
            "message": message,
            "plan_enforcement": plan_enforcement_payload(plan, session_id),
        },
    )


def consume_quota(plan: str, session_id: str, action: str) -> dict[str, Any]:
    rules = PLAN_RULES[plan]
    usage = usage_bucket(plan, session_id)

    if action == "analyze":
        if usage["analyze_used"] >= rules["analyze_limit"]:
            raise quota_error(
                f"{plan.title()} plan analyze limit reached for today. Upgrade for more predictions.",
                plan,
                session_id,
                429,
            )
        usage["analyze_used"] += 1
    elif action == "suggest":
        if usage["suggest_used"] >= rules["suggest_limit"]:
            raise quota_error(
                f"{plan.title()} plan suggestion limit reached for today. Upgrade for deeper guidance.",
                plan,
                session_id,
                429,
            )
        usage["suggest_used"] += 1
    elif action == "generation":
        if usage["generation_used"] >= rules["generation_limit"]:
            raise quota_error(
                f"{plan.title()} plan generation limit reached for today. Upgrade for more resume generations.",
                plan,
                session_id,
                429,
            )
        usage["generation_used"] += 1
    elif action == "pdf_polish":
        if not rules["can_upload_pdf"]:
            raise quota_error(
                f"PDF upload polishing is not available on the {plan.title()} plan. Upgrade to unlock this option.",
                plan,
                session_id,
                403,
            )
        if usage["generation_used"] >= rules["generation_limit"]:
            raise quota_error(
                f"{plan.title()} plan generation limit reached for today. Upgrade for more resume generations.",
                plan,
                session_id,
                429,
            )
        if usage["pdf_polish_used"] >= rules["pdf_polish_limit"]:
            raise quota_error(
                f"{plan.title()} plan PDF polish limit reached for today. Upgrade for more PDF polishing runs.",
                plan,
                session_id,
                429,
            )
        usage["pdf_polish_used"] += 1
        usage["generation_used"] += 1

    return plan_enforcement_payload(plan, session_id)


def normalize_token(value: str) -> str:
    token = value.strip().lower()
    token = re.sub(r"\s+", " ", token)
    token = token.replace("_", " ")
    token = token.replace("-", " ")
    return SKILL_ALIASES.get(token, token)


def dedupe_preserve_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        token = normalize_token(value)
        if token and token not in seen:
            seen.add(token)
            ordered.append(token)
    return ordered


def tokenize_keywords(text: str) -> set[str]:
    words = re.findall(r"[a-zA-Z][a-zA-Z0-9+#.-]{2,}", text.lower())
    return {word for word in words if word not in STOPWORDS}


def infer_role_track_with_score(role: str, industry: str = "") -> tuple[str, int]:
    role_lower = f"{role} {industry}".lower()
    best_track = "general"
    best_score = 0

    for track, keywords in ROLE_TRACK_KEYWORDS.items():
        score = sum(1 for keyword in keywords if keyword in role_lower)
        if score > best_score:
            best_score = score
            best_track = track

    return best_track, best_score


def infer_role_track(role: str, industry: str = "") -> str:
    track, _ = infer_role_track_with_score(role, industry)
    return track


def infer_seniority(role: str) -> str:
    role_lower = role.lower()
    seniority_score = {"junior": 0, "mid": 0, "senior": 0}

    for band, keywords in SENIORITY_KEYWORDS.items():
        seniority_score[band] = sum(1 for keyword in keywords if keyword in role_lower)

    if seniority_score["senior"] > max(seniority_score["junior"], seniority_score["mid"]):
        return "senior"
    if seniority_score["junior"] > max(seniority_score["senior"], seniority_score["mid"]):
        return "junior"
    return "mid"


def score_critical_coverage(critical_skills: list[str], skills_list: list[str]) -> tuple[int, list[str]]:
    skill_set = set(skills_list)
    matched = [skill for skill in critical_skills if skill in skill_set]
    missing = [skill for skill in critical_skills if skill not in skill_set]
    score = clamp((len(matched) / max(1, len(critical_skills))) * 100)
    return score, missing


def build_track_skill_index() -> dict[str, set[str]]:
    index: dict[str, set[str]] = {}
    for track, blueprint in ROLE_BLUEPRINTS.items():
        index[track] = {normalize_token(skill) for skill in [*blueprint["core"], *blueprint["adjacent"]]}
    return index


TRACK_SKILL_INDEX = build_track_skill_index()


def build_role_skill_catalog() -> set[str]:
    catalog: set[str] = set()

    for track in ROLE_BLUEPRINTS:
        blueprint = ROLE_BLUEPRINTS[track]
        catalog.update(normalize_token(skill) for skill in blueprint["core"])
        catalog.update(normalize_token(skill) for skill in blueprint["adjacent"])
        catalog.update(normalize_token(skill) for skill in ROLE_CRITICAL_SKILLS.get(track, []))
        catalog.update(normalize_token(skill) for skill in ROLE_TRACK_KEYWORDS.get(track, []))

    return {token for token in catalog if token and len(token) >= 3}


ROLE_SKILL_CATALOG = build_role_skill_catalog()


def resolve_role_profile(role: str, industry: str, skills_list: list[str]) -> tuple[str, dict[str, list[str]], list[str], bool]:
    track, score = infer_role_track_with_score(role, industry)

    if score > 0 and track in ROLE_BLUEPRINTS:
        blueprint = ROLE_BLUEPRINTS[track]
        critical = ROLE_CRITICAL_SKILLS.get(track, ROLE_CRITICAL_SKILLS["general"])
        return track, blueprint, critical, False

    role_terms = dedupe_preserve_order(
        [
            token
            for token in tokenize_keywords(f"{role} {industry}")
            if token not in GENERIC_ROLE_WORDS and token not in STOPWORDS
        ]
    )
    normalized_skills = dedupe_preserve_order(skills_list)

    dynamic_core = dedupe_preserve_order(
        [
            *normalized_skills[:10],
            *ROLE_BLUEPRINTS["general"]["core"],
        ]
    )[:10]
    dynamic_adjacent = dedupe_preserve_order(
        [
            *role_terms[2:10],
            *normalized_skills[10:18],
            *ROLE_BLUEPRINTS["general"]["adjacent"],
        ]
    )[:8]
    dynamic_critical = dedupe_preserve_order(
        [
            *normalized_skills[:2],
            *ROLE_CRITICAL_SKILLS["general"],
        ]
    )[:3]

    blueprint = {
        "core": dynamic_core or ROLE_BLUEPRINTS["general"]["core"],
        "adjacent": dynamic_adjacent or ROLE_BLUEPRINTS["general"]["adjacent"],
        "projects": [
            f"Build a role-focused case study for {safe_text(role) or 'your target role'} with clear measurable outcomes.",
            "Create a portfolio artifact proving your strongest core capabilities end-to-end.",
            "Document decision process, execution steps, and business impact in a recruiter-friendly format.",
        ],
    }
    critical = dynamic_critical or ROLE_CRITICAL_SKILLS["general"]
    return "custom", blueprint, critical, True


def score_track_consistency(role_track: str, skills_list: list[str], blueprint: dict[str, list[str]]) -> int:
    if not skills_list:
        return 20

    normalized_skills = [normalize_token(skill) for skill in skills_list]
    target_index = {normalize_token(skill) for skill in [*blueprint["core"], *blueprint["adjacent"]]}
    if not target_index:
        target_index = TRACK_SKILL_INDEX["general"]
    target_hits = 0
    off_track_hits = 0
    neutral_hits = 0

    for skill in normalized_skills:
        in_target = skill in target_index
        in_other = any(skill in index for track, index in TRACK_SKILL_INDEX.items() if track != role_track)
        if in_target:
            target_hits += 1
        elif in_other:
            off_track_hits += 1
        else:
            neutral_hits += 1

    target_ratio = target_hits / max(1, len(normalized_skills))
    off_track_ratio = off_track_hits / max(1, len(normalized_skills))
    specificity_bonus = min(14, sum(1 for skill in normalized_skills if skill in SPECIFICITY_KEYWORDS) * 1.3)
    neutral_penalty = min(8, neutral_hits * 0.9)

    off_track_weight = 24 if role_track == "custom" else 40
    score = target_ratio * 92 + specificity_bonus - off_track_ratio * off_track_weight - neutral_penalty
    if target_hits >= 3 and off_track_hits == 0:
        score += 6
    if role_track == "custom" and target_hits >= 2:
        score += 8
    return clamp(score)


def confidence_by_seniority(seniority: str, listed_count: int, critical_coverage: int) -> int:
    if seniority == "junior":
        base = 56
        expected_skills = 7
    elif seniority == "senior":
        base = 44
        expected_skills = 14
    else:
        base = 50
        expected_skills = 10

    sufficiency = clamp((listed_count / max(1, expected_skills)) * 100)
    confidence = base + min(26, sufficiency * 0.22) + min(24, critical_coverage * 0.24)
    return clamp(confidence)


def build_prediction_band(overall_score: int, confidence: int) -> dict[str, int]:
    uncertainty = max(6, int(round((100 - confidence) * 0.18)))
    return {
        "low": clamp(overall_score - uncertainty),
        "high": clamp(overall_score + uncertainty),
    }


def extract_skills_from_text(skills_text: str) -> list[str]:
    raw_parts = [part.strip() for part in re.split(r"[,\n;/|]+", skills_text) if part.strip()]
    normalized: set[str] = set()

    for part in raw_parts:
        token = normalize_token(part)
        if token:
            normalized.add(token)

    full_text = f" {skills_text.lower()} "
    for alias, canonical in SKILL_ALIASES.items():
        pattern = rf"\b{re.escape(alias)}\b"
        if re.search(pattern, full_text):
            normalized.add(canonical)

    for skill in SPECIFICITY_KEYWORDS:
        if re.search(rf"\b{re.escape(skill)}\b", full_text):
            normalized.add(skill)

    # Capture recognizable role-skill phrases from free-text sentences.
    search_text = " " + re.sub(r"[^a-z0-9+#./]+", " ", skills_text.lower()) + " "
    for phrase in ROLE_SKILL_CATALOG:
        if f" {phrase} " in search_text:
            normalized.add(phrase)

    return sorted(normalized)


def score_keyword_overlap(
    role_track: str,
    role: str,
    industry: str,
    skills_list: list[str],
    blueprint: dict[str, list[str]],
    critical_skills: list[str],
) -> tuple[int, list[str]]:
    if not skills_list:
        return 0, []

    role_industry_terms = {
        token
        for token in tokenize_keywords(f"{role} {industry}")
        if token not in GENERIC_ROLE_WORDS and token not in STOPWORDS
    }

    target_phrases = dedupe_preserve_order(
        [
            *ROLE_TRACK_KEYWORDS.get(role_track, []),
            *critical_skills,
            *blueprint["core"],
            *blueprint["adjacent"][:6],
        ]
    )
    target_phrase_set = set(target_phrases)

    target_tokens = set()
    for phrase in [*target_phrases, *role_industry_terms]:
        target_tokens.update(tokenize_keywords(phrase))

    skill_set = {normalize_token(skill) for skill in skills_list}
    skill_tokens = set()
    for skill in skills_list:
        skill_tokens.update(tokenize_keywords(skill))

    exact_matches = [phrase for phrase in target_phrases if phrase in skill_set]
    token_matches = sorted(target_tokens.intersection(skill_tokens))

    exact_ratio = len(exact_matches) / max(1, len(target_phrase_set))
    token_ratio = len(token_matches) / max(1, len(target_tokens))
    score = clamp(exact_ratio * 72 + token_ratio * 28)

    if len(skills_list) >= 5:
        score = max(score, 32)

    matched = dedupe_preserve_order([*exact_matches, *token_matches])
    return score, matched[:12]


def score_skill_profile_quality(skills_text: str, skills_list: list[str]) -> tuple[int, dict[str, Any]]:
    raw_tokens = [token.strip() for token in re.split(r"[,\n;/|]+", skills_text) if token.strip()]
    listed_count = len(raw_tokens)
    unique_count = len(skills_list)
    duplicate_count = max(0, listed_count - unique_count)

    specificity_hits = sum(1 for skill in skills_list if skill in SPECIFICITY_KEYWORDS)

    if listed_count < 4:
        volume_score = 26
    elif listed_count <= 14:
        volume_score = 40
    elif listed_count <= 22:
        volume_score = 33
    else:
        volume_score = 25

    uniqueness_score = min(24, unique_count * 1.6)
    specificity_score = min(24, specificity_hits * 3)
    breadth_score = min(12, len(tokenize_keywords(skills_text)) * 0.45)
    duplicate_penalty = min(10, duplicate_count * 1.4)

    skills_profile_score = clamp(volume_score + uniqueness_score + specificity_score + breadth_score - duplicate_penalty)

    return skills_profile_score, {
        "listed_count": listed_count,
        "unique_count": unique_count,
        "duplicate_count": duplicate_count,
        "specificity_hits": specificity_hits,
    }


def score_blueprint_coverage(
    blueprint: dict[str, list[str]], skills_list: list[str]
) -> tuple[int, list[str], list[str], list[str], list[str]]:
    skill_set = set(skills_list)

    core_hits = [skill for skill in blueprint["core"] if skill in skill_set]
    core_missing = [skill for skill in blueprint["core"] if skill not in skill_set]

    adjacent_hits = [skill for skill in blueprint["adjacent"] if skill in skill_set]
    adjacent_missing = [skill for skill in blueprint["adjacent"] if skill not in skill_set]

    core_ratio = len(core_hits) / max(1, len(blueprint["core"]))
    adjacent_ratio = len(adjacent_hits) / max(1, len(blueprint["adjacent"]))

    score = clamp(core_ratio * 78 + adjacent_ratio * 22)
    return score, core_hits, core_missing, adjacent_hits, adjacent_missing


def build_shortlist_prediction(score: int) -> str:
    if score >= 85:
        return "High shortlist probability"
    if score >= 70:
        return "Moderate to high shortlist probability"
    if score >= 55:
        return "Moderate shortlist probability"
    return "Low shortlist probability"


def build_improvement_areas(
    critical_missing: list[str],
    core_missing: list[str],
    adjacent_missing: list[str],
    profile_details: dict[str, Any],
    consistency_score: int,
) -> list[dict[str, Any]]:
    areas: list[dict[str, Any]] = []

    if critical_missing:
        areas.append(
            {
                "category": "Must-Have Skill Gaps",
                "details": [
                    f"Missing must-have skills: {', '.join(critical_missing[:4])}.",
                    "These are high-weight filters in shortlist decisions for this role track.",
                    "Prioritize learning and demonstrating these skills first in projects or experience bullets.",
                ],
            }
        )

    if core_missing:
        areas.append(
            {
                "category": "Critical Skill Gaps",
                "details": [
                    f"Missing core skills: {', '.join(core_missing[:5])}.",
                    "Core gaps reduce shortlist probability even when overall profile looks decent.",
                    "Prioritize these skills first and add proof through projects or work outcomes.",
                ],
            }
        )

    if consistency_score < 45:
        areas.append(
            {
                "category": "Role Consistency",
                "details": [
                    "Your listed skills look scattered across multiple role tracks.",
                    "Low role consistency reduces screening confidence and ranking quality.",
                    "Refocus profile around one target role and remove unrelated low-signal skills.",
                ],
            }
        )

    if len(adjacent_missing) >= 3:
        areas.append(
            {
                "category": "Competitive Edge",
                "details": [
                    f"Missing differentiators: {', '.join(adjacent_missing[:5])}.",
                    "Adjacent stack knowledge helps stand out against equally qualified candidates.",
                    "Add at least 2 adjacent tools and demonstrate practical usage.",
                ],
            }
        )

    if profile_details["listed_count"] < 6:
        areas.append(
            {
                "category": "Skill Coverage",
                "details": [
                    "Current skill list is short for strong confidence scoring.",
                    "Short skill coverage lowers matching confidence for most roles.",
                    "Expand with role-aligned tools, frameworks, and domain technologies.",
                ],
            }
        )

    if profile_details["duplicate_count"] > 2:
        areas.append(
            {
                "category": "Skill Clarity",
                "details": [
                    "Repeated or overlapping skills reduce profile clarity.",
                    "Duplicated terms reduce keyword signal quality in screening.",
                    "Use canonical names and remove duplicates for better clarity.",
                ],
            }
        )

    if not areas:
        areas.append(
            {
                "category": "Positioning",
                "details": [
                    "Your profile is in a good range but can be sharpened further.",
                    "Focused positioning improves conversion from applications to interviews.",
                    "Tailor top skills to each job post and prioritize evidence-backed claims.",
                ],
            }
        )

    return areas


def build_suggestion_payload(
    role_track: str,
    role: str,
    industry: str,
    analysis: dict[str, Any],
    role_profile: dict[str, Any] | None,
    critical_missing: list[str],
    core_missing: list[str],
    adjacent_missing: list[str],
) -> dict[str, Any]:
    if role_profile and role_profile.get("core") and role_profile.get("adjacent"):
        blueprint = {
            "core": role_profile["core"],
            "adjacent": role_profile["adjacent"],
            "projects": role_profile.get("projects", ROLE_BLUEPRINTS["general"]["projects"]),
        }
    else:
        blueprint = ROLE_BLUEPRINTS.get(role_track, ROLE_BLUEPRINTS["general"])

    priority_actions = [
        "Add missing core skills to your profile and learn them through applied projects.",
        "Use target-role keywords directly from job descriptions in your skills section.",
        "Group skills clearly by category: Languages, Frameworks, Cloud, Databases, Tools.",
    ]

    if critical_missing:
        priority_actions[0] = f"Close must-have gaps first: {', '.join(critical_missing[:4])}."
    elif core_missing:
        priority_actions[0] = f"Close these core skill gaps first: {', '.join(core_missing[:4])}."

    if adjacent_missing:
        priority_actions.append(f"Add competitive adjacent skills: {', '.join(adjacent_missing[:4])}.")

    suggested_skills = dedupe_preserve_order([*critical_missing[:5], *core_missing[:5], *adjacent_missing[:4]])
    keyword_bank = dedupe_preserve_order([*blueprint["core"][:8], *blueprint["adjacent"][:6]])

    return {
        "stage": "suggest",
        "target_role": role,
        "target_industry": industry,
        "role_track": role_track,
        "current_shortlist_prediction": analysis["shortlist_prediction"],
        "critical_missing_skills": critical_missing[:8],
        "missing_core_skills": core_missing[:8],
        "missing_adjacent_skills": adjacent_missing[:8],
        "suggested_skills": suggested_skills,
        "priority_actions": priority_actions[:5],
        "portfolio_project_ideas": blueprint["projects"][:3],
        "keyword_bank": keyword_bank,
    }


def analyze_profile(industry: str, role: str, skills_text: str) -> dict[str, Any]:
    normalized_skills_text = safe_text(skills_text)
    skills_list = extract_skills_from_text(normalized_skills_text)

    role_track, blueprint, critical_skills, adaptive_profile = resolve_role_profile(role, industry, skills_list)
    seniority = infer_seniority(role)
    skill_match_score, keyword_matches = score_keyword_overlap(
        role_track,
        role,
        industry,
        skills_list,
        blueprint,
        critical_skills,
    )
    profile_score, profile_details = score_skill_profile_quality(normalized_skills_text, skills_list)
    coverage_score, core_hits, core_missing, adjacent_hits, adjacent_missing = score_blueprint_coverage(blueprint, skills_list)
    critical_coverage, critical_missing = score_critical_coverage(critical_skills, skills_list)
    consistency_score = score_track_consistency(role_track, skills_list, blueprint)

    raw_overall = clamp(
        0.40 * critical_coverage
        + 0.26 * coverage_score
        + 0.18 * skill_match_score
        + 0.10 * profile_score
        + 0.06 * consistency_score
    )

    penalty_cap = 14 if adaptive_profile else 18
    strictness_penalty = min(penalty_cap, len(critical_missing) * 6 + max(0, 45 - consistency_score) * 0.22)
    overall_score = clamp(raw_overall - strictness_penalty)

    confidence = confidence_by_seniority(seniority, profile_details["listed_count"], critical_coverage)
    confidence = clamp(confidence + min(8, consistency_score * 0.08) - min(10, len(critical_missing) * 2.3))
    confidence = min(96, confidence)
    prediction_band = build_prediction_band(overall_score, confidence)

    prediction_reasoning = [
        f"Critical-skill coverage is {critical_coverage}% for the {role_track} role track.",
        f"Role blueprint coverage is {coverage_score}% and keyword alignment is {skill_match_score}%.",
        f"Consistency score is {consistency_score}%; profile quality signal is {profile_score}%.",
    ]
    if adaptive_profile:
        prediction_reasoning.append("Adaptive role profiling is active for this custom role.")

    quick_wins = [
        "Close must-have skill gaps first, then add adjacent differentiators.",
        "Match your skill keywords to current job descriptions for your target role.",
        "Keep role-focused skills and remove low-signal unrelated terms.",
    ]

    areas_to_improve = build_improvement_areas(
        critical_missing,
        core_missing,
        adjacent_missing,
        profile_details,
        consistency_score,
    )

    return {
        "stage": "analyze",
        "overall_score": overall_score,
        "ats_friendliness": profile_score,
        "skill_match": skill_match_score,
        "shortlist_prediction": build_shortlist_prediction(overall_score),
        "confidence": confidence,
        "prediction_range": prediction_band,
        "role_track": role_track,
        "profile_mode": "adaptive" if adaptive_profile else "standard",
        "seniority_assumption": seniority,
        "matched_skills": skills_list[:20],
        "matched_keywords": keyword_matches[:12],
        "critical_coverage": critical_coverage,
        "critical_missing_skills": critical_missing[:10],
        "consistency_score": consistency_score,
        "matched_core_skills": core_hits[:10],
        "matched_adjacent_skills": adjacent_hits[:10],
        "missing_core_skills": core_missing[:10],
        "missing_adjacent_skills": adjacent_missing[:10],
        "precision_diagnostics": {
            "raw_overall": raw_overall,
            "strictness_penalty": clamp(strictness_penalty),
            "listed_skills": profile_details["listed_count"],
            "unique_skills": profile_details["unique_count"],
            "specificity_hits": profile_details["specificity_hits"],
            "adaptive_profile": adaptive_profile,
        },
        "role_profile": {
            "core": blueprint["core"][:10],
            "adjacent": blueprint["adjacent"][:8],
            "critical": critical_skills[:5],
            "projects": blueprint["projects"][:3],
        },
        "prediction_reasoning": prediction_reasoning,
        "quick_wins": quick_wins,
        "areas_to_improve": areas_to_improve,
    }


def fallback_build_resume(data: ResumeBuildRequest) -> str:
    sections: list[str] = []
    sections.append((safe_text(data.name) or "Candidate").upper())
    sections.append(f"Target Role: {safe_text(data.role)} | Industry: {safe_text(data.industry)}")
    sections.append(f"Experience: {safe_text(data.experience_years)}")

    if safe_text(data.skills):
        sections.append(f"SKILLS\n{safe_text(data.skills)}")
    if safe_text(data.work_experience):
        sections.append(f"WORK EXPERIENCE\n{safe_text(data.work_experience)}")
    if safe_text(data.projects):
        sections.append(f"PROJECTS\n{safe_text(data.projects)}")
    if safe_text(data.education):
        sections.append(f"EDUCATION\n{safe_text(data.education)}")

    return "\n\n".join(sections)


def generate_with_llm(system_prompt: str, user_prompt: str, temperature: float, fallback_text: str) -> str:
    if client is None:
        return fallback_text

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=temperature,
        )
        content = safe_text(response.choices[0].message.content)
        return content or fallback_text
    except Exception:
        return fallback_text


def improvise_resume_text(data: ResumeImproviseRequest) -> dict[str, Any]:
    input_skills = safe_text(data.current_skills) or safe_text(data.resume_text)
    analysis = analyze_profile(data.industry, data.role, input_skills)
    suggestions = build_suggestion_payload(
        analysis["role_track"],
        data.role,
        data.industry,
        analysis,
        analysis.get("role_profile"),
        analysis["critical_missing_skills"],
        analysis["missing_core_skills"],
        analysis["missing_adjacent_skills"],
    )

    focus = data.focus_areas or suggestions["priority_actions"][:3]

    improvise_prompt = f"""
You are a senior resume improver.

Target Role: {data.role}
Target Industry: {data.industry}

Current Resume:
{safe_text(data.resume_text)}

Priority Improvements:
- {'\n- '.join(focus)}

Critical Skill Gaps:
- {'\n- '.join(suggestions['critical_missing_skills'][:6]) if suggestions['critical_missing_skills'] else 'None'}

Instructions:
- Rewrite to increase shortlist probability for target role.
- Improve clarity, structure, and impact language.
- Keep claims factual; do not invent fake employers, titles, or numbers.
- Integrate relevant role keywords naturally.
- Return plain text resume only.
"""

    fallback_text = safe_text(data.resume_text)
    improved_resume = generate_with_llm(
        system_prompt="You improve resumes with factual discipline and ATS-aware clarity.",
        user_prompt=improvise_prompt,
        temperature=0.25,
        fallback_text=fallback_text,
    )

    post_analysis = analyze_profile(data.industry, data.role, improved_resume)

    return {
        "stage": "improvise",
        "optimized_resume": improved_resume,
        "improvisation_notes": suggestions["priority_actions"][:4],
        "pre_improvement_score": analysis["overall_score"],
        "post_improvement_estimate": {
            "overall_score": post_analysis["overall_score"],
            "skill_match": post_analysis["skill_match"],
            "ats_friendliness": post_analysis["ats_friendliness"],
            "shortlist_prediction": post_analysis["shortlist_prediction"],
        },
    }


@app.get("/")
def root() -> dict[str, str]:
    return {"message": "Hirescore backend running"}


@app.get("/plan-status")
def plan_status(plan: str = "free", session_id: str = "anonymous") -> dict[str, Any]:
    normalized_plan = normalize_plan(plan)
    normalized_session = normalize_session_id(session_id)
    return {"plan_enforcement": plan_enforcement_payload(normalized_plan, normalized_session)}


@app.post("/analyze")
def analyze_resume(data: ResumeRequest) -> dict[str, Any]:
    normalized_plan = normalize_plan(data.plan)
    normalized_session = normalize_session_id(data.session_id)
    plan_meta = consume_quota(normalized_plan, normalized_session, "analyze")
    skills_text = safe_text(data.skills or data.description)
    analysis = analyze_profile(data.industry, data.role, skills_text)
    analysis["plan_enforcement"] = plan_meta
    return analysis


@app.post("/suggest")
def suggest_actions(data: ResumeRequest) -> dict[str, Any]:
    normalized_plan = normalize_plan(data.plan)
    normalized_session = normalize_session_id(data.session_id)
    plan_meta = consume_quota(normalized_plan, normalized_session, "suggest")
    skills_text = safe_text(data.skills or data.description)
    analysis = analyze_profile(data.industry, data.role, skills_text)

    payload = build_suggestion_payload(
        analysis["role_track"],
        data.role,
        data.industry,
        analysis,
        analysis.get("role_profile"),
        analysis["critical_missing_skills"],
        analysis["missing_core_skills"],
        analysis["missing_adjacent_skills"],
    )
    payload["plan_enforcement"] = plan_meta
    return payload


@app.post("/build-resume")
def build_resume(data: ResumeBuildRequest) -> dict[str, Any]:
    normalized_plan = normalize_plan(data.plan)
    normalized_session = normalize_session_id(data.session_id)
    plan_meta = consume_quota(normalized_plan, normalized_session, "generation")

    seeded_skills = extract_skills_from_text(safe_text(data.skills))
    role_track, blueprint, critical_skills, _ = resolve_role_profile(data.role, data.industry, seeded_skills)

    analysis_source = " ".join(
        part
        for part in [
            safe_text(data.skills),
            safe_text(data.work_experience),
            safe_text(data.projects),
            safe_text(data.education),
        ]
        if part
    ).lower()

    blueprint_catalog = dedupe_preserve_order(
        [
            *critical_skills,
            *blueprint["core"],
            *blueprint["adjacent"],
        ]
    )
    blueprint_hits = [skill for skill in blueprint_catalog if re.search(rf"\b{re.escape(skill)}\b", analysis_source)]
    specificity_hits = [skill for skill in SPECIFICITY_KEYWORDS if re.search(rf"\b{re.escape(skill)}\b", analysis_source)]

    analysis_input = ", ".join(dedupe_preserve_order([*seeded_skills, *blueprint_hits, *specificity_hits]))
    analysis = analyze_profile(data.industry, data.role, analysis_input)

    prompt = f"""
You are a senior resume writer focused on ATS and recruiter readability.

Create a clean, role-targeted resume using only factual details below.

Name: {data.name}
Target Industry: {data.industry}
Target Role: {data.role}
Experience Years: {data.experience_years}

Skills:
{data.skills}

Work Experience:
{data.work_experience}

Projects:
{data.projects}

Education:
{data.education}

Analysis Focus:
- Current shortlist estimate: {analysis['overall_score']}%
- Must-have gaps: {', '.join(analysis['critical_missing_skills'][:5]) or 'None'}
- Missing core skills to emphasize/bridge: {', '.join(analysis['missing_core_skills'][:6]) or 'None'}
- Matched strengths: {', '.join(analysis['matched_core_skills'][:6]) or 'None'}

Instructions:
- Keep output factual and ATS-friendly.
- Use strong achievement-oriented bullet points.
- Do not fabricate employers, titles, or numbers.
- Keep plain text only.

Return only the final resume text.
"""

    content = generate_with_llm(
        system_prompt="You write highly structured, factual resumes.",
        user_prompt=prompt,
        temperature=0.3,
        fallback_text=fallback_build_resume(data),
    )

    return {
        "optimized_resume": content,
        "plan_enforcement": plan_meta,
    }


@app.post("/improvise-resume")
def improvise_resume(data: ResumeImproviseRequest) -> dict[str, Any]:
    normalized_plan = normalize_plan(data.plan)
    normalized_session = normalize_session_id(data.session_id)
    plan_meta = consume_quota(normalized_plan, normalized_session, "generation")
    payload = improvise_resume_text(data)
    payload["plan_enforcement"] = plan_meta
    return payload


@app.post("/polish-resume-pdf")
async def polish_resume_pdf(
    file: UploadFile = File(...),
    plan: str = Form("free"),
    session_id: str = Form("anonymous"),
    industry: str = Form("General"),
    role: str = Form("General Role"),
) -> dict[str, Any]:
    normalized_plan = normalize_plan(plan)
    normalized_session = normalize_session_id(session_id)
    plan_meta = consume_quota(normalized_plan, normalized_session, "pdf_polish")

    contents = await file.read()
    pdf_reader = PyPDF2.PdfReader(io.BytesIO(contents))

    extracted_pages: list[str] = []
    for page in pdf_reader.pages:
        extracted_pages.append(page.extract_text() or "")

    extracted_text = "\n".join(extracted_pages).strip()

    improvise_payload = ResumeImproviseRequest(
        industry=industry,
        role=role,
        resume_text=extracted_text,
        current_skills=extracted_text,
    )

    improved = improvise_resume_text(improvise_payload)
    return {
        "optimized_resume": safe_text(improved["optimized_resume"]),
        "plan_enforcement": plan_meta,
    }
