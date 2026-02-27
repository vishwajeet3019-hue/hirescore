from __future__ import annotations

import io
import csv
import json
import logging
import os
import re
import html
import smtplib
import sqlite3
import threading
import time
import hashlib
import hmac
import base64
import secrets
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Any

import PyPDF2
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from openai import OpenAI
from pydantic import BaseModel
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfgen import canvas
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

try:
    import stripe  # type: ignore
except Exception:  # pragma: no cover - optional dependency at runtime
    stripe = None

try:
    import psycopg2  # type: ignore
    from psycopg2.extras import RealDictCursor  # type: ignore
except Exception:  # pragma: no cover - optional dependency at runtime
    psycopg2 = None
    RealDictCursor = None

load_dotenv()

TRUTHY_ENV_VALUES = {"1", "true", "yes", "on"}
logger = logging.getLogger("hirescore.backend")


def env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in TRUTHY_ENV_VALUES


DEFAULT_CORS_ORIGINS = [
    "https://hirescore.in",
    "https://www.hirescore.in",
    "https://staging.hirescore.in",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]


def parse_cors_origins(value: str | None) -> list[str]:
    if not value:
        return DEFAULT_CORS_ORIGINS
    origins = [origin.strip() for origin in value.split(",") if origin.strip()]
    return origins or DEFAULT_CORS_ORIGINS


app = FastAPI()
cors_allow_origins = parse_cors_origins(os.getenv("CORS_ALLOW_ORIGINS"))
cors_allow_origin_regex = os.getenv("CORS_ALLOW_ORIGIN_REGEX")
BYPASS_PLAN_LIMITS = env_flag("BYPASS_PLAN_LIMITS", False)
BYPASS_PLAN_AS = (os.getenv("BYPASS_PLAN_AS") or "elite").strip().lower()

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_allow_origins,
    allow_origin_regex=cors_allow_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

openai_api_key = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL = (os.getenv("OPENAI_MODEL") or "gpt-4o-mini").strip()
configured_fallback_models = [model.strip() for model in (os.getenv("OPENAI_FALLBACK_MODELS") or "").split(",") if model.strip()]
if configured_fallback_models:
    OPENAI_FALLBACK_MODELS = configured_fallback_models
else:
    OPENAI_FALLBACK_MODELS = [model for model in ["gpt-4.1-mini", "gpt-4o-mini"] if model != OPENAI_MODEL]
client = OpenAI(api_key=openai_api_key) if openai_api_key else None

if client is None:
    logger.warning("OPENAI_API_KEY is missing. AI generation requests will not reach OpenAI.")


def resolve_auth_db_path() -> str:
    explicit = (os.getenv("AUTH_DB_PATH") or "").strip()
    if explicit:
        return explicit
    if os.path.isdir("/var/data"):
        return "/var/data/hirescore_auth.db"
    local_default = os.path.join(os.path.dirname(__file__), "data", "hirescore_auth.db")
    return local_default


def normalize_database_url(value: str | None) -> str:
    raw = (value or "").strip()
    if raw.startswith("postgres://"):
        return "postgresql://" + raw[len("postgres://") :]
    return raw


DATABASE_URL = normalize_database_url(os.getenv("DATABASE_URL") or os.getenv("RENDER_POSTGRESQL_URL"))
AUTH_DB_BACKEND = "postgres" if DATABASE_URL.startswith("postgresql://") else "sqlite"
AUTH_DB_PATH = resolve_auth_db_path()
AUTH_TOKEN_SECRET = (os.getenv("AUTH_TOKEN_SECRET") or "replace-this-in-production").strip()
AUTH_TOKEN_TTL_HOURS = int((os.getenv("AUTH_TOKEN_TTL_HOURS") or "720").strip())
ALLOW_UNVERIFIED_TOPUP = env_flag("ALLOW_UNVERIFIED_TOPUP", True)
EMAIL_OTP_REQUIRED = env_flag("EMAIL_OTP_REQUIRED", True)
ADMIN_API_KEYS = {
    key.strip()
    for key in (os.getenv("ADMIN_API_KEYS") or os.getenv("ADMIN_API_KEY") or "").split(",")
    if key.strip()
}
ADMIN_LOGIN_ID = "vishwajeet3019@gmail.com"
ADMIN_PASSWORD = "Vishwajeet098@"
ADMIN_AUTH_SECRET = ((os.getenv("ADMIN_AUTH_SECRET") or "").strip()) or AUTH_TOKEN_SECRET
ADMIN_TOKEN_TTL_HOURS = max(1, int((os.getenv("ADMIN_TOKEN_TTL_HOURS") or "72").strip()))
if AUTH_TOKEN_SECRET == "replace-this-in-production":
    logger.warning("AUTH_TOKEN_SECRET is using a default value. Set AUTH_TOKEN_SECRET in production.")
if AUTH_DB_BACKEND == "sqlite" and AUTH_DB_PATH.startswith("/tmp/"):
    logger.warning("AUTH_DB_PATH is using temporary storage (%s). Use persistent storage in production.", AUTH_DB_PATH)
if AUTH_DB_BACKEND == "postgres":
    if psycopg2 is None or RealDictCursor is None:
        logger.error("DATABASE_URL is set but psycopg2 is unavailable. Install psycopg2-binary.")
    logger.info("Using external Postgres database for auth storage.")
else:
    logger.info("Using auth database path: %s", AUTH_DB_PATH)
    if env_flag("RENDER", False) and not os.path.isdir("/var/data"):
        logger.warning(
            "Running on Render without persistent disk or DATABASE_URL. User/login data will reset after deploy/restart."
        )

WELCOME_FREE_CREDITS = 5
CREDIT_COSTS: dict[str, int] = {
    "analyze": 5,
    "ai_resume_generation": 15,
    "template_pdf_download": 20,
}

PAYMENT_CREDIT_PACKS: dict[str, dict[str, Any]] = {
    "starter_50": {"label": "Starter 50", "credits": 50, "amount_inr": 199},
    "pro_100": {"label": "Pro 100", "credits": 100, "amount_inr": 499},
    "elite_200": {"label": "Elite 200", "credits": 200, "amount_inr": 999},
}
PAYMENT_SUCCESS_URL = (os.getenv("PAYMENT_SUCCESS_URL") or "").strip() or "https://hirescore.in/pricing?payment=success"
PAYMENT_CANCEL_URL = (os.getenv("PAYMENT_CANCEL_URL") or "").strip() or "https://hirescore.in/pricing?payment=cancelled"
STRIPE_SECRET_KEY = (os.getenv("STRIPE_SECRET_KEY") or "").strip()
STRIPE_WEBHOOK_SECRET = (os.getenv("STRIPE_WEBHOOK_SECRET") or "").strip()
STRIPE_ENABLED = bool(stripe and STRIPE_SECRET_KEY)
if STRIPE_ENABLED and stripe is not None:
    stripe.api_key = STRIPE_SECRET_KEY
RAZORPAY_KEY_ID = (os.getenv("RAZORPAY_KEY_ID") or "").strip()
RAZORPAY_KEY_SECRET = (os.getenv("RAZORPAY_KEY_SECRET") or "").strip()
RAZORPAY_ENABLED = bool(RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET)
PAYMENT_GATEWAY = (os.getenv("PAYMENT_GATEWAY") or "auto").strip().lower()
if PAYMENT_GATEWAY == "razorpay" and RAZORPAY_ENABLED:
    PAYMENT_GATEWAY_ACTIVE = "razorpay"
elif PAYMENT_GATEWAY == "stripe" and STRIPE_ENABLED:
    PAYMENT_GATEWAY_ACTIVE = "stripe"
elif PAYMENT_GATEWAY == "stripe" and not STRIPE_ENABLED and RAZORPAY_ENABLED:
    PAYMENT_GATEWAY_ACTIVE = "razorpay"
elif PAYMENT_GATEWAY == "razorpay" and not RAZORPAY_ENABLED and STRIPE_ENABLED:
    PAYMENT_GATEWAY_ACTIVE = "stripe"
elif RAZORPAY_ENABLED:
    PAYMENT_GATEWAY_ACTIVE = "razorpay"
elif STRIPE_ENABLED:
    PAYMENT_GATEWAY_ACTIVE = "stripe"
else:
    PAYMENT_GATEWAY_ACTIVE = "none"

EMAIL_SMTP_HOST = (os.getenv("EMAIL_SMTP_HOST") or "").strip()
EMAIL_SMTP_PORT = int((os.getenv("EMAIL_SMTP_PORT") or "587").strip())
EMAIL_SMTP_USERNAME = (os.getenv("EMAIL_SMTP_USERNAME") or "").strip()
EMAIL_SMTP_PASSWORD = (os.getenv("EMAIL_SMTP_PASSWORD") or "").strip()
EMAIL_SMTP_FROM = (os.getenv("EMAIL_SMTP_FROM") or EMAIL_SMTP_USERNAME).strip()
EMAIL_SMTP_FROM_NAME = (os.getenv("EMAIL_SMTP_FROM_NAME") or "HireScore").strip()
EMAIL_SMTP_USE_TLS = env_flag("EMAIL_SMTP_USE_TLS", True)
EMAIL_SMTP_USE_SSL = env_flag("EMAIL_SMTP_USE_SSL", False)
EMAIL_SMTP_TIMEOUT_SECONDS = max(5, min(30, int((os.getenv("EMAIL_SMTP_TIMEOUT_SECONDS") or "12").strip())))
SMTP_EMAIL_SENDING_ENABLED = bool(EMAIL_SMTP_HOST and EMAIL_SMTP_PORT and EMAIL_SMTP_USERNAME and EMAIL_SMTP_PASSWORD and EMAIL_SMTP_FROM)
RESEND_API_KEY = (os.getenv("RESEND_API_KEY") or "").strip()
RESEND_FROM = (os.getenv("RESEND_FROM") or EMAIL_SMTP_FROM).strip()
RESEND_EMAIL_SENDING_ENABLED = bool(RESEND_API_KEY and RESEND_FROM)
EMAIL_PROVIDER = (os.getenv("EMAIL_PROVIDER") or "auto").strip().lower()
EMAIL_HTTP_TIMEOUT_SECONDS = max(5, min(30, int((os.getenv("EMAIL_HTTP_TIMEOUT_SECONDS") or "12").strip())))
OTP_SIGNING_SECRET = (os.getenv("OTP_SIGNING_SECRET") or AUTH_TOKEN_SECRET).strip()
OTP_EXPIRY_MINUTES = max(2, min(30, int((os.getenv("OTP_EXPIRY_MINUTES") or "10").strip())))
OTP_RESEND_COOLDOWN_SECONDS = max(10, min(180, int((os.getenv("OTP_RESEND_COOLDOWN_SECONDS") or "45").strip())))
OTP_MAX_ATTEMPTS = max(3, min(12, int((os.getenv("OTP_MAX_ATTEMPTS") or "6").strip())))

AUTH_DB_LOCK = threading.Lock()


class AuthRequest(BaseModel):
    email: str
    password: str


class SignupOtpRequest(BaseModel):
    email: str
    password: str


class SignupOtpVerifyRequest(BaseModel):
    email: str
    otp: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ForgotPasswordResetRequest(BaseModel):
    email: str
    otp: str
    new_password: str


class TopupRequest(BaseModel):
    credits: int


class FeedbackSubmitRequest(BaseModel):
    rating: int
    comment: str
    source: str | None = None
    auth_token: str | None = None


class PaymentCheckoutRequest(BaseModel):
    package_id: str
    auth_token: str | None = None


class RazorpayVerifyRequest(BaseModel):
    order_id: str
    razorpay_payment_id: str
    razorpay_signature: str
    auth_token: str | None = None


class AdminUserUpdateRequest(BaseModel):
    name: str | None = None
    email: str | None = None
    password: str | None = None
    credits_set: int | None = None
    plan: str | None = None


class AdminCreditAdjustRequest(BaseModel):
    delta: int
    reason: str | None = None


class AdminLoginRequest(BaseModel):
    login_id: str
    password: str


class ResumeExportRequest(BaseModel):
    name: str | None = None
    template: str | None = None
    resume_text: str
    auth_token: str | None = None


class ResumeRequest(BaseModel):
    industry: str
    role: str
    skills: str | None = None
    description: str | None = None
    experience_years: float | None = None
    applications_count: int | None = None
    salary_boost_toggles: list[str] | None = None
    plan: str | None = None
    session_id: str | None = None
    auth_token: str | None = None


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
    auth_token: str | None = None


class ResumeImproviseRequest(BaseModel):
    industry: str
    role: str
    resume_text: str
    current_skills: str | None = None
    focus_areas: list[str] | None = None
    plan: str | None = None
    session_id: str | None = None
    auth_token: str | None = None


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

BYPASS_PLAN_AS = BYPASS_PLAN_AS if BYPASS_PLAN_AS in PLAN_RULES else "elite"

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
    "content marketing": "content strategy",
    "email campaigns": "email marketing",
    "social media marketing": "social media",
    "ppc": "performance marketing",
    "google analytics": "analytics",
    "meta marketing": "meta ads",
    "paid ads": "performance marketing",
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
    "business": {
        "core": [
            "business analysis",
            "requirement gathering",
            "stakeholder management",
            "process mapping",
            "kpi tracking",
            "problem solving",
        ],
        "adjacent": [
            "excel",
            "sql",
            "power bi",
            "tableau",
            "documentation",
            "workflow design",
            "gap analysis",
            "presentation",
        ],
        "projects": [
            "Create an end-to-end business requirements document with measurable delivery outcomes.",
            "Build a KPI dashboard and present weekly business insights with actions.",
            "Map and optimize one operational workflow with before/after performance metrics.",
        ],
    },
    "consulting": {
        "core": [
            "problem structuring",
            "market analysis",
            "client communication",
            "stakeholder management",
            "business strategy",
            "presentation",
        ],
        "adjacent": [
            "financial modeling",
            "excel",
            "powerpoint",
            "data analysis",
            "research",
            "workshop facilitation",
            "change management",
            "risk analysis",
        ],
        "projects": [
            "Deliver a consulting case with clear hypotheses, analysis, and implementation roadmap.",
            "Build a market-entry strategy deck with assumptions and quantified impact.",
            "Create an operating model recommendation with risks, dependencies, and success metrics.",
        ],
    },
    "cybersecurity": {
        "core": [
            "network security",
            "security monitoring",
            "incident response",
            "vulnerability assessment",
            "risk management",
            "security compliance",
        ],
        "adjacent": [
            "siem",
            "soc",
            "iam",
            "penetration testing",
            "threat modeling",
            "cloud security",
            "linux",
            "scripting",
        ],
        "projects": [
            "Build a security monitoring workflow with alert triage and incident playbooks.",
            "Conduct a vulnerability assessment and remediation prioritization report.",
            "Design a role-based access control model with audit and compliance mapping.",
        ],
    },
    "mobile": {
        "core": [
            "android",
            "ios",
            "mobile app development",
            "ui development",
            "api integration",
            "debugging",
        ],
        "adjacent": [
            "kotlin",
            "swift",
            "flutter",
            "react native",
            "firebase",
            "performance optimization",
            "app testing",
            "state management",
        ],
        "projects": [
            "Build a production-ready mobile app with auth, APIs, and offline support.",
            "Optimize app performance and reduce crash rates with measurable improvements.",
            "Create a modular app architecture with testable components and CI pipeline.",
        ],
    },
    "content": {
        "core": [
            "content writing",
            "content strategy",
            "seo",
            "research",
            "editing",
            "storytelling",
        ],
        "adjacent": [
            "copywriting",
            "email marketing",
            "social media",
            "keyword research",
            "cms",
            "analytics",
            "brand voice",
            "campaign planning",
        ],
        "projects": [
            "Build a content calendar with measurable organic traffic growth targets.",
            "Create SEO-optimized long-form and landing-page content with keyword strategy.",
            "Design a multi-channel content campaign and report engagement/conversion impact.",
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
    "sales": [
        "sales",
        "account executive",
        "business development",
        "bdm",
        "inside sales",
        "field sales",
        "retail sales",
        "channel sales",
        "relationship manager",
        "regional sales manager",
        "pre sales",
        "sales manager",
        "automobile sales",
        "automotive sales",
        "dealer sales",
        "territory sales",
    ],
    "marketing": [
        "marketing",
        "digital marketing",
        "seo",
        "sem",
        "brand",
        "campaign",
        "performance marketing",
        "marketing associate",
        "growth marketer",
        "content marketer",
        "email marketer",
        "social media manager",
        "seo specialist",
        "brand manager",
        "demand generation",
        "marketing manager",
    ],
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
    "business": ["business analyst", "business analysis", "requirements", "process mapping", "kpi", "bsa"],
    "consulting": ["consultant", "consulting", "strategy consultant", "management consulting", "advisory"],
    "cybersecurity": ["cybersecurity", "security analyst", "soc", "infosec", "iam", "threat", "vulnerability"],
    "mobile": ["mobile", "android", "ios", "flutter", "react native", "app developer"],
    "content": ["content", "content writer", "copywriter", "copywriting", "editor", "seo content"],
}

ROLE_TITLE_OVERRIDES = {
    "business analyst": "business",
    "marketing associate": "marketing",
    "seo specialist": "marketing",
    "content strategist": "content",
    "sales executive": "sales",
    "customer success manager": "support",
    "backend engineer": "backend",
    "frontend developer": "frontend",
    "data analyst": "data",
    "hr recruiter": "hr",
    "operations associate": "operations",
    "finance analyst": "finance",
    "ui ux designer": "design",
    "product designer": "design",
    "qa engineer": "qa",
    "devops engineer": "devops",
    "security analyst": "cybersecurity",
    "cybersecurity analyst": "cybersecurity",
    "mobile app developer": "mobile",
    "legal associate": "legal",
    "healthcare coordinator": "healthcare",
}

ROLE_CRITICAL_SKILLS = {
    "backend": ["python", "sql", "api design"],
    "frontend": ["javascript", "react", "html"],
    "data": ["python", "sql", "data analysis"],
    "product": ["product strategy", "metrics", "user research"],
    "sales": ["pipeline management", "negotiation", "deal closing"],
    "marketing": ["campaign management", "seo", "content strategy"],
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
    "business": ["business analysis", "requirement gathering", "stakeholder management"],
    "consulting": ["problem structuring", "market analysis", "presentation"],
    "cybersecurity": ["network security", "incident response", "vulnerability assessment"],
    "mobile": ["mobile app development", "api integration", "debugging"],
    "content": ["content writing", "content strategy", "seo"],
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
    "sem",
    "content strategy",
    "content writing",
    "email marketing",
    "social media",
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
    "kotlin",
    "swift",
    "flutter",
    "react native",
    "firebase",
    "siem",
    "soc",
    "iam",
    "penetration testing",
    "vulnerability assessment",
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

TRACK_TO_MARKET_SEGMENT = {
    "backend": "technology",
    "frontend": "technology",
    "data": "technology",
    "product": "business",
    "sales": "business",
    "marketing": "business",
    "finance": "business",
    "operations": "business",
    "hr": "business",
    "design": "creative",
    "devops": "technology",
    "qa": "technology",
    "support": "service",
    "legal": "business",
    "healthcare": "service",
    "education": "service",
    "business": "business",
    "consulting": "business",
    "cybersecurity": "technology",
    "mobile": "technology",
    "content": "creative",
    "general": "general",
}

TRACK_FIELD_FAMILIES: dict[str, str] = {
    "backend": "technology",
    "frontend": "technology",
    "data": "technology",
    "devops": "technology",
    "qa": "technology",
    "cybersecurity": "technology",
    "mobile": "technology",
    "product": "product_design",
    "design": "product_design",
    "sales": "go_to_market",
    "marketing": "go_to_market",
    "content": "go_to_market",
    "support": "go_to_market",
    "finance": "business_ops",
    "operations": "business_ops",
    "hr": "business_ops",
    "business": "business_ops",
    "consulting": "business_ops",
    "legal": "business_ops",
    "healthcare": "services",
    "education": "services",
    "general": "general",
}

FIELD_FAMILY_TRACKS: dict[str, list[str]] = {
    "technology": ["backend", "frontend", "data", "devops", "qa", "cybersecurity", "mobile"],
    "product_design": ["product", "design", "business", "marketing"],
    "go_to_market": ["sales", "marketing", "content", "support", "business", "operations"],
    "business_ops": ["business", "operations", "finance", "hr", "consulting", "legal", "support"],
    "services": ["healthcare", "education", "support", "operations", "business"],
    "general": [],
}

NON_TECH_ROLE_TRACKS = {"sales", "marketing", "content", "support", "finance", "operations", "hr", "business", "consulting", "legal", "healthcare", "education"}

TECH_HEAVY_TERMS = {
    "python",
    "sql",
    "api design",
    "javascript",
    "react",
    "next.js",
    "typescript",
    "docker",
    "kubernetes",
    "ci/cd",
    "microservices",
    "system design",
    "tensorflow",
    "pytorch",
    "node.js",
    "java",
    "aws",
    "gcp",
    "azure",
    "devops",
    "backend",
    "frontend",
    "mobile app development",
}

ROLE_HUMAN_INSIGHT_PACKS: dict[str, dict[str, str]] = {
    "sales": {
        "hiring_lens": "Sales hiring teams trust pipeline evidence, conversion outcomes, and client handling maturity over generic claims.",
        "proof_style": "Use bullets that show deal stage movement, average ticket size, win-rate lift, and renewal/expansion wins.",
        "weekly_move": "Every week, add one quantified deal story and one objection-handling example from live conversations.",
    },
    "marketing": {
        "hiring_lens": "Marketing shortlisting is driven by channel ownership, CAC/ROAS discipline, and clear campaign outcomes.",
        "proof_style": "Show campaign hypothesis, execution, and measured outcome (lead quality, CPL, CTR/CVR, ROI).",
        "weekly_move": "Each week, publish one campaign teardown: what changed, why, and what improved in numbers.",
    },
    "hr": {
        "hiring_lens": "HR hiring evaluates quality-of-hire impact, funnel discipline, and stakeholder trust.",
        "proof_style": "Show time-to-hire improvements, offer-acceptance lift, onboarding quality, and retention support metrics.",
        "weekly_move": "Every week, add one hiring/process case where you diagnosed a bottleneck and fixed it.",
    },
    "operations": {
        "hiring_lens": "Operations hiring rewards execution reliability, SLA discipline, and process improvement ownership.",
        "proof_style": "Show before/after metrics for cycle-time, quality errors, cost, and throughput.",
        "weekly_move": "Each week, document one workflow improvement with measurable impact and stakeholder adoption.",
    },
    "business": {
        "hiring_lens": "Business roles prioritize structured thinking, requirement clarity, and measurable business impact.",
        "proof_style": "Show problem framing, analysis path, recommendation, and measurable result in plain business language.",
        "weekly_move": "Publish one mini business case per week tied to your target role and industry reality.",
    },
    "finance": {
        "hiring_lens": "Finance hiring screens for analytical rigor, variance control, and decision-quality reporting.",
        "proof_style": "Show forecast accuracy, variance reduction, margin/cashflow impact, and decision influence.",
        "weekly_move": "Add one case weekly showing how your analysis changed a financial decision.",
    },
    "support": {
        "hiring_lens": "Support teams shortlist candidates who can de-escalate quickly and protect customer trust at scale.",
        "proof_style": "Show response/resolution improvements, CSAT gains, and repeat-ticket reduction outcomes.",
        "weekly_move": "Each week, add one complex escalation story with root-cause fix and customer outcome.",
    },
}

INDIA_MARKET_SEGMENTS: dict[str, dict[str, Any]] = {
    "technology": {
        "salary_lpa": {"entry": (5.8, 12.0), "mid": (11.0, 24.0), "senior": (22.0, 48.0)},
        "best_months": ["January", "February", "March", "July", "August", "September"],
        "hiring_peak_windows": ["Q1 budgeting cycle", "Q3 product release cycle"],
        "layoff_risk": "medium",
        "layoff_note": "Startup and non-profitable teams can be volatile; revenue-critical engineering teams are safer.",
    },
    "business": {
        "salary_lpa": {"entry": (3.6, 8.5), "mid": (7.5, 18.0), "senior": (15.0, 36.0)},
        "best_months": ["January", "February", "April", "August", "September", "October"],
        "hiring_peak_windows": ["Q1 annual planning", "Post-monsoon expansion cycle"],
        "layoff_risk": "medium",
        "layoff_note": "Demand is healthy but target-driven teams can tighten headcount during slow quarters.",
    },
    "creative": {
        "salary_lpa": {"entry": (3.2, 8.0), "mid": (6.5, 15.0), "senior": (13.0, 28.0)},
        "best_months": ["January", "March", "June", "August", "October"],
        "hiring_peak_windows": ["Campaign planning cycles", "Festive-quarter brand spend"],
        "layoff_risk": "medium",
        "layoff_note": "Brand budgets can contract in downturns; performance-linked roles are more resilient.",
    },
    "service": {
        "salary_lpa": {"entry": (2.8, 7.0), "mid": (5.5, 13.0), "senior": (11.0, 24.0)},
        "best_months": ["February", "March", "July", "August", "November"],
        "hiring_peak_windows": ["Academic/financial-year transitions", "Year-end staffing ramps"],
        "layoff_risk": "low",
        "layoff_note": "Operational roles are steadier, with volatility concentrated in contract-heavy employers.",
    },
    "general": {
        "salary_lpa": {"entry": (3.4, 7.8), "mid": (6.8, 15.0), "senior": (12.0, 28.0)},
        "best_months": ["January", "February", "July", "August", "September"],
        "hiring_peak_windows": ["Quarter planning windows"],
        "layoff_risk": "medium",
        "layoff_note": "Stability depends on company profitability and team criticality.",
    },
}

HIGH_RISK_INDUSTRIES_INDIA = [
    "speculative web3 and non-revenue crypto ventures",
    "high-burn direct-to-consumer startups",
    "ad-dependent content businesses with weak cash flow",
]

SEGMENT_RISK_SEGMENTS_INDIA: dict[str, list[str]] = {
    "technology": [
        "high-burn SaaS startups without clear path to profitability",
        "outsourcing teams with single-client dependency",
        "speculative AI tooling products with low enterprise adoption",
    ],
    "business": [
        "commission-heavy field sales teams with high quarterly churn",
        "aggressive expansion teams with weak unit economics",
        "agencies dependent on one or two anchor clients",
    ],
    "creative": [
        "project-only design agencies with unstable retainers",
        "brand studios tied to seasonal ad budgets",
        "influencer-only content operations with volatile demand",
    ],
    "service": [
        "contract-heavy support desks with limited SLA protection",
        "short-cycle BPO projects without multi-year contracts",
        "operations teams in low-margin outsourcing firms",
    ],
    "general": [
        *HIGH_RISK_INDUSTRIES_INDIA,
    ],
}

ROLE_TRACK_MARKET_HINTS: dict[str, dict[str, Any]] = {
    "backend": {
        "best_months": ["January", "February", "July", "August", "November"],
        "peak_windows": ["Q1 platform budgeting", "Q3 reliability hiring"],
        "risk_delta": -1,
        "timing_tip": "Lead with reliability and scale-impact bullets in the first outreach batch.",
    },
    "frontend": {
        "best_months": ["January", "March", "July", "September", "October"],
        "peak_windows": ["Q1 product roadmap staffing", "Q3 feature-release sprint"],
        "risk_delta": 0,
        "timing_tip": "Submit role-tailored portfolio links with measurable UX outcomes.",
    },
    "data": {
        "best_months": ["February", "March", "August", "September", "October"],
        "peak_windows": ["Quarterly planning analytics ramp", "Pre-festive forecasting window"],
        "risk_delta": 0,
        "timing_tip": "Prioritize evidence of business impact, not just tooling.",
    },
    "product": {
        "best_months": ["January", "April", "July", "August", "October"],
        "peak_windows": ["Annual planning cycle", "Mid-year growth initiatives"],
        "risk_delta": 1,
        "timing_tip": "Apply early in planning cycles with roadmap and metric ownership examples.",
    },
    "sales": {
        "best_months": ["January", "April", "July", "September", "October"],
        "peak_windows": ["Quarter opening headcount release", "Festive-quarter revenue push"],
        "risk_delta": 1,
        "timing_tip": "Reach out in the first 10 business days of a quarter with pipeline outcomes.",
    },
    "marketing": {
        "best_months": ["January", "March", "June", "August", "October"],
        "peak_windows": ["Campaign planning cycle", "Festive demand acceleration"],
        "risk_delta": 1,
        "timing_tip": "Share campaign case studies before peak spend months.",
    },
    "finance": {
        "best_months": ["January", "February", "April", "July", "September"],
        "peak_windows": ["Annual budgeting", "Quarter close and forecast refresh"],
        "risk_delta": -1,
        "timing_tip": "Highlight variance reduction and decision-support impact in outreach.",
    },
    "operations": {
        "best_months": ["February", "March", "July", "August", "November"],
        "peak_windows": ["Post-quarter process reset", "Year-end fulfillment ramp"],
        "risk_delta": -1,
        "timing_tip": "Show SLA and cycle-time improvements with clear before/after numbers.",
    },
    "hr": {
        "best_months": ["January", "February", "June", "July", "September"],
        "peak_windows": ["Campus and lateral hiring cycles", "Mid-year expansion hiring"],
        "risk_delta": 0,
        "timing_tip": "Apply before bulk hiring waves with funnel-quality examples.",
    },
    "support": {
        "best_months": ["February", "May", "July", "September", "November"],
        "peak_windows": ["Customer volume ramps", "Service transition windows"],
        "risk_delta": -1,
        "timing_tip": "Lead with CSAT, resolution time, and escalation outcomes.",
    },
    "general": {
        "best_months": ["January", "February", "July", "August", "September"],
        "peak_windows": ["Quarter planning windows"],
        "risk_delta": 0,
        "timing_tip": "Apply in focused weekly batches with role-specific resume variants.",
    },
}

TRACK_ROLE_OPTIONS: dict[str, list[str]] = {
    "backend": ["Backend Engineer", "Platform Engineer", "API Engineer", "Site Reliability Engineer"],
    "frontend": ["Frontend Engineer", "UI Engineer", "Web Developer", "Design Systems Engineer"],
    "data": ["Data Analyst", "Data Scientist", "Business Intelligence Analyst", "ML Engineer"],
    "product": ["Product Manager", "Product Analyst", "Growth Analyst", "Program Manager"],
    "sales": ["Account Executive", "Business Development Executive", "Inside Sales Specialist", "Customer Success Manager"],
    "marketing": ["Performance Marketer", "Growth Marketer", "SEO Specialist", "Content Marketing Manager"],
    "finance": ["Finance Analyst", "FP&A Analyst", "Risk Analyst", "Business Finance Manager"],
    "operations": ["Operations Analyst", "Program Operations Manager", "Supply Chain Analyst", "Business Operations Lead"],
    "hr": ["Talent Acquisition Specialist", "HR Operations Analyst", "People Partner", "Recruitment Consultant"],
    "design": ["Product Designer", "UI Designer", "UX Researcher", "Visual Designer"],
    "devops": ["DevOps Engineer", "Cloud Engineer", "Infrastructure Engineer", "Reliability Engineer"],
    "qa": ["QA Engineer", "Automation Test Engineer", "SDET", "Quality Analyst"],
    "support": ["Customer Support Specialist", "Customer Success Executive", "Support Operations Analyst", "Service Desk Analyst"],
    "legal": ["Legal Associate", "Compliance Analyst", "Contracts Specialist", "Corporate Counsel"],
    "healthcare": ["Clinical Coordinator", "Healthcare Operations Analyst", "Patient Success Specialist", "Medical Documentation Specialist"],
    "education": ["Instructional Designer", "Curriculum Specialist", "Learning Program Manager", "Academic Coordinator"],
    "business": ["Business Analyst", "Process Analyst", "Strategy Analyst", "Operations Analyst"],
    "consulting": ["Consulting Analyst", "Strategy Analyst", "Business Consultant", "Transformation Consultant"],
    "cybersecurity": ["Security Analyst", "SOC Analyst", "Security Engineer", "GRC Analyst"],
    "mobile": ["Mobile Developer", "Android Developer", "iOS Developer", "Flutter Engineer"],
    "content": ["Content Strategist", "SEO Content Specialist", "Copywriter", "Editorial Lead"],
    "general": ["Business Analyst", "Operations Executive", "Project Coordinator", "Program Associate"],
}

ROLE_TRACK_NEIGHBORS: dict[str, list[str]] = {
    "backend": ["devops", "data", "cybersecurity", "qa"],
    "frontend": ["design", "product", "mobile", "qa"],
    "data": ["business", "finance", "product", "marketing"],
    "product": ["business", "marketing", "operations", "design"],
    "sales": ["marketing", "support", "business", "operations"],
    "marketing": ["content", "sales", "product", "business"],
    "finance": ["business", "consulting", "operations", "data"],
    "operations": ["business", "finance", "support", "consulting"],
    "hr": ["operations", "support", "business", "consulting"],
    "design": ["frontend", "product", "content", "marketing"],
    "devops": ["backend", "cybersecurity", "qa", "data"],
    "qa": ["backend", "frontend", "devops", "mobile"],
    "support": ["sales", "operations", "business", "hr"],
    "legal": ["business", "consulting", "finance", "operations"],
    "healthcare": ["support", "operations", "business", "education"],
    "education": ["content", "operations", "business", "support"],
    "business": ["consulting", "operations", "product", "finance"],
    "consulting": ["business", "product", "finance", "operations"],
    "cybersecurity": ["devops", "backend", "qa", "data"],
    "mobile": ["frontend", "backend", "product", "qa"],
    "content": ["marketing", "design", "sales", "product"],
}

GLOBAL_SALARY_BOOSTERS: list[dict[str, Any]] = [
    {
        "id": "quantified_outcomes",
        "label": "Quantified impact in resume",
        "description": "Show revenue, conversion, savings, quality, or delivery metrics.",
        "uplift_lpa": 1.1,
    },
    {
        "id": "domain_certification",
        "label": "Role-relevant certification",
        "description": "Add one strong certification tied to your target role stack.",
        "uplift_lpa": 0.8,
    },
    {
        "id": "portfolio_case_study",
        "label": "Portfolio case study",
        "description": "Show one end-to-end project artifact aligned to your target job.",
        "uplift_lpa": 1.2,
    },
]

TRACK_SALARY_BOOSTERS: dict[str, list[dict[str, Any]]] = {
    "technology": [
        {"id": "cloud_depth", "label": "Cloud depth (AWS/GCP/Azure)", "description": "Demonstrate production-grade cloud ownership.", "uplift_lpa": 1.4},
        {"id": "system_design", "label": "System design readiness", "description": "Show scalability and architecture decision capability.", "uplift_lpa": 1.6},
    ],
    "business": [
        {"id": "stakeholder_influence", "label": "Stakeholder influence", "description": "Document cross-functional initiatives with outcomes.", "uplift_lpa": 1.3},
        {"id": "pnl_orientation", "label": "P&L or revenue ownership", "description": "Show ownership of growth, margin, or cost metrics.", "uplift_lpa": 1.5},
    ],
    "creative": [
        {"id": "campaign_roi", "label": "Campaign ROI proof", "description": "Add data-backed campaign case studies.", "uplift_lpa": 1.2},
        {"id": "design_systems", "label": "Design systems expertise", "description": "Show consistency and scale impact from design systems.", "uplift_lpa": 1.0},
    ],
    "service": [
        {"id": "service_quality_metrics", "label": "Service quality metrics", "description": "Highlight CSAT, TAT, adherence, and retention gains.", "uplift_lpa": 1.1},
        {"id": "domain_specialization", "label": "Domain specialization", "description": "Show depth in healthcare/education/service workflows.", "uplift_lpa": 0.9},
    ],
    "general": [
        {"id": "business_communication", "label": "Executive communication", "description": "Demonstrate report-ready structured communication.", "uplift_lpa": 0.8},
        {"id": "ownership_scope", "label": "Ownership scope increase", "description": "Show larger project or process ownership.", "uplift_lpa": 1.0},
    ],
}


def clamp(value: float, lower: int = 0, upper: int = 100) -> int:
    return max(lower, min(upper, int(round(value))))


def clamp_float(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def safe_text(value: str | None) -> str:
    return (value or "").strip()


def now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("utf-8").rstrip("=")


def b64url_decode(value: str) -> bytes:
    padding = "=" * ((4 - (len(value) % 4)) % 4)
    return base64.urlsafe_b64decode(value + padding)


DB_INTEGRITY_ERRORS: tuple[type[Exception], ...] = (sqlite3.IntegrityError,)
if psycopg2 is not None:
    DB_INTEGRITY_ERRORS = DB_INTEGRITY_ERRORS + (psycopg2.IntegrityError,)


def adapt_query_for_backend(query: str, params: Any = None) -> tuple[str, Any]:
    if AUTH_DB_BACKEND != "postgres" or params is None:
        return query, params
    converted_query = query.replace("?", "%s")
    if isinstance(params, list):
        return converted_query, tuple(params)
    return converted_query, params


class AuthDBCursor:
    def __init__(self, raw_cursor: Any):
        self._raw_cursor = raw_cursor

    def execute(self, query: str, params: Any = None) -> "AuthDBCursor":
        converted_query, converted_params = adapt_query_for_backend(query, params)
        if converted_params is None:
            self._raw_cursor.execute(converted_query)
        else:
            self._raw_cursor.execute(converted_query, converted_params)
        return self

    def executemany(self, query: str, seq_of_params: list[Any]) -> "AuthDBCursor":
        converted_query = query if AUTH_DB_BACKEND != "postgres" else query.replace("?", "%s")
        converted_params = seq_of_params
        if AUTH_DB_BACKEND == "postgres":
            converted_params = [tuple(item) if isinstance(item, list) else item for item in seq_of_params]
        self._raw_cursor.executemany(converted_query, converted_params)
        return self

    def fetchone(self) -> Any:
        return self._raw_cursor.fetchone()

    def fetchall(self) -> list[Any]:
        return self._raw_cursor.fetchall()

    def close(self) -> None:
        self._raw_cursor.close()

    @property
    def rowcount(self) -> int:
        return int(getattr(self._raw_cursor, "rowcount", 0))

    @property
    def lastrowid(self) -> Any:
        return getattr(self._raw_cursor, "lastrowid", None)


class AuthDBConnection:
    def __init__(self, raw_connection: Any):
        self._raw_connection = raw_connection

    def cursor(self) -> AuthDBCursor:
        if AUTH_DB_BACKEND == "postgres":
            if RealDictCursor is None:
                raise RuntimeError("RealDictCursor unavailable while DATABASE_URL is configured.")
            return AuthDBCursor(self._raw_connection.cursor(cursor_factory=RealDictCursor))
        return AuthDBCursor(self._raw_connection.cursor())

    def execute(self, query: str, params: Any = None) -> AuthDBCursor:
        cursor = self.cursor()
        cursor.execute(query, params)
        return cursor

    def commit(self) -> None:
        self._raw_connection.commit()

    def rollback(self) -> None:
        self._raw_connection.rollback()

    def close(self) -> None:
        self._raw_connection.close()

    def __enter__(self) -> "AuthDBConnection":
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        self.close()


def auth_db_connection() -> AuthDBConnection:
    if AUTH_DB_BACKEND == "postgres":
        if psycopg2 is None:
            raise RuntimeError("DATABASE_URL is configured but psycopg2 is not installed.")
        raw_connection = psycopg2.connect(DATABASE_URL, connect_timeout=10)
        return AuthDBConnection(raw_connection)
    db_dir = os.path.dirname(AUTH_DB_PATH)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    raw_connection = sqlite3.connect(AUTH_DB_PATH, timeout=15, check_same_thread=False)
    raw_connection.row_factory = sqlite3.Row
    return AuthDBConnection(raw_connection)


def begin_write_transaction(cursor: AuthDBCursor) -> None:
    if AUTH_DB_BACKEND == "postgres":
        cursor.execute("BEGIN")
        return
    cursor.execute("BEGIN IMMEDIATE")


def inserted_row_id(connection: AuthDBConnection, cursor: AuthDBCursor) -> int:
    raw_id = cursor.lastrowid
    if raw_id not in (None, "", 0):
        return int(raw_id)
    if AUTH_DB_BACKEND == "postgres":
        row = connection.execute("SELECT LASTVAL() AS id").fetchone()
        if row:
            row_id = row["id"]
            if row_id is not None:
                return int(row_id)
    raise RuntimeError("Unable to determine inserted row id for the current transaction.")


def init_auth_db() -> None:
    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            if AUTH_DB_BACKEND == "postgres":
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS users (
                        id BIGSERIAL PRIMARY KEY,
                        full_name TEXT NOT NULL DEFAULT '',
                        email TEXT NOT NULL UNIQUE,
                        password_hash TEXT NOT NULL,
                        password_salt TEXT NOT NULL,
                        plan_tier TEXT NOT NULL DEFAULT 'free',
                        credits INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL,
                        email_verified INTEGER NOT NULL DEFAULT 1
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS credit_transactions (
                        id BIGSERIAL PRIMARY KEY,
                        user_id BIGINT NOT NULL REFERENCES users (id),
                        action TEXT NOT NULL,
                        delta INTEGER NOT NULL,
                        balance_after INTEGER NOT NULL,
                        meta_json TEXT,
                        created_at TEXT NOT NULL
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS user_feedback (
                        id BIGSERIAL PRIMARY KEY,
                        user_id BIGINT NOT NULL REFERENCES users (id),
                        rating INTEGER NOT NULL,
                        comment TEXT NOT NULL,
                        source TEXT,
                        created_at TEXT NOT NULL
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS analytics_events (
                        id BIGSERIAL PRIMARY KEY,
                        user_id BIGINT REFERENCES users (id),
                        event_type TEXT NOT NULL,
                        event_name TEXT NOT NULL,
                        meta_json TEXT,
                        created_at TEXT NOT NULL
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS payment_orders (
                        id BIGSERIAL PRIMARY KEY,
                        gateway TEXT NOT NULL,
                        order_id TEXT NOT NULL UNIQUE,
                        user_id BIGINT NOT NULL REFERENCES users (id),
                        package_id TEXT NOT NULL,
                        credits INTEGER NOT NULL,
                        amount_inr INTEGER NOT NULL,
                        currency TEXT NOT NULL,
                        status TEXT NOT NULL,
                        payment_id TEXT,
                        signature TEXT,
                        created_at TEXT NOT NULL,
                        verified_at TEXT,
                        meta_json TEXT
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS signup_otps (
                        id BIGSERIAL PRIMARY KEY,
                        email TEXT NOT NULL,
                        password_hash TEXT NOT NULL,
                        password_salt TEXT NOT NULL,
                        otp_hash TEXT NOT NULL,
                        expires_at TEXT NOT NULL,
                        attempts INTEGER NOT NULL DEFAULT 0,
                        consumed_at TEXT,
                        created_at TEXT NOT NULL
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS password_reset_otps (
                        id BIGSERIAL PRIMARY KEY,
                        user_id BIGINT NOT NULL REFERENCES users (id),
                        email TEXT NOT NULL,
                        otp_hash TEXT NOT NULL,
                        expires_at TEXT NOT NULL,
                        attempts INTEGER NOT NULL DEFAULT 0,
                        consumed_at TEXT,
                        created_at TEXT NOT NULL
                    )
                    """
                )
                cursor.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT ''")
                cursor.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_tier TEXT NOT NULL DEFAULT 'free'")
                cursor.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified INTEGER NOT NULL DEFAULT 1")
            else:
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        full_name TEXT NOT NULL DEFAULT '',
                        email TEXT NOT NULL UNIQUE,
                        password_hash TEXT NOT NULL,
                        password_salt TEXT NOT NULL,
                        plan_tier TEXT NOT NULL DEFAULT 'free',
                        credits INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS credit_transactions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        action TEXT NOT NULL,
                        delta INTEGER NOT NULL,
                        balance_after INTEGER NOT NULL,
                        meta_json TEXT,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY (user_id) REFERENCES users (id)
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS user_feedback (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        rating INTEGER NOT NULL,
                        comment TEXT NOT NULL,
                        source TEXT,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY (user_id) REFERENCES users (id)
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS analytics_events (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER,
                        event_type TEXT NOT NULL,
                        event_name TEXT NOT NULL,
                        meta_json TEXT,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY (user_id) REFERENCES users (id)
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS payment_orders (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        gateway TEXT NOT NULL,
                        order_id TEXT NOT NULL UNIQUE,
                        user_id INTEGER NOT NULL,
                        package_id TEXT NOT NULL,
                        credits INTEGER NOT NULL,
                        amount_inr INTEGER NOT NULL,
                        currency TEXT NOT NULL,
                        status TEXT NOT NULL,
                        payment_id TEXT,
                        signature TEXT,
                        created_at TEXT NOT NULL,
                        verified_at TEXT,
                        meta_json TEXT,
                        FOREIGN KEY (user_id) REFERENCES users (id)
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS signup_otps (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        email TEXT NOT NULL,
                        password_hash TEXT NOT NULL,
                        password_salt TEXT NOT NULL,
                        otp_hash TEXT NOT NULL,
                        expires_at TEXT NOT NULL,
                        attempts INTEGER NOT NULL DEFAULT 0,
                        consumed_at TEXT,
                        created_at TEXT NOT NULL
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS password_reset_otps (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        email TEXT NOT NULL,
                        otp_hash TEXT NOT NULL,
                        expires_at TEXT NOT NULL,
                        attempts INTEGER NOT NULL DEFAULT 0,
                        consumed_at TEXT,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY (user_id) REFERENCES users (id)
                    )
                    """
                )
                user_columns = [row["name"] for row in cursor.execute("PRAGMA table_info(users)").fetchall()]
                if "full_name" not in user_columns:
                    cursor.execute("ALTER TABLE users ADD COLUMN full_name TEXT NOT NULL DEFAULT ''")
                if "plan_tier" not in user_columns:
                    cursor.execute("ALTER TABLE users ADD COLUMN plan_tier TEXT NOT NULL DEFAULT 'free'")
                if "email_verified" not in user_columns:
                    cursor.execute("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_credit_tx_user_time ON credit_transactions (user_id, created_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_feedback_user_time ON user_feedback (user_id, created_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_events_user_time ON analytics_events (user_id, created_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_events_time ON analytics_events (created_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_payment_orders_user_time ON payment_orders (user_id, created_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders (status, created_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_signup_otps_email_time ON signup_otps (email, created_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_reset_otps_email_time ON password_reset_otps (email, created_at)")
            connection.commit()
        finally:
            connection.close()


def normalize_email(value: str) -> str:
    return safe_text(value).lower()


def normalize_plan_tier(value: str | None) -> str:
    normalized = safe_text(value).lower()
    if normalized in PLAN_RULES:
        return normalized
    aliases = {
        "starter_50": "starter",
        "pro_100": "pro",
        "elite_200": "elite",
        "basic": "free",
    }
    return aliases.get(normalized, "free")


def user_plan_from_package_id(package_id: str) -> str:
    token = safe_text(package_id).lower()
    if token.startswith("starter"):
        return "starter"
    if token.startswith("pro"):
        return "pro"
    if token.startswith("elite"):
        return "elite"
    return "free"


def display_name_from_email(email: str) -> str:
    normalized = normalize_email(email)
    local = normalized.split("@", 1)[0]
    if not local:
        return "User"
    cleaned = re.sub(r"[^a-z0-9]+", " ", local).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    if not cleaned:
        return "User"
    return " ".join(part.capitalize() for part in cleaned.split(" ")[:3])


def hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 190_000).hex()


def parse_iso_datetime(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
    except Exception:
        return datetime.now(timezone.utc) - timedelta(days=3650)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def generate_numeric_otp(length: int = 6) -> str:
    return "".join(str(secrets.randbelow(10)) for _ in range(max(4, min(8, length))))


def otp_hash(email: str, purpose: str, otp: str) -> str:
    message = f"{OTP_SIGNING_SECRET}:{normalize_email(email)}:{safe_text(purpose)}:{safe_text(otp)}"
    return hashlib.sha256(message.encode("utf-8")).hexdigest()


def send_email_message_smtp(to_email: str, subject: str, text_body: str) -> str | None:
    if not SMTP_EMAIL_SENDING_ENABLED:
        return "SMTP email settings are missing in backend environment."

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"{EMAIL_SMTP_FROM_NAME} <{EMAIL_SMTP_FROM}>"
    msg["To"] = normalize_email(to_email)
    msg.set_content(text_body)

    try:
        use_ssl = EMAIL_SMTP_PORT == 465 or EMAIL_SMTP_USE_SSL
        if use_ssl:
            with smtplib.SMTP_SSL(EMAIL_SMTP_HOST, EMAIL_SMTP_PORT, timeout=EMAIL_SMTP_TIMEOUT_SECONDS) as server:
                server.login(EMAIL_SMTP_USERNAME, EMAIL_SMTP_PASSWORD)
                server.send_message(msg)
        else:
            with smtplib.SMTP(EMAIL_SMTP_HOST, EMAIL_SMTP_PORT, timeout=EMAIL_SMTP_TIMEOUT_SECONDS) as server:
                if EMAIL_SMTP_USE_TLS:
                    server.starttls()
                server.login(EMAIL_SMTP_USERNAME, EMAIL_SMTP_PASSWORD)
                server.send_message(msg)
        return None
    except smtplib.SMTPAuthenticationError:
        logger.exception("SMTP auth failed for %s", EMAIL_SMTP_USERNAME)
        return "SMTP authentication failed. Check EMAIL_SMTP_USERNAME and EMAIL_SMTP_PASSWORD."
    except TimeoutError:
        logger.exception("SMTP timeout for host %s", EMAIL_SMTP_HOST)
        return "SMTP connection timed out. Check EMAIL_SMTP_HOST, EMAIL_SMTP_PORT, and EMAIL_SMTP_USE_TLS."
    except smtplib.SMTPException:
        logger.exception("SMTP error while sending email to %s", to_email)
        return "SMTP rejected the request. Verify SMTP host/port/TLS and sender mailbox."
    except OSError:
        logger.exception("SMTP network error while sending email to %s", to_email)
        return "SMTP network error. Verify host/port and provider connectivity."
    except Exception:
        logger.exception("Failed to send email to %s", to_email)
        return "Unexpected email delivery error. Check backend logs for details."


def send_email_message_resend(to_email: str, subject: str, text_body: str) -> str | None:
    if not RESEND_EMAIL_SENDING_ENABLED:
        return "Resend email settings are missing in backend environment."
    payload = {
        "from": f"{EMAIL_SMTP_FROM_NAME} <{RESEND_FROM}>",
        "to": [normalize_email(to_email)],
        "subject": subject,
        "text": text_body,
    }
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "HireScoreBackend/1.0 (+https://hirescore.in)",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=EMAIL_HTTP_TIMEOUT_SECONDS) as resp:
            status_code = int(resp.getcode() or 0)
            if status_code >= 400:
                return f"Resend API rejected the request (HTTP {status_code})."
        return None
    except urllib.error.HTTPError as exc:
        details = ""
        try:
            details = exc.read().decode("utf-8", errors="ignore")
        except Exception:
            details = ""
        logger.exception("Resend HTTP error while sending email to %s", to_email)
        try:
            parsed = json.loads(details or "{}")
        except Exception:
            parsed = {}
        error_name = safe_text(str(parsed.get("name") or ""))
        error_message = safe_text(str(parsed.get("message") or ""))
        if error_name or error_message:
            return f"Resend API error ({exc.code}) {error_name}: {error_message}".strip()
        if "error code: 1010" in details.lower():
            return "Resend API blocked this request (Cloudflare 1010). Check API key account/domain match or contact Resend support."
        if details:
            return f"Resend API error ({exc.code}): {details[:220]}"
        return f"Resend API error ({exc.code})."
    except TimeoutError:
        logger.exception("Resend timeout while sending email to %s", to_email)
        return "Resend API timeout. Check provider connectivity."
    except urllib.error.URLError:
        logger.exception("Resend network error while sending email to %s", to_email)
        return "Resend network error. Verify connectivity from backend."
    except Exception:
        logger.exception("Unexpected Resend failure while sending email to %s", to_email)
        return "Unexpected Resend delivery error. Check backend logs for details."


def send_email_message(to_email: str, subject: str, text_body: str) -> str | None:
    preferred_provider = EMAIL_PROVIDER if EMAIL_PROVIDER in {"smtp", "resend"} else "auto"
    provider_sequence: list[str] = []
    if preferred_provider == "smtp":
        provider_sequence = ["smtp", "resend"]
    elif preferred_provider == "resend":
        provider_sequence = ["resend", "smtp"]
    else:
        if RESEND_EMAIL_SENDING_ENABLED:
            provider_sequence.append("resend")
        if SMTP_EMAIL_SENDING_ENABLED:
            provider_sequence.append("smtp")
    if not provider_sequence:
        logger.warning("Email sending is not configured. Unable to send email to %s", to_email)
        return "Email settings are missing. Configure RESEND_API_KEY/RESEND_FROM or SMTP settings."

    errors: list[str] = []
    for provider in provider_sequence:
        if provider == "resend":
            error = send_email_message_resend(to_email, subject, text_body)
        else:
            error = send_email_message_smtp(to_email, subject, text_body)
        if not error:
            return None
        errors.append(f"{provider.upper()}: {error}")
    return " | ".join(errors)


def send_signup_otp_email(email: str, otp: str) -> str | None:
    return send_email_message(
        email,
        "Your HireScore verification code",
        (
            f"Your HireScore OTP is: {otp}\n\n"
            f"This code expires in {OTP_EXPIRY_MINUTES} minutes.\n"
            "If you did not request this signup, you can ignore this email."
        ),
    )


def send_password_reset_otp_email(email: str, otp: str) -> str | None:
    return send_email_message(
        email,
        "Reset your HireScore password",
        (
            f"Your HireScore password reset OTP is: {otp}\n\n"
            f"This code expires in {OTP_EXPIRY_MINUTES} minutes.\n"
            "If you did not request this reset, please ignore this email."
        ),
    )


def send_welcome_email(email: str) -> str | None:
    return send_email_message(
        email,
        "Welcome to HireScore",
        (
            "Welcome to HireScore.\n\n"
            "Your account is now active with 5 welcome credits.\n"
            "Start by running your first shortlist analysis on /upload."
        ),
    )


def create_user_with_welcome_credits(email: str, password: str, source: str = "signup") -> sqlite3.Row:
    salt = secrets.token_hex(16)
    password_hash = hash_password(password, salt)
    full_name = display_name_from_email(email)

    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            try:
                cursor.execute(
                    """
                    INSERT INTO users (full_name, email, password_hash, password_salt, plan_tier, credits, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (full_name, email, password_hash, salt, "free", WELCOME_FREE_CREDITS, now_utc_iso()),
                )
                user_id = inserted_row_id(connection, cursor)
                cursor.execute(
                    """
                    INSERT INTO credit_transactions (user_id, action, delta, balance_after, meta_json, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        user_id,
                        "welcome_credits",
                        WELCOME_FREE_CREDITS,
                        WELCOME_FREE_CREDITS,
                        json.dumps({"source": source}, separators=(",", ":"), sort_keys=True),
                        now_utc_iso(),
                    ),
                )
                connection.commit()
            except DB_INTEGRITY_ERRORS:
                connection.rollback()
        finally:
            connection.close()

    user = fetch_user_by_email(email)
    if not user:
        raise HTTPException(status_code=500, detail="Unable to create account.")
    return user


def create_auth_token(user_id: int, email: str) -> str:
    payload = {
        "uid": user_id,
        "email": normalize_email(email),
        "exp": int(time.time()) + max(1, AUTH_TOKEN_TTL_HOURS) * 3600,
    }
    payload_b64 = b64url_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = hmac.new(AUTH_TOKEN_SECRET.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).digest()
    return f"{payload_b64}.{b64url_encode(signature)}"


def decode_auth_token(token: str) -> dict[str, Any]:
    parts = token.split(".")
    if len(parts) != 2:
        raise HTTPException(status_code=401, detail="Invalid authentication token.")

    payload_b64, signature_b64 = parts
    expected = hmac.new(AUTH_TOKEN_SECRET.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).digest()
    provided = b64url_decode(signature_b64)

    if not hmac.compare_digest(expected, provided):
        raise HTTPException(status_code=401, detail="Invalid authentication token signature.")

    try:
        payload = json.loads(b64url_decode(payload_b64).decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid authentication token payload.") from exc

    if int(payload.get("exp", 0)) < int(time.time()):
        raise HTTPException(status_code=401, detail="Authentication token expired. Please log in again.")

    return payload


def create_admin_token(login_id: str) -> str:
    payload = {
        "sub": "admin",
        "login_id": safe_text(login_id),
        "exp": int(time.time()) + ADMIN_TOKEN_TTL_HOURS * 3600,
    }
    payload_b64 = b64url_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = hmac.new(ADMIN_AUTH_SECRET.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).digest()
    return f"{payload_b64}.{b64url_encode(signature)}"


def decode_admin_token(token: str) -> dict[str, Any]:
    parts = safe_text(token).split(".")
    if len(parts) != 2:
        raise HTTPException(status_code=401, detail="Invalid admin session token.")
    payload_b64, signature_b64 = parts
    expected = hmac.new(ADMIN_AUTH_SECRET.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).digest()
    provided = b64url_decode(signature_b64)
    if not hmac.compare_digest(expected, provided):
        raise HTTPException(status_code=401, detail="Invalid admin session token.")
    try:
        payload = json.loads(b64url_decode(payload_b64).decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid admin session payload.") from exc
    if safe_text(str(payload.get("sub"))) != "admin":
        raise HTTPException(status_code=401, detail="Invalid admin session subject.")
    if int(payload.get("exp", 0)) < int(time.time()):
        raise HTTPException(status_code=401, detail="Admin session expired. Please login again.")
    return payload


def fetch_user_by_email(email: str) -> sqlite3.Row | None:
    normalized = normalize_email(email)
    connection = auth_db_connection()
    try:
        cursor = connection.execute(
            "SELECT id, full_name, email, password_hash, password_salt, plan_tier, credits, created_at, email_verified FROM users WHERE email = ?",
            (normalized,),
        )
        return cursor.fetchone()
    finally:
        connection.close()


def fetch_user_by_id(user_id: int) -> sqlite3.Row | None:
    connection = auth_db_connection()
    try:
        cursor = connection.execute(
            "SELECT id, full_name, email, password_hash, password_salt, plan_tier, credits, created_at, email_verified FROM users WHERE id = ?",
            (user_id,),
        )
        return cursor.fetchone()
    finally:
        connection.close()


def is_email_verified(user_row: sqlite3.Row | None) -> bool:
    if not user_row:
        return False
    try:
        return bool(int(user_row["email_verified"]))
    except Exception:
        return True


def set_user_password(user_id: int, new_password: str) -> None:
    new_salt = secrets.token_hex(16)
    new_hash = hash_password(new_password, new_salt)
    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            connection.execute(
                "UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?",
                (new_hash, new_salt, user_id),
            )
            connection.commit()
        finally:
            connection.close()


def enforce_otp_resend_cooldown(email: str, table_name: str) -> None:
    connection = auth_db_connection()
    try:
        row = connection.execute(
            f"SELECT created_at FROM {table_name} WHERE email = ? ORDER BY id DESC LIMIT 1",
            (normalize_email(email),),
        ).fetchone()
    finally:
        connection.close()
    if not row:
        return
    created_at = parse_iso_datetime(str(row["created_at"]))
    if (datetime.now(timezone.utc) - created_at).total_seconds() < OTP_RESEND_COOLDOWN_SECONDS:
        raise HTTPException(status_code=429, detail=f"Please wait {OTP_RESEND_COOLDOWN_SECONDS} seconds before requesting a new OTP.")


def create_signup_otp(email: str, password: str) -> None:
    normalized_email = normalize_email(email)
    enforce_otp_resend_cooldown(normalized_email, "signup_otps")
    otp = generate_numeric_otp()
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=OTP_EXPIRY_MINUTES)).isoformat()
    salt = secrets.token_hex(16)
    password_hash = hash_password(password, salt)

    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            connection.execute(
                """
                INSERT INTO signup_otps (email, password_hash, password_salt, otp_hash, expires_at, attempts, consumed_at, created_at)
                VALUES (?, ?, ?, ?, ?, 0, NULL, ?)
                """,
                (
                    normalized_email,
                    password_hash,
                    salt,
                    otp_hash(normalized_email, "signup", otp),
                    expires_at,
                    now_utc_iso(),
                ),
            )
            connection.commit()
        finally:
            connection.close()

    otp_send_error = send_signup_otp_email(normalized_email, otp)
    if otp_send_error:
        raise HTTPException(status_code=503, detail=f"Unable to send verification email right now. {otp_send_error}")


def verify_signup_otp_and_create_user(email: str, otp: str) -> sqlite3.Row:
    normalized_email = normalize_email(email)
    now = datetime.now(timezone.utc)
    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            row = cursor.execute(
                """
                SELECT id, email, password_hash, password_salt, otp_hash, expires_at, attempts, consumed_at
                FROM signup_otps
                WHERE email = ?
                ORDER BY id DESC
                LIMIT 1
                """,
                (normalized_email,),
            ).fetchone()
            if not row:
                connection.rollback()
                raise HTTPException(status_code=400, detail="OTP not found. Please request signup OTP again.")
            if safe_text(row["consumed_at"]):
                connection.rollback()
                raise HTTPException(status_code=400, detail="OTP already used. Request a new OTP.")
            if parse_iso_datetime(str(row["expires_at"])) < now:
                connection.rollback()
                raise HTTPException(status_code=400, detail="OTP expired. Request a new OTP.")
            attempts = int(row["attempts"] or 0)
            if attempts >= OTP_MAX_ATTEMPTS:
                connection.rollback()
                raise HTTPException(status_code=429, detail="Too many invalid OTP attempts. Request a new OTP.")
            if otp_hash(normalized_email, "signup", otp) != safe_text(row["otp_hash"]):
                cursor.execute("UPDATE signup_otps SET attempts = ? WHERE id = ?", (attempts + 1, int(row["id"])))
                connection.commit()
                raise HTTPException(status_code=400, detail="Invalid OTP.")
            existing = cursor.execute(
                "SELECT id FROM users WHERE email = ? LIMIT 1",
                (normalized_email,),
            ).fetchone()
            if existing:
                connection.rollback()
                raise HTTPException(status_code=409, detail="Account already exists. Please log in.")
            cursor.execute(
                """
                INSERT INTO users (full_name, email, password_hash, password_salt, plan_tier, credits, created_at, email_verified)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1)
                """,
                (
                    display_name_from_email(normalized_email),
                    normalized_email,
                    safe_text(row["password_hash"]),
                    safe_text(row["password_salt"]),
                    "free",
                    WELCOME_FREE_CREDITS,
                    now_utc_iso(),
                ),
            )
            user_id = inserted_row_id(connection, cursor)
            cursor.execute(
                """
                INSERT INTO credit_transactions (user_id, action, delta, balance_after, meta_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    "welcome_credits",
                    WELCOME_FREE_CREDITS,
                    WELCOME_FREE_CREDITS,
                    json.dumps({"source": "signup_otp"}, separators=(",", ":"), sort_keys=True),
                    now_utc_iso(),
                ),
            )
            cursor.execute("UPDATE signup_otps SET consumed_at = ? WHERE id = ?", (now_utc_iso(), int(row["id"])))
            connection.commit()
        finally:
            connection.close()

    user = fetch_user_by_email(normalized_email)
    if not user:
        raise HTTPException(status_code=500, detail="Unable to create account.")
    send_welcome_email(normalized_email)
    return user


def create_password_reset_otp(email: str) -> None:
    normalized_email = normalize_email(email)
    user = fetch_user_by_email(normalized_email)
    if not user:
        return
    enforce_otp_resend_cooldown(normalized_email, "password_reset_otps")
    otp = generate_numeric_otp()
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=OTP_EXPIRY_MINUTES)).isoformat()

    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            connection.execute(
                """
                INSERT INTO password_reset_otps (user_id, email, otp_hash, expires_at, attempts, consumed_at, created_at)
                VALUES (?, ?, ?, ?, 0, NULL, ?)
                """,
                (
                    int(user["id"]),
                    normalized_email,
                    otp_hash(normalized_email, "password_reset", otp),
                    expires_at,
                    now_utc_iso(),
                ),
            )
            connection.commit()
        finally:
            connection.close()

    reset_send_error = send_password_reset_otp_email(normalized_email, otp)
    if reset_send_error:
        raise HTTPException(status_code=503, detail=f"Unable to send reset email right now. {reset_send_error}")


def verify_password_reset_otp(email: str, otp: str, new_password: str) -> sqlite3.Row:
    normalized_email = normalize_email(email)
    now = datetime.now(timezone.utc)
    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            row = cursor.execute(
                """
                SELECT id, user_id, otp_hash, expires_at, attempts, consumed_at
                FROM password_reset_otps
                WHERE email = ?
                ORDER BY id DESC
                LIMIT 1
                """,
                (normalized_email,),
            ).fetchone()
            if not row:
                connection.rollback()
                raise HTTPException(status_code=400, detail="Reset OTP not found. Request a new OTP.")
            if safe_text(row["consumed_at"]):
                connection.rollback()
                raise HTTPException(status_code=400, detail="Reset OTP already used. Request a new OTP.")
            if parse_iso_datetime(str(row["expires_at"])) < now:
                connection.rollback()
                raise HTTPException(status_code=400, detail="Reset OTP expired. Request a new OTP.")
            attempts = int(row["attempts"] or 0)
            if attempts >= OTP_MAX_ATTEMPTS:
                connection.rollback()
                raise HTTPException(status_code=429, detail="Too many invalid OTP attempts. Request a new OTP.")
            if otp_hash(normalized_email, "password_reset", otp) != safe_text(row["otp_hash"]):
                cursor.execute("UPDATE password_reset_otps SET attempts = ? WHERE id = ?", (attempts + 1, int(row["id"])))
                connection.commit()
                raise HTTPException(status_code=400, detail="Invalid reset OTP.")
            user_id = int(row["user_id"])
            new_salt = secrets.token_hex(16)
            new_hash = hash_password(new_password, new_salt)
            cursor.execute("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?", (new_hash, new_salt, user_id))
            cursor.execute("UPDATE password_reset_otps SET consumed_at = ? WHERE id = ?", (now_utc_iso(), int(row["id"])))
            connection.commit()
        finally:
            connection.close()

    user = fetch_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Account not found.")
    return user


def log_analytics_event(
    event_type: str,
    event_name: str,
    user_id: int | None = None,
    meta: dict[str, Any] | None = None,
) -> None:
    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            connection.execute(
                """
                INSERT INTO analytics_events (user_id, event_type, event_name, meta_json, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    safe_text(event_type) or "system",
                    safe_text(event_name) or "event",
                    json.dumps(meta or {}, separators=(",", ":"), sort_keys=True),
                    now_utc_iso(),
                ),
            )
            connection.commit()
        except Exception:
            connection.rollback()
        finally:
            connection.close()


def get_analyze_count(user_id: int) -> int:
    connection = auth_db_connection()
    try:
        row = connection.execute(
            "SELECT COUNT(*) AS count FROM credit_transactions WHERE user_id = ? AND action = 'analyze'",
            (user_id,),
        ).fetchone()
        return int(row["count"] if row else 0)
    finally:
        connection.close()


def has_feedback_submission(user_id: int) -> bool:
    connection = auth_db_connection()
    try:
        row = connection.execute(
            "SELECT id FROM user_feedback WHERE user_id = ? ORDER BY id ASC LIMIT 1",
            (user_id,),
        ).fetchone()
        return bool(row)
    finally:
        connection.close()


def feedback_required_for_user(user_id: int) -> bool:
    return get_analyze_count(user_id) >= 1 and not has_feedback_submission(user_id)


def require_feedback_completion(user_id: int) -> None:
    if feedback_required_for_user(user_id):
        raise HTTPException(
            status_code=403,
            detail={
                "message": "Mandatory feedback is required before running another analysis.",
                "feedback_required": True,
            },
        )


def require_admin_access(request: Request) -> None:
    has_api_keys = bool(ADMIN_API_KEYS)
    has_login = bool(ADMIN_LOGIN_ID and ADMIN_PASSWORD)
    if not has_api_keys and not has_login:
        raise HTTPException(status_code=503, detail="Admin access is not configured.")

    bearer = safe_text(extract_bearer_token(request))
    if bearer and has_login:
        decode_admin_token(bearer)
        return

    header_token = safe_text(request.headers.get("x-admin-key"))
    if header_token and header_token in ADMIN_API_KEYS:
        return

    raise HTTPException(status_code=401, detail="Admin authentication failed.")


def wallet_payload(credits: int) -> dict[str, Any]:
    return {
        "credits": max(0, int(credits)),
        "welcome_credits": WELCOME_FREE_CREDITS,
        "pricing": {
            "analyze": CREDIT_COSTS["analyze"],
            "ai_resume_generation": CREDIT_COSTS["ai_resume_generation"],
            "template_pdf_download": CREDIT_COSTS["template_pdf_download"],
        },
        "free_analysis_included": 1,
    }


def auth_response_payload(user_row: sqlite3.Row, token: str | None = None) -> dict[str, Any]:
    user_id = int(user_row["id"])
    email_verified = is_email_verified(user_row)
    payload: dict[str, Any] = {
        "user": {
            "id": user_id,
            "name": safe_text(str(user_row["full_name"])) or display_name_from_email(str(user_row["email"])),
            "email": str(user_row["email"]),
            "plan": normalize_plan_tier(str(user_row["plan_tier"])),
            "created_at": str(user_row["created_at"]),
        },
        "wallet": wallet_payload(int(user_row["credits"])),
        "feedback_required": feedback_required_for_user(user_id),
        "email_verified": email_verified,
    }
    if token:
        payload["auth_token"] = token
    return payload


def extract_bearer_token(request: Request) -> str | None:
    auth_header = safe_text(request.headers.get("authorization"))
    if auth_header.lower().startswith("bearer "):
        return safe_text(auth_header[7:])
    return None


def require_authenticated_user(request: Request, explicit_auth_token: str | None = None) -> sqlite3.Row:
    token = safe_text(explicit_auth_token) or safe_text(extract_bearer_token(request))
    if not token:
        raise HTTPException(status_code=401, detail="Login required. Please sign in to continue.")

    payload = decode_auth_token(token)
    user = fetch_user_by_id(int(payload.get("uid", 0)))
    if not user:
        raise HTTPException(status_code=401, detail="Account not found. Please log in again.")
    if not is_email_verified(user):
        raise HTTPException(status_code=401, detail="Email is not verified. Complete OTP verification to continue.")

    if normalize_email(str(user["email"])) != normalize_email(str(payload.get("email", ""))):
        raise HTTPException(status_code=401, detail="Invalid authentication token.")

    return user


def credit_error(user_row: sqlite3.Row, message: str, status_code: int = 402) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={
            "message": message,
            "wallet": wallet_payload(int(user_row["credits"])),
        },
    )


def debit_credits(user_id: int, action: str, amount: int, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            user = cursor.execute(
                "SELECT id, full_name, email, password_hash, password_salt, plan_tier, credits, created_at FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
            if not user:
                connection.rollback()
                raise HTTPException(status_code=401, detail="Account not found.")

            current_credits = int(user["credits"])
            if current_credits < amount:
                connection.rollback()
                raise credit_error(
                    user,
                    f"Insufficient credits for {action.replace('_', ' ')}. You need {amount} credits.",
                    402,
                )

            updated_credits = current_credits - amount
            cursor.execute("UPDATE users SET credits = ? WHERE id = ?", (updated_credits, user_id))
            cursor.execute(
                """
                INSERT INTO credit_transactions (user_id, action, delta, balance_after, meta_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    action,
                    -amount,
                    updated_credits,
                    json.dumps(meta or {}, separators=(",", ":"), sort_keys=True),
                    now_utc_iso(),
                ),
            )
            transaction_id = inserted_row_id(connection, cursor)
            connection.commit()
            return {
                "transaction_id": transaction_id,
                "wallet": wallet_payload(updated_credits),
            }
        finally:
            connection.close()


def credit_credits(user_id: int, action: str, amount: int, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            user = cursor.execute(
                "SELECT id, email, password_hash, password_salt, credits, created_at FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
            if not user:
                connection.rollback()
                raise HTTPException(status_code=401, detail="Account not found.")

            updated_credits = int(user["credits"]) + int(amount)
            cursor.execute("UPDATE users SET credits = ? WHERE id = ?", (updated_credits, user_id))
            cursor.execute(
                """
                INSERT INTO credit_transactions (user_id, action, delta, balance_after, meta_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    action,
                    amount,
                    updated_credits,
                    json.dumps(meta or {}, separators=(",", ":"), sort_keys=True),
                    now_utc_iso(),
                ),
            )
            transaction_id = inserted_row_id(connection, cursor)
            connection.commit()
            return {
                "transaction_id": transaction_id,
                "wallet": wallet_payload(updated_credits),
            }
        finally:
            connection.close()


init_auth_db()


def normalize_experience_years(value: float | None) -> float | None:
    if value is None:
        return None
    return clamp_float(float(value), 0.0, 35.0)


def normalize_applications_count(value: int | None) -> int:
    if value is None:
        return 60
    return int(clamp_float(float(value), 1.0, 2500.0))


def normalize_toggle_ids(values: list[str] | None) -> list[str]:
    if not values:
        return []
    normalized: list[str] = []
    for item in values:
        token = re.sub(r"[^a-z0-9_]+", "_", safe_text(item).lower()).strip("_")
        if token:
            normalized.append(token)
    return dedupe_preserve_order(normalized)


def extract_resume_text_for_analysis(file_name: str, content_type: str | None, contents: bytes) -> str:
    normalized_name = safe_text(file_name).lower()
    normalized_type = safe_text(content_type).lower()

    is_pdf = normalized_name.endswith(".pdf") or normalized_type == "application/pdf"
    is_txt = normalized_name.endswith(".txt") or normalized_type.startswith("text/")

    if is_pdf:
        pdf_reader = PyPDF2.PdfReader(io.BytesIO(contents))
        extracted_pages: list[str] = []
        for page in pdf_reader.pages:
            extracted_pages.append(page.extract_text() or "")
        return "\n".join(extracted_pages).strip()

    if is_txt:
        return contents.decode("utf-8", errors="ignore").strip()

    raise HTTPException(
        status_code=400,
        detail="Unsupported file type for analysis. Upload a PDF or TXT file.",
    )


def usage_window_key() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def normalize_plan(plan: str | None) -> str:
    if BYPASS_PLAN_LIMITS:
        return BYPASS_PLAN_AS
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


def ai_service_error(plan: str, session_id: str, detail: str | None = None) -> HTTPException:
    message = "AI generation is temporarily unavailable. Please retry shortly."
    if detail:
        message = f"{message} ({detail})"
    return quota_error(message, plan, session_id, 503)


def consume_quota(plan: str, session_id: str, action: str) -> dict[str, Any]:
    if BYPASS_PLAN_LIMITS:
        return plan_enforcement_payload(plan, session_id)

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


def rollback_quota(plan: str, session_id: str, action: str) -> None:
    if BYPASS_PLAN_LIMITS:
        return

    usage = usage_bucket(plan, session_id)

    if action == "generation" and usage["generation_used"] > 0:
        usage["generation_used"] -= 1
    elif action == "pdf_polish":
        if usage["pdf_polish_used"] > 0:
            usage["pdf_polish_used"] -= 1
        if usage["generation_used"] > 0:
            usage["generation_used"] -= 1


def normalize_token(value: str) -> str:
    token = value.strip().lower()
    token = re.sub(r"\s+", " ", token)
    token = token.replace("_", " ")
    token = token.replace("-", " ")
    return SKILL_ALIASES.get(token, token)


def normalize_search_text(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9+#./]+", " ", safe_text(value).lower())
    return re.sub(r"\s+", " ", normalized).strip()


def phrase_in_text(text: str, phrase: str) -> bool:
    normalized_text = normalize_search_text(text)
    normalized_phrase = normalize_search_text(phrase)
    if not normalized_text or not normalized_phrase:
        return False
    return f" {normalized_phrase} " in f" {normalized_text} "


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
    role_text = f"{safe_text(role)} {safe_text(industry)}"
    role_compact = normalize_search_text(role_text)

    for title, track in ROLE_TITLE_OVERRIDES.items():
        if phrase_in_text(role_compact, title):
            return track, 5

    best_track = "general"
    best_score = 0

    for track, keywords in ROLE_TRACK_KEYWORDS.items():
        score = sum(1 for keyword in keywords if phrase_in_text(role_compact, keyword))
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


def role_metric_signals(role_track: str) -> list[str]:
    mapping = {
        "sales": ["pipeline coverage", "win rate", "deal value", "revenue closed"],
        "marketing": ["CAC", "ROAS", "CTR/CVR", "qualified leads"],
        "hr": ["time-to-hire", "offer acceptance", "retention", "quality-of-hire"],
        "operations": ["cycle time", "SLA adherence", "cost savings", "error reduction"],
        "finance": ["forecast accuracy", "variance reduction", "cashflow impact", "margin improvement"],
        "product": ["activation", "retention", "feature adoption", "release impact"],
        "support": ["first response time", "resolution time", "CSAT", "escalation rate"],
    }
    return mapping.get(role_track, ["delivery speed", "quality outcomes", "business impact", "stakeholder trust"])


def role_execution_examples(role_track: str, industry: str) -> list[str]:
    industry_text = normalize_search_text(industry)
    if role_track == "sales" and any(phrase_in_text(industry_text, token) for token in ["automobile", "automotive", "dealership"]):
        return [
            "test-drive to booking conversion improvement",
            "dealer/outlet-wise target achievement plan",
            "finance and insurance attach-rate improvement",
        ]
    if role_track == "hr":
        return [
            "hiring funnel cleanup for priority roles",
            "onboarding quality checklist rollout",
            "manager interview calibration framework",
        ]
    if role_track == "marketing":
        return [
            "channel mix optimization with budget reallocation",
            "campaign copy-test matrix with weekly winners",
            "landing page and funnel conversion improvements",
        ]
    if role_track == "operations":
        return [
            "workflow bottleneck elimination sprint",
            "SOP redesign with weekly quality controls",
            "vendor-performance and SLA governance setup",
        ]
    return [
        "role-aligned proof project with measurable impact",
        "before/after process or outcome metrics",
        "decision narrative with clear ownership",
    ]


def filter_field_specific_terms(role_track: str, terms: list[str]) -> list[str]:
    if role_track not in NON_TECH_ROLE_TRACKS:
        return dedupe_preserve_order(terms)

    filtered = [term for term in terms if normalize_token(term) not in TECH_HEAVY_TERMS]
    return dedupe_preserve_order(filtered)


def human_insight_pack(role_track: str) -> dict[str, str]:
    return ROLE_HUMAN_INSIGHT_PACKS.get(
        role_track,
        {
            "hiring_lens": "Recruiters shortlist profiles that look role-ready, measurable, and immediately useful.",
            "proof_style": "Show concrete evidence, measurable outcomes, and clear ownership in each bullet.",
            "weekly_move": "Add one strong proof story per week tied directly to your target role.",
        },
    )


def build_quick_wins(
    role_track: str,
    role: str,
    industry: str,
    critical_missing: list[str],
    core_missing: list[str],
    adjacent_missing: list[str],
    experience_band: str,
) -> list[str]:
    role_label = safe_text(role) or "your target role"
    industry_label = safe_text(industry) or "your target industry"
    metrics = ", ".join(role_metric_signals(role_track)[:3])
    examples = role_execution_examples(role_track, industry)
    insight_pack = human_insight_pack(role_track)

    wins: list[str] = [
        f"For {role_label} hiring in {industry_label}, first show measurable outcomes ({metrics}) before listing tools/skills.",
        insight_pack["hiring_lens"],
        f"Add one proof story this week: {examples[0]} with numbers, timeline, and your exact ownership.",
    ]

    if critical_missing:
        wins.append(f"Close must-have gaps first: {', '.join(critical_missing[:3])}. Do this before adding advanced/adjacent skills.")
    elif core_missing:
        wins.append(f"Prioritize these role-core skills next: {', '.join(core_missing[:3])}. Tie each to one practical work example.")
    elif adjacent_missing:
        wins.append(f"Add 1-2 differentiators ({', '.join(adjacent_missing[:3])}) to move from 'eligible' to 'preferred' candidate.")
    else:
        wins.append("Your core signals are in place. Focus on sharper role-tailored bullets and weekly application quality.")

    if experience_band == "senior":
        wins.append("As a senior profile, highlight team outcomes, forecasting quality, and business decisions you influenced.")
    else:
        wins.append(insight_pack["weekly_move"])

    return wins[:4]


def build_improvement_areas(
    role_track: str,
    role: str,
    industry: str,
    critical_missing: list[str],
    core_missing: list[str],
    adjacent_missing: list[str],
    profile_details: dict[str, Any],
    consistency_score: int,
) -> list[dict[str, Any]]:
    areas: list[dict[str, Any]] = []
    role_label = safe_text(role) or "your target role"
    industry_label = safe_text(industry) or "your target industry"
    metrics_text = ", ".join(role_metric_signals(role_track)[:3])
    execution_examples = role_execution_examples(role_track, industry)
    insight_pack = human_insight_pack(role_track)

    areas.append(
        {
            "category": "How Recruiters Read Your Profile",
            "details": [
                insight_pack["hiring_lens"],
                insight_pack["proof_style"],
                f"For {role_label} in {industry_label}, clarity + proof usually beats keyword stuffing.",
            ],
        }
    )

    if critical_missing:
        areas.append(
            {
                "category": "Must-Have Skill Gaps",
                "details": [
                    f"Missing must-have skills for {role_label}: {', '.join(critical_missing[:4])}.",
                    f"In {industry_label}, first shortlisting pass usually checks these before anything else.",
                    f"Action this week: add one bullet per missing skill with measurable evidence ({metrics_text}).",
                ],
            }
        )

    if core_missing:
        areas.append(
            {
                "category": "Critical Skill Gaps",
                "details": [
                    f"Core capability gaps: {', '.join(core_missing[:5])}.",
                    "Current profile looks partially aligned, but not clearly hire-ready for this role.",
                    f"Convert each gap into proof by completing role-specific outputs like {execution_examples[0]} and {execution_examples[1]}.",
                ],
            }
        )

    if consistency_score < 45:
        areas.append(
            {
                "category": "Role Consistency",
                "details": [
                    "Your skills currently signal multiple directions, which creates hiring doubt.",
                    f"For {role_label}, keep one clear narrative: target scope, key capabilities, and outcomes.",
                    "Remove low-signal unrelated keywords and tighten your top 8-12 skills to one role direction.",
                ],
            }
        )

    if len(adjacent_missing) >= 3:
        areas.append(
            {
                "category": "Competitive Edge",
                "details": [
                    f"Missing differentiators: {', '.join(adjacent_missing[:5])}.",
                    "These are the skills that move profiles from 'considered' to 'shortlisted quickly'.",
                    f"Pick 2 and prove them via outcomes (for example: {execution_examples[2]}).",
                ],
            }
        )

    if profile_details["listed_count"] < 6:
        areas.append(
            {
                "category": "Skill Coverage",
                "details": [
                    "Current skill list is short for strong confidence scoring.",
                    "Short coverage makes the profile look early-stage even when potential is high.",
                    "Expand with role-aligned tools, workflows, and domain language.",
                ],
            }
        )

    if profile_details["duplicate_count"] > 2:
        areas.append(
            {
                "category": "Skill Clarity",
                "details": [
                    "Repeated or overlapping skills reduce profile clarity.",
                    "Duplicate wording weakens trust in profile quality.",
                    "Use clean canonical names and remove repeats for sharper credibility.",
                ],
            }
        )

    if not areas:
        areas.append(
            {
                "category": "Positioning",
                "details": [
                    f"Your profile is already close to interview-ready for {role_label}.",
                    "Next lift will come from sharper positioning and stronger proof, not just adding more keywords.",
                    "Tailor your top section for each role cluster and keep every claim evidence-backed.",
                ],
            }
        )

    if role_track == "sales":
        areas.append(
            {
                "category": "Sales Trust Signals",
                "details": [
                    "Hiring managers in sales trust numbers before claims.",
                    "Lead with pipeline, win-rate, conversion, or revenue outcomes in top bullets.",
                    "Show one objection-handling or deal-recovery example to signal real field strength.",
                ],
            }
        )
    elif role_track == "marketing":
        areas.append(
            {
                "category": "Marketing Credibility Signals",
                "details": [
                    "Teams shortlist marketers who can link actions to business outcomes quickly.",
                    "Show channel ownership with CAC/ROAS/CTR-CVR metrics and campaign decision logic.",
                    "Add one campaign case showing what changed, why it worked, and what improved.",
                ],
            }
        )
    elif role_track in {"hr", "operations", "business", "finance"}:
        areas.append(
            {
                "category": "Execution Credibility",
                "details": [
                    "Hiring panels look for ownership, not task lists.",
                    "Show process or decision impact with before/after numbers and stakeholder outcomes.",
                    "Use one story per capability: problem, action, measurable result, and learning.",
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


def infer_experience_band(experience_years: float | None, seniority: str) -> str:
    normalized = normalize_experience_years(experience_years)
    if normalized is None:
        if seniority == "senior":
            return "senior"
        if seniority == "junior":
            return "entry"
        return "mid"
    if normalized < 2.5:
        return "entry"
    if normalized < 8:
        return "mid"
    return "senior"


def market_segment_for_track(role_track: str, industry: str) -> str:
    inferred = TRACK_TO_MARKET_SEGMENT.get(role_track, "general")
    industry_text = normalize_search_text(industry)
    if any(phrase_in_text(industry_text, token) for token in ["ai", "software", "technology", "saas", "it services"]):
        return "technology"
    if any(phrase_in_text(industry_text, token) for token in ["bank", "finance", "insurance", "consulting", "retail"]):
        return "business"
    if any(phrase_in_text(industry_text, token) for token in ["healthcare", "hospital", "education", "edtech"]):
        return "service"
    if any(phrase_in_text(industry_text, token) for token in ["media", "content", "creative", "design", "advertising"]):
        return "creative"
    return inferred if inferred in INDIA_MARKET_SEGMENTS else "general"


def build_salary_boosters(market_segment: str) -> list[dict[str, Any]]:
    segment_boosters = TRACK_SALARY_BOOSTERS.get(market_segment, TRACK_SALARY_BOOSTERS["general"])
    merged = [*GLOBAL_SALARY_BOOSTERS, *segment_boosters]
    deduped: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for booster in merged:
        booster_id = safe_text(str(booster.get("id"))).lower()
        if booster_id and booster_id not in seen_ids:
            seen_ids.add(booster_id)
            deduped.append(
                {
                    "id": booster_id,
                    "label": safe_text(str(booster.get("label"))),
                    "description": safe_text(str(booster.get("description"))),
                    "uplift_lpa": round(float(booster.get("uplift_lpa", 0.0)), 1),
                }
            )
    return deduped


def build_salary_insight(
    role_track: str,
    role: str,
    industry: str,
    overall_score: int,
    confidence: int,
    seniority: str,
    experience_years: float | None,
    selected_toggle_ids: list[str] | None,
) -> dict[str, Any]:
    market_segment = market_segment_for_track(role_track, industry)
    market_data = INDIA_MARKET_SEGMENTS.get(market_segment, INDIA_MARKET_SEGMENTS["general"])
    experience_band = infer_experience_band(experience_years, seniority)

    band_low, band_high = market_data["salary_lpa"][experience_band]
    score_factor = clamp_float(0.86 + (overall_score / 100.0) * 0.32, 0.82, 1.22)
    confidence_factor = clamp_float(0.92 + (confidence / 100.0) * 0.14, 0.9, 1.08)

    base_low = round(band_low * score_factor * confidence_factor, 1)
    base_high = round(band_high * score_factor * confidence_factor, 1)

    boosters = build_salary_boosters(market_segment)
    selected = set(normalize_toggle_ids(selected_toggle_ids))
    uplift = round(sum(item["uplift_lpa"] for item in boosters if item["id"] in selected), 1)

    projected_low = round(base_low + (uplift * 0.72), 1)
    projected_high = round(base_high + uplift, 1)

    return {
        "market_scope": "India",
        "market_segment": market_segment,
        "target_role": safe_text(role),
        "target_industry": safe_text(industry),
        "experience_band": experience_band,
        "experience_years_used": normalize_experience_years(experience_years),
        "currency": "INR LPA",
        "base_range_lpa": {
            "low": base_low,
            "mid": round((base_low + base_high) / 2, 1),
            "high": base_high,
        },
        "selected_boosters": sorted(selected),
        "booster_uplift_lpa": uplift,
        "projected_range_lpa": {
            "low": projected_low,
            "mid": round((projected_low + projected_high) / 2, 1),
            "high": projected_high,
        },
        "salary_booster_options": boosters,
        "market_data_refresh_note": "Model calibrated for current India hiring patterns; connect live salary APIs for company-level precision.",
    }


def build_ninety_plus_plan(
    overall_score: int,
    role_track: str,
    role: str,
    industry: str,
    experience_band: str,
    critical_missing: list[str],
    core_missing: list[str],
    adjacent_missing: list[str],
) -> dict[str, Any]:
    gap_to_90 = max(0, 90 - overall_score)
    actions: list[dict[str, Any]] = []
    role_label = safe_text(role) or "your target role"
    industry_label = safe_text(industry) or "your target industry"
    metrics = ", ".join(role_metric_signals(role_track)[:3])
    execution_examples = role_execution_examples(role_track, industry)
    insight_pack = human_insight_pack(role_track)

    def add_action(
        title: str,
        action: str,
        why_it_matters: str,
        how_to_execute: list[str],
        estimated_score_lift: int,
        timeline_weeks: str,
    ) -> None:
        step = len(actions) + 1
        actions.append(
            {
                "priority": f"Step {step}",
                "step_label": f"Step {step}",
                "title": title,
                "action": action,
                "why_it_matters": why_it_matters,
                "how_to_execute": how_to_execute[:3],
                "estimated_score_lift": int(estimated_score_lift),
                "timeline_weeks": timeline_weeks,
            }
        )

    if critical_missing:
        add_action(
            "Fix hard-screening gaps first",
            f"Close must-have gaps for {role_label}: {', '.join(critical_missing[:4])}.",
            "These are hard filters in first shortlist screening.",
            [
                f"Pick top 2 gaps and complete one practical output for each in {industry_label}.",
                f"Add proof bullets with measurable impact ({metrics}).",
                "Mirror exact JD wording in your headline, skills, and top experience points.",
            ],
            min(24, 6 + len(critical_missing[:4]) * 4),
            "2-5",
        )

    if core_missing:
        add_action(
            "Build depth proof for role-core capabilities",
            f"Create real evidence for these core areas: {', '.join(core_missing[:4])}.",
            "Recruiters shortlist candidates who can prove execution, not only list skills.",
            [
                f"Build two proof artifacts such as {execution_examples[0]} and {execution_examples[1]}.",
                "Add one quantified achievement per core skill in your resume.",
                "Use STAR-style storytelling for interviews on each capability.",
            ],
            min(18, 5 + len(core_missing[:4]) * 3),
            "3-6",
        )

    leadership_clause = "Include team impact, planning quality, and decision ownership in each story." if experience_band == "senior" else "Highlight direct individual contribution and outcome ownership in each story."
    add_action(
        "Rewrite resume for recruiter-first clarity",
        f"Rewrite top bullets for {role_label} with measurable outcomes and clean role language.",
        f"{insight_pack['hiring_lens']} A clear, role-aligned resume raises screening confidence quickly.",
        [
            f"Lead bullets with outcome metrics ({metrics}) instead of responsibilities.",
            "Remove generic claims and replace with specific scope, numbers, and timeline.",
            leadership_clause,
        ],
        8,
        "1-2",
    )
    add_action(
        "Run focused weekly application strategy",
        "Use role-specific resume variants and submit in focused weekly batches.",
        "Targeted applications outperform broad, generic submissions.",
        [
            "Create 2 resume variants for adjacent job-title clusters.",
            "Apply in weekly batches and track callback % and rejection reasons.",
            "Improve one weak section every week based on recruiter signal.",
        ],
        6,
        "1-3",
    )

    if adjacent_missing:
        add_action(
            "Add 2 differentiators to beat similar profiles",
            f"Add practical differentiators: {', '.join(adjacent_missing[:3])}.",
            "Differentiators increase confidence when many candidates have similar fundamentals.",
            [
                f"Choose 2 differentiators most used in {industry_label} hiring.",
                "Ship one mini-project or case proof for each differentiator.",
                "Mention business impact and not just tool usage.",
            ],
            5,
            "2-4",
        )

    projected_lift = min(32, sum(item["estimated_score_lift"] for item in actions[:4]))
    projected_score = clamp(overall_score + projected_lift)

    return {
        "target_score": 90,
        "current_score": overall_score,
        "gap_to_90": gap_to_90,
        "projected_score_after_execution": projected_score,
        "execution_window_weeks": "4-10",
        "plan_status": "already_90_plus" if gap_to_90 == 0 else "improvement_required",
        "actions": actions[:5],
    }


def build_interview_call_likelihood(overall_score: int, confidence: int) -> dict[str, Any]:
    weighted = clamp(0.68 * overall_score + 0.32 * confidence)
    if weighted >= 76:
        return {"level": "high", "label": "Likely to get interview calls: High", "score": weighted}
    if weighted >= 56:
        return {"level": "medium", "label": "Likely to get interview calls: Medium", "score": weighted}
    return {"level": "low", "label": "Likely to get interview calls: Low", "score": weighted}


def track_fit_score(track: str, skills_list: list[str], role: str, industry: str) -> tuple[int, list[str]]:
    blueprint = ROLE_BLUEPRINTS.get(track, ROLE_BLUEPRINTS["general"])
    catalog = dedupe_preserve_order(
        [
            *blueprint["core"],
            *blueprint["adjacent"],
            *ROLE_CRITICAL_SKILLS.get(track, []),
            *ROLE_TRACK_KEYWORDS.get(track, []),
        ]
    )
    catalog_set = set(catalog)
    hits = [skill for skill in skills_list if skill in catalog_set]
    ratio = len(hits) / max(1, min(14, len(catalog_set)))

    role_hint = normalize_search_text(f"{safe_text(role)} {safe_text(industry)}")
    keyword_bonus = min(18, sum(1 for keyword in ROLE_TRACK_KEYWORDS.get(track, []) if phrase_in_text(role_hint, keyword)) * 4)
    score = clamp(ratio * 92 + keyword_bonus)
    if not hits and keyword_bonus < 8:
        return 0, []
    return score, dedupe_preserve_order(hits)[:6]


def build_positioning_strategy(role_track: str, role: str, industry: str, skills_list: list[str]) -> dict[str, Any]:
    target_track = role_track if role_track in ROLE_BLUEPRINTS else infer_role_track(role, industry)
    track_scores: list[tuple[str, int, list[str]]] = []
    target_family = TRACK_FIELD_FAMILIES.get(target_track, "general")
    family_tracks = set(FIELD_FAMILY_TRACKS.get(target_family, [])) if target_family != "general" else set()

    for track in ROLE_BLUEPRINTS:
        if track == "general":
            continue
        score, hits = track_fit_score(track, skills_list, role, industry)
        track_scores.append((track, score, hits))

    track_scores.sort(key=lambda item: item[1], reverse=True)
    target_score = next((item[1] for item in track_scores if item[0] == target_track), 0)

    segment = TRACK_TO_MARKET_SEGMENT.get(target_track, "general")
    same_segment_tracks = [
        track
        for track in ROLE_BLUEPRINTS.keys()
        if track not in {"general", target_track} and TRACK_TO_MARKET_SEGMENT.get(track, "general") == segment
    ]
    neighbor_tracks = ROLE_TRACK_NEIGHBORS.get(target_track, [])
    preferred_tracks = dedupe_preserve_order([*neighbor_tracks, *same_segment_tracks])
    score_lookup = {track: (score, hits) for track, score, hits in track_scores}

    alternatives: list[dict[str, Any]] = []
    minimum_fit_threshold = max(28, target_score - 10)
    for track in preferred_tracks:
        if track in {"general", target_track} or track not in score_lookup:
            continue
        if family_tracks and track not in family_tracks:
            continue
        score, hits = score_lookup[track]
        if score < minimum_fit_threshold:
            continue
        stronger_fit = score >= target_score + 4
        options = TRACK_ROLE_OPTIONS.get(track, TRACK_ROLE_OPTIONS["general"])
        alternatives.append(
            {
                "role": options[0],
                "fit_score": score,
                "fit_signal": "higher_fit" if stronger_fit else "comparable_fit",
                "why": f"Skills signal strongest relevance for {', '.join(hits[:3]) or 'transferable capabilities'} in this role direction.",
            }
        )
        if len(alternatives) == 3:
            break

    if len(alternatives) < 3:
        for track, score, hits in track_scores:
            if (
                track == target_track
                or score < minimum_fit_threshold
                or any(item["role"] in TRACK_ROLE_OPTIONS.get(track, []) for item in alternatives)
            ):
                continue
            if family_tracks and track not in family_tracks:
                continue
            stronger_fit = score >= target_score + 4
            options = TRACK_ROLE_OPTIONS.get(track, TRACK_ROLE_OPTIONS["general"])
            alternatives.append(
                {
                    "role": options[0],
                    "fit_score": score,
                    "fit_signal": "higher_fit" if stronger_fit else "comparable_fit",
                    "why": f"Adjacent fit emerges from {', '.join(hits[:3]) or 'cross-functional capability overlap'}.",
                }
            )
            if len(alternatives) == 3:
                break

    target_role_options = TRACK_ROLE_OPTIONS.get(target_track, TRACK_ROLE_OPTIONS["general"])
    if alternatives:
        summary = "Based on your current proof signals, these adjacent roles in your field may give faster interview traction."
    else:
        summary = "Your profile is currently best aligned to your chosen field path. Execute the roadmap to raise fit before role expansion."
    return {
        "target_role": safe_text(role),
        "target_fit_score": target_score,
        "target_role_examples": target_role_options[:3],
        "higher_probability_roles": alternatives,
        "summary": summary,
    }


def learning_roadmap_phase2(role_track: str) -> tuple[list[str], str]:
    if role_track == "sales":
        return (
            ["Deal story bank", "Objection-handling scripts", "Conversion proof by stage"],
            "Convert experience into quantified deal evidence and interview-ready stories.",
        )
    if role_track in {"marketing", "content"}:
        return (
            ["Campaign outcome snapshots", "Channel-specific ROI evidence", "Audience-growth proof"],
            "Turn campaign work into measurable outcome narratives recruiters trust quickly.",
        )
    if role_track in {"operations", "hr", "support"}:
        return (
            ["Process improvement evidence", "Service quality metrics", "Stakeholder ownership examples"],
            "Show operational ownership and measurable business impact clearly.",
        )
    if role_track in {"business", "consulting", "finance"}:
        return (
            ["Case-style problem breakdowns", "Decision-impact summaries", "Business metrics evidence"],
            "Demonstrate structured thinking and measurable decision impact.",
        )
    return (
        ["Portfolio artifact", "Role-specific execution evidence"],
        "Convert skills into outcome-based bullets with strong proof of execution.",
    )


def industry_focus_modules(role_track: str, industry: str) -> list[str]:
    industry_text = normalize_search_text(industry)
    if any(phrase_in_text(industry_text, token) for token in ["automobile", "automotive", "dealership"]):
        if role_track == "sales":
            return [
                "Dealer network expansion",
                "Test-drive to booking conversion",
                "Financing and insurance attach rate",
                "Territory and outlet productivity",
            ]
        if role_track == "marketing":
            return [
                "Local showroom lead-gen campaigns",
                "Model launch conversion funnels",
                "Regional demand seasonality planning",
            ]
        return ["Automotive customer journey", "Dealer-channel operations"]
    if any(phrase_in_text(industry_text, token) for token in ["saas", "software", "technology"]):
        return ["Pipeline hygiene and CRM velocity" if role_track == "sales" else "Product-led growth metrics", "Retention and expansion workflows"]
    if any(phrase_in_text(industry_text, token) for token in ["bank", "finance", "insurance"]):
        return ["Compliance-safe client communication", "Risk-aware conversion process"]
    if any(phrase_in_text(industry_text, token) for token in ["healthcare", "hospital", "pharma"]):
        return ["Clinical stakeholder communication", "Audit-ready documentation standards"]
    return []


def roadmap_deliverables(role_track: str, experience_band: str) -> tuple[list[str], list[str], list[str]]:
    phase1 = [
        "Map target JD must-haves vs current profile and identify top 5 gaps.",
        "Build one-page role narrative with role keywords and proof bullets.",
    ]
    phase2 = [
        "Create 2 proof projects/case studies aligned to target role expectations.",
        "Rewrite 8-12 resume bullets with quantified outcomes and scope.",
    ]
    phase3 = [
        "Run weekly application batches with role-specific resume variants.",
        "Track callback, rejection reason, and adjust targeting every week.",
    ]

    if role_track == "sales":
        phase1 = [
            "Build target-account and territory map with ICP, segment priority, and outreach plan.",
            "Create objection-handling playbook by deal stage with confidence scripts.",
        ]
        phase2 = [
            "Build deal story bank: 5 wins + 2 recoveries with conversion metrics.",
            "Document funnel metrics by stage (lead->meeting->proposal->close) and explain lift levers.",
        ]
        phase3 = [
            "Apply with role-tailored narratives (hunter/farmer/enterprise) and weekly follow-up cadence.",
            "Run callback post-mortem each week and improve pitch, domain story, and quantified evidence.",
        ]
        if experience_band == "senior":
            phase2.insert(0, "Create regional revenue plan with quota split, channel mix, and forecast confidence.")
    elif role_track in {"marketing", "content"}:
        phase2 = [
            "Ship campaign case studies with CAC/ROAS/CTR outcomes and channel mix rationale.",
            "Build monthly experiment backlog and publish win/loss learnings.",
        ]
    elif role_track in {"business", "consulting", "finance"}:
        phase2 = [
            "Prepare 3 structured business cases with hypotheses, analysis, and decision impact.",
            "Build dashboard snapshots linking recommendations to measurable outcomes.",
        ]
    elif role_track in {"operations", "support", "hr"}:
        phase2 = [
            "Document process-improvement before/after metrics (TAT, SLA, quality, cost).",
            "Build stakeholder communication templates for escalation and closure.",
        ]

    return phase1, phase2, phase3


def build_learning_roadmap(
    role_track: str,
    role: str,
    industry: str,
    experience_years: float | None,
    critical_missing: list[str],
    core_missing: list[str],
    adjacent_missing: list[str],
) -> dict[str, Any]:
    experience_band = infer_experience_band(experience_years, infer_seniority(role))
    role_label = safe_text(role) or "your target role"
    insight_pack = human_insight_pack(role_track)
    foundation_focus = dedupe_preserve_order([*critical_missing[:3], *core_missing[:2]])[:4]
    execution_focus = dedupe_preserve_order([*core_missing[2:6], *adjacent_missing[:3]])[:4]
    phase2_default_focus, phase2_default_outcome = learning_roadmap_phase2(role_track)
    context_modules = industry_focus_modules(role_track, industry)
    phase1_deliverables, phase2_deliverables, phase3_deliverables = roadmap_deliverables(role_track, experience_band)

    phases: list[dict[str, Any]] = [
        {
            "phase": "Phase 1: Foundation",
            "duration_weeks": "1-3",
            "focus": dedupe_preserve_order([*foundation_focus, *context_modules[:2]])[:4]
            or ["Role fundamentals", "Keyword-ready skill language"],
            "outcome": f"Cover must-have gaps and become baseline interview-ready for {role_label}.",
            "deliverables": phase1_deliverables,
        },
        {
            "phase": "Phase 2: Proof Of Work",
            "duration_weeks": "3-6",
            "focus": dedupe_preserve_order([*execution_focus, *phase2_default_focus, *context_modules])[:5] or phase2_default_focus,
            "outcome": phase2_default_outcome,
            "deliverables": phase2_deliverables,
        },
        {
            "phase": "Phase 3: Conversion Sprint",
            "duration_weeks": "2-4",
            "focus": ["Resume variants", "Interview stories", "Targeted application batching", "Weekly proof updates"],
            "outcome": "Increase interview call rate through sharper positioning and stronger recruiter trust signals.",
            "deliverables": phase3_deliverables,
        },
    ]

    return {
        "target_role": safe_text(role),
        "target_industry": safe_text(industry),
        "experience_band": experience_band,
        "total_duration_weeks": "6-13",
        "coach_note": insight_pack["weekly_move"],
        "phases": phases,
    }


def build_hiring_timing_insights(role_track: str, industry: str) -> dict[str, Any]:
    segment = market_segment_for_track(role_track, industry)
    market_data = INDIA_MARKET_SEGMENTS.get(segment, INDIA_MARKET_SEGMENTS["general"])
    role_hint = ROLE_TRACK_MARKET_HINTS.get(role_track, ROLE_TRACK_MARKET_HINTS["general"])

    best_months = dedupe_preserve_order([*role_hint["best_months"], *market_data["best_months"]])[:6]
    peak_windows = dedupe_preserve_order([*role_hint["peak_windows"], *market_data["hiring_peak_windows"]])[:3]

    risk_levels = ["low", "medium", "high"]
    base_level = safe_text(market_data["layoff_risk"]).lower() or "medium"
    try:
        base_idx = risk_levels.index(base_level)
    except ValueError:
        base_idx = 1
    risk_delta = int(role_hint.get("risk_delta", 0))
    adjusted_level = risk_levels[max(0, min(len(risk_levels) - 1, base_idx + risk_delta))]

    role_note = {
        "low": "This role is typically tied to business continuity and tends to recover hiring faster.",
        "medium": "Demand is healthy but budgeting discipline and team criticality matter a lot.",
        "high": "Hiring can swing sharply with revenue cycles, so role-targeted positioning is essential.",
    }[adjusted_level]

    industry_tokens = safe_text(industry).lower()
    segment_risk = SEGMENT_RISK_SEGMENTS_INDIA.get(segment, HIGH_RISK_INDUSTRIES_INDIA)
    dynamic_risk_segments = list(segment_risk)
    if "startup" in industry_tokens or "d2c" in industry_tokens:
        dynamic_risk_segments.append("early-stage startups operating on short runway")
    if "gaming" in industry_tokens or "media" in industry_tokens:
        dynamic_risk_segments.append("ad and creator-economy businesses with unstable quarter-on-quarter demand")
    if "fintech" in industry_tokens:
        dynamic_risk_segments.append("compliance-heavy fintech teams exposed to regulatory policy swings")
    if "edtech" in industry_tokens:
        dynamic_risk_segments.append("enrollment-dependent edtech businesses with seasonal headcount cuts")

    timing_tip = role_hint.get("timing_tip") or "Apply in focused weekly batches with role-specific evidence."
    timing_window = f"{best_months[0]} and {best_months[1]}" if len(best_months) >= 2 else "peak months"
    return {
        "best_months_to_apply": best_months,
        "hiring_peak_windows": peak_windows,
        "layoff_risk_level": adjusted_level,
        "layoff_risk_note": f"{market_data['layoff_note']} {role_note}",
        "higher_layoff_risk_industries": dedupe_preserve_order(dynamic_risk_segments)[:4],
        "application_timing_tip": f"Prioritize first-wave applications in {timing_window}. {timing_tip}",
    }


def build_callback_estimator(
    overall_score: int,
    confidence: int,
    applications_count: int,
    ninety_plus_plan: dict[str, Any],
) -> dict[str, Any]:
    application_volume = normalize_applications_count(applications_count)
    base_rate = clamp_float(1.8 + (overall_score * 0.16) + (confidence * 0.065), 2.0, 38.0)
    improvement_headroom = 2.0 + max(0.0, ninety_plus_plan["gap_to_90"] * 0.24)
    improved_rate = clamp_float(base_rate + improvement_headroom, base_rate, 48.0)

    expected_callbacks = round((application_volume * base_rate) / 100.0, 1)
    improved_callbacks = round((application_volume * improved_rate) / 100.0, 1)
    analysis_window_weeks = 4
    applications_per_week = round(application_volume / analysis_window_weeks, 1)
    expected_callbacks_per_week = round(expected_callbacks / analysis_window_weeks, 2)
    improved_callbacks_per_week = round(improved_callbacks / analysis_window_weeks, 2)

    return {
        "applications_input": application_volume,
        "analysis_window_weeks": analysis_window_weeks,
        "applications_per_week": applications_per_week,
        "estimated_callback_rate": round(base_rate, 1),
        "expected_callbacks": expected_callbacks,
        "expected_callbacks_per_week": expected_callbacks_per_week,
        "improved_callback_rate": round(improved_rate, 1),
        "expected_callbacks_after_improvements": improved_callbacks,
        "expected_callbacks_after_improvements_per_week": improved_callbacks_per_week,
        "weekly_note": "Weekly callback view is modeled on a 4-week application cycle.",
        "improvement_actions": [action["action"] for action in ninety_plus_plan.get("actions", [])[:3]],
    }


def analyze_profile(
    industry: str,
    role: str,
    skills_text: str,
    experience_years: float | None = None,
    applications_count: int | None = None,
    salary_boost_toggles: list[str] | None = None,
) -> dict[str, Any]:
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
    critical_missing = filter_field_specific_terms(role_track, critical_missing)
    core_missing = filter_field_specific_terms(role_track, core_missing)
    adjacent_missing = filter_field_specific_terms(role_track, adjacent_missing)
    consistency_score = score_track_consistency(role_track, skills_list, blueprint)

    raw_overall = clamp(
        0.40 * critical_coverage
        + 0.26 * coverage_score
        + 0.18 * skill_match_score
        + 0.10 * profile_score
        + 0.06 * consistency_score
    )

    penalty_cap = 12 if adaptive_profile else 16
    strictness_penalty = min(penalty_cap, len(critical_missing) * 4.4 + max(0, 40 - consistency_score) * 0.16)
    overall_score = clamp(raw_overall - strictness_penalty)

    # Prevent extreme floor effects for valid role/skill signals on short early-career profiles.
    if skills_list and role_track != "custom":
        if profile_details["listed_count"] >= 3:
            overall_score = max(overall_score, 14)
        if skill_match_score >= 16:
            overall_score = max(overall_score, 20)
        if critical_coverage >= 34:
            overall_score = max(overall_score, 24)

    confidence = confidence_by_seniority(seniority, profile_details["listed_count"], critical_coverage)
    confidence = clamp(confidence + min(8, consistency_score * 0.08) - min(10, len(critical_missing) * 2.3))
    confidence = min(96, confidence)
    prediction_band = build_prediction_band(overall_score, confidence)

    prediction_reasoning = [
        f"Critical-skill coverage is {critical_coverage}% for your target role intent.",
        f"Role blueprint coverage is {coverage_score}% and keyword alignment is {skill_match_score}%.",
        f"Consistency score is {consistency_score}%; profile quality signal is {profile_score}%.",
    ]
    if adaptive_profile:
        prediction_reasoning.append("Adaptive open-role profiling is active for this title.")

    role_text = safe_text(role).lower()
    exp_value = float(experience_years) if experience_years is not None else None
    explicit_fresher_role = any(token in role_text for token in ["intern", "fresher", "trainee", "entry level", "entry-level"])
    is_fresher_profile = bool(
        explicit_fresher_role
        or (exp_value is not None and exp_value <= 1.0)
        or (exp_value is None and seniority == "junior" and profile_details["listed_count"] <= 2)
    )

    experience_band = infer_experience_band(experience_years, seniority)
    quick_wins = build_quick_wins(
        role_track,
        role,
        industry,
        critical_missing,
        core_missing,
        adjacent_missing,
        experience_band,
    )

    areas_to_improve = build_improvement_areas(
        role_track,
        role,
        industry,
        critical_missing,
        core_missing,
        adjacent_missing,
        profile_details,
        consistency_score,
    )
    applications_used = normalize_applications_count(applications_count)
    ninety_plus_strategy = build_ninety_plus_plan(
        overall_score,
        role_track,
        role,
        industry,
        experience_band,
        critical_missing,
        core_missing,
        adjacent_missing,
    )
    interview_call_likelihood = build_interview_call_likelihood(overall_score, confidence)
    salary_insight = build_salary_insight(
        role_track=role_track,
        role=role,
        industry=industry,
        overall_score=overall_score,
        confidence=confidence,
        seniority=seniority,
        experience_years=experience_years,
        selected_toggle_ids=salary_boost_toggles,
    )
    positioning_strategy = None if is_fresher_profile else build_positioning_strategy(role_track, role, industry, skills_list)
    learning_roadmap = build_learning_roadmap(
        role_track,
        role,
        industry,
        experience_years,
        critical_missing,
        core_missing,
        adjacent_missing,
    )
    hiring_market_insights = build_hiring_timing_insights(role_track, industry)
    callback_forecast = build_callback_estimator(overall_score, confidence, applications_used, ninety_plus_strategy)

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
        "role_universe_mode": "unlimited_open_role",
        "likely_interview_call": interview_call_likelihood,
        "ninety_plus_strategy": ninety_plus_strategy,
        "salary_insight": salary_insight,
        "positioning_strategy": positioning_strategy,
        "learning_roadmap": learning_roadmap,
        "hiring_market_insights": hiring_market_insights,
        "callback_forecast": callback_forecast,
        "is_fresher_profile": is_fresher_profile,
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

    return sanitize_resume_output("\n\n".join(sections))


def sanitize_resume_output(text: str) -> str:
    normalized_text = safe_text(text)
    if not normalized_text:
        return ""

    lines = normalized_text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    filtered_lines: list[str] = []
    blocked_headings = {
        "references available upon request",
        "optimized resume",
        "optimised resume",
        "resume",
        "resume draft",
    }
    for raw_line in lines:
        line = raw_line.strip()
        normalized_line = re.sub(r"[\[\]\(\)\{\}\.\,\:\;\-\_\s]+", " ", line).strip().lower()
        if normalized_line in blocked_headings:
            continue
        filtered_lines.append(raw_line)

    # Keep paragraph spacing readable while removing excessive empty lines.
    cleaned = "\n".join(filtered_lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def extract_llm_text(message_content: Any) -> str:
    if isinstance(message_content, str):
        return safe_text(message_content)

    if isinstance(message_content, list):
        parts: list[str] = []
        for item in message_content:
            if isinstance(item, str):
                parts.append(item)
                continue

            text = None
            if isinstance(item, dict):
                text = item.get("text")
            else:
                text = getattr(item, "text", None)

            if isinstance(text, str):
                parts.append(text)

        return safe_text("\n".join(parts))

    return safe_text(message_content)


def is_transient_openai_error(exc: Exception) -> bool:
    return type(exc).__name__ in {"APIConnectionError", "APITimeoutError", "InternalServerError"}


def generate_with_llm(
    system_prompt: str,
    user_prompt: str,
    temperature: float,
    fallback_text: str,
) -> tuple[str, bool, str | None]:
    if client is None:
        return fallback_text, False, "OPENAI_API_KEY not configured"

    models: list[str] = []
    for model in [OPENAI_MODEL, *OPENAI_FALLBACK_MODELS]:
        if model and model not in models:
            models.append(model)

    last_error: str | None = None
    for model in models:
        for attempt in range(3):
            try:
                response = client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=temperature,
                )
                content = extract_llm_text(response.choices[0].message.content if response.choices else "")
                if content:
                    return content, True, None
                last_error = f"empty response from model {model}"
                logger.error("OpenAI returned empty content for model '%s'.", model)
                break
            except Exception as exc:
                last_error = f"{type(exc).__name__} on model {model}"
                logger.exception("OpenAI request failed for model '%s' (attempt %s).", model, attempt + 1)

                if attempt < 2 and is_transient_openai_error(exc):
                    time.sleep(0.35 * (attempt + 1))
                    continue
                break

    return fallback_text, False, last_error


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

    fallback_text = sanitize_resume_output(safe_text(data.resume_text))
    improved_resume, ai_generated, ai_error = generate_with_llm(
        system_prompt="You improve resumes with factual discipline and ATS-aware clarity.",
        user_prompt=improvise_prompt,
        temperature=0.25,
        fallback_text=fallback_text,
    )
    improved_resume = sanitize_resume_output(improved_resume)

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
        "ai_generated": ai_generated,
        "ai_error": ai_error,
    }


def sanitize_download_name(value: str | None) -> str:
    base = re.sub(r"[^a-zA-Z0-9._-]+", "-", safe_text(value) or "optimized-resume").strip("-").lower()
    return base or "optimized-resume"


RESUME_SECTION_ALIASES = {
    "resume": "meta_ignore",
    "optimized resume": "meta_ignore",
    "optimised resume": "meta_ignore",
    "resume draft": "meta_ignore",
    "summary": "summary",
    "professional summary": "summary",
    "profile summary": "summary",
    "about": "summary",
    "skills": "skills",
    "key skills": "skills",
    "technical skills": "skills",
    "core skills": "skills",
    "work experience": "experience",
    "experience": "experience",
    "professional experience": "experience",
    "employment": "experience",
    "projects": "projects",
    "project experience": "projects",
    "education": "education",
    "certifications": "certifications",
    "certification": "certifications",
    "achievements": "achievements",
    "awards": "achievements",
    "languages": "languages",
    "interests": "interests",
}

RESUME_SECTION_ORDER = [
    "summary",
    "skills",
    "experience",
    "projects",
    "education",
    "certifications",
    "achievements",
    "languages",
    "interests",
]

RESUME_SECTION_TITLES = {
    "summary": "Professional Summary",
    "skills": "Key Skills",
    "experience": "Work Experience",
    "projects": "Projects",
    "education": "Education",
    "certifications": "Certifications",
    "achievements": "Achievements",
    "languages": "Languages",
    "interests": "Interests",
}


def normalize_resume_section_key(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", " ", safe_text(value).lower()).strip()
    if normalized in RESUME_SECTION_ALIASES:
        return RESUME_SECTION_ALIASES[normalized]
    return normalized or "summary"


def looks_like_resume_heading(line: str) -> bool:
    raw = safe_text(line).strip(":")
    if not raw:
        return False
    normalized = normalize_resume_section_key(raw)
    if normalized in RESUME_SECTION_ALIASES.values():
        return True
    compact = re.sub(r"[^a-zA-Z0-9 ]+", "", raw).strip()
    if not compact:
        return False
    if compact.isupper() and 2 <= len(compact) <= 45 and len(compact.split()) <= 5:
        return True
    return False


def looks_like_contact_line(line: str) -> bool:
    text = safe_text(line).lower()
    return bool(
        "@" in text
        or "linkedin" in text
        or "github" in text
        or "|" in text
        or re.search(r"\+?\d[\d\-\s]{7,}", text)
    )


def strip_bullet_prefix(line: str) -> str:
    return re.sub(r"^(?:[-*•]|(?:\d+[\).\s]))\s*", "", safe_text(line))


def parse_resume_sections(name: str, resume_text: str) -> dict[str, Any]:
    raw_lines = [safe_text(line) for line in resume_text.replace("\r", "\n").split("\n")]
    lines = [line for line in raw_lines if line]

    guessed_name = safe_text(name)
    if not guessed_name and lines:
        first_line = lines[0]
        if len(first_line) <= 64 and not looks_like_resume_heading(first_line):
            guessed_name = first_line

    sections: dict[str, list[str]] = {}
    contact_lines: list[str] = []
    current = "summary"
    seen_heading = False

    for index, line in enumerate(lines):
        if index == 0 and guessed_name and line.lower() == guessed_name.lower():
            continue

        if looks_like_resume_heading(line):
            current = normalize_resume_section_key(line.strip(":"))
            if current == "meta_ignore":
                current = "summary"
                continue
            sections.setdefault(current, [])
            seen_heading = True
            continue

        if (not seen_heading) and len(contact_lines) < 2 and looks_like_contact_line(line):
            contact_lines.append(line)
            continue

        sections.setdefault(current, []).append(line)

    cleaned_sections: dict[str, list[str]] = {}
    for key, value in sections.items():
        lines_clean = [safe_text(line) for line in value if safe_text(line)]
        if lines_clean:
            cleaned_sections[key] = lines_clean

    if not cleaned_sections:
        cleaned_sections = {"summary": [safe_text(resume_text) or "Resume content not provided."]}

    ordered_keys = [key for key in RESUME_SECTION_ORDER if key in cleaned_sections]
    ordered_keys += [key for key in cleaned_sections if key not in ordered_keys]

    headline = ""
    summary_lines = cleaned_sections.get("summary", [])
    if summary_lines:
        first_summary = summary_lines[0]
        if len(first_summary) <= 115:
            headline = first_summary

    return {
        "name": guessed_name or "Candidate",
        "contact_line": " | ".join(contact_lines),
        "headline": headline,
        "sections": [(key, cleaned_sections[key]) for key in ordered_keys],
    }


def template_palette(template_key: str) -> dict[str, colors.Color]:
    palettes = {
        "minimal": {
            "name": colors.HexColor("#0F243A"),
            "accent": colors.HexColor("#2E6A9E"),
            "text": colors.HexColor("#1B2733"),
            "muted": colors.HexColor("#567086"),
            "line": colors.HexColor("#D7E2EA"),
            "surface": colors.HexColor("#F5F9FC"),
        },
        "executive": {
            "name": colors.HexColor("#132135"),
            "accent": colors.HexColor("#223A59"),
            "text": colors.HexColor("#1F2A36"),
            "muted": colors.HexColor("#546273"),
            "line": colors.HexColor("#C2CCD8"),
            "surface": colors.HexColor("#EFF3F7"),
        },
        "quantum": {
            "name": colors.HexColor("#0C3154"),
            "accent": colors.HexColor("#0F87B5"),
            "text": colors.HexColor("#13384D"),
            "muted": colors.HexColor("#4A6C80"),
            "line": colors.HexColor("#BED8E5"),
            "surface": colors.HexColor("#EEF8FC"),
        },
    }
    return palettes.get(template_key, palettes["minimal"])


def build_pdf_styles(template_key: str) -> dict[str, ParagraphStyle]:
    sample = getSampleStyleSheet()
    palette = template_palette(template_key)
    header_size = 23 if template_key == "executive" else 25
    body_size = 10.0 if template_key == "minimal" else 10.2

    styles = {
        "name": ParagraphStyle(
            "name",
            parent=sample["Title"],
            fontName="Helvetica-Bold",
            fontSize=header_size,
            leading=header_size + 2,
            textColor=palette["name"],
            spaceAfter=2,
        ),
        "contact": ParagraphStyle(
            "contact",
            parent=sample["Normal"],
            fontName="Helvetica",
            fontSize=9.6,
            leading=12,
            textColor=palette["muted"],
            spaceAfter=2,
        ),
        "header_inverse": ParagraphStyle(
            "header_inverse",
            parent=sample["Normal"],
            fontName="Helvetica-Bold",
            fontSize=12.2,
            leading=15,
            textColor=colors.white,
            spaceAfter=0,
        ),
        "header_inverse_meta": ParagraphStyle(
            "header_inverse_meta",
            parent=sample["Normal"],
            fontName="Helvetica",
            fontSize=9.4,
            leading=12.2,
            textColor=colors.Color(1, 1, 1, alpha=0.92),
            spaceAfter=0,
        ),
        "headline": ParagraphStyle(
            "headline",
            parent=sample["Normal"],
            fontName="Helvetica-Bold",
            fontSize=10.8,
            leading=14,
            textColor=palette["text"],
            spaceAfter=6,
        ),
        "section": ParagraphStyle(
            "section",
            parent=sample["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=11.4,
            leading=14,
            textColor=colors.white if template_key == "executive" else palette["accent"],
            spaceBefore=7,
            spaceAfter=4,
        ),
        "body": ParagraphStyle(
            "body",
            parent=sample["Normal"],
            fontName="Helvetica",
            fontSize=body_size,
            leading=14.2,
            textColor=palette["text"],
            spaceAfter=3,
        ),
        "bullet": ParagraphStyle(
            "bullet",
            parent=sample["Normal"],
            fontName="Helvetica",
            fontSize=body_size,
            leading=14.2,
            textColor=palette["text"],
            leftIndent=14,
            bulletIndent=2,
            spaceBefore=1,
            spaceAfter=3,
        ),
    }
    return styles


def section_header_flowable(
    template_key: str,
    section_title: str,
    styles: dict[str, ParagraphStyle],
    palette: dict[str, colors.Color],
    width: float,
) -> Any:
    title_html = html.escape(section_title.upper())
    title_para = Paragraph(title_html, styles["section"])

    if template_key == "executive":
        table = Table([[title_para]], colWidths=[width])
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), palette["accent"]),
                    ("TEXTCOLOR", (0, 0), (-1, -1), colors.white),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                    ("BOX", (0, 0), (-1, -1), 0.7, palette["line"]),
                ]
            )
        )
        return table

    if template_key == "quantum":
        table = Table([["", title_para]], colWidths=[7, width - 7])
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (0, -1), palette["accent"]),
                    ("BACKGROUND", (1, 0), (1, -1), palette["surface"]),
                    ("LEFTPADDING", (1, 0), (1, -1), 7),
                    ("RIGHTPADDING", (1, 0), (1, -1), 7),
                    ("TOPPADDING", (1, 0), (1, -1), 4),
                    ("BOTTOMPADDING", (1, 0), (1, -1), 3),
                    ("BOX", (0, 0), (-1, -1), 0.7, palette["line"]),
                ]
            )
        )
        return table

    return Paragraph(html.escape(section_title), styles["section"])


def draw_template_page_decoration(pdf: canvas.Canvas, doc: SimpleDocTemplate, template_key: str) -> None:
    palette = template_palette(template_key)
    width, height = A4
    pdf.saveState()

    if template_key == "executive":
        pdf.setFillColor(palette["accent"])
        pdf.rect(0, height - 22, width, 22, fill=1, stroke=0)
        pdf.setFillColor(colors.Color(1, 1, 1, alpha=0.18))
        pdf.rect(0, height - 24.2, width, 2.2, fill=1, stroke=0)
    elif template_key == "quantum":
        pdf.setFillColor(palette["accent"])
        pdf.rect(0, 0, 8, height, fill=1, stroke=0)
        pdf.setFillColor(colors.Color(0.08, 0.52, 0.68, alpha=0.22))
        pdf.circle(width - doc.rightMargin - 22, height - 15, 8, fill=1, stroke=0)
        pdf.circle(width - doc.rightMargin - 42, height - 20, 4, fill=1, stroke=0)
    else:
        pdf.setStrokeColor(palette["line"])
        pdf.setLineWidth(0.9)
        pdf.line(doc.leftMargin, height - 24, doc.leftMargin + doc.width, height - 24)

    pdf.setStrokeColor(palette["line"])
    pdf.setLineWidth(0.6)
    pdf.line(doc.leftMargin, 24, doc.leftMargin + doc.width, 24)
    pdf.setFont("Helvetica", 8)
    pdf.setFillColor(palette["muted"])
    pdf.drawRightString(doc.leftMargin + doc.width, 12, f"Page {pdf.getPageNumber()}")
    pdf.restoreState()


def render_resume_pdf_bytes(name: str, template: str, resume_text: str) -> bytes:
    template_key = safe_text(template).lower() or "minimal"
    if template_key not in {"minimal", "executive", "quantum"}:
        template_key = "minimal"

    parsed = parse_resume_sections(name, sanitize_resume_output(resume_text))
    styles = build_pdf_styles(template_key)
    palette = template_palette(template_key)

    output = io.BytesIO()
    if template_key == "quantum":
        left_margin = 52
    elif template_key == "executive":
        left_margin = 40
    else:
        left_margin = 44
    right_margin = left_margin
    doc = SimpleDocTemplate(
        output,
        pagesize=A4,
        leftMargin=left_margin,
        rightMargin=right_margin,
        topMargin=48 if template_key == "executive" else 42,
        bottomMargin=34,
        title=f"{parsed['name']} Resume",
        author="HireScore AI",
    )

    story: list[Any] = []
    if template_key == "executive":
        meta_lines = []
        if parsed["contact_line"]:
            meta_lines.append(Paragraph(html.escape(parsed["contact_line"]), styles["header_inverse_meta"]))
        if parsed["headline"]:
            meta_lines.append(Paragraph(html.escape(parsed["headline"]), styles["header_inverse_meta"]))
        header_rows: list[list[Any]] = [[Paragraph(html.escape(parsed["name"]), styles["header_inverse"])]]
        for meta in meta_lines[:2]:
            header_rows.append([meta])
        header_table = Table(header_rows, colWidths=[doc.width])
        header_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), palette["accent"]),
                    ("LEFTPADDING", (0, 0), (-1, -1), 10),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                    ("TOPPADDING", (0, 0), (-1, 0), 7),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                    ("LINEBELOW", (0, 0), (-1, -1), 0.7, colors.Color(1, 1, 1, alpha=0.22)),
                    ("BOX", (0, 0), (-1, -1), 0.8, palette["line"]),
                ]
            )
        )
        story.append(header_table)
        story.append(Spacer(1, 8))
    else:
        story.append(Paragraph(html.escape(parsed["name"]), styles["name"]))
        if parsed["contact_line"]:
            story.append(Paragraph(html.escape(parsed["contact_line"]), styles["contact"]))
        if parsed["headline"]:
            story.append(Paragraph(html.escape(parsed["headline"]), styles["headline"]))
        story.append(HRFlowable(width="100%", color=palette["line"], thickness=0.9, spaceBefore=2, spaceAfter=7))

    for section_key, lines in parsed["sections"]:
        section_title = RESUME_SECTION_TITLES.get(section_key, section_key.replace("_", " ").title())
        story.append(section_header_flowable(template_key, section_title, styles, palette, doc.width))
        if template_key == "minimal":
            story.append(HRFlowable(width="100%", color=palette["line"], thickness=0.5, spaceBefore=1, spaceAfter=4))
        else:
            story.append(Spacer(1, 4))

        for line in lines:
            content = safe_text(line)
            if not content:
                continue
            if re.match(r"^(?:[-*•]|(?:\d+[\).\s]))\s*", content):
                bullet_text = html.escape(strip_bullet_prefix(content))
                story.append(Paragraph(bullet_text, styles["bullet"], bulletText="• "))
            else:
                story.append(Paragraph(html.escape(content), styles["body"]))

        story.append(Spacer(1, 5 if template_key == "minimal" else 6))

    doc.build(
        story,
        onFirstPage=lambda pdf, page_doc: draw_template_page_decoration(pdf, page_doc, template_key),
        onLaterPages=lambda pdf, page_doc: draw_template_page_decoration(pdf, page_doc, template_key),
    )
    output.seek(0)
    return output.getvalue()


@app.get("/")
def root() -> dict[str, str]:
    return {"message": "Hirescore backend running"}


@app.get("/plan-status")
def plan_status(request: Request, auth_token: str | None = None) -> dict[str, Any]:
    user = require_authenticated_user(request, auth_token)
    return auth_response_payload(user)


@app.post("/auth/signup")
def signup(data: AuthRequest) -> dict[str, Any]:
    if EMAIL_OTP_REQUIRED:
        request_signup_otp(SignupOtpRequest(email=data.email, password=data.password))
        return {
            "otp_required": True,
            "message": f"OTP sent to {normalize_email(data.email)}. Verify to complete signup.",
            "otp_expires_minutes": OTP_EXPIRY_MINUTES,
        }

    email = normalize_email(data.email)
    password = safe_text(data.password)

    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    if len(password) < 6:
        log_analytics_event("auth", "signup_failed_short_password", meta={"email": email})
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
    if fetch_user_by_email(email):
        log_analytics_event("auth", "signup_failed_existing_account", meta={"email": email})
        raise HTTPException(status_code=409, detail="Account already exists. Please log in.")

    user = create_user_with_welcome_credits(email, password, source="signup")
    log_analytics_event("auth", "signup_success", user_id=int(user["id"]), meta={"email": email})
    send_welcome_email(email)
    return auth_response_payload(user, create_auth_token(int(user["id"]), str(user["email"])))


@app.post("/auth/signup/request-otp")
def request_signup_otp(data: SignupOtpRequest) -> dict[str, Any]:
    email = normalize_email(data.email)
    password = safe_text(data.password)

    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    if len(password) < 6:
        log_analytics_event("auth", "signup_failed_short_password", meta={"email": email})
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
    if fetch_user_by_email(email):
        log_analytics_event("auth", "signup_failed_existing_account", meta={"email": email})
        raise HTTPException(status_code=409, detail="Account already exists. Please log in.")

    create_signup_otp(email, password)
    log_analytics_event("auth", "signup_otp_sent", meta={"email": email})
    return {
        "otp_required": True,
        "message": f"OTP sent to {email}. Verify to complete signup.",
        "otp_expires_minutes": OTP_EXPIRY_MINUTES,
    }


@app.post("/auth/signup/verify-otp")
def verify_signup_otp(data: SignupOtpVerifyRequest) -> dict[str, Any]:
    email = normalize_email(data.email)
    otp = re.sub(r"[^0-9]", "", safe_text(data.otp))
    if len(otp) < 4:
        raise HTTPException(status_code=400, detail="Enter a valid OTP.")
    try:
        user = verify_signup_otp_and_create_user(email, otp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unhandled signup OTP verification error for %s", email)
        raise HTTPException(status_code=500, detail="OTP verification failed due to a server error. Please try again.") from exc
    log_analytics_event("auth", "signup_success", user_id=int(user["id"]), meta={"email": email, "via": "otp"})
    return auth_response_payload(user, create_auth_token(int(user["id"]), str(user["email"])))


@app.post("/auth/login")
def login(data: AuthRequest) -> dict[str, Any]:
    email = normalize_email(data.email)
    password = safe_text(data.password)
    user = fetch_user_by_email(email)
    if not user:
        log_analytics_event("auth", "login_failed_account_not_found", meta={"email": email})
        raise HTTPException(status_code=401, detail="Account not found. Please sign up.")
    if not is_email_verified(user):
        log_analytics_event("auth", "login_failed_unverified_email", user_id=int(user["id"]), meta={"email": email})
        raise HTTPException(status_code=401, detail="Email not verified. Complete signup OTP verification.")

    expected = hash_password(password, str(user["password_salt"]))
    if not hmac.compare_digest(expected, str(user["password_hash"])):
        log_analytics_event("auth", "login_failed_wrong_password", user_id=int(user["id"]), meta={"email": email})
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    log_analytics_event("auth", "login_success", user_id=int(user["id"]), meta={"email": email})
    return auth_response_payload(user, create_auth_token(int(user["id"]), str(user["email"])))


@app.post("/auth/forgot-password/request-otp")
def request_password_reset_otp(data: ForgotPasswordRequest) -> dict[str, Any]:
    email = normalize_email(data.email)
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    create_password_reset_otp(email)
    log_analytics_event("auth", "password_reset_otp_requested", meta={"email": email})
    return {
        "message": "If this email exists, a reset OTP has been sent.",
        "otp_expires_minutes": OTP_EXPIRY_MINUTES,
    }


@app.post("/auth/forgot-password/reset")
def reset_password_with_otp(data: ForgotPasswordResetRequest) -> dict[str, Any]:
    email = normalize_email(data.email)
    otp = re.sub(r"[^0-9]", "", safe_text(data.otp))
    new_password = safe_text(data.new_password)
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
    if len(otp) < 4:
        raise HTTPException(status_code=400, detail="Enter a valid reset OTP.")
    try:
        user = verify_password_reset_otp(email, otp, new_password)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unhandled password reset OTP verification error for %s", email)
        raise HTTPException(status_code=500, detail="Password reset failed due to a server error. Please try again.") from exc
    log_analytics_event("auth", "password_reset_success", user_id=int(user["id"]), meta={"email": email})
    return auth_response_payload(user, create_auth_token(int(user["id"]), str(user["email"])))


@app.get("/auth/me")
def auth_me(request: Request, auth_token: str | None = None) -> dict[str, Any]:
    user = require_authenticated_user(request, auth_token)
    return auth_response_payload(user)


@app.post("/auth/topup")
def auth_topup(data: TopupRequest, request: Request, auth_token: str | None = None) -> dict[str, Any]:
    if not ALLOW_UNVERIFIED_TOPUP:
        raise HTTPException(status_code=403, detail="Top-up endpoint disabled.")

    credits = int(clamp_float(float(data.credits), 1.0, 5000.0))
    user = require_authenticated_user(request, auth_token)
    topup = credit_credits(int(user["id"]), "manual_topup", credits, meta={"source": "api_topup"})
    refreshed = fetch_user_by_id(int(user["id"]))
    if not refreshed:
        raise HTTPException(status_code=500, detail="Unable to refresh wallet.")
    log_analytics_event("credits", "manual_topup", user_id=int(user["id"]), meta={"credits": credits})
    payload = auth_response_payload(refreshed)
    payload["wallet"] = topup["wallet"]
    payload["credit_transaction_id"] = topup["transaction_id"]
    return payload


@app.post("/feedback")
def submit_feedback(data: FeedbackSubmitRequest, request: Request) -> dict[str, Any]:
    user = require_authenticated_user(request, data.auth_token)
    rating = int(clamp_float(float(data.rating), 1.0, 5.0))
    comment = safe_text(data.comment)
    if len(comment) < 4:
        raise HTTPException(status_code=400, detail="Please add a short feedback comment.")

    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            connection.execute(
                """
                INSERT INTO user_feedback (user_id, rating, comment, source, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    int(user["id"]),
                    rating,
                    comment,
                    safe_text(data.source) or "post_analysis",
                    now_utc_iso(),
                ),
            )
            connection.commit()
        finally:
            connection.close()

    log_analytics_event(
        "feedback",
        "feedback_submitted",
        user_id=int(user["id"]),
        meta={"rating": rating, "source": safe_text(data.source)},
    )
    refreshed = fetch_user_by_id(int(user["id"]))
    if not refreshed:
        raise HTTPException(status_code=500, detail="Unable to refresh account.")
    payload = auth_response_payload(refreshed)
    payload["feedback_saved"] = True
    return payload


@app.get("/payments/packages")
def payment_packages() -> dict[str, Any]:
    return {
        "payment_gateway": PAYMENT_GATEWAY_ACTIVE,
        "payment_enabled": PAYMENT_GATEWAY_ACTIVE in {"stripe", "razorpay"},
        "stripe_enabled": STRIPE_ENABLED,
        "razorpay_enabled": RAZORPAY_ENABLED,
        "razorpay_key_id": RAZORPAY_KEY_ID if RAZORPAY_ENABLED else "",
        "packages": [
            {
                "id": package_id,
                "label": package["label"],
                "credits": package["credits"],
                "amount_inr": package["amount_inr"],
            }
            for package_id, package in PAYMENT_CREDIT_PACKS.items()
        ],
    }


def razorpay_request(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    if not RAZORPAY_ENABLED:
        raise HTTPException(status_code=503, detail="Razorpay is not configured yet.")
    url = f"https://api.razorpay.com/v1/{path.lstrip('/')}"
    basic_token = base64.b64encode(f"{RAZORPAY_KEY_ID}:{RAZORPAY_KEY_SECRET}".encode("utf-8")).decode("utf-8")
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Basic {basic_token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8", errors="ignore")
            parsed = json.loads(raw or "{}")
            if int(resp.getcode() or 0) >= 400:
                raise HTTPException(status_code=502, detail="Razorpay rejected checkout request.")
            return parsed
    except urllib.error.HTTPError as exc:
        details = ""
        try:
            details = exc.read().decode("utf-8", errors="ignore")
        except Exception:
            details = ""
        logger.exception("Razorpay HTTP error on %s", path)
        if details:
            raise HTTPException(status_code=502, detail=f"Razorpay error: {details[:220]}") from exc
        raise HTTPException(status_code=502, detail="Unable to initialize Razorpay checkout.") from exc
    except urllib.error.URLError as exc:
        logger.exception("Razorpay network error on %s", path)
        raise HTTPException(status_code=502, detail="Unable to reach Razorpay right now. Please retry.") from exc
    except TimeoutError as exc:
        logger.exception("Razorpay timeout on %s", path)
        raise HTTPException(status_code=502, detail="Razorpay timed out. Please retry.") from exc
    except Exception as exc:
        logger.exception("Unexpected Razorpay error on %s", path)
        raise HTTPException(status_code=502, detail="Unable to initialize Razorpay checkout.") from exc


def razorpay_signature_valid(order_id: str, payment_id: str, signature: str) -> bool:
    payload = f"{safe_text(order_id)}|{safe_text(payment_id)}"
    expected = hmac.new(
        RAZORPAY_KEY_SECRET.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, safe_text(signature))


@app.post("/payments/checkout")
def create_payment_checkout(data: PaymentCheckoutRequest, request: Request) -> dict[str, Any]:
    if PAYMENT_GATEWAY_ACTIVE not in {"stripe", "razorpay"}:
        raise HTTPException(status_code=503, detail="Payment gateway is not configured yet.")

    package_id = safe_text(data.package_id)
    package = PAYMENT_CREDIT_PACKS.get(package_id)
    if not package:
        raise HTTPException(status_code=400, detail="Invalid payment package.")

    user = require_authenticated_user(request, data.auth_token)
    if PAYMENT_GATEWAY_ACTIVE == "stripe":
        if not STRIPE_ENABLED or stripe is None:
            raise HTTPException(status_code=503, detail="Stripe is not configured yet.")
        try:
            session = stripe.checkout.Session.create(
                mode="payment",
                payment_method_types=["card"],
                line_items=[
                    {
                        "price_data": {
                            "currency": "inr",
                            "unit_amount": int(package["amount_inr"]) * 100,
                            "product_data": {
                                "name": f"HireScore Credits - {package['label']}",
                                "description": f"{package['credits']} credit pack",
                            },
                        },
                        "quantity": 1,
                    }
                ],
                success_url=PAYMENT_SUCCESS_URL,
                cancel_url=PAYMENT_CANCEL_URL,
                metadata={
                    "user_id": str(int(user["id"])),
                    "package_id": package_id,
                    "credits": str(int(package["credits"])),
                },
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Unable to initialize payment session right now.") from exc

        log_analytics_event(
            "payment",
            "checkout_created",
            user_id=int(user["id"]),
            meta={"gateway": "stripe", "package_id": package_id, "stripe_session_id": safe_text(session.get("id"))},
        )
        return {
            "provider": "stripe",
            "checkout_url": safe_text(session.get("url")),
            "session_id": safe_text(session.get("id")),
        }

    amount_inr = int(package["amount_inr"])
    credits = int(package["credits"])
    amount_paise = amount_inr * 100
    receipt = f"hs_{int(user['id'])}_{int(time.time())}_{secrets.token_hex(2)}"[:40]
    order = razorpay_request(
        "/orders",
        {
            "amount": amount_paise,
            "currency": "INR",
            "receipt": receipt,
            "notes": {
                "user_id": str(int(user["id"])),
                "package_id": package_id,
                "credits": str(credits),
            },
        },
    )
    order_id = safe_text(order.get("id"))
    if not order_id:
        raise HTTPException(status_code=502, detail="Razorpay did not return order id.")

    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            cursor.execute(
                """
                INSERT INTO payment_orders
                (gateway, order_id, user_id, package_id, credits, amount_inr, currency, status, created_at, meta_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "razorpay",
                    order_id,
                    int(user["id"]),
                    package_id,
                    credits,
                    amount_inr,
                    "INR",
                    "created",
                    now_utc_iso(),
                    json.dumps(
                        {"receipt": receipt, "gateway_order_status": safe_text(order.get("status"))},
                        separators=(",", ":"),
                        sort_keys=True,
                    ),
                ),
            )
            connection.commit()
        finally:
            connection.close()

    log_analytics_event(
        "payment",
        "checkout_created",
        user_id=int(user["id"]),
        meta={"gateway": "razorpay", "package_id": package_id, "order_id": order_id},
    )
    return {
        "provider": "razorpay",
        "order_id": order_id,
        "razorpay_key_id": RAZORPAY_KEY_ID,
        "currency": "INR",
        "amount_paise": amount_paise,
        "package_id": package_id,
        "package_label": safe_text(package["label"]),
        "credits": credits,
        "prefill_email": safe_text(user["email"]),
    }


@app.post("/payments/razorpay/verify")
def verify_razorpay_payment(data: RazorpayVerifyRequest, request: Request) -> dict[str, Any]:
    if not RAZORPAY_ENABLED:
        raise HTTPException(status_code=503, detail="Razorpay is not configured yet.")
    user = require_authenticated_user(request, data.auth_token)
    order_id = safe_text(data.order_id)
    payment_id = safe_text(data.razorpay_payment_id)
    signature = safe_text(data.razorpay_signature)
    if not order_id or not payment_id or not signature:
        raise HTTPException(status_code=400, detail="Missing Razorpay verification fields.")
    if not razorpay_signature_valid(order_id, payment_id, signature):
        raise HTTPException(status_code=400, detail="Invalid Razorpay signature.")

    checkout_logged_meta: dict[str, Any] | None = None
    refreshed_user = None
    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            order_row = cursor.execute(
                """
                SELECT id, user_id, package_id, credits, amount_inr, status, payment_id
                FROM payment_orders
                WHERE gateway = 'razorpay' AND order_id = ?
                LIMIT 1
                """,
                (order_id,),
            ).fetchone()
            if not order_row:
                connection.rollback()
                raise HTTPException(status_code=404, detail="Payment order not found.")
            if int(order_row["user_id"]) != int(user["id"]):
                connection.rollback()
                raise HTTPException(status_code=403, detail="This payment order belongs to a different user.")

            status = safe_text(order_row["status"]).lower()
            existing_payment_id = safe_text(order_row["payment_id"])
            if status == "paid":
                if existing_payment_id and existing_payment_id != payment_id:
                    connection.rollback()
                    raise HTTPException(status_code=409, detail="Payment already verified with a different payment id.")
                refreshed_user = cursor.execute("SELECT id, email, credits FROM users WHERE id = ?", (int(user["id"]),)).fetchone()
                connection.rollback()
            else:
                duplicate = cursor.execute(
                    """
                    SELECT order_id FROM payment_orders
                    WHERE gateway = 'razorpay' AND payment_id = ? AND status = 'paid' AND order_id != ?
                    LIMIT 1
                    """,
                    (payment_id, order_id),
                ).fetchone()
                if duplicate:
                    connection.rollback()
                    raise HTTPException(status_code=409, detail="This payment id is already consumed.")
                user_row = cursor.execute(
                    "SELECT id, email, credits FROM users WHERE id = ?",
                    (int(user["id"]),),
                ).fetchone()
                if not user_row:
                    connection.rollback()
                    raise HTTPException(status_code=404, detail="User account was not found.")

                credits_delta = int(order_row["credits"])
                updated_credits = int(user_row["credits"]) + credits_delta
                package_id = safe_text(order_row["package_id"])
                amount_inr = int(order_row["amount_inr"])
                plan_tier = user_plan_from_package_id(package_id)
                cursor.execute(
                    "UPDATE users SET credits = ?, plan_tier = ? WHERE id = ?",
                    (updated_credits, plan_tier, int(user["id"])),
                )
                cursor.execute(
                    """
                    INSERT INTO credit_transactions (user_id, action, delta, balance_after, meta_json, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        int(user["id"]),
                        "razorpay_credit_pack",
                        credits_delta,
                        updated_credits,
                        json.dumps(
                            {
                                "gateway": "razorpay",
                                "order_id": order_id,
                                "payment_id": payment_id,
                                "package_id": package_id,
                                "amount_inr": amount_inr,
                            },
                            separators=(",", ":"),
                            sort_keys=True,
                        ),
                        now_utc_iso(),
                    ),
                )
                cursor.execute(
                    """
                    UPDATE payment_orders
                    SET status = 'paid', payment_id = ?, signature = ?, verified_at = ?, meta_json = ?
                    WHERE id = ?
                    """,
                    (
                        payment_id,
                        signature,
                        now_utc_iso(),
                        json.dumps(
                            {"verified_by": "frontend_callback"},
                            separators=(",", ":"),
                            sort_keys=True,
                        ),
                        int(order_row["id"]),
                    ),
                )
                refreshed_user = cursor.execute("SELECT id, email, credits FROM users WHERE id = ?", (int(user["id"]),)).fetchone()
                connection.commit()
                checkout_logged_meta = {
                    "gateway": "razorpay",
                    "package_id": package_id,
                    "plan": plan_tier,
                    "credits": credits_delta,
                    "order_id": order_id,
                    "payment_id": payment_id,
                    "credits_after": updated_credits,
                }
        finally:
            connection.close()

    if checkout_logged_meta:
        log_analytics_event(
            "payment",
            "checkout_completed",
            user_id=int(user["id"]),
            meta=checkout_logged_meta,
        )
    if not refreshed_user:
        refreshed_user = fetch_user_by_id(int(user["id"]))
    if not refreshed_user:
        raise HTTPException(status_code=500, detail="Unable to refresh wallet after payment.")
    return {
        "message": "Payment verified and credits added.",
        "wallet": wallet_payload(int(refreshed_user["credits"])),
        "provider": "razorpay",
    }


@app.post("/payments/webhook")
async def stripe_webhook(request: Request) -> dict[str, bool]:
    if not STRIPE_ENABLED or stripe is None:
        raise HTTPException(status_code=503, detail="Payment gateway is not configured.")
    if not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="Stripe webhook secret is not configured.")

    payload = await request.body()
    signature = safe_text(request.headers.get("stripe-signature"))
    try:
        event = stripe.Webhook.construct_event(payload=payload, sig_header=signature, secret=STRIPE_WEBHOOK_SECRET)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid webhook signature.") from exc

    if safe_text(event.get("type")) == "checkout.session.completed":
        session = event.get("data", {}).get("object", {})
        metadata = session.get("metadata") or {}
        user_id = int(float(metadata.get("user_id") or 0))
        credits = int(float(metadata.get("credits") or 0))
        package_id = safe_text(metadata.get("package_id"))
        stripe_session_id = safe_text(session.get("id"))
        checkout_logged_meta: dict[str, Any] | None = None
        if user_id > 0 and credits > 0 and stripe_session_id:
            with AUTH_DB_LOCK:
                connection = auth_db_connection()
                try:
                    cursor = connection.cursor()
                    begin_write_transaction(cursor)
                    existing = connection.execute(
                        """
                        SELECT id FROM credit_transactions
                        WHERE action = 'stripe_credit_pack' AND meta_json LIKE ?
                        LIMIT 1
                        """,
                        (f'%\"stripe_session_id\":\"{stripe_session_id}\"%',),
                    ).fetchone()
                    if not existing:
                        user_row = cursor.execute(
                            "SELECT id, credits FROM users WHERE id = ?",
                            (user_id,),
                        ).fetchone()
                        if not user_row:
                            connection.rollback()
                            return {"received": True}
                        updated_credits = int(user_row["credits"]) + credits
                        plan_tier = user_plan_from_package_id(package_id)
                        cursor.execute(
                            "UPDATE users SET credits = ?, plan_tier = ? WHERE id = ?",
                            (updated_credits, plan_tier, user_id),
                        )
                        cursor.execute(
                            """
                            INSERT INTO credit_transactions (user_id, action, delta, balance_after, meta_json, created_at)
                            VALUES (?, ?, ?, ?, ?, ?)
                            """,
                            (
                                user_id,
                                "stripe_credit_pack",
                                credits,
                                updated_credits,
                                json.dumps(
                                    {
                                        "stripe_session_id": stripe_session_id,
                                        "package_id": package_id,
                                        "amount_inr": int(PAYMENT_CREDIT_PACKS.get(package_id, {}).get("amount_inr", 0)),
                                    },
                                    separators=(",", ":"),
                                    sort_keys=True,
                                ),
                                now_utc_iso(),
                            ),
                        )
                        connection.commit()
                        checkout_logged_meta = {
                            "package_id": package_id,
                            "plan": plan_tier,
                            "credits": credits,
                            "stripe_session_id": stripe_session_id,
                            "credits_after": updated_credits,
                        }
                    else:
                        connection.rollback()
                finally:
                    connection.close()
            if checkout_logged_meta:
                log_analytics_event(
                    "payment",
                    "checkout_completed",
                    user_id=user_id,
                    meta=checkout_logged_meta,
                )

    return {"received": True}


def parse_meta_json(meta_json: Any) -> dict[str, Any]:
    try:
        return json.loads(meta_json or "{}")
    except Exception:
        return {}


def collect_admin_analytics_summary(connection: sqlite3.Connection) -> dict[str, Any]:
    users_total = int(connection.execute("SELECT COUNT(*) AS count FROM users").fetchone()["count"])
    feedback_row = connection.execute(
        "SELECT COUNT(*) AS count, COALESCE(AVG(rating), 0) AS avg_rating FROM user_feedback"
    ).fetchone()
    feedback_total = int(feedback_row["count"])
    feedback_avg = round(float(feedback_row["avg_rating"] or 0), 2)
    signups_total = int(
        connection.execute(
            "SELECT COUNT(*) AS count FROM analytics_events WHERE event_type = 'auth' AND event_name = 'signup_success'"
        ).fetchone()["count"]
    )
    logins_total = int(
        connection.execute(
            "SELECT COUNT(*) AS count FROM analytics_events WHERE event_type = 'auth' AND event_name = 'login_success'"
        ).fetchone()["count"]
    )
    analyses_total = int(connection.execute("SELECT COUNT(*) AS count FROM credit_transactions WHERE action = 'analyze'").fetchone()["count"])
    payments_total = int(
        connection.execute(
            "SELECT COUNT(*) AS count FROM credit_transactions WHERE action IN ('stripe_credit_pack', 'razorpay_credit_pack')"
        ).fetchone()["count"]
    )
    credits_sold = int(
        connection.execute(
            "SELECT COALESCE(SUM(delta), 0) AS sold FROM credit_transactions WHERE action IN ('stripe_credit_pack', 'razorpay_credit_pack')"
        ).fetchone()["sold"]
    )
    payment_rows = connection.execute(
        "SELECT meta_json FROM credit_transactions WHERE action IN ('stripe_credit_pack', 'razorpay_credit_pack')"
    ).fetchall()
    revenue_inr = 0
    for row in payment_rows:
        meta = parse_meta_json(row["meta_json"])
        revenue_inr += int(meta.get("amount_inr") or 0)

    return {
        "users_total": users_total,
        "signups_total": signups_total,
        "logins_total": logins_total,
        "analyses_total": analyses_total,
        "feedback_total": feedback_total,
        "feedback_avg_rating": feedback_avg,
        "payments_total": payments_total,
        "credits_sold_total": credits_sold,
        "revenue_inr_total": revenue_inr,
        "stripe_enabled": STRIPE_ENABLED,
        "razorpay_enabled": RAZORPAY_ENABLED,
        "payment_gateway": PAYMENT_GATEWAY_ACTIVE,
    }


def collect_admin_events(connection: sqlite3.Connection, limit: int | None = None) -> list[dict[str, Any]]:
    query = """
        SELECT e.id, e.user_id, u.email, e.event_type, e.event_name, e.meta_json, e.created_at
        FROM analytics_events e
        LEFT JOIN users u ON u.id = e.user_id
        ORDER BY e.id DESC
    """
    params: tuple[Any, ...] = ()
    if limit is not None:
        query += "\nLIMIT ?"
        params = (int(limit),)
    rows = connection.execute(query, params).fetchall()
    return [
        {
            "id": int(row["id"]),
            "user_id": int(row["user_id"]) if row["user_id"] is not None else None,
            "email": safe_text(row["email"]),
            "event_type": safe_text(row["event_type"]),
            "event_name": safe_text(row["event_name"]),
            "meta": parse_meta_json(row["meta_json"]),
            "created_at": safe_text(row["created_at"]),
        }
        for row in rows
    ]


def collect_admin_feedback(connection: sqlite3.Connection, limit: int | None = None) -> list[dict[str, Any]]:
    query = """
        SELECT f.id, f.user_id, u.email, f.rating, f.comment, f.source, f.created_at
        FROM user_feedback f
        LEFT JOIN users u ON u.id = f.user_id
        ORDER BY f.id DESC
    """
    params: tuple[Any, ...] = ()
    if limit is not None:
        query += "\nLIMIT ?"
        params = (int(limit),)
    rows = connection.execute(query, params).fetchall()
    return [
        {
            "id": int(row["id"]),
            "user_id": int(row["user_id"]),
            "email": safe_text(row["email"]),
            "rating": int(row["rating"]),
            "comment": safe_text(row["comment"]),
            "source": safe_text(row["source"]),
            "created_at": safe_text(row["created_at"]),
        }
        for row in rows
    ]


def collect_admin_credit_transactions(connection: sqlite3.Connection, limit: int | None = None) -> list[dict[str, Any]]:
    query = """
        SELECT t.id, t.user_id, u.email, t.action, t.delta, t.balance_after, t.meta_json, t.created_at
        FROM credit_transactions t
        LEFT JOIN users u ON u.id = t.user_id
        ORDER BY t.id DESC
    """
    params: tuple[Any, ...] = ()
    if limit is not None:
        query += "\nLIMIT ?"
        params = (int(limit),)
    rows = connection.execute(query, params).fetchall()
    return [
        {
            "id": int(row["id"]),
            "user_id": int(row["user_id"]),
            "email": safe_text(row["email"]),
            "action": safe_text(row["action"]),
            "delta": int(row["delta"]),
            "balance_after": int(row["balance_after"]),
            "meta": parse_meta_json(row["meta_json"]),
            "created_at": safe_text(row["created_at"]),
        }
        for row in rows
    ]


def collect_admin_users(
    connection: sqlite3.Connection,
    q: str | None = None,
    plan: str | None = None,
    limit: int | None = None,
    offset: int = 0,
) -> list[dict[str, Any]]:
    search = safe_text(q).lower()
    raw_plan = safe_text(plan).lower()
    plan_filter = normalize_plan_tier(raw_plan) if raw_plan and raw_plan != "all" else ""

    filters: list[str] = []
    values: list[Any] = []
    if search:
        filters.append("(lower(u.email) LIKE ? OR lower(u.full_name) LIKE ?)")
        values.extend([f"%{search}%", f"%{search}%"])
    if plan_filter:
        filters.append("lower(u.plan_tier) = ?")
        values.append(plan_filter)
    where_sql = f"WHERE {' AND '.join(filters)}" if filters else ""
    pagination_sql = ""
    if limit is not None:
        pagination_sql = "LIMIT ? OFFSET ?"
        values.extend([int(limit), max(0, int(offset))])

    rows = connection.execute(
        f"""
        SELECT
            u.id,
            u.full_name,
            u.email,
            u.plan_tier,
            u.credits,
            u.created_at,
            COALESCE(a.analyze_count, 0) AS analyze_count,
            COALESCE(f.feedback_count, 0) AS feedback_count
        FROM users u
        LEFT JOIN (
            SELECT user_id, COUNT(*) AS analyze_count
            FROM credit_transactions
            WHERE action = 'analyze'
            GROUP BY user_id
        ) a ON a.user_id = u.id
        LEFT JOIN (
            SELECT user_id, COUNT(*) AS feedback_count
            FROM user_feedback
            GROUP BY user_id
        ) f ON f.user_id = u.id
        {where_sql}
        ORDER BY u.id DESC
        {pagination_sql}
        """,
        tuple(values),
    ).fetchall()

    users: list[dict[str, Any]] = []
    for row in rows:
        analyze_count = int(row["analyze_count"] or 0)
        feedback_count = int(row["feedback_count"] or 0)
        users.append(
            {
                "id": int(row["id"]),
                "name": safe_text(row["full_name"]) or display_name_from_email(str(row["email"])),
                "email": str(row["email"]),
                "plan": normalize_plan_tier(str(row["plan_tier"])),
                "credits": int(row["credits"]),
                "created_at": str(row["created_at"]),
                "analyze_count": analyze_count,
                "feedback_submitted": feedback_count > 0,
                "feedback_required": analyze_count >= 1 and feedback_count == 0,
            }
        )
    return users


def build_csv_bytes(rows: list[dict[str, Any]], fieldnames: list[str]) -> bytes:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        serialized: dict[str, Any] = {}
        for field in fieldnames:
            value = row.get(field)
            if isinstance(value, (dict, list)):
                serialized[field] = json.dumps(value, separators=(",", ":"), sort_keys=True)
            elif isinstance(value, bool):
                serialized[field] = "true" if value else "false"
            else:
                serialized[field] = value
        writer.writerow(serialized)
    return buffer.getvalue().encode("utf-8")


def csv_download_response(filename: str, rows: list[dict[str, Any]], fieldnames: list[str]) -> StreamingResponse:
    content = build_csv_bytes(rows, fieldnames)
    return StreamingResponse(
        io.BytesIO(content),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def json_download_response(filename: str, payload: dict[str, Any]) -> StreamingResponse:
    content = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=False).encode("utf-8")
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/admin/auth/login")
def admin_auth_login(data: AdminLoginRequest) -> dict[str, Any]:
    if not ADMIN_LOGIN_ID or not ADMIN_PASSWORD:
        raise HTTPException(status_code=503, detail="Admin login is not configured.")
    login_id = safe_text(data.login_id)
    password = safe_text(data.password)
    if not login_id or not password:
        raise HTTPException(status_code=400, detail="Enter admin login id and password.")
    if login_id != ADMIN_LOGIN_ID or password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid admin login credentials.")
    token = create_admin_token(login_id)
    return {
        "admin_token": token,
        "expires_in_hours": ADMIN_TOKEN_TTL_HOURS,
    }


@app.get("/admin/analytics")
def admin_analytics(request: Request) -> dict[str, Any]:
    require_admin_access(request)
    connection = auth_db_connection()
    try:
        return collect_admin_analytics_summary(connection)
    finally:
        connection.close()


@app.get("/admin/events")
def admin_events(request: Request, limit: int = 200) -> dict[str, Any]:
    require_admin_access(request)
    safe_limit = int(clamp_float(float(limit), 1, 1000))
    connection = auth_db_connection()
    try:
        events = collect_admin_events(connection, safe_limit)
    finally:
        connection.close()
    return {"events": events}


@app.get("/admin/feedback")
def admin_feedback(request: Request, limit: int = 200) -> dict[str, Any]:
    require_admin_access(request)
    safe_limit = int(clamp_float(float(limit), 1, 1000))
    connection = auth_db_connection()
    try:
        feedback_rows = collect_admin_feedback(connection, safe_limit)
    finally:
        connection.close()
    return {"feedback": feedback_rows}


@app.get("/admin/users")
def admin_users(
    request: Request,
    q: str | None = None,
    plan: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    require_admin_access(request)
    safe_limit = int(clamp_float(float(limit), 1, 200))
    safe_offset = max(0, int(offset))

    connection = auth_db_connection()
    try:
        users = collect_admin_users(connection, q=q, plan=plan, limit=safe_limit, offset=safe_offset)
    finally:
        connection.close()
    raw_plan = safe_text(plan).lower()
    plan_filter = normalize_plan_tier(raw_plan) if raw_plan and raw_plan != "all" else ""
    return {"users": users, "limit": safe_limit, "offset": safe_offset, "plan_filter": plan_filter or None}


@app.patch("/admin/users/{user_id}")
def admin_update_user(user_id: int, data: AdminUserUpdateRequest, request: Request) -> dict[str, Any]:
    require_admin_access(request)
    if user_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid user id.")

    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            user = cursor.execute(
                "SELECT id, full_name, email, password_hash, password_salt, plan_tier, credits, created_at FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
            if not user:
                connection.rollback()
                raise HTTPException(status_code=404, detail="User not found.")

            updates: list[str] = []
            values: list[Any] = []
            meta: dict[str, Any] = {}

            if data.name is not None:
                new_name = safe_text(data.name)
                updates.append("full_name = ?")
                values.append(new_name)
                meta["name_updated"] = True

            if data.email is not None:
                new_email = normalize_email(data.email)
                if not new_email or "@" not in new_email:
                    connection.rollback()
                    raise HTTPException(status_code=400, detail="Enter a valid email address.")
                updates.append("email = ?")
                values.append(new_email)
                meta["email_updated"] = True

            if data.password is not None:
                new_password = safe_text(data.password)
                if len(new_password) < 6:
                    connection.rollback()
                    raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
                new_salt = secrets.token_hex(16)
                new_hash = hash_password(new_password, new_salt)
                updates.extend(["password_hash = ?", "password_salt = ?"])
                values.extend([new_hash, new_salt])
                meta["password_updated"] = True

            if data.plan is not None:
                new_plan = normalize_plan_tier(data.plan)
                updates.append("plan_tier = ?")
                values.append(new_plan)
                meta["plan_updated"] = new_plan

            if updates:
                values.append(user_id)
                cursor.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", tuple(values))

            if data.credits_set is not None:
                target = max(0, int(data.credits_set))
                current = int(user["credits"])
                delta = target - current
                cursor.execute("UPDATE users SET credits = ? WHERE id = ?", (target, user_id))
                cursor.execute(
                    """
                    INSERT INTO credit_transactions (user_id, action, delta, balance_after, meta_json, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        user_id,
                        "admin_set_credits",
                        delta,
                        target,
                        json.dumps({"reason": "admin_update"}, separators=(",", ":"), sort_keys=True),
                        now_utc_iso(),
                    ),
                )
                meta["credits_set"] = target

            connection.commit()
        except HTTPException:
            raise
        except DB_INTEGRITY_ERRORS as exc:
            connection.rollback()
            raise HTTPException(status_code=409, detail="Email already exists.") from exc
        finally:
            connection.close()

    refreshed = fetch_user_by_id(user_id)
    if not refreshed:
        raise HTTPException(status_code=500, detail="Unable to refresh updated user.")
    log_analytics_event("admin", "user_updated", user_id=user_id, meta=meta)
    return {
        "user": {
            "id": int(refreshed["id"]),
            "name": safe_text(refreshed["full_name"]) or display_name_from_email(str(refreshed["email"])),
            "email": str(refreshed["email"]),
            "plan": normalize_plan_tier(str(refreshed["plan_tier"])),
            "credits": int(refreshed["credits"]),
            "created_at": str(refreshed["created_at"]),
        },
        "feedback_required": feedback_required_for_user(user_id),
    }


@app.post("/admin/users/{user_id}/credits")
def admin_adjust_credits(user_id: int, data: AdminCreditAdjustRequest, request: Request) -> dict[str, Any]:
    require_admin_access(request)
    if user_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid user id.")

    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            user = cursor.execute(
                "SELECT id, email, password_hash, password_salt, credits, created_at FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
            if not user:
                connection.rollback()
                raise HTTPException(status_code=404, detail="User not found.")
            current = int(user["credits"])
            target = max(0, current + int(data.delta))
            delta_applied = target - current
            cursor.execute("UPDATE users SET credits = ? WHERE id = ?", (target, user_id))
            cursor.execute(
                """
                INSERT INTO credit_transactions (user_id, action, delta, balance_after, meta_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    "admin_adjust_credits",
                    delta_applied,
                    target,
                    json.dumps({"reason": safe_text(data.reason)}, separators=(",", ":"), sort_keys=True),
                    now_utc_iso(),
                ),
            )
            connection.commit()
        finally:
            connection.close()

    refreshed = fetch_user_by_id(user_id)
    if not refreshed:
        raise HTTPException(status_code=500, detail="Unable to refresh wallet.")
    log_analytics_event("admin", "user_credits_adjusted", user_id=user_id, meta={"delta": int(data.delta), "reason": safe_text(data.reason)})
    return {
        "wallet": wallet_payload(int(refreshed["credits"])),
        "user": {
            "id": int(refreshed["id"]),
            "name": safe_text(refreshed["full_name"]) or display_name_from_email(str(refreshed["email"])),
            "email": str(refreshed["email"]),
            "plan": normalize_plan_tier(str(refreshed["plan_tier"])),
            "credits": int(refreshed["credits"]),
        },
    }


@app.delete("/admin/users/{user_id}")
def admin_delete_user(user_id: int, request: Request) -> dict[str, Any]:
    require_admin_access(request)
    if user_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid user id.")

    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            user = cursor.execute("SELECT id, email FROM users WHERE id = ? LIMIT 1", (user_id,)).fetchone()
            if not user:
                connection.rollback()
                raise HTTPException(status_code=404, detail="User not found.")
            cursor.execute("DELETE FROM payment_orders WHERE user_id = ?", (user_id,))
            cursor.execute("DELETE FROM credit_transactions WHERE user_id = ?", (user_id,))
            cursor.execute("DELETE FROM user_feedback WHERE user_id = ?", (user_id,))
            cursor.execute("DELETE FROM analytics_events WHERE user_id = ?", (user_id,))
            cursor.execute("DELETE FROM password_reset_otps WHERE user_id = ?", (user_id,))
            cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
            connection.commit()
        finally:
            connection.close()
    log_analytics_event("admin", "user_deleted", user_id=user_id, meta={"email": safe_text(user["email"]) if user else ""})
    return {"deleted": True, "user_id": user_id}


@app.get("/admin/credit-transactions")
def admin_credit_transactions(request: Request, limit: int = 120) -> dict[str, Any]:
    require_admin_access(request)
    safe_limit = int(clamp_float(float(limit), 1, 400))
    connection = auth_db_connection()
    try:
        transactions = collect_admin_credit_transactions(connection, safe_limit)
    finally:
        connection.close()
    return {"transactions": transactions}


@app.get("/admin/export/full.json")
def admin_export_full_json(request: Request, q: str | None = None, plan: str | None = None) -> StreamingResponse:
    require_admin_access(request)
    connection = auth_db_connection()
    try:
        payload = {
            "generated_at_utc": now_utc_iso(),
            "summary": collect_admin_analytics_summary(connection),
            "users": collect_admin_users(connection, q=q, plan=plan, limit=None, offset=0),
            "events": collect_admin_events(connection, limit=None),
            "feedback": collect_admin_feedback(connection, limit=None),
            "credit_transactions": collect_admin_credit_transactions(connection, limit=None),
        }
    finally:
        connection.close()

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return json_download_response(f"hirescore-admin-export-{timestamp}.json", payload)


@app.get("/admin/export/users.csv")
def admin_export_users_csv(request: Request, q: str | None = None, plan: str | None = None) -> StreamingResponse:
    require_admin_access(request)
    connection = auth_db_connection()
    try:
        rows = collect_admin_users(connection, q=q, plan=plan, limit=None, offset=0)
    finally:
        connection.close()
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return csv_download_response(
        f"hirescore-users-{timestamp}.csv",
        rows,
        ["id", "name", "email", "plan", "credits", "created_at", "analyze_count", "feedback_submitted", "feedback_required"],
    )


@app.get("/admin/export/events.csv")
def admin_export_events_csv(request: Request) -> StreamingResponse:
    require_admin_access(request)
    connection = auth_db_connection()
    try:
        rows = collect_admin_events(connection, limit=None)
    finally:
        connection.close()
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return csv_download_response(
        f"hirescore-events-{timestamp}.csv",
        rows,
        ["id", "user_id", "email", "event_type", "event_name", "meta", "created_at"],
    )


@app.get("/admin/export/feedback.csv")
def admin_export_feedback_csv(request: Request) -> StreamingResponse:
    require_admin_access(request)
    connection = auth_db_connection()
    try:
        rows = collect_admin_feedback(connection, limit=None)
    finally:
        connection.close()
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return csv_download_response(
        f"hirescore-feedback-{timestamp}.csv",
        rows,
        ["id", "user_id", "email", "rating", "comment", "source", "created_at"],
    )


@app.get("/admin/export/credit-transactions.csv")
def admin_export_credit_transactions_csv(request: Request) -> StreamingResponse:
    require_admin_access(request)
    connection = auth_db_connection()
    try:
        rows = collect_admin_credit_transactions(connection, limit=None)
    finally:
        connection.close()
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return csv_download_response(
        f"hirescore-credit-transactions-{timestamp}.csv",
        rows,
        ["id", "user_id", "email", "action", "delta", "balance_after", "meta", "created_at"],
    )


@app.post("/analyze")
def analyze_resume(data: ResumeRequest, request: Request) -> dict[str, Any]:
    user = require_authenticated_user(request, data.auth_token)
    require_feedback_completion(int(user["id"]))
    debit = debit_credits(
        int(user["id"]),
        "analyze",
        CREDIT_COSTS["analyze"],
        meta={"route": "/analyze", "role": safe_text(data.role), "industry": safe_text(data.industry)},
    )

    try:
        skills_text = safe_text(data.skills or data.description)
        analysis = analyze_profile(
            data.industry,
            data.role,
            skills_text,
            experience_years=data.experience_years,
            applications_count=data.applications_count,
            salary_boost_toggles=data.salary_boost_toggles,
        )
        analysis["wallet"] = debit["wallet"]
        analysis["credit_transaction_id"] = debit["transaction_id"]
        analysis["feedback_required"] = feedback_required_for_user(int(user["id"]))
        log_analytics_event(
            "analysis",
            "analyze_success",
            user_id=int(user["id"]),
            meta={"role": safe_text(data.role), "industry": safe_text(data.industry)},
        )
        return analysis
    except HTTPException:
        credit_credits(
            int(user["id"]),
            "refund_analyze",
            CREDIT_COSTS["analyze"],
            meta={"reason": "analyze_failed"},
        )
        raise
    except Exception as exc:
        credit_credits(
            int(user["id"]),
            "refund_analyze",
            CREDIT_COSTS["analyze"],
            meta={"reason": "analyze_failed_unhandled"},
        )
        raise HTTPException(status_code=500, detail="Unable to analyze profile right now.") from exc


@app.post("/analyze-resume-file")
async def analyze_resume_file(
    request: Request,
    file: UploadFile = File(...),
    industry: str = Form("General"),
    role: str = Form("General Role"),
    experience_years: float | None = Form(None),
    applications_count: int | None = Form(None),
    salary_boost_toggles: str = Form(""),
    auth_token: str | None = Form(None),
) -> dict[str, Any]:
    user = require_authenticated_user(request, auth_token)
    require_feedback_completion(int(user["id"]))
    debit = debit_credits(
        int(user["id"]),
        "analyze",
        CREDIT_COSTS["analyze"],
        meta={"route": "/analyze-resume-file", "role": safe_text(role), "industry": safe_text(industry)},
    )

    try:
        contents = await file.read()
        extracted_text = extract_resume_text_for_analysis(file.filename or "", file.content_type, contents)
        if not extracted_text:
            raise HTTPException(status_code=400, detail="No readable text found in the uploaded file.")

        toggle_ids = [token.strip() for token in salary_boost_toggles.split(",") if token.strip()]
        analysis = analyze_profile(
            industry,
            role,
            extracted_text,
            experience_years=experience_years,
            applications_count=applications_count,
            salary_boost_toggles=toggle_ids,
        )
        analysis["wallet"] = debit["wallet"]
        analysis["credit_transaction_id"] = debit["transaction_id"]
        analysis["source"] = "resume_upload"
        analysis["extracted_chars"] = len(extracted_text)
        analysis["feedback_required"] = feedback_required_for_user(int(user["id"]))
        log_analytics_event(
            "analysis",
            "analyze_resume_file_success",
            user_id=int(user["id"]),
            meta={"role": safe_text(role), "industry": safe_text(industry)},
        )
        return analysis
    except HTTPException:
        credit_credits(
            int(user["id"]),
            "refund_analyze",
            CREDIT_COSTS["analyze"],
            meta={"reason": "analyze_resume_file_failed"},
        )
        raise
    except Exception as exc:
        credit_credits(
            int(user["id"]),
            "refund_analyze",
            CREDIT_COSTS["analyze"],
            meta={"reason": "analyze_resume_file_failed_unhandled"},
        )
        raise HTTPException(status_code=400, detail="Unable to parse this file. Try a text-based PDF or TXT resume.") from exc


@app.post("/suggest")
def suggest_actions(data: ResumeRequest, request: Request) -> dict[str, Any]:
    user = require_authenticated_user(request, data.auth_token)
    require_feedback_completion(int(user["id"]))
    debit = debit_credits(
        int(user["id"]),
        "analyze",
        CREDIT_COSTS["analyze"],
        meta={"route": "/suggest", "role": safe_text(data.role), "industry": safe_text(data.industry)},
    )

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
    payload["wallet"] = debit["wallet"]
    payload["credit_transaction_id"] = debit["transaction_id"]
    return payload


@app.post("/build-resume")
def build_resume(data: ResumeBuildRequest, request: Request) -> dict[str, Any]:
    user = require_authenticated_user(request, data.auth_token)
    debit = debit_credits(
        int(user["id"]),
        "ai_resume_generation",
        CREDIT_COSTS["ai_resume_generation"],
        meta={"route": "/build-resume", "role": safe_text(data.role), "industry": safe_text(data.industry)},
    )

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

    content, ai_generated, ai_error = generate_with_llm(
        system_prompt="You write highly structured, factual resumes.",
        user_prompt=prompt,
        temperature=0.3,
        fallback_text=fallback_build_resume(data),
    )

    effective_wallet = debit["wallet"]
    if not ai_generated and ai_error:
        refund = credit_credits(
            int(user["id"]),
            "refund_ai_resume_generation",
            CREDIT_COSTS["ai_resume_generation"],
            meta={"reason": ai_error, "route": "/build-resume"},
        )
        effective_wallet = refund["wallet"]

    return {
        "optimized_resume": sanitize_resume_output(content),
        "wallet": effective_wallet,
        "credit_transaction_id": debit["transaction_id"],
        "ai_generated": ai_generated,
        "ai_warning": "AI service was unavailable for this run. Returned a structured fallback draft."
        if (not ai_generated and ai_error)
        else None,
    }


@app.post("/improvise-resume")
def improvise_resume(data: ResumeImproviseRequest, request: Request) -> dict[str, Any]:
    user = require_authenticated_user(request, data.auth_token)
    debit = debit_credits(
        int(user["id"]),
        "ai_resume_generation",
        CREDIT_COSTS["ai_resume_generation"],
        meta={"route": "/improvise-resume", "role": safe_text(data.role), "industry": safe_text(data.industry)},
    )
    payload = improvise_resume_text(data)
    ai_error = payload.pop("ai_error", None)
    effective_wallet = debit["wallet"]
    if not payload.get("ai_generated") and ai_error:
        refund = credit_credits(
            int(user["id"]),
            "refund_ai_resume_generation",
            CREDIT_COSTS["ai_resume_generation"],
            meta={"reason": ai_error, "route": "/improvise-resume"},
        )
        effective_wallet = refund["wallet"]
        payload["ai_warning"] = "AI service was unavailable for this run. Returned a structured fallback draft."
    payload["wallet"] = effective_wallet
    payload["credit_transaction_id"] = debit["transaction_id"]
    return payload


@app.post("/polish-resume-pdf")
async def polish_resume_pdf(
    request: Request,
    file: UploadFile = File(...),
    industry: str = Form("General"),
    role: str = Form("General Role"),
    auth_token: str | None = Form(None),
) -> dict[str, Any]:
    user = require_authenticated_user(request, auth_token)
    debit = debit_credits(
        int(user["id"]),
        "ai_resume_generation",
        CREDIT_COSTS["ai_resume_generation"],
        meta={"route": "/polish-resume-pdf", "role": safe_text(role), "industry": safe_text(industry)},
    )

    try:
        contents = await file.read()
        pdf_reader = PyPDF2.PdfReader(io.BytesIO(contents))

        extracted_pages: list[str] = []
        for page in pdf_reader.pages:
            extracted_pages.append(page.extract_text() or "")

        extracted_text = "\n".join(extracted_pages).strip()
        if not extracted_text:
            raise HTTPException(status_code=400, detail="No readable text found in uploaded PDF.")

        improvise_payload = ResumeImproviseRequest(
            industry=industry,
            role=role,
            resume_text=extracted_text,
            current_skills=extracted_text,
        )

        improved = improvise_resume_text(improvise_payload)
        ai_error = improved.get("ai_error")
        effective_wallet = debit["wallet"]
        if not improved.get("ai_generated") and ai_error:
            refund = credit_credits(
                int(user["id"]),
                "refund_ai_resume_generation",
                CREDIT_COSTS["ai_resume_generation"],
                meta={"reason": str(ai_error), "route": "/polish-resume-pdf"},
            )
            effective_wallet = refund["wallet"]

        return {
            "optimized_resume": safe_text(improved["optimized_resume"]),
            "wallet": effective_wallet,
            "credit_transaction_id": debit["transaction_id"],
            "ai_generated": improved.get("ai_generated", False),
            "ai_warning": "AI service was unavailable for this run. Returned a structured fallback draft."
            if (not improved.get("ai_generated") and ai_error)
            else None,
        }
    except HTTPException:
        credit_credits(
            int(user["id"]),
            "refund_ai_resume_generation",
            CREDIT_COSTS["ai_resume_generation"],
            meta={"reason": "polish_failed"},
        )
        raise
    except Exception as exc:
        credit_credits(
            int(user["id"]),
            "refund_ai_resume_generation",
            CREDIT_COSTS["ai_resume_generation"],
            meta={"reason": "polish_failed_unhandled"},
        )
        raise HTTPException(status_code=400, detail="Unable to process this PDF file.") from exc


@app.post("/export-resume-pdf")
def export_resume_pdf(data: ResumeExportRequest, request: Request) -> StreamingResponse:
    user = require_authenticated_user(request, data.auth_token)
    resume_text = safe_text(data.resume_text)
    if not resume_text:
        raise HTTPException(status_code=400, detail="Resume text is required for PDF export.")

    template_name = safe_text(data.template).lower() or "minimal"
    debit = debit_credits(
        int(user["id"]),
        "template_pdf_download",
        CREDIT_COSTS["template_pdf_download"],
        meta={"route": "/export-resume-pdf", "template": template_name},
    )

    try:
        pdf_bytes = render_resume_pdf_bytes(data.name or "Candidate", template_name, resume_text)
    except Exception as exc:
        credit_credits(
            int(user["id"]),
            "refund_template_pdf_download",
            CREDIT_COSTS["template_pdf_download"],
            meta={"reason": "pdf_render_failed"},
        )
        raise HTTPException(status_code=500, detail="Unable to generate PDF right now.") from exc

    safe_name = sanitize_download_name(data.name)
    headers = {
        "Content-Disposition": f'attachment; filename="{safe_name}-{template_name}.pdf"',
        "X-HireScore-Credits-Remaining": str(debit["wallet"]["credits"]),
    }
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf", headers=headers)
