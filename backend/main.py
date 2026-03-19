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
import uuid
import zipfile
import urllib.request
import urllib.error
import urllib.parse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Any
import xml.etree.ElementTree as ET

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
ANALYZE_MODE = (os.getenv("ANALYZE_MODE") or "hybrid").strip().lower()
if ANALYZE_MODE not in {"rules", "hybrid", "llm"}:
    ANALYZE_MODE = "hybrid"
ANALYZE_LLM_MODEL = (os.getenv("ANALYZE_LLM_MODEL") or OPENAI_MODEL).strip() or OPENAI_MODEL
try:
    ANALYZE_LLM_BLEND = float((os.getenv("ANALYZE_LLM_BLEND") or "0.28").strip())
except Exception:
    ANALYZE_LLM_BLEND = 0.28
ANALYZE_LLM_BLEND = max(0.08, min(0.6, ANALYZE_LLM_BLEND))
try:
    JD_MATCH_LLM_BLEND = float((os.getenv("JD_MATCH_LLM_BLEND") or "0.32").strip())
except Exception:
    JD_MATCH_LLM_BLEND = 0.32
JD_MATCH_LLM_BLEND = max(0.08, min(0.6, JD_MATCH_LLM_BLEND))
ANALYZE_CACHE_ENABLED = env_flag("ANALYZE_CACHE_ENABLED", True)
ANALYZE_SMART_ROUTING_ENABLED = env_flag("ANALYZE_SMART_ROUTING_ENABLED", True)
ANALYZE_SELF_LEARNING_ENABLED = env_flag("ANALYZE_SELF_LEARNING_ENABLED", True)
ANALYZE_MEMORY_ROUTE_ENABLED = env_flag("ANALYZE_MEMORY_ROUTE_ENABLED", True)
try:
    ANALYZE_CACHE_TTL_HOURS = float((os.getenv("ANALYZE_CACHE_TTL_HOURS") or "240").strip())
except Exception:
    ANALYZE_CACHE_TTL_HOURS = 240.0
ANALYZE_CACHE_TTL_HOURS = max(1.0, min(24.0 * 60.0, ANALYZE_CACHE_TTL_HOURS))
ANALYZE_MEMORY_MIN_FEEDBACK = max(1, min(80, int((os.getenv("ANALYZE_MEMORY_MIN_FEEDBACK") or "6").strip())))
configured_fallback_models = [model.strip() for model in (os.getenv("OPENAI_FALLBACK_MODELS") or "").split(",") if model.strip()]
if configured_fallback_models:
    OPENAI_FALLBACK_MODELS = configured_fallback_models
else:
    OPENAI_FALLBACK_MODELS = [model for model in ["gpt-4.1-mini", "gpt-4o-mini"] if model != OPENAI_MODEL]
ANALYZE_LLM_LOW_MODEL = (os.getenv("ANALYZE_LLM_LOW_MODEL") or ANALYZE_LLM_MODEL).strip() or ANALYZE_LLM_MODEL
default_high_model = OPENAI_FALLBACK_MODELS[0] if OPENAI_FALLBACK_MODELS else ANALYZE_LLM_MODEL
ANALYZE_LLM_HIGH_MODEL = (os.getenv("ANALYZE_LLM_HIGH_MODEL") or default_high_model).strip() or ANALYZE_LLM_MODEL
APP_BUILD_SHA = (
    (os.getenv("APP_BUILD_SHA") or "")
    or (os.getenv("RENDER_GIT_COMMIT") or "")
    or (os.getenv("VERCEL_GIT_COMMIT_SHA") or "")
    or (os.getenv("GIT_COMMIT_SHA") or "")
    or (os.getenv("GITHUB_SHA") or "")
).strip()[:40]
APP_STARTED_AT = datetime.now(timezone.utc).isoformat()
client = OpenAI(api_key=openai_api_key) if openai_api_key else None

if client is None:
    logger.warning("OPENAI_API_KEY is missing. AI generation requests will not reach OpenAI.")


def resolve_auth_db_path() -> str:
    explicit = (os.getenv("AUTH_DB_PATH") or "").strip()
    if explicit:
        return explicit
    if os.path.isdir("/var/data"):
        return "/var/data/hirescore_auth.db"
    if (os.getenv("VERCEL") or "").strip() or (os.getenv("VERCEL_ENV") or "").strip():
        # Vercel serverless file system is read-only except /tmp.
        return "/tmp/hirescore_auth.db"
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
GUEST_CHAT_TOKEN_TTL_HOURS = max(6, min(24 * 90, int((os.getenv("GUEST_CHAT_TOKEN_TTL_HOURS") or "168").strip())))
GUEST_SYSTEM_EMAIL_SUFFIX = "@guest.hirescore.local"
# Testing helper endpoint (/auth/topup) should be disabled by default in production.
ALLOW_UNVERIFIED_TOPUP = env_flag("ALLOW_UNVERIFIED_TOPUP", False)
EMAIL_OTP_REQUIRED = env_flag("EMAIL_OTP_REQUIRED", True)
ADMIN_API_KEYS = {
    key.strip()
    for key in (os.getenv("ADMIN_API_KEYS") or os.getenv("ADMIN_API_KEY") or "").split(",")
    if key.strip()
}
ADMIN_LOGIN_ID = (os.getenv("ADMIN_LOGIN_ID") or "").strip()
ADMIN_PASSWORD = (os.getenv("ADMIN_PASSWORD") or "").strip()
ADMIN_AUTH_SECRET = ((os.getenv("ADMIN_AUTH_SECRET") or "").strip()) or AUTH_TOKEN_SECRET
ADMIN_TOKEN_TTL_HOURS = max(1, int((os.getenv("ADMIN_TOKEN_TTL_HOURS") or "72").strip()))
ADMIN_IMPERSONATION_TOKEN_TTL_MINUTES = max(5, min(720, int((os.getenv("ADMIN_IMPERSONATION_TOKEN_TTL_MINUTES") or "60").strip())))
if AUTH_TOKEN_SECRET == "replace-this-in-production":
    logger.warning("AUTH_TOKEN_SECRET is using a default value. Set AUTH_TOKEN_SECRET in production.")
if not ADMIN_API_KEYS and not (ADMIN_LOGIN_ID and ADMIN_PASSWORD):
    logger.warning("Admin auth is not configured. Set ADMIN_API_KEYS or ADMIN_LOGIN_ID + ADMIN_PASSWORD.")
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
    "jd_match": 5,
    "interview_prep": 0,
    "ai_resume_generation": 15,
    "template_pdf_download": 20,
}
ATS_STANDARD_RESUME_TEMPLATE_KEY = "ats_standard"
ATS_STANDARD_RESUME_TEMPLATE_FILE_SUFFIX = "ats-standard"

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
FOCUSED_MATCHER_MODE = env_flag("FOCUSED_MATCHER_MODE", True)

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
GOOGLE_CLIENT_IDS = {
    client_id.strip()
    for client_id in (os.getenv("GOOGLE_CLIENT_IDS") or os.getenv("GOOGLE_CLIENT_ID") or "").split(",")
    if client_id.strip()
}
GOOGLE_TOKENINFO_TIMEOUT_SECONDS = max(4, min(20, int((os.getenv("GOOGLE_TOKENINFO_TIMEOUT_SECONDS") or "8").strip())))
AB_FLAGS_JSON = (os.getenv("AB_FLAGS_JSON") or "").strip()
ASYNC_JOB_WORKERS = max(1, min(8, int((os.getenv("ASYNC_JOB_WORKERS") or "3").strip())))
ASYNC_JOB_RETRY_ATTEMPTS = max(0, min(4, int((os.getenv("ASYNC_JOB_RETRY_ATTEMPTS") or "2").strip())))

AUTH_DB_LOCK = threading.Lock()
ASYNC_JOB_LOCK = threading.Lock()
ASYNC_JOB_STORE: dict[str, dict[str, Any]] = {}
ASYNC_JOB_EXECUTOR = ThreadPoolExecutor(max_workers=ASYNC_JOB_WORKERS)
INTERVIEW_SIMULATOR_LOCK = threading.Lock()
INTERVIEW_SIMULATOR_SESSIONS: dict[str, dict[str, Any]] = {}
INTERVIEW_SIMULATOR_TTL_SECONDS = max(
    30 * 60, min(48 * 60 * 60, int((os.getenv("INTERVIEW_SIMULATOR_TTL_SECONDS") or "21600").strip()))
)
INTERVIEW_SIMULATOR_MIN_ROUNDS = 1
INTERVIEW_SIMULATOR_MAX_ROUNDS = 4
INTERVIEW_SIMULATOR_GUEST_FREE_LIMIT = max(
    0,
    min(10, int((os.getenv("INTERVIEW_SIMULATOR_GUEST_FREE_LIMIT") or "1").strip())),
)
INTERVIEW_SIMULATOR_GUEST_FINGERPRINT_SALT = (
    (os.getenv("INTERVIEW_SIMULATOR_GUEST_FINGERPRINT_SALT") or AUTH_TOKEN_SECRET or "hirescore-guest-interview-salt").strip()
)
INTERVIEW_SIMULATOR_STAGE_BLUEPRINTS: list[dict[str, Any]] = [
    {
        "key": "screening",
        "label": "Screening",
        "objective": "confirm role fit, resume signal, communication quality, and motivation",
        "min_questions": 2,
        "max_questions": 2,
    },
    {
        "key": "technical_assessment",
        "label": "Technical Assessment",
        "objective": "test role-specific execution, judgment, tools, and measurable outcomes",
        "min_questions": 2,
        "max_questions": 3,
    },
    {
        "key": "in_depth_assessment",
        "label": "In-Depth Assessment",
        "objective": "go deeper on ambiguity, leadership, trade-offs, and high-stakes problem solving",
        "min_questions": 1,
        "max_questions": 2,
    },
    {
        "key": "hr",
        "label": "HR",
        "objective": "close on motivation, values, collaboration style, and career intent",
        "min_questions": 1,
        "max_questions": 2,
    },
]
INTERVIEW_SIMULATOR_STAGE_BLUEPRINT_MAP = {item["key"]: item for item in INTERVIEW_SIMULATOR_STAGE_BLUEPRINTS}
INTERVIEW_SIMULATOR_MODE_FULL = "full"
INTERVIEW_SIMULATOR_MODE_DEMO = "demo"
INTERVIEW_SIMULATOR_DEMO_QUESTION_COUNT = 3
try:
    INTERVIEW_SIMULATOR_LLM_BLEND = float((os.getenv("INTERVIEW_SIMULATOR_LLM_BLEND") or "0.34").strip())
except Exception:
    INTERVIEW_SIMULATOR_LLM_BLEND = 0.34
INTERVIEW_SIMULATOR_LLM_BLEND = max(0.08, min(0.65, INTERVIEW_SIMULATOR_LLM_BLEND))
INTERVIEW_SIMULATOR_TTS_ENABLED = env_flag("INTERVIEW_SIMULATOR_TTS_ENABLED", True)
INTERVIEW_SIMULATOR_TTS_MODEL = (os.getenv("INTERVIEW_SIMULATOR_TTS_MODEL") or "gpt-4o-mini-tts").strip()
configured_simulator_tts_models = [
    model.strip() for model in (os.getenv("INTERVIEW_SIMULATOR_TTS_FALLBACK_MODELS") or "").split(",") if model.strip()
]
if configured_simulator_tts_models:
    INTERVIEW_SIMULATOR_TTS_FALLBACK_MODELS = configured_simulator_tts_models
else:
    INTERVIEW_SIMULATOR_TTS_FALLBACK_MODELS = [model for model in ["gpt-4o-mini-tts", "tts-1-hd", "tts-1"] if model != INTERVIEW_SIMULATOR_TTS_MODEL]
INTERVIEW_SIMULATOR_TTS_DEFAULT_VOICE = (os.getenv("INTERVIEW_SIMULATOR_TTS_DEFAULT_VOICE") or "verse").strip().lower() or "verse"
INTERVIEW_SIMULATOR_TTS_PREFETCH_VOICE = (os.getenv("INTERVIEW_SIMULATOR_TTS_PREFETCH_VOICE") or "verse").strip().lower() or "verse"
INTERVIEW_SIMULATOR_TTS_RESPONSE_FORMAT = (os.getenv("INTERVIEW_SIMULATOR_TTS_RESPONSE_FORMAT") or "mp3").strip().lower() or "mp3"
INTERVIEW_SIMULATOR_TTS_MAX_CHARS = max(
    120,
    min(1600, int((os.getenv("INTERVIEW_SIMULATOR_TTS_MAX_CHARS") or "520").strip())),
)
INTERVIEW_SIMULATOR_TTS_CACHE_TTL_SECONDS = max(
    60,
    min(24 * 60 * 60, int((os.getenv("INTERVIEW_SIMULATOR_TTS_CACHE_TTL_SECONDS") or "14400").strip())),
)
INTERVIEW_SIMULATOR_TTS_CACHE_MAX_ITEMS = max(
    1,
    min(16, int((os.getenv("INTERVIEW_SIMULATOR_TTS_CACHE_MAX_ITEMS") or "6").strip())),
)
INTERVIEW_SIMULATOR_VIDEO_SENTIMENT_ENABLED = env_flag("INTERVIEW_SIMULATOR_VIDEO_SENTIMENT_ENABLED", True)
INTERVIEW_SIMULATOR_VIDEO_SENTIMENT_MAX_FRAMES = max(
    1,
    min(4, int((os.getenv("INTERVIEW_SIMULATOR_VIDEO_SENTIMENT_MAX_FRAMES") or "3").strip())),
)
INTERVIEW_SIMULATOR_VIDEO_SENTIMENT_MAX_DATA_URL_CHARS = max(
    1600,
    min(420000, int((os.getenv("INTERVIEW_SIMULATOR_VIDEO_SENTIMENT_MAX_DATA_URL_CHARS") or "220000").strip())),
)
PUBLIC_INSTANT_LOCK = threading.Lock()
PUBLIC_INSTANT_REQUEST_STATE: dict[str, dict[str, Any]] = {}
PUBLIC_INSTANT_RESULT_STORE: dict[str, dict[str, Any]] = {}
PUBLIC_INSTANT_SHARE_STORE: dict[str, dict[str, Any]] = {}
PUBLIC_INSTANT_FILE_MAX_BYTES = 12 * 1024 * 1024
PUBLIC_INSTANT_MAX_TEXT_CHARS = max(5000, min(30000, int((os.getenv("PUBLIC_INSTANT_MAX_TEXT_CHARS") or "18000").strip())))
PUBLIC_INSTANT_REQUEST_WINDOW_SECONDS = max(
    600, min(24 * 60 * 60, int((os.getenv("PUBLIC_INSTANT_REQUEST_WINDOW_SECONDS") or "3600").strip()))
)
PUBLIC_INSTANT_REQUEST_LIMIT = max(1, min(80, int((os.getenv("PUBLIC_INSTANT_REQUEST_LIMIT") or "8").strip())))
PUBLIC_INSTANT_UPLOAD_LIMIT = max(1, min(120, int((os.getenv("PUBLIC_INSTANT_UPLOAD_LIMIT") or "12").strip())))
PUBLIC_INSTANT_RESULT_TTL_SECONDS = max(
    15 * 60, min(14 * 24 * 60 * 60, int((os.getenv("PUBLIC_INSTANT_RESULT_TTL_SECONDS") or "172800").strip()))
)
PUBLIC_INSTANT_SHARE_TTL_SECONDS = max(
    60 * 60, min(120 * 24 * 60 * 60, int((os.getenv("PUBLIC_INSTANT_SHARE_TTL_SECONDS") or "1209600").strip()))
)
APPLICATION_COPILOT_TRACK_STATUSES = {"saved", "applied", "interview", "offer", "rejected"}
PUBLIC_ACCESS_RUNTIME_SETTING_KEY = "public_feature_access_enabled"
PUBLIC_ACCESS_GUEST_PREFIX = "public-access"
PUBLIC_ACCESS_GUEST_TOKEN_TTL_HOURS = max(
    6,
    min(24 * 90, int((os.getenv("PUBLIC_ACCESS_GUEST_TOKEN_TTL_HOURS") or "336").strip())),
)
PUBLIC_ACCESS_GUEST_CREDITS = max(
    1000,
    min(10_000_000, int((os.getenv("PUBLIC_ACCESS_GUEST_CREDITS") or "500000").strip())),
)
PUBLIC_ACCESS_GUEST_PLAN = "elite"


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


class GoogleAuthRequest(BaseModel):
    credential: str


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


class AdminRuntimeSettingsUpdateRequest(BaseModel):
    public_feature_access_enabled: bool | None = None


class AdminImpersonateRequest(BaseModel):
    reason: str | None = None


class GuestChatSessionRequest(BaseModel):
    guest_key: str | None = None
    name: str | None = None
    email: str | None = None


class PublicAccessSessionRequest(BaseModel):
    guest_key: str | None = None
    name: str | None = None


class AuthProfileUpdateRequest(BaseModel):
    name: str | None = None
    auth_token: str | None = None


class ChatMessageCreateRequest(BaseModel):
    message: str
    auth_token: str | None = None


class SecurityLeakTraceRequest(BaseModel):
    action: str
    source: str | None = None
    detail: str | None = None
    path: str | None = None
    user_agent: str | None = None
    auth_token: str | None = None


class AdminChatReplyRequest(BaseModel):
    message: str


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
    age_years: float | None = None
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


class GoalRoadmapMilestoneRequest(BaseModel):
    id: str | None = None
    title: str
    detail: str | None = None
    category: str | None = None
    priority: str | None = None
    timeframe: str | None = None
    why: str | None = None
    done_when: str | None = None
    focus_skills: list[str] | None = None


class GoalRoadmapUpsertRequest(BaseModel):
    goal_title: str
    goal_context: str | None = None
    target_role: str | None = None
    target_industry: str | None = None
    target_score: int | None = None
    current_score: int | None = None
    milestones: list[GoalRoadmapMilestoneRequest]
    auth_token: str | None = None


class GoalRoadmapMilestoneToggleRequest(BaseModel):
    completed: bool
    auth_token: str | None = None


class GoalRoadmapMilestoneEvidenceRequest(BaseModel):
    note: str | None = None
    link: str | None = None
    auth_token: str | None = None


class JobDescriptionMatchRequest(BaseModel):
    industry: str
    role: str
    resume_text: str
    job_description: str
    auth_token: str | None = None


class PublicInstantFitCheckRequest(BaseModel):
    industry: str | None = None
    role: str | None = None
    resume_text: str
    job_description: str
    session_id: str | None = None


class PublicInstantFitShareRequest(BaseModel):
    result_id: str
    session_id: str | None = None


class InterviewPrepRequest(BaseModel):
    industry: str
    role: str
    job_description: str | None = None
    critical_missing_skills: list[str] | None = None
    auth_token: str | None = None


class InterviewSimulatorStartRequest(BaseModel):
    industry: str
    role: str
    candidate_name: str | None = None
    job_description: str | None = None
    resume_text: str | None = None
    difficulty: str | None = None
    mode: str | None = None
    rounds: int | None = None
    auth_token: str | None = None


class InterviewSimulatorTurnRequest(BaseModel):
    session_id: str
    answer_text: str
    response_time_seconds: int | None = None
    video_frame_samples: list[str] | None = None
    session_secret: str | None = None
    auth_token: str | None = None


class InterviewSimulatorReportRequest(BaseModel):
    session_id: str
    session_secret: str | None = None
    auth_token: str | None = None


class InterviewSimulatorTtsRequest(BaseModel):
    session_id: str
    session_secret: str | None = None
    text: str | None = None
    voice: str | None = None
    auth_token: str | None = None


class ApplicationPackRequest(BaseModel):
    industry: str
    role: str
    resume_text: str
    job_description: str | None = None
    auth_token: str | None = None


class ApplicationCopilotRequest(BaseModel):
    industry: str
    role: str
    resume_text: str
    job_description: str
    company: str | None = None
    auth_token: str | None = None


class ApplicationCopilotTrackCreateRequest(BaseModel):
    role: str
    industry: str | None = None
    company: str | None = None
    status: str | None = None
    copilot_payload: dict[str, Any] | None = None
    auth_token: str | None = None


class ApplicationCopilotTrackStatusRequest(BaseModel):
    status: str
    auth_token: str | None = None


class BuildResumeAsyncRequest(ResumeBuildRequest):
    async_mode: bool = True


class ExportResumePdfAsyncRequest(ResumeExportRequest):
    async_mode: bool = True


PLAN_RULES: dict[str, dict[str, Any]] = {
    "free": {
        "analyze_limit": 8,
        "jd_match_limit": 8,
        "suggest_limit": 8,
        "generation_limit": 1,
        "pdf_polish_limit": 0,
        "allowed_templates": [ATS_STANDARD_RESUME_TEMPLATE_KEY],
        "can_upload_pdf": False,
        "can_ai_enhance": False,
        "can_jd_match": True,
    },
    "starter": {
        "analyze_limit": 80,
        "jd_match_limit": 80,
        "suggest_limit": 80,
        "generation_limit": 15,
        "pdf_polish_limit": 6,
        "allowed_templates": [ATS_STANDARD_RESUME_TEMPLATE_KEY],
        "can_upload_pdf": True,
        "can_ai_enhance": True,
        "can_jd_match": True,
    },
    "pro": {
        "analyze_limit": 320,
        "jd_match_limit": 320,
        "suggest_limit": 320,
        "generation_limit": 90,
        "pdf_polish_limit": 40,
        "allowed_templates": [ATS_STANDARD_RESUME_TEMPLATE_KEY],
        "can_upload_pdf": True,
        "can_ai_enhance": True,
        "can_jd_match": True,
    },
    "elite": {
        "analyze_limit": 1200,
        "jd_match_limit": 1200,
        "suggest_limit": 1200,
        "generation_limit": 320,
        "pdf_polish_limit": 160,
        "allowed_templates": [ATS_STANDARD_RESUME_TEMPLATE_KEY],
        "can_upload_pdf": True,
        "can_ai_enhance": True,
        "can_jd_match": True,
    },
}

BYPASS_PLAN_AS = BYPASS_PLAN_AS if BYPASS_PLAN_AS in PLAN_RULES else "elite"

USAGE_TRACKER: dict[str, dict[str, int]] = {}


def canonical_resume_template_name(_template: str | None = None) -> str:
    return ATS_STANDARD_RESUME_TEMPLATE_KEY


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


def is_transient_db_write_error(exc: Exception) -> bool:
    message = safe_text(str(exc)).lower()
    if not message:
        return False
    transient_markers = (
        "database is locked",
        "database is busy",
        "deadlock detected",
        "could not serialize access",
        "timeout",
        "temporarily unavailable",
    )
    return any(marker in message for marker in transient_markers)


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
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS user_chat_messages (
                        id BIGSERIAL PRIMARY KEY,
                        user_id BIGINT NOT NULL REFERENCES users (id),
                        sender_role TEXT NOT NULL,
                        message TEXT NOT NULL,
                        read_by_user INTEGER NOT NULL DEFAULT 0,
                        read_by_admin INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS guest_chat_profiles (
                        id BIGSERIAL PRIMARY KEY,
                        user_id BIGINT NOT NULL UNIQUE REFERENCES users (id),
                        guest_key TEXT NOT NULL UNIQUE,
                        contact_name TEXT NOT NULL,
                        contact_email TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS analysis_reports (
                        id BIGSERIAL PRIMARY KEY,
                        user_id BIGINT NOT NULL REFERENCES users (id),
                        source TEXT NOT NULL,
                        industry TEXT,
                        role TEXT,
                        overall_score INTEGER,
                        shortlist_prediction TEXT,
                        report_json TEXT NOT NULL,
                        created_at TEXT NOT NULL
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS guest_interview_usage (
                        id BIGSERIAL PRIMARY KEY,
                        fingerprint TEXT NOT NULL UNIQUE,
                        usage_count INTEGER NOT NULL DEFAULT 0,
                        first_used_at TEXT NOT NULL,
                        last_used_at TEXT NOT NULL,
                        last_ip TEXT,
                        user_agent TEXT
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS user_goal_roadmaps (
                        id BIGSERIAL PRIMARY KEY,
                        user_id BIGINT NOT NULL REFERENCES users (id),
                        goal_title TEXT NOT NULL,
                        goal_context TEXT,
                        target_role TEXT,
                        target_industry TEXT,
                        target_score INTEGER,
                        current_score INTEGER,
                        milestones_json TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS application_job_tracks (
                        id BIGSERIAL PRIMARY KEY,
                        user_id BIGINT NOT NULL REFERENCES users (id),
                        role TEXT NOT NULL,
                        industry TEXT,
                        company TEXT,
                        status TEXT NOT NULL DEFAULT 'saved',
                        match_percentage INTEGER NOT NULL DEFAULT 0,
                        matched_skills_json TEXT NOT NULL DEFAULT '[]',
                        missing_skills_json TEXT NOT NULL DEFAULT '[]',
                        feedback_json TEXT NOT NULL DEFAULT '[]',
                        next_steps_json TEXT NOT NULL DEFAULT '[]',
                        payload_json TEXT NOT NULL DEFAULT '{}',
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS analysis_semantic_cache (
                        id BIGSERIAL PRIMARY KEY,
                        cache_key TEXT NOT NULL UNIQUE,
                        industry TEXT,
                        role TEXT,
                        role_track TEXT,
                        payload_json TEXT NOT NULL,
                        model TEXT,
                        usage_count INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        last_used_at TEXT
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS analysis_learning_memory (
                        bucket_key TEXT PRIMARY KEY,
                        industry TEXT,
                        role TEXT,
                        role_track TEXT,
                        sample_count INTEGER NOT NULL DEFAULT 0,
                        feedback_count INTEGER NOT NULL DEFAULT 0,
                        avg_feedback_rating REAL NOT NULL DEFAULT 0,
                        avg_overall_score REAL NOT NULL DEFAULT 0,
                        avg_confidence REAL NOT NULL DEFAULT 0,
                        positive_feedback_count INTEGER NOT NULL DEFAULT 0,
                        negative_feedback_count INTEGER NOT NULL DEFAULT 0,
                        quick_win_counts_json TEXT NOT NULL DEFAULT '{}',
                        missing_skill_counts_json TEXT NOT NULL DEFAULT '{}',
                        model_success_json TEXT NOT NULL DEFAULT '{}',
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS app_runtime_settings (
                        setting_key TEXT PRIMARY KEY,
                        value_json TEXT NOT NULL,
                        updated_at TEXT NOT NULL
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
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS user_chat_messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        sender_role TEXT NOT NULL,
                        message TEXT NOT NULL,
                        read_by_user INTEGER NOT NULL DEFAULT 0,
                        read_by_admin INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY (user_id) REFERENCES users (id)
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS guest_chat_profiles (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL UNIQUE,
                        guest_key TEXT NOT NULL UNIQUE,
                        contact_name TEXT NOT NULL,
                        contact_email TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        FOREIGN KEY (user_id) REFERENCES users (id)
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS analysis_reports (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        source TEXT NOT NULL,
                        industry TEXT,
                        role TEXT,
                        overall_score INTEGER,
                        shortlist_prediction TEXT,
                        report_json TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY (user_id) REFERENCES users (id)
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS guest_interview_usage (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        fingerprint TEXT NOT NULL UNIQUE,
                        usage_count INTEGER NOT NULL DEFAULT 0,
                        first_used_at TEXT NOT NULL,
                        last_used_at TEXT NOT NULL,
                        last_ip TEXT,
                        user_agent TEXT
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS user_goal_roadmaps (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        goal_title TEXT NOT NULL,
                        goal_context TEXT,
                        target_role TEXT,
                        target_industry TEXT,
                        target_score INTEGER,
                        current_score INTEGER,
                        milestones_json TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        FOREIGN KEY (user_id) REFERENCES users (id)
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS application_job_tracks (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        role TEXT NOT NULL,
                        industry TEXT,
                        company TEXT,
                        status TEXT NOT NULL DEFAULT 'saved',
                        match_percentage INTEGER NOT NULL DEFAULT 0,
                        matched_skills_json TEXT NOT NULL DEFAULT '[]',
                        missing_skills_json TEXT NOT NULL DEFAULT '[]',
                        feedback_json TEXT NOT NULL DEFAULT '[]',
                        next_steps_json TEXT NOT NULL DEFAULT '[]',
                        payload_json TEXT NOT NULL DEFAULT '{}',
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        FOREIGN KEY (user_id) REFERENCES users (id)
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS analysis_semantic_cache (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        cache_key TEXT NOT NULL UNIQUE,
                        industry TEXT,
                        role TEXT,
                        role_track TEXT,
                        payload_json TEXT NOT NULL,
                        model TEXT,
                        usage_count INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        last_used_at TEXT
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS analysis_learning_memory (
                        bucket_key TEXT PRIMARY KEY,
                        industry TEXT,
                        role TEXT,
                        role_track TEXT,
                        sample_count INTEGER NOT NULL DEFAULT 0,
                        feedback_count INTEGER NOT NULL DEFAULT 0,
                        avg_feedback_rating REAL NOT NULL DEFAULT 0,
                        avg_overall_score REAL NOT NULL DEFAULT 0,
                        avg_confidence REAL NOT NULL DEFAULT 0,
                        positive_feedback_count INTEGER NOT NULL DEFAULT 0,
                        negative_feedback_count INTEGER NOT NULL DEFAULT 0,
                        quick_win_counts_json TEXT NOT NULL DEFAULT '{}',
                        missing_skill_counts_json TEXT NOT NULL DEFAULT '{}',
                        model_success_json TEXT NOT NULL DEFAULT '{}',
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS app_runtime_settings (
                        setting_key TEXT PRIMARY KEY,
                        value_json TEXT NOT NULL,
                        updated_at TEXT NOT NULL
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
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_chat_user_time ON user_chat_messages (user_id, created_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_chat_admin_unread ON user_chat_messages (read_by_admin, created_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_chat_user_unread ON user_chat_messages (user_id, read_by_user, created_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_guest_chat_profiles_key ON guest_chat_profiles (guest_key)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_guest_chat_profiles_contact_email ON guest_chat_profiles (contact_email)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_analysis_reports_user_time ON analysis_reports (user_id, created_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_guest_interview_usage_last_used ON guest_interview_usage (last_used_at)")
            cursor.execute("DROP INDEX IF EXISTS idx_goal_roadmap_user_unique")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_goal_roadmap_user_time ON user_goal_roadmaps (user_id, updated_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_goal_roadmap_updated ON user_goal_roadmaps (updated_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_app_job_tracks_user_time ON application_job_tracks (user_id, updated_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_semantic_cache_updated ON analysis_semantic_cache (updated_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_learning_memory_track_time ON analysis_learning_memory (role_track, updated_at)")
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


def send_payment_success_email(email: str, gateway: str, package_id: str, credits_added: int, credits_after: int) -> str | None:
    package = PAYMENT_CREDIT_PACKS.get(safe_text(package_id))
    package_label = safe_text(str(package.get("label") if package else package_id)) or "Credit Pack"
    amount_inr = int(package.get("amount_inr", 0)) if package else 0
    gateway_label = safe_text(gateway).capitalize() or "Payment"
    amount_line = f"Amount paid: INR {amount_inr}\n" if amount_inr > 0 else ""
    return send_email_message(
        email,
        "HireScore payment successful",
        (
            "Your payment was successful and credits have been added.\n\n"
            f"Package: {package_label}\n"
            f"Gateway: {gateway_label}\n"
            f"{amount_line}"
            f"Credits added: {int(credits_added)}\n"
            f"Updated wallet balance: {int(credits_after)} credits\n\n"
            "You can now continue your analysis and resume workflows."
        ),
    )


def verify_google_id_token(credential: str) -> dict[str, str]:
    token = safe_text(credential)
    if not token:
        raise HTTPException(status_code=400, detail="Google credential is missing.")
    if not GOOGLE_CLIENT_IDS:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured on server.")

    request = urllib.request.Request(
        "https://oauth2.googleapis.com/tokeninfo?" + urllib.parse.urlencode({"id_token": token}),
        headers={
            "Accept": "application/json",
            "User-Agent": "HireScoreBackend/1.0 (+https://hirescore.in)",
        },
    )
    raw_payload = ""
    try:
        with urllib.request.urlopen(request, timeout=GOOGLE_TOKENINFO_TIMEOUT_SECONDS) as response:
            raw_payload = response.read().decode("utf-8", errors="ignore")
    except urllib.error.HTTPError as exc:
        logger.warning("Google tokeninfo rejected credential (%s)", exc.code)
        raise HTTPException(status_code=401, detail="Invalid Google sign-in. Please try again.") from exc
    except TimeoutError as exc:
        logger.exception("Google tokeninfo timed out")
        raise HTTPException(status_code=503, detail="Google sign-in timed out. Please try again.") from exc
    except urllib.error.URLError as exc:
        logger.exception("Google tokeninfo network error")
        raise HTTPException(status_code=503, detail="Google sign-in is unavailable right now. Please try again.") from exc
    except Exception as exc:
        logger.exception("Unexpected Google token verification error")
        raise HTTPException(status_code=500, detail="Google sign-in failed due to server error.") from exc

    try:
        payload = json.loads(raw_payload or "{}")
    except Exception as exc:
        logger.exception("Google tokeninfo response parse failure")
        raise HTTPException(status_code=401, detail="Invalid Google sign-in payload.") from exc

    aud = safe_text(str(payload.get("aud") or ""))
    if aud not in GOOGLE_CLIENT_IDS:
        raise HTTPException(status_code=401, detail="Google sign-in audience mismatch.")

    issuer = safe_text(str(payload.get("iss") or ""))
    if issuer and issuer not in {"accounts.google.com", "https://accounts.google.com"}:
        raise HTTPException(status_code=401, detail="Google sign-in issuer is invalid.")

    try:
        expires_at = int(str(payload.get("exp") or "0"))
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Google sign-in token expiry is invalid.") from exc
    if expires_at <= int(time.time()):
        raise HTTPException(status_code=401, detail="Google sign-in token expired.")

    email = normalize_email(str(payload.get("email") or ""))
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Google account email is missing.")

    email_verified = safe_text(str(payload.get("email_verified") or "")).lower()
    if email_verified not in {"true", "1"}:
        raise HTTPException(status_code=403, detail="Google account email is not verified.")

    return {
        "email": email,
        "name": safe_text(str(payload.get("name") or "")),
        "sub": safe_text(str(payload.get("sub") or "")),
    }


def sync_user_after_google_login(user_id: int, full_name: str | None = None) -> None:
    cleaned_name = safe_text(full_name)
    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            if cleaned_name:
                connection.execute(
                    """
                    UPDATE users
                    SET email_verified = 1,
                        full_name = CASE WHEN TRIM(full_name) = '' THEN ? ELSE full_name END
                    WHERE id = ?
                    """,
                    (cleaned_name[:120], user_id),
                )
            else:
                connection.execute(
                    "UPDATE users SET email_verified = 1 WHERE id = ?",
                    (user_id,),
                )
            connection.commit()
        finally:
            connection.close()


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


def create_auth_token(user_id: int, email: str, ttl_seconds: int | None = None) -> str:
    effective_ttl_seconds = (
        max(300, int(ttl_seconds))
        if ttl_seconds is not None
        else max(1, AUTH_TOKEN_TTL_HOURS) * 3600
    )
    payload = {
        "uid": user_id,
        "email": normalize_email(email),
        "exp": int(time.time()) + effective_ttl_seconds,
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


def is_google_sso_user(user_id: int) -> bool:
    connection = auth_db_connection()
    try:
        row = connection.execute(
            """
            SELECT meta_json
            FROM credit_transactions
            WHERE user_id = ? AND action = 'welcome_credits'
            ORDER BY id ASC
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()
    finally:
        connection.close()
    if not row:
        return False
    try:
        payload = json.loads(safe_text(row["meta_json"]) or "{}")
    except Exception:
        return False
    source = safe_text(str(payload.get("source") or "")).lower()
    return source == "google_sso"


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


def normalize_guest_chat_key(value: str | None) -> str:
    normalized = re.sub(r"[^a-z0-9_-]", "", safe_text(value).lower())[:72]
    if len(normalized) >= 8:
        return normalized
    return secrets.token_hex(8)


def guest_chat_email_for_key(guest_key: str) -> str:
    fingerprint = hashlib.sha256(f"guest-chat:{guest_key}:{AUTH_TOKEN_SECRET}".encode("utf-8")).hexdigest()[:24]
    return f"guest-chat-{fingerprint}{GUEST_SYSTEM_EMAIL_SUFFIX}"


def get_or_create_guest_chat_user(guest_key: str) -> sqlite3.Row:
    email = guest_chat_email_for_key(guest_key)
    existing = fetch_user_by_email(email)
    if existing:
        return existing

    password_salt = secrets.token_hex(16)
    password_hash = hash_password(secrets.token_urlsafe(18), password_salt)
    display_name = f"Guest {email.split('@', 1)[0][-6:]}".strip()
    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            try:
                cursor.execute(
                    """
                    INSERT INTO users (full_name, email, password_hash, password_salt, plan_tier, credits, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        display_name or "Guest User",
                        email,
                        password_hash,
                        password_salt,
                        "free",
                        0,
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
        raise HTTPException(status_code=500, detail="Unable to create guest chat session.")
    return user


def normalize_guest_contact_name(value: str | None) -> str:
    normalized = re.sub(r"\s+", " ", safe_text(value)).strip()
    if len(normalized) < 2:
        raise HTTPException(status_code=400, detail="Enter your name to start chat.")
    return normalized[:80]


def normalize_profile_name(value: str | None, *, empty_error: str = "Enter your name.") -> str:
    normalized = re.sub(r"\s+", " ", safe_text(value)).strip()
    if len(normalized) < 2:
        raise HTTPException(status_code=400, detail=empty_error)
    return normalized[:80]


def normalize_optional_profile_name(value: str | None) -> str:
    normalized = re.sub(r"\s+", " ", safe_text(value)).strip()
    if not normalized:
        return ""
    if len(normalized) < 2:
        raise HTTPException(status_code=400, detail="Enter your name.")
    return normalized[:80]


def normalize_guest_contact_email(value: str | None) -> str:
    normalized = normalize_email(safe_text(value))
    if not normalized or "@" not in normalized or " " in normalized:
        raise HTTPException(status_code=400, detail="Enter a valid email to start chat.")
    local, _, domain = normalized.partition("@")
    if not local or not domain or "." not in domain:
        raise HTTPException(status_code=400, detail="Enter a valid email to start chat.")
    return normalized[:180]


def upsert_guest_chat_profile(
    guest_key: str,
    user_id: int,
    contact_name: str,
    contact_email: str,
) -> dict[str, str]:
    now = now_utc_iso()
    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            existing_by_key = cursor.execute(
                """
                SELECT id, user_id, guest_key, contact_name, contact_email
                FROM guest_chat_profiles
                WHERE guest_key = ?
                LIMIT 1
                """,
                (guest_key,),
            ).fetchone()
            if existing_by_key:
                cursor.execute(
                    """
                    UPDATE guest_chat_profiles
                    SET user_id = ?, contact_name = ?, contact_email = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        int(user_id),
                        contact_name,
                        contact_email,
                        now,
                        int(existing_by_key["id"]),
                    ),
                )
            else:
                existing_by_user = cursor.execute(
                    """
                    SELECT id FROM guest_chat_profiles
                    WHERE user_id = ?
                    LIMIT 1
                    """,
                    (int(user_id),),
                ).fetchone()
                if existing_by_user:
                    cursor.execute(
                        """
                        UPDATE guest_chat_profiles
                        SET guest_key = ?, contact_name = ?, contact_email = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (
                            guest_key,
                            contact_name,
                            contact_email,
                            now,
                            int(existing_by_user["id"]),
                        ),
                    )
                else:
                    cursor.execute(
                        """
                        INSERT INTO guest_chat_profiles (
                            user_id, guest_key, contact_name, contact_email, created_at, updated_at
                        )
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (
                            int(user_id),
                            guest_key,
                            contact_name,
                            contact_email,
                            now,
                            now,
                        ),
                    )
            connection.commit()
        finally:
            connection.close()

    return {"name": contact_name, "email": contact_email}


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
    safe_event_type = safe_text(event_type) or "system"
    safe_event_name = safe_text(event_name) or "event"
    serialized_meta = json.dumps(meta or {}, separators=(",", ":"), sort_keys=True)
    max_attempts = 3 if AUTH_DB_BACKEND == "sqlite" else 2

    for attempt in range(max_attempts):
        should_retry = False
        with AUTH_DB_LOCK:
            connection = auth_db_connection()
            try:
                cursor = connection.cursor()
                begin_write_transaction(cursor)
                cursor.execute(
                    """
                    INSERT INTO analytics_events (user_id, event_type, event_name, meta_json, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        user_id,
                        safe_event_type,
                        safe_event_name,
                        serialized_meta,
                        now_utc_iso(),
                    ),
                )
                connection.commit()
                return
            except Exception as exc:
                try:
                    connection.rollback()
                except Exception:
                    pass
                should_retry = attempt + 1 < max_attempts and is_transient_db_write_error(exc)
                if not should_retry:
                    logger.exception(
                        "Failed to persist analytics event after %s attempt(s): event_type=%s event_name=%s user_id=%s",
                        attempt + 1,
                        safe_event_type,
                        safe_event_name,
                        user_id,
                    )
                    return
            finally:
                connection.close()
        if should_retry:
            time.sleep(0.08 * (attempt + 1))


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


def studio_unlocked_for_user(user_id: int, analyze_count: int | None = None) -> bool:
    effective_count = max(0, int(analyze_count)) if analyze_count is not None else get_analyze_count(user_id)
    return effective_count >= 1


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


def feedback_required_for_user(user_id: int, analyze_count: int | None = None) -> bool:
    if public_feature_access_enabled():
        user = fetch_user_by_id(user_id)
        if is_public_access_guest_user(user):
            return False
    effective_count = max(0, int(analyze_count)) if analyze_count is not None else get_analyze_count(user_id)
    return effective_count >= 1 and not has_feedback_submission(user_id)


def require_studio_access(user_id: int) -> None:
    if public_feature_access_enabled():
        user = fetch_user_by_id(user_id)
        if is_public_access_guest_user(user):
            return
    analyze_count = get_analyze_count(user_id)
    if studio_unlocked_for_user(user_id, analyze_count):
        return
    raise HTTPException(
        status_code=403,
        detail={
            "message": "Resume Studio unlocks after your first analysis. Run one analysis on /upload first.",
            "studio_locked": True,
            "studio_unlocked": False,
            "analysis_count": analyze_count,
            "required_analysis_count": 1,
        },
    )


def require_feedback_completion(user_id: int) -> None:
    if feedback_required_for_user(user_id):
        raise HTTPException(
            status_code=403,
            detail={
                "message": "Mandatory feedback is required before running another analysis.",
                "feedback_required": True,
            },
        )


def admin_actor_from_request(request: Request) -> dict[str, str]:
    bearer = safe_text(extract_bearer_token(request))
    if bearer:
        try:
            payload = decode_admin_token(bearer)
            login_id = safe_text(str(payload.get("login_id") or "")) or "admin"
            return {"auth_mode": "token", "identifier": login_id}
        except HTTPException:
            pass

    api_key = safe_text(request.headers.get("x-admin-key"))
    if api_key:
        key_fingerprint = hashlib.sha256(api_key.encode("utf-8")).hexdigest()[:12]
        return {"auth_mode": "api_key", "identifier": f"api_key:{key_fingerprint}"}

    return {"auth_mode": "unknown", "identifier": "unknown"}


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
    pricing = {
        "analyze": CREDIT_COSTS["analyze"],
        "jd_match": CREDIT_COSTS["jd_match"],
        "interview_prep": CREDIT_COSTS["interview_prep"],
        "ai_resume_generation": CREDIT_COSTS["ai_resume_generation"],
        "template_pdf_download": CREDIT_COSTS["template_pdf_download"],
    }
    if FOCUSED_MATCHER_MODE:
        pricing = {
            "analyze": 0,
            "jd_match": 0,
            "interview_prep": 0,
            "ai_resume_generation": 0,
            "template_pdf_download": 0,
        }
    return {
        "credits": max(0, int(credits)),
        "welcome_credits": WELCOME_FREE_CREDITS,
        "pricing": pricing,
        "free_analysis_included": 1,
    }


def auth_response_payload(user_row: sqlite3.Row, token: str | None = None) -> dict[str, Any]:
    user_id = int(user_row["id"])
    analyze_count = get_analyze_count(user_id)
    is_public_guest = is_public_access_guest_user(user_row)
    studio_unlocked = True if is_public_guest and public_feature_access_enabled() else studio_unlocked_for_user(user_id, analyze_count)
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
        "analysis_count": analyze_count,
        "studio_unlocked": studio_unlocked,
        "feedback_required": False if is_public_guest and public_feature_access_enabled() else feedback_required_for_user(user_id, analyze_count),
        "email_verified": email_verified,
        "guest_mode": is_public_guest,
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
    if is_public_access_guest_user(user) and not public_feature_access_enabled():
        raise HTTPException(status_code=401, detail="Public access session expired. Please refresh and continue.")
    if not is_email_verified(user):
        raise HTTPException(status_code=401, detail="Email is not verified. Complete OTP verification to continue.")

    if normalize_email(str(user["email"])) != normalize_email(str(payload.get("email", ""))):
        raise HTTPException(status_code=401, detail="Invalid authentication token.")

    return user


def resolve_optional_authenticated_user(request: Request, explicit_auth_token: str | None = None) -> sqlite3.Row | None:
    try:
        return require_authenticated_user(request, explicit_auth_token)
    except HTTPException:
        return None


def interview_simulator_guest_fingerprint(request: Request) -> str:
    source_ip = request_source_ip(request)
    user_agent = safe_text(request.headers.get("user-agent"))[:220]
    accept_language = safe_text(request.headers.get("accept-language"))[:120]
    raw = f"{INTERVIEW_SIMULATOR_GUEST_FINGERPRINT_SALT}|{source_ip}|{user_agent}|{accept_language}"
    return hashlib.sha256(raw.encode("utf-8", errors="ignore")).hexdigest()


def fetch_guest_interview_usage_count(connection: AuthDBConnection, fingerprint: str) -> int:
    row = connection.execute(
        """
        SELECT usage_count
        FROM guest_interview_usage
        WHERE fingerprint = ?
        LIMIT 1
        """,
        (safe_text(fingerprint),),
    ).fetchone()
    if not row:
        return 0
    return max(0, int(row["usage_count"] or 0))


def enforce_guest_interview_quota(request: Request, limit: int = INTERVIEW_SIMULATOR_GUEST_FREE_LIMIT) -> tuple[str, int, int]:
    effective_limit = max(0, int(limit))
    if effective_limit <= 0:
        raise HTTPException(
            status_code=402,
            detail="Guest interview mode is currently disabled. Sign in to continue.",
        )
    fingerprint = interview_simulator_guest_fingerprint(request)
    connection = auth_db_connection()
    try:
        usage_count = fetch_guest_interview_usage_count(connection, fingerprint)
    finally:
        connection.close()
    remaining = max(0, effective_limit - usage_count)
    if usage_count >= effective_limit:
        raise HTTPException(
            status_code=402,
            detail=f"Your free guest interview is already used. Sign in to continue and save all reports to dashboard.",
        )
    return fingerprint, usage_count, remaining


def consume_guest_interview_quota(fingerprint: str, request: Request) -> int:
    normalized_fingerprint = safe_text(fingerprint)
    if not normalized_fingerprint:
        return 0
    now = now_utc_iso()
    source_ip = request_source_ip(request)
    user_agent = safe_text(request.headers.get("user-agent"))[:240]
    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            existing = cursor.execute(
                """
                SELECT id, usage_count
                FROM guest_interview_usage
                WHERE fingerprint = ?
                LIMIT 1
                """,
                (normalized_fingerprint,),
            ).fetchone()
            if existing:
                next_count = max(0, int(existing["usage_count"] or 0)) + 1
                cursor.execute(
                    """
                    UPDATE guest_interview_usage
                    SET usage_count = ?, last_used_at = ?, last_ip = ?, user_agent = ?
                    WHERE id = ?
                    """,
                    (next_count, now, source_ip, user_agent, int(existing["id"])),
                )
            else:
                next_count = 1
                cursor.execute(
                    """
                    INSERT INTO guest_interview_usage (
                        fingerprint,
                        usage_count,
                        first_used_at,
                        last_used_at,
                        last_ip,
                        user_agent
                    )
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (normalized_fingerprint, next_count, now, now, source_ip, user_agent),
                )
            connection.commit()
            return int(next_count)
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


def credit_error(user_row: sqlite3.Row, message: str, status_code: int = 402) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={
            "message": message,
            "wallet": wallet_payload(int(user_row["credits"])),
        },
    )


def debit_credits(user_id: int, action: str, amount: int, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    if FOCUSED_MATCHER_MODE:
        user = fetch_user_by_id(user_id)
        effective_credits = int(user["credits"] or 0) if user else 0
        return {
            "transaction_id": 0,
            "wallet": wallet_payload(effective_credits),
        }
    if public_feature_access_enabled():
        user = fetch_user_by_id(user_id)
        if is_public_access_guest_user(user):
            effective_credits = max(int(user["credits"] or 0), PUBLIC_ACCESS_GUEST_CREDITS) if user else PUBLIC_ACCESS_GUEST_CREDITS
            return {
                "transaction_id": 0,
                "wallet": wallet_payload(effective_credits),
            }
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
    if FOCUSED_MATCHER_MODE:
        user = fetch_user_by_id(user_id)
        effective_credits = int(user["credits"] or 0) if user else 0
        return {
            "transaction_id": 0,
            "wallet": wallet_payload(effective_credits),
        }
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


def runtime_setting_value(setting_key: str, default: Any = None) -> Any:
    normalized_key = safe_text(setting_key)
    if not normalized_key:
        return default
    connection = auth_db_connection()
    try:
        row = connection.execute(
            """
            SELECT value_json
            FROM app_runtime_settings
            WHERE setting_key = ?
            LIMIT 1
            """,
            (normalized_key,),
        ).fetchone()
    finally:
        connection.close()
    if not row:
        return default
    try:
        return json.loads(safe_text(row["value_json"]))
    except Exception:
        return default


def set_runtime_setting_value(setting_key: str, value: Any) -> Any:
    normalized_key = safe_text(setting_key)
    if not normalized_key:
        raise HTTPException(status_code=400, detail="Invalid runtime setting key.")
    encoded_value = json.dumps(value, separators=(",", ":"), sort_keys=True)
    now_iso = now_utc_iso()
    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            existing = cursor.execute(
                """
                SELECT setting_key
                FROM app_runtime_settings
                WHERE setting_key = ?
                LIMIT 1
                """,
                (normalized_key,),
            ).fetchone()
            if existing:
                cursor.execute(
                    """
                    UPDATE app_runtime_settings
                    SET value_json = ?, updated_at = ?
                    WHERE setting_key = ?
                    """,
                    (encoded_value, now_iso, normalized_key),
                )
            else:
                cursor.execute(
                    """
                    INSERT INTO app_runtime_settings (setting_key, value_json, updated_at)
                    VALUES (?, ?, ?)
                    """,
                    (normalized_key, encoded_value, now_iso),
                )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
    return value


def public_feature_access_enabled() -> bool:
    if FOCUSED_MATCHER_MODE:
        return True
    return bool(runtime_setting_value(PUBLIC_ACCESS_RUNTIME_SETTING_KEY, False))


def normalize_public_access_key(value: str | None) -> str:
    normalized = re.sub(r"[^a-z0-9_-]", "", safe_text(value).lower())[:72]
    if len(normalized) >= 8:
        return normalized
    return secrets.token_hex(8)


def public_access_email_for_key(guest_key: str) -> str:
    fingerprint = hashlib.sha256(f"{PUBLIC_ACCESS_GUEST_PREFIX}:{guest_key}:{AUTH_TOKEN_SECRET}".encode("utf-8")).hexdigest()[:24]
    return f"{PUBLIC_ACCESS_GUEST_PREFIX}-{fingerprint}{GUEST_SYSTEM_EMAIL_SUFFIX}"


def is_public_access_guest_email(email: str | None) -> bool:
    normalized = normalize_email(safe_text(email))
    return normalized.startswith(f"{PUBLIC_ACCESS_GUEST_PREFIX}-") and normalized.endswith(GUEST_SYSTEM_EMAIL_SUFFIX)


def is_public_access_guest_user(user_row: sqlite3.Row | None) -> bool:
    if not user_row:
        return False
    return is_public_access_guest_email(str(user_row["email"]))


def is_placeholder_public_access_name(value: str | None) -> bool:
    normalized = re.sub(r"\s+", " ", safe_text(value)).strip().lower()
    if not normalized:
        return True
    if normalized in {"guest access", "guest user"}:
        return True
    return normalized.startswith("guest ")


def sync_public_access_user_name_from_resume(user_row: sqlite3.Row | None, resume_text: str) -> str:
    if not is_public_access_guest_user(user_row):
        return safe_text(str(user_row["full_name"])) if user_row else ""

    current_name = safe_text(str(user_row["full_name"])).strip()
    if current_name and not is_placeholder_public_access_name(current_name):
        return current_name

    lines = [clean_resume_line(line) for line in safe_text(resume_text).replace("\r", "\n").split("\n")]
    inferred_name = safe_text(infer_candidate_name_from_resume_lines(lines)).strip()
    if not inferred_name:
        return current_name
    if is_placeholder_public_access_name(inferred_name) or is_placeholder_candidate_name(inferred_name):
        return current_name

    normalized_name = normalize_optional_profile_name(inferred_name)
    if not normalized_name:
        return current_name

    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            cursor.execute(
                "UPDATE users SET full_name = ? WHERE id = ?",
                (normalized_name, int(user_row["id"])),
            )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    return normalized_name


def get_or_create_public_access_user(guest_key: str, name: str | None = None) -> sqlite3.Row:
    email = public_access_email_for_key(guest_key)
    provided_name = normalize_optional_profile_name(name)
    existing = fetch_user_by_email(email)
    if existing:
        with AUTH_DB_LOCK:
            connection = auth_db_connection()
            try:
                cursor = connection.cursor()
                begin_write_transaction(cursor)
                next_credits = max(int(existing["credits"] or 0), PUBLIC_ACCESS_GUEST_CREDITS)
                next_name = provided_name or safe_text(existing["full_name"]) or "Guest Access"
                cursor.execute(
                    """
                    UPDATE users
                    SET full_name = ?, plan_tier = ?, credits = ?, email_verified = 1
                    WHERE id = ?
                    """,
                    (next_name, PUBLIC_ACCESS_GUEST_PLAN, next_credits, int(existing["id"])),
                )
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            finally:
                connection.close()
        refreshed = fetch_user_by_email(email)
        if refreshed:
            return refreshed
        return existing

    password_salt = secrets.token_hex(16)
    password_hash = hash_password(secrets.token_urlsafe(18), password_salt)
    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            try:
                cursor.execute(
                    """
                    INSERT INTO users (full_name, email, password_hash, password_salt, plan_tier, credits, created_at, email_verified)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
                    """,
                    (
                        provided_name or "Guest Access",
                        email,
                        password_hash,
                        password_salt,
                        PUBLIC_ACCESS_GUEST_PLAN,
                        PUBLIC_ACCESS_GUEST_CREDITS,
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
        raise HTTPException(status_code=500, detail="Unable to create public access session.")
    return user


def normalize_experience_years(value: float | None) -> float | None:
    if value is None:
        return None
    return clamp_float(float(value), 0.0, 35.0)


def normalize_age_years(value: float | None) -> int | None:
    if value is None:
        return None
    return int(round(clamp_float(float(value), 16.0, 70.0)))


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


def extract_text_from_docx_upload(contents: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(contents)) as archive:
            document_xml = archive.read("word/document.xml")
    except (zipfile.BadZipFile, KeyError, RuntimeError, ValueError):
        return ""

    try:
        root = ET.fromstring(document_xml)
    except ET.ParseError:
        return ""

    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    lines: list[str] = []
    for paragraph in root.findall(".//w:p", namespace):
        chunks: list[str] = []
        for text_node in paragraph.findall(".//w:t", namespace):
            value = safe_text(text_node.text)
            if value:
                chunks.append(value)
        merged = "".join(chunks).strip()
        if merged:
            lines.append(merged)
    return "\n".join(lines).strip()


def extract_resume_text_for_analysis(file_name: str, content_type: str | None, contents: bytes) -> str:
    normalized_name = safe_text(file_name).lower()
    normalized_type = safe_text(content_type).lower()

    is_pdf = normalized_name.endswith(".pdf") or normalized_type == "application/pdf"
    is_txt = normalized_name.endswith(".txt") or normalized_type.startswith("text/")
    is_docx = normalized_name.endswith(".docx") or normalized_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    is_image = normalized_type.startswith("image/") or bool(re.search(r"\.(png|jpe?g|webp|gif|bmp|tiff?)$", normalized_name))

    if is_pdf:
        pdf_reader = PyPDF2.PdfReader(io.BytesIO(contents))
        extracted_pages: list[str] = []
        for page in pdf_reader.pages:
            extracted_pages.append(page.extract_text() or "")
        return "\n".join(extracted_pages).strip()

    if is_txt:
        return contents.decode("utf-8", errors="ignore").strip()

    if is_docx:
        extracted_docx = extract_text_from_docx_upload(contents)
        if extracted_docx:
            return extracted_docx
        raise HTTPException(
            status_code=400,
            detail="Could not read enough text from this DOCX file. Export as PDF/TXT and try again.",
        )

    if is_image:
        return extract_text_from_uploaded_image_with_openai(contents, normalized_type, document_kind="resume")

    raise HTTPException(
        status_code=400,
        detail="Unsupported file type for analysis. Upload PDF, DOCX, TXT, or image.",
    )


def extract_text_from_uploaded_image_with_openai(
    contents: bytes,
    content_type: str | None = None,
    document_kind: str = "job description",
) -> str:
    if client is None:
        raise HTTPException(
            status_code=503,
            detail="Image text extraction is unavailable right now. Upload a PDF or paste text instead.",
        )

    normalized_kind = safe_text(document_kind).strip().lower() or "document"
    if "resume" in normalized_kind:
        normalized_kind = "resume"
    elif "job" in normalized_kind or "jd" in normalized_kind:
        normalized_kind = "job description"
    else:
        normalized_kind = "document"

    encoded_image = base64.b64encode(contents).decode("ascii")
    mime_type = safe_text(content_type).lower()
    if not mime_type.startswith("image/"):
        mime_type = "image/png"
    image_data_url = f"data:{mime_type};base64,{encoded_image}"

    prompt = (
        f"Extract only the visible {normalized_kind} text from this image.\n"
        "Return plain text only, no markdown, no code fences."
    )

    models: list[str] = []
    for model in [ANALYZE_LLM_MODEL, OPENAI_MODEL, *OPENAI_FALLBACK_MODELS]:
        cleaned = safe_text(model)
        if cleaned and cleaned not in models:
            models.append(cleaned)

    last_error: str | None = None
    for model in models:
        for attempt in range(2):
            try:
                response = client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": "Return only extracted plain text."},
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": prompt},
                                {"type": "image_url", "image_url": {"url": image_data_url}},
                            ],
                        },
                    ],
                    temperature=0.0,
                )
                content = extract_llm_text(response.choices[0].message.content if response.choices else "")
                cleaned_text = re.sub(r"\n{3,}", "\n\n", content).strip()
                if len(cleaned_text) >= 24:
                    return cleaned_text
                last_error = f"short_extraction_{model}"
            except Exception as exc:
                last_error = f"{type(exc).__name__} on model {model}"
                logger.exception("Image JD extraction failed for model '%s' (attempt %s).", model, attempt + 1)
                if attempt == 0 and is_transient_openai_error(exc):
                    time.sleep(0.25)
                    continue
                break

    logger.warning("Image text extraction failed (%s): %s", normalized_kind, last_error)
    raise HTTPException(
        status_code=400,
        detail=f"Could not read enough {normalized_kind} text from this image. Try a clearer image or upload a PDF.",
    )


def extract_job_description_text_from_upload(file_name: str, content_type: str | None, contents: bytes) -> str:
    normalized_name = safe_text(file_name).lower()
    normalized_type = safe_text(content_type).lower()

    is_pdf = normalized_name.endswith(".pdf") or normalized_type == "application/pdf"
    is_txt = normalized_name.endswith(".txt") or normalized_type.startswith("text/")
    is_image = normalized_type.startswith("image/") or bool(re.search(r"\.(png|jpe?g|webp|gif|bmp|tiff?)$", normalized_name))

    if is_pdf:
        pdf_reader = PyPDF2.PdfReader(io.BytesIO(contents))
        extracted_pages: list[str] = []
        for page in pdf_reader.pages:
            extracted_pages.append(page.extract_text() or "")
        return "\n".join(extracted_pages).strip()

    if is_txt:
        return contents.decode("utf-8", errors="ignore").strip()

    if is_image:
        return extract_text_from_uploaded_image_with_openai(contents, normalized_type, document_kind="job description")

    raise HTTPException(
        status_code=400,
        detail="Unsupported JD file type. Upload a PDF, TXT, or image.",
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


def request_source_ip(request: Request) -> str:
    forwarded_for = safe_text(request.headers.get("x-forwarded-for"))
    if forwarded_for:
        first_ip = safe_text(forwarded_for.split(",")[0]).strip()
        if first_ip:
            return first_ip[:80]
    x_real_ip = safe_text(request.headers.get("x-real-ip"))
    if x_real_ip:
        return x_real_ip[:80]
    if request.client and request.client.host:
        return safe_text(request.client.host)[:80] or "unknown"
    return "unknown"


def public_instant_client_key(request: Request, session_id: str | None = None) -> str:
    source_ip = request_source_ip(request)
    session_key = normalize_session_id(session_id)[:120]
    user_agent = safe_text(request.headers.get("user-agent"))[:160]
    fingerprint = f"{source_ip}|{session_key}|{user_agent}"
    return hashlib.sha256(fingerprint.encode("utf-8", errors="ignore")).hexdigest()[:36]


def cleanup_public_instant_stores(now_ts: float) -> None:
    request_expiry = now_ts - max(PUBLIC_INSTANT_REQUEST_WINDOW_SECONDS * 4, 4 * 60 * 60)
    result_expiry = now_ts - PUBLIC_INSTANT_RESULT_TTL_SECONDS
    share_expiry = now_ts - PUBLIC_INSTANT_SHARE_TTL_SECONDS

    stale_request_keys = [key for key, value in PUBLIC_INSTANT_REQUEST_STATE.items() if float(value.get("last_seen") or 0) < request_expiry]
    for key in stale_request_keys:
        PUBLIC_INSTANT_REQUEST_STATE.pop(key, None)

    stale_result_keys = [key for key, value in PUBLIC_INSTANT_RESULT_STORE.items() if float(value.get("created_at_ts") or 0) < result_expiry]
    for key in stale_result_keys:
        PUBLIC_INSTANT_RESULT_STORE.pop(key, None)

    stale_share_keys = [key for key, value in PUBLIC_INSTANT_SHARE_STORE.items() if float(value.get("created_at_ts") or 0) < share_expiry]
    for key in stale_share_keys:
        PUBLIC_INSTANT_SHARE_STORE.pop(key, None)


def consume_public_instant_quota(request: Request, session_id: str | None, action: str) -> tuple[str, int, int]:
    if action not in {"analyze", "extract"}:
        raise HTTPException(status_code=400, detail="Invalid public action.")

    action_limit = PUBLIC_INSTANT_REQUEST_LIMIT if action == "analyze" else PUBLIC_INSTANT_UPLOAD_LIMIT
    action_key = f"{action}:{public_instant_client_key(request, session_id)}"
    now_ts = time.time()

    with PUBLIC_INSTANT_LOCK:
        cleanup_public_instant_stores(now_ts)
        usage_state = PUBLIC_INSTANT_REQUEST_STATE.get(action_key)
        if not usage_state or now_ts - float(usage_state.get("window_started") or 0) >= PUBLIC_INSTANT_REQUEST_WINDOW_SECONDS:
            usage_state = {
                "window_started": now_ts,
                "count": 0,
                "last_seen": now_ts,
            }
        current_count = int(usage_state.get("count") or 0)
        if current_count >= action_limit:
            raise HTTPException(
                status_code=429,
                detail=(
                    "Too many requests right now. "
                    f"You can run up to {action_limit} public {action} request(s) every "
                    f"{max(1, int(PUBLIC_INSTANT_REQUEST_WINDOW_SECONDS / 60))} minutes."
                ),
            )

        updated_count = current_count + 1
        usage_state["count"] = updated_count
        usage_state["last_seen"] = now_ts
        PUBLIC_INSTANT_REQUEST_STATE[action_key] = usage_state

    remaining = max(0, action_limit - updated_count)
    return action_key, updated_count, remaining


def build_public_instant_fit_result(payload: dict[str, Any], role: str, industry: str) -> dict[str, Any]:
    raw_match = float(payload.get("match_percentage") or payload.get("match_score") or 0.0)
    match_percentage = int(round(clamp_float(raw_match, 0.0, 100.0)))
    matched_skills = dedupe_text_list(payload.get("matched_skills") or payload.get("matched_keywords") or [], limit=14, max_item_len=90)
    missing_skills = dedupe_text_list(payload.get("missing_skills") or payload.get("missing_keywords") or [], limit=16, max_item_len=90)
    feedback = dedupe_text_list(payload.get("feedback") or [payload.get("alignment_summary")], limit=5, max_item_len=200)
    improvements = dedupe_text_list(payload.get("improvements") or payload.get("suggested_bullets") or [], limit=5, max_item_len=200)
    next_steps = dedupe_text_list(payload.get("next_steps") or [], limit=4, max_item_len=200)
    skill_breakdown = payload.get("skill_breakdown") if isinstance(payload.get("skill_breakdown"), dict) else {}
    jd_relevance = payload.get("jd_relevance") if isinstance(payload.get("jd_relevance"), dict) else {}
    ai_meta = jd_relevance.get("ai") if isinstance(jd_relevance.get("ai"), dict) else {}

    metrics = {
        "match_percentage": match_percentage,
        "jd_relevance": int(clamp_float(float(jd_relevance.get("score") or 0), 0.0, 100.0)),
        "must_have_coverage": int(clamp_float(float(skill_breakdown.get("must_have_coverage") or 0), 0.0, 100.0)),
        "good_to_have_coverage": int(clamp_float(float(skill_breakdown.get("good_to_have_coverage") or 0), 0.0, 100.0)),
        "critical_coverage": int(clamp_float(float(payload.get("critical_coverage") or 0), 0.0, 100.0)),
    }

    return {
        "role": safe_text(role) or "Target role",
        "industry": safe_text(industry) or "General",
        "match_percentage": metrics["match_percentage"],
        "alignment_summary": safe_text(payload.get("alignment_summary")) or "Role-fit summary generated.",
        "metrics": metrics,
        "matched_skills": matched_skills,
        "missing_skills": missing_skills,
        "feedback": feedback,
        "improvements": improvements,
        "next_steps": next_steps,
        "jd_relevance": {
            "score": metrics["jd_relevance"],
            "verdict": safe_text(jd_relevance.get("verdict")) or "moderate_relevance",
            "detected_jd_track": safe_text(jd_relevance.get("detected_jd_track")) or "general",
            "is_field_mismatch": bool(jd_relevance.get("is_field_mismatch")),
            "reasoning": dedupe_text_list(jd_relevance.get("reasoning") or [], limit=4, max_item_len=180),
        },
        "skill_breakdown": {
            "must_have_coverage": metrics["must_have_coverage"],
            "good_to_have_coverage": metrics["good_to_have_coverage"],
            "gap_severity": safe_text(skill_breakdown.get("gap_severity")) or "medium",
        },
        "ai": {
            "used": bool(ai_meta.get("used")),
            "model": safe_text(ai_meta.get("model")) or None,
            "blend": clamp_float(float(ai_meta.get("blend") or 0.0), 0.0, 1.0),
            "mode": "hybrid_llm_plus_rules" if bool(ai_meta.get("used")) else "rules_only",
            "reason": safe_text(ai_meta.get("reason")) or "",
        },
    }


def usage_bucket(plan: str, session_id: str) -> dict[str, int]:
    key = f"{usage_window_key()}::{plan}::{session_id}"
    if key not in USAGE_TRACKER:
        USAGE_TRACKER[key] = {
            "analyze_used": 0,
            "jd_match_used": 0,
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
            "jd_match_used": usage["jd_match_used"],
            "suggest_used": usage["suggest_used"],
            "generation_used": usage["generation_used"],
            "pdf_polish_used": usage["pdf_polish_used"],
        },
        "limits": {
            "analyze_limit": rules["analyze_limit"],
            "jd_match_limit": rules["jd_match_limit"],
            "suggest_limit": rules["suggest_limit"],
            "generation_limit": rules["generation_limit"],
            "pdf_polish_limit": rules["pdf_polish_limit"],
        },
        "features": {
            "allowed_templates": rules["allowed_templates"],
            "can_upload_pdf": rules["can_upload_pdf"],
            "can_ai_enhance": rules["can_ai_enhance"],
            "can_jd_match": rules["can_jd_match"],
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
    elif action == "jd_match":
        if not rules["can_jd_match"]:
            raise quota_error(
                f"JD Match is not available on the {plan.title()} plan. Upgrade to unlock this feature.",
                plan,
                session_id,
                403,
            )
        if usage["jd_match_used"] >= rules["jd_match_limit"]:
            raise quota_error(
                f"{plan.title()} plan JD match limit reached for today. Upgrade for more JD matching runs.",
                plan,
                session_id,
                429,
            )
        usage["jd_match_used"] += 1
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

    if action == "analyze" and usage["analyze_used"] > 0:
        usage["analyze_used"] -= 1
    elif action == "jd_match" and usage["jd_match_used"] > 0:
        usage["jd_match_used"] -= 1
    elif action == "suggest" and usage["suggest_used"] > 0:
        usage["suggest_used"] -= 1
    elif action == "generation" and usage["generation_used"] > 0:
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


def looks_like_skill_fragment(value: str) -> bool:
    cleaned = re.sub(r"\s+", " ", safe_text(value).strip(" ,.;:-")).strip()
    if not cleaned:
        return False
    lowered = cleaned.lower()
    if "[" in lowered or "]" in lowered:
        return False
    if len(cleaned) < 2 or len(cleaned) > 48:
        return False
    if re.search(r"[.!?]", cleaned):
        return False

    words = [word for word in re.findall(r"[a-zA-Z0-9+#./-]+", cleaned) if word]
    if not words or len(words) > 5:
        return False

    if lowered in {"competencies", "market conditions", "industry conditions", "company name"}:
        return False

    blocked_fragments = (
        "your company",
        "looking to hire",
        "forward thinking",
        "developed a reputation",
        "consistently delivering",
        "based in ",
        "high performing sales team",
        "staying informed",
    )
    if any(fragment in lowered for fragment in blocked_fragments):
        return False

    narrative_tokens = {
        "company",
        "looking",
        "hire",
        "based",
        "promises",
        "team",
        "candidate",
        "responsibilities",
        "requirements",
    }
    if len(words) >= 4 and any(normalize_token(word) in narrative_tokens for word in words):
        return False

    alpha_chars = sum(1 for char in cleaned if char.isalpha())
    if alpha_chars < max(2, int(len(cleaned) * 0.45)):
        return False
    return True


def extract_skills_from_text(skills_text: str) -> list[str]:
    raw_parts = [part.strip() for part in re.split(r"[,\n;/|]+", skills_text) if part.strip()]
    normalized: set[str] = set()

    for part in raw_parts:
        if not looks_like_skill_fragment(part):
            continue
        token = normalize_token(part)
        if token and looks_like_skill_fragment(token):
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

    filtered = sorted(token for token in normalized if looks_like_skill_fragment(token))
    return filtered


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


def infer_career_stage(age_years: int | None) -> str:
    if age_years is None:
        return "unspecified"
    if age_years <= 21:
        return "early_explorer"
    if age_years <= 27:
        return "launch_phase"
    if age_years <= 35:
        return "growth_phase"
    if age_years <= 45:
        return "leadership_phase"
    return "senior_transition"


def expected_experience_range_for_age(age_years: int) -> tuple[float, float]:
    if age_years <= 21:
        return (0.0, 2.0)
    if age_years <= 24:
        return (0.5, 4.0)
    if age_years <= 29:
        return (2.0, 7.0)
    if age_years <= 35:
        return (4.0, 12.0)
    if age_years <= 45:
        return (7.0, 20.0)
    return (10.0, 28.0)


def build_age_factor(
    age_years: int | None,
    experience_years: float | None,
    seniority: str,
    role: str,
) -> dict[str, Any]:
    if age_years is None:
        return {
            "score_delta": 0,
            "confidence_delta": 0,
            "opinions": [],
            "career_stage": "unspecified",
            "expected_experience_years": None,
        }

    stage = infer_career_stage(age_years)
    stage_label = {
        "early_explorer": "early-career exploration stage",
        "launch_phase": "career launch stage",
        "growth_phase": "career growth stage",
        "leadership_phase": "leadership-growth stage",
        "senior_transition": "senior transition stage",
    }.get(stage, "career stage")

    expected_low, expected_high = expected_experience_range_for_age(age_years)
    normalized_exp = normalize_experience_years(experience_years)
    score_delta = 0
    confidence_delta = 0
    opinions: list[str] = [
        f"Age context ({age_years}) suggests a {stage_label}; tailor proof stories to this stage for stronger recruiter trust."
    ]

    if normalized_exp is not None:
        if normalized_exp < max(0.0, expected_low - 1.5):
            score_delta -= 2
            confidence_delta -= 4
            opinions.append("Experience appears early for this age/role target mix. Add stronger project depth and measurable outcomes.")
        elif normalized_exp > expected_high + 3.0:
            confidence_delta -= 2
            opinions.append("Profile may look overqualified for some openings. Target roles with higher ownership scope.")
        else:
            score_delta += 1
            confidence_delta += 1
            opinions.append("Age and experience look broadly aligned, which improves fit confidence.")

    role_text = safe_text(role).lower()
    leadership_role = any(token in role_text for token in ["head", "director", "vp", "vice president", "principal", "lead"])
    if leadership_role and normalized_exp is not None and normalized_exp < 6:
        score_delta -= 2
        confidence_delta -= 3
        opinions.append("Leadership titles usually need stronger team-level ownership proof. Highlight planning and decision impact.")

    if seniority == "senior" and normalized_exp is not None and normalized_exp < 5:
        score_delta -= 1
        confidence_delta -= 2
    if seniority == "junior" and normalized_exp is not None and normalized_exp > 9:
        confidence_delta -= 1
        opinions.append("For junior role targets, make your transition narrative explicit to avoid level-mismatch screening.")

    return {
        "score_delta": int(clamp_float(float(score_delta), -4.0, 3.0)),
        "confidence_delta": int(clamp_float(float(confidence_delta), -6.0, 3.0)),
        "opinions": dedupe_preserve_order(opinions)[:3],
        "career_stage": stage,
        "expected_experience_years": {"low": round(expected_low, 1), "high": round(expected_high, 1)},
    }


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
    age_years: float | None = None,
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
    normalized_age_years = normalize_age_years(age_years)
    age_factor = build_age_factor(normalized_age_years, experience_years, seniority, role)
    overall_score = clamp(raw_overall - strictness_penalty + age_factor["score_delta"])

    # Prevent extreme floor effects for valid role/skill signals on short early-career profiles.
    if skills_list and role_track != "custom":
        if profile_details["listed_count"] >= 3:
            overall_score = max(overall_score, 14)
        if skill_match_score >= 16:
            overall_score = max(overall_score, 20)
        if critical_coverage >= 34:
            overall_score = max(overall_score, 24)

    confidence = confidence_by_seniority(seniority, profile_details["listed_count"], critical_coverage)
    confidence = clamp(
        confidence
        + min(8, consistency_score * 0.08)
        - min(10, len(critical_missing) * 2.3)
        + int(age_factor["confidence_delta"])
    )
    confidence = min(96, confidence)
    prediction_band = build_prediction_band(overall_score, confidence)

    prediction_reasoning = [
        f"Critical-skill coverage is {critical_coverage}% for your target role intent.",
        f"Role blueprint coverage is {coverage_score}% and keyword alignment is {skill_match_score}%.",
        f"Consistency score is {consistency_score}%; profile quality signal is {profile_score}%.",
    ]
    if age_factor["opinions"]:
        prediction_reasoning.append(age_factor["opinions"][0])
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
    if age_factor["opinions"]:
        quick_wins = dedupe_preserve_order([*quick_wins, *age_factor["opinions"]])[:5]

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
        "age_years_used": normalized_age_years,
        "age_opinions": age_factor["opinions"],
        "career_stage": age_factor["career_stage"],
        "experience_expectation_years": age_factor["expected_experience_years"],
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


def parse_llm_json_payload(content: str) -> dict[str, Any] | None:
    text = safe_text(content)
    if not text:
        return None

    candidates = [text]
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, flags=re.DOTALL | re.IGNORECASE)
    if fenced:
        candidates.insert(0, fenced.group(1).strip())
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        candidates.insert(0, text[start : end + 1].strip())

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except Exception:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def normalize_string_list(value: Any, limit: int = 6, max_item_len: int = 140) -> list[str]:
    if isinstance(value, str):
        raw_items = [item.strip() for item in re.split(r"[\n,;]+", value) if item.strip()]
    elif isinstance(value, list):
        raw_items = [safe_text(str(item)) for item in value if safe_text(str(item))]
    else:
        raw_items = []
    normalized: list[str] = []
    for item in raw_items:
        clipped = item[:max_item_len]
        if clipped and clipped not in normalized:
            normalized.append(clipped)
        if len(normalized) >= limit:
            break
    return normalized


def safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except Exception:
        return int(default)


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return float(default)


def normalize_counter_key(value: str) -> str:
    return re.sub(r"\s+", " ", safe_text(value)).strip()


def parse_counter_json(raw_value: Any) -> dict[str, int]:
    if isinstance(raw_value, dict):
        parsed = raw_value
    else:
        parsed = parse_meta_json(raw_value)
        if not isinstance(parsed, dict):
            return {}
    counters: dict[str, int] = {}
    for key, value in parsed.items():
        normalized_key = normalize_counter_key(str(key))
        if not normalized_key:
            continue
        count = max(0, safe_int(value, 0))
        if count > 0:
            counters[normalized_key] = count
    return counters


def upsert_counter_phrase(counter: dict[str, int], phrase: str, delta: int = 1) -> None:
    text = normalize_counter_key(phrase)
    if not text:
        return
    normalized = normalize_search_text(text)
    if not normalized:
        return
    existing_key = next((key for key in counter if normalize_search_text(key) == normalized), None)
    if existing_key:
        counter[existing_key] = max(0, safe_int(counter.get(existing_key), 0) + max(1, delta))
        return
    counter[text[:120]] = max(1, delta)


def top_counter_phrases(counter: dict[str, int], limit: int = 6, max_chars: int = 120) -> list[str]:
    ordered = sorted(counter.items(), key=lambda item: (-safe_int(item[1], 0), len(item[0]), item[0].lower()))
    result: list[str] = []
    for phrase, _count in ordered:
        cleaned = safe_text(phrase)[:max_chars]
        if cleaned and cleaned not in result:
            result.append(cleaned)
        if len(result) >= limit:
            break
    return result


def build_learning_bucket(industry: str, role: str, role_track: str) -> dict[str, str]:
    role_token = normalize_search_text(role)[:96]
    industry_token = normalize_search_text(industry)[:96]
    track_token = normalize_search_text(role_track)[:48] or "general"
    seed = f"{track_token}|{industry_token}|{role_token}"
    digest = hashlib.sha1(seed.encode("utf-8")).hexdigest()[:20]
    return {
        "bucket_key": f"{track_token}:{digest}",
        "industry": industry_token,
        "role": role_token,
        "role_track": track_token,
    }


def build_semantic_cache_key(
    industry: str,
    role: str,
    skills_text: str,
    experience_years: float | None,
    age_years: float | None,
) -> str:
    normalized_skills = sorted(tokenize_keywords(safe_text(skills_text)))
    if not normalized_skills:
        fallback = normalize_search_text(skills_text)
        normalized_skills = fallback.split(" ")[:120] if fallback else []
    payload = {
        "industry": normalize_search_text(industry)[:80],
        "role": normalize_search_text(role)[:80],
        "experience_years": None if experience_years is None else round(float(experience_years), 1),
        "age_years": None if age_years is None else round(float(age_years), 1),
        "skills": normalized_skills[:120],
    }
    return hashlib.sha256(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")).hexdigest()


def default_learning_memory(bucket: dict[str, str]) -> dict[str, Any]:
    return {
        "bucket_key": safe_text(bucket.get("bucket_key")),
        "industry": safe_text(bucket.get("industry")),
        "role": safe_text(bucket.get("role")),
        "role_track": safe_text(bucket.get("role_track")),
        "sample_count": 0,
        "feedback_count": 0,
        "avg_feedback_rating": 0.0,
        "avg_overall_score": 0.0,
        "avg_confidence": 0.0,
        "positive_feedback_count": 0,
        "negative_feedback_count": 0,
        "quick_win_counts": {},
        "missing_skill_counts": {},
        "model_success": {},
    }


def fetch_learning_memory(bucket: dict[str, str]) -> dict[str, Any]:
    if not ANALYZE_SELF_LEARNING_ENABLED:
        return default_learning_memory(bucket)

    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            row = connection.execute(
                """
                SELECT bucket_key, industry, role, role_track, sample_count, feedback_count, avg_feedback_rating,
                       avg_overall_score, avg_confidence, positive_feedback_count, negative_feedback_count,
                       quick_win_counts_json, missing_skill_counts_json, model_success_json
                FROM analysis_learning_memory
                WHERE bucket_key = ?
                LIMIT 1
                """,
                (safe_text(bucket.get("bucket_key")),),
            ).fetchone()
        finally:
            connection.close()

    memory = default_learning_memory(bucket)
    if not row:
        return memory

    memory["sample_count"] = max(0, safe_int(row["sample_count"], 0))
    memory["feedback_count"] = max(0, safe_int(row["feedback_count"], 0))
    memory["avg_feedback_rating"] = round(clamp_float(safe_float(row["avg_feedback_rating"], 0.0), 0.0, 5.0), 3)
    memory["avg_overall_score"] = round(clamp_float(safe_float(row["avg_overall_score"], 0.0), 0.0, 100.0), 3)
    memory["avg_confidence"] = round(clamp_float(safe_float(row["avg_confidence"], 0.0), 0.0, 100.0), 3)
    memory["positive_feedback_count"] = max(0, safe_int(row["positive_feedback_count"], 0))
    memory["negative_feedback_count"] = max(0, safe_int(row["negative_feedback_count"], 0))
    memory["quick_win_counts"] = parse_counter_json(row["quick_win_counts_json"])
    memory["missing_skill_counts"] = parse_counter_json(row["missing_skill_counts_json"])
    parsed_model_success = parse_meta_json(row["model_success_json"])
    memory["model_success"] = parsed_model_success if isinstance(parsed_model_success, dict) else {}
    return memory


def persist_learning_memory(
    bucket: dict[str, str],
    analysis: dict[str, Any] | None = None,
    semantic_model: str | None = None,
    ai_used: bool | None = None,
    cache_hit: bool = False,
    feedback_rating: int | None = None,
) -> None:
    if not ANALYZE_SELF_LEARNING_ENABLED:
        return

    memory = fetch_learning_memory(bucket)
    sample_count = max(0, safe_int(memory.get("sample_count"), 0))
    feedback_count = max(0, safe_int(memory.get("feedback_count"), 0))
    avg_feedback = clamp_float(safe_float(memory.get("avg_feedback_rating"), 0.0), 0.0, 5.0)
    avg_overall = clamp_float(safe_float(memory.get("avg_overall_score"), 0.0), 0.0, 100.0)
    avg_conf = clamp_float(safe_float(memory.get("avg_confidence"), 0.0), 0.0, 100.0)
    positive_feedback_count = max(0, safe_int(memory.get("positive_feedback_count"), 0))
    negative_feedback_count = max(0, safe_int(memory.get("negative_feedback_count"), 0))
    quick_win_counts = parse_counter_json(memory.get("quick_win_counts"))
    missing_skill_counts = parse_counter_json(memory.get("missing_skill_counts"))
    model_success = memory.get("model_success")
    if not isinstance(model_success, dict):
        model_success = {}

    if analysis is not None:
        current_overall = clamp_float(safe_float(analysis.get("overall_score"), 0.0), 0.0, 100.0)
        current_conf = clamp_float(safe_float(analysis.get("confidence"), 0.0), 0.0, 100.0)
        next_sample_count = sample_count + 1
        if next_sample_count > 0:
            avg_overall = ((avg_overall * sample_count) + current_overall) / next_sample_count
            avg_conf = ((avg_conf * sample_count) + current_conf) / next_sample_count
        sample_count = next_sample_count

        for quick_win in normalize_string_list((analysis.get("quick_wins") or []), limit=7, max_item_len=120):
            upsert_counter_phrase(quick_win_counts, quick_win, delta=1)
        for skill in normalize_string_list((analysis.get("critical_missing_skills") or []), limit=10, max_item_len=80):
            upsert_counter_phrase(missing_skill_counts, skill, delta=1)

        model_key = safe_text(semantic_model)
        if ai_used and model_key:
            existing_entry = model_success.get(model_key)
            if not isinstance(existing_entry, dict):
                existing_entry = {}
            existing_entry["calls"] = max(0, safe_int(existing_entry.get("calls"), 0) + 1)
            existing_entry["cache_hits"] = max(0, safe_int(existing_entry.get("cache_hits"), 0) + (1 if cache_hit else 0))
            model_success[model_key] = existing_entry

    if feedback_rating is not None:
        rating = int(clamp_float(float(feedback_rating), 1.0, 5.0))
        next_feedback_count = feedback_count + 1
        if next_feedback_count > 0:
            avg_feedback = ((avg_feedback * feedback_count) + rating) / next_feedback_count
        feedback_count = next_feedback_count
        if rating >= 4:
            positive_feedback_count += 1
        elif rating <= 2:
            negative_feedback_count += 1

    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            existing = cursor.execute(
                "SELECT bucket_key FROM analysis_learning_memory WHERE bucket_key = ? LIMIT 1",
                (safe_text(bucket.get("bucket_key")),),
            ).fetchone()
            payload = (
                safe_text(bucket.get("industry")),
                safe_text(bucket.get("role")),
                safe_text(bucket.get("role_track")),
                int(sample_count),
                int(feedback_count),
                round(avg_feedback, 4),
                round(avg_overall, 4),
                round(avg_conf, 4),
                int(positive_feedback_count),
                int(negative_feedback_count),
                json.dumps(quick_win_counts, separators=(",", ":"), sort_keys=True),
                json.dumps(missing_skill_counts, separators=(",", ":"), sort_keys=True),
                json.dumps(model_success, separators=(",", ":"), sort_keys=True),
                now_utc_iso(),
                safe_text(bucket.get("bucket_key")),
            )
            if existing:
                cursor.execute(
                    """
                    UPDATE analysis_learning_memory
                    SET industry = ?,
                        role = ?,
                        role_track = ?,
                        sample_count = ?,
                        feedback_count = ?,
                        avg_feedback_rating = ?,
                        avg_overall_score = ?,
                        avg_confidence = ?,
                        positive_feedback_count = ?,
                        negative_feedback_count = ?,
                        quick_win_counts_json = ?,
                        missing_skill_counts_json = ?,
                        model_success_json = ?,
                        updated_at = ?
                    WHERE bucket_key = ?
                    """,
                    payload,
                )
            else:
                cursor.execute(
                    """
                    INSERT INTO analysis_learning_memory (
                        industry, role, role_track, sample_count, feedback_count, avg_feedback_rating,
                        avg_overall_score, avg_confidence, positive_feedback_count, negative_feedback_count,
                        quick_win_counts_json, missing_skill_counts_json, model_success_json, updated_at, bucket_key
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    payload,
                )
            connection.commit()
        except Exception:
            connection.rollback()
            logger.exception("Failed to persist analysis learning memory for bucket '%s'.", safe_text(bucket.get("bucket_key")))
        finally:
            connection.close()


def fetch_cached_semantic_overlay(cache_key: str) -> tuple[dict[str, Any] | None, str | None]:
    if not ANALYZE_CACHE_ENABLED:
        return None, None
    cache_token = safe_text(cache_key)
    if not cache_token:
        return None, None

    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            row = connection.execute(
                """
                SELECT cache_key, payload_json, model, updated_at
                FROM analysis_semantic_cache
                WHERE cache_key = ?
                LIMIT 1
                """,
                (cache_token,),
            ).fetchone()
            if not row:
                return None, None

            updated_at = parse_iso_datetime(safe_text(row["updated_at"]))
            age_seconds = max(0.0, (datetime.now(timezone.utc) - updated_at).total_seconds())
            if age_seconds > (ANALYZE_CACHE_TTL_HOURS * 3600.0):
                return None, None

            payload = parse_meta_json(row["payload_json"])
            if not isinstance(payload, dict):
                return None, None

            cursor = connection.cursor()
            begin_write_transaction(cursor)
            cursor.execute(
                """
                UPDATE analysis_semantic_cache
                SET usage_count = COALESCE(usage_count, 0) + 1,
                    last_used_at = ?,
                    updated_at = ?
                WHERE cache_key = ?
                """,
                (now_utc_iso(), now_utc_iso(), cache_token),
            )
            connection.commit()
            return payload, safe_text(row["model"]) or None
        except Exception:
            connection.rollback()
            logger.exception("Failed to read semantic cache entry.")
            return None, None
        finally:
            connection.close()


def save_cached_semantic_overlay(
    cache_key: str,
    industry: str,
    role: str,
    role_track: str,
    semantic_payload: dict[str, Any],
    model: str | None,
) -> None:
    if not ANALYZE_CACHE_ENABLED:
        return
    cache_token = safe_text(cache_key)
    if not cache_token or not isinstance(semantic_payload, dict):
        return

    serialized = json.dumps(semantic_payload, separators=(",", ":"), ensure_ascii=False, sort_keys=True, default=str)
    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            existing = cursor.execute(
                "SELECT id FROM analysis_semantic_cache WHERE cache_key = ? LIMIT 1",
                (cache_token,),
            ).fetchone()
            if existing:
                cursor.execute(
                    """
                    UPDATE analysis_semantic_cache
                    SET industry = ?,
                        role = ?,
                        role_track = ?,
                        payload_json = ?,
                        model = ?,
                        updated_at = ?
                    WHERE cache_key = ?
                    """,
                    (
                        normalize_search_text(industry)[:96],
                        normalize_search_text(role)[:96],
                        normalize_search_text(role_track)[:48],
                        serialized,
                        safe_text(model),
                        now_utc_iso(),
                        cache_token,
                    ),
                )
            else:
                cursor.execute(
                    """
                    INSERT INTO analysis_semantic_cache (
                        cache_key, industry, role, role_track, payload_json, model, usage_count, created_at, updated_at, last_used_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        cache_token,
                        normalize_search_text(industry)[:96],
                        normalize_search_text(role)[:96],
                        normalize_search_text(role_track)[:48],
                        serialized,
                        safe_text(model),
                        0,
                        now_utc_iso(),
                        now_utc_iso(),
                        None,
                    ),
                )
            connection.commit()
        except Exception:
            connection.rollback()
            logger.exception("Failed to store semantic cache entry.")
        finally:
            connection.close()


def build_memory_prompt_context(memory: dict[str, Any]) -> dict[str, Any]:
    return {
        "top_quick_wins": top_counter_phrases(parse_counter_json(memory.get("quick_win_counts")), limit=4, max_chars=110),
        "top_missing_skills": top_counter_phrases(parse_counter_json(memory.get("missing_skill_counts")), limit=5, max_chars=80),
        "feedback_count": max(0, safe_int(memory.get("feedback_count"), 0)),
        "avg_feedback_rating": round(clamp_float(safe_float(memory.get("avg_feedback_rating"), 0.0), 0.0, 5.0), 2),
    }


def apply_learning_memory_overlay(base: dict[str, Any], memory: dict[str, Any], max_items: int = 3) -> None:
    learned_quick_wins = top_counter_phrases(parse_counter_json(memory.get("quick_win_counts")), limit=max_items, max_chars=110)
    if learned_quick_wins:
        base["quick_wins"] = dedupe_preserve_order([*learned_quick_wins, *(base.get("quick_wins") or [])])[:7]
    learned_missing = top_counter_phrases(parse_counter_json(memory.get("missing_skill_counts")), limit=max_items, max_chars=64)
    if learned_missing:
        base["critical_missing_skills"] = dedupe_preserve_order([*(base.get("critical_missing_skills") or []), *learned_missing])[:10]


def choose_hybrid_routing(base_analysis: dict[str, Any], skills_text: str, memory: dict[str, Any]) -> dict[str, Any]:
    base_confidence = clamp_float(safe_float(base_analysis.get("confidence"), 0), 0.0, 100.0)
    base_overall = clamp_float(safe_float(base_analysis.get("overall_score"), 0), 0.0, 100.0)
    critical_missing_count = len(base_analysis.get("critical_missing_skills") or [])
    unique_skills = max(0, safe_int((base_analysis.get("precision_diagnostics") or {}).get("unique_skills"), 0))
    feedback_count = max(0, safe_int(memory.get("feedback_count"), 0))
    avg_feedback = clamp_float(safe_float(memory.get("avg_feedback_rating"), 0.0), 0.0, 5.0)
    negative_feedback_count = max(0, safe_int(memory.get("negative_feedback_count"), 0))

    complexity = 38.0
    if base_confidence < 72:
        complexity += 16
    if base_confidence < 58:
        complexity += 11
    if base_overall < 58:
        complexity += 10
    if critical_missing_count >= 5:
        complexity += 8
    if critical_missing_count >= 8:
        complexity += 8
    if len(safe_text(skills_text)) > 2200:
        complexity += 7
    if unique_skills <= 6:
        complexity += 7
    if feedback_count >= ANALYZE_MEMORY_MIN_FEEDBACK and avg_feedback >= 4.3:
        complexity -= 10
    if negative_feedback_count >= 2:
        complexity += 12
    complexity = clamp_float(complexity, 0.0, 100.0)

    if not ANALYZE_SMART_ROUTING_ENABLED:
        return {
            "strategy": "llm",
            "complexity": int(round(complexity)),
            "reason": "smart_routing_disabled",
            "preferred_models": [ANALYZE_LLM_MODEL, OPENAI_MODEL, *OPENAI_FALLBACK_MODELS],
        }

    memory_only = (
        ANALYZE_MEMORY_ROUTE_ENABLED
        and feedback_count >= ANALYZE_MEMORY_MIN_FEEDBACK
        and avg_feedback >= 4.25
        and negative_feedback_count <= 1
        and base_confidence >= 88
        and base_overall >= 80
        and complexity <= 30
    )
    if memory_only:
        return {
            "strategy": "memory_only",
            "complexity": int(round(complexity)),
            "reason": "high_confidence_role_memory",
            "preferred_models": [],
        }

    preferred: list[str] = []
    if complexity >= 65:
        preferred.extend([ANALYZE_LLM_HIGH_MODEL, ANALYZE_LLM_MODEL, OPENAI_MODEL, *OPENAI_FALLBACK_MODELS])
    elif complexity <= 35:
        preferred.extend([ANALYZE_LLM_LOW_MODEL, ANALYZE_LLM_MODEL, OPENAI_MODEL, *OPENAI_FALLBACK_MODELS])
    else:
        preferred.extend([ANALYZE_LLM_MODEL, OPENAI_MODEL, *OPENAI_FALLBACK_MODELS, ANALYZE_LLM_HIGH_MODEL])

    seen_models: set[str] = set()
    preferred_models: list[str] = []
    for model in preferred:
        candidate = safe_text(model)
        if candidate and candidate not in seen_models:
            seen_models.add(candidate)
            preferred_models.append(candidate)

    return {
        "strategy": "llm",
        "complexity": int(round(complexity)),
        "reason": "dynamic_model_routing",
        "preferred_models": preferred_models,
    }


def apply_feedback_learning_signal(user_id: int, rating: int) -> None:
    if not ANALYZE_SELF_LEARNING_ENABLED or user_id <= 0:
        return
    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            row = connection.execute(
                """
                SELECT industry, role, report_json
                FROM analysis_reports
                WHERE user_id = ?
                ORDER BY id DESC
                LIMIT 1
                """,
                (int(user_id),),
            ).fetchone()
        finally:
            connection.close()
    if not row:
        return

    parsed_payload = parse_meta_json(row["report_json"])
    role_track = safe_text(str(parsed_payload.get("role_track", ""))) or infer_role_track(safe_text(row["role"]), safe_text(row["industry"]))
    bucket = build_learning_bucket(safe_text(row["industry"]), safe_text(row["role"]), role_track)
    persist_learning_memory(bucket=bucket, analysis=None, feedback_rating=int(clamp_float(float(rating), 1.0, 5.0)))


def request_semantic_analysis_overlay(
    industry: str,
    role: str,
    skills_text: str,
    base_analysis: dict[str, Any],
    experience_years: float | None = None,
    age_years: float | None = None,
    preferred_models: list[str] | None = None,
    memory_context: dict[str, Any] | None = None,
) -> tuple[dict[str, Any] | None, str | None, str | None]:
    if client is None:
        return None, None, "OPENAI_API_KEY not configured"

    models: list[str] = []
    for model in [*(preferred_models or []), ANALYZE_LLM_MODEL, OPENAI_MODEL, *OPENAI_FALLBACK_MODELS]:
        cleaned = safe_text(model)
        if cleaned and cleaned not in models:
            models.append(cleaned)

    memory_section = ""
    if memory_context:
        memory_section = (
            f"\nHistorical memory (use as weak priors, not absolute rules):\n"
            f"- Avg feedback rating: {safe_float(memory_context.get('avg_feedback_rating'), 0.0):.2f} "
            f"from {safe_int(memory_context.get('feedback_count'), 0)} feedback events\n"
            f"- Frequent quick wins: {json.dumps(memory_context.get('top_quick_wins') or [], ensure_ascii=False)}\n"
            f"- Frequent missing skills: {json.dumps(memory_context.get('top_missing_skills') or [], ensure_ascii=False)}\n"
        )

    prompt = f"""
You are a strict hiring analyst. Return only one valid JSON object.

Input:
- Target role: {safe_text(role)}
- Target industry: {safe_text(industry)}
- Experience years: {experience_years}
- Age years: {age_years}
- Candidate profile text:
{safe_text(skills_text)[:7000]}

Deterministic baseline:
{json.dumps({
    "overall_score": int(base_analysis.get("overall_score", 0)),
    "skill_match": int(base_analysis.get("skill_match", 0)),
    "confidence": int(base_analysis.get("confidence", 0)),
    "critical_missing_skills": base_analysis.get("critical_missing_skills", [])[:8],
    "missing_core_skills": base_analysis.get("missing_core_skills", [])[:8],
    "matched_core_skills": base_analysis.get("matched_core_skills", [])[:8],
}, ensure_ascii=False)}
{memory_section}

JSON schema (all keys required):
{{
  "semantic_skill_match": <number 0-100>,
  "semantic_confidence": <number 0-100>,
  "semantic_overall_adjustment": <number from -8 to 8>,
  "semantic_prediction_reasoning": ["reason 1", "reason 2", "reason 3"],
  "semantic_quick_wins": ["win 1", "win 2", "win 3", "win 4"],
  "semantic_missing_skills": ["skill 1", "skill 2", "skill 3"],
  "semantic_strengths": ["strength 1", "strength 2", "strength 3"],
  "semantic_summary": "short summary (max 240 chars)"
}}
"""

    last_error: str | None = None
    for model in models:
        for attempt in range(3):
            try:
                response = client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": "Return strict JSON only. No markdown."},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.15,
                )
                content = extract_llm_text(response.choices[0].message.content if response.choices else "")
                parsed = parse_llm_json_payload(content)
                if parsed is not None:
                    return parsed, model, None
                last_error = f"invalid_json_from_{model}"
                logger.error("Semantic analysis returned non-JSON content for model '%s'.", model)
                break
            except Exception as exc:
                last_error = f"{type(exc).__name__} on model {model}"
                logger.exception("Semantic analysis failed for model '%s' (attempt %s).", model, attempt + 1)
                if attempt < 2 and is_transient_openai_error(exc):
                    time.sleep(0.35 * (attempt + 1))
                    continue
                break
    return None, None, last_error


def analyze_profile_hybrid(
    industry: str,
    role: str,
    skills_text: str,
    experience_years: float | None = None,
    age_years: float | None = None,
    applications_count: int | None = None,
    salary_boost_toggles: list[str] | None = None,
    source: str = "manual_input",
) -> dict[str, Any]:
    base = analyze_profile(
        industry=industry,
        role=role,
        skills_text=skills_text,
        experience_years=experience_years,
        age_years=age_years,
        applications_count=applications_count,
        salary_boost_toggles=salary_boost_toggles,
    )
    base["source"] = source
    role_track = safe_text(str(base.get("role_track", ""))) or infer_role_track(role, industry)
    memory_bucket = build_learning_bucket(industry, role, role_track)
    memory = fetch_learning_memory(memory_bucket)
    routing = choose_hybrid_routing(base, skills_text, memory)
    cache_key = build_semantic_cache_key(industry, role, skills_text, experience_years, age_years)

    if ANALYZE_MODE == "rules":
        apply_learning_memory_overlay(base, memory, max_items=2)
        base["analysis_mode"] = "rules"
        base["analysis_ai"] = {
            "used": False,
            "model": None,
            "reason": "ANALYZE_MODE=rules",
            "cache_hit": False,
            "routing": routing,
        }
        persist_learning_memory(memory_bucket, analysis=base, semantic_model=None, ai_used=False, cache_hit=False)
        return base

    semantic_payload: dict[str, Any] | None = None
    semantic_model: str | None = None
    semantic_error: str | None = None
    cache_hit = False

    if routing["strategy"] != "memory_only":
        semantic_payload, semantic_model = fetch_cached_semantic_overlay(cache_key)
        if semantic_payload is not None:
            cache_hit = True

    if semantic_payload is None and routing["strategy"] != "memory_only":
        semantic_payload, semantic_model, semantic_error = request_semantic_analysis_overlay(
            industry=industry,
            role=role,
            skills_text=skills_text,
            base_analysis=base,
            experience_years=experience_years,
            age_years=age_years,
            preferred_models=routing.get("preferred_models") or None,
            memory_context=build_memory_prompt_context(memory),
        )
        if semantic_payload is not None:
            save_cached_semantic_overlay(
                cache_key=cache_key,
                industry=industry,
                role=role,
                role_track=role_track,
                semantic_payload=semantic_payload,
                model=semantic_model,
            )

    if semantic_payload is None:
        apply_learning_memory_overlay(base, memory, max_items=3)
        if routing["strategy"] == "memory_only":
            base["analysis_mode"] = "hybrid_memory"
            fallback_reason = safe_text(routing.get("reason")) or "memory_only_route"
        else:
            base["analysis_mode"] = "rules_fallback"
            fallback_reason = semantic_error or "semantic_overlay_unavailable"
        base["analysis_ai"] = {
            "used": False,
            "model": semantic_model,
            "reason": fallback_reason,
            "cache_hit": cache_hit,
            "routing": routing,
        }
        persist_learning_memory(memory_bucket, analysis=base, semantic_model=semantic_model, ai_used=False, cache_hit=cache_hit)
        return base

    def safe_float_from_payload(key: str, default_value: float) -> float:
        try:
            return float(semantic_payload.get(key, default_value))
        except Exception:
            return float(default_value)

    deterministic_skill_match = int(base.get("skill_match", 0))
    deterministic_confidence = int(base.get("confidence", 0))
    deterministic_overall = int(base.get("overall_score", 0))

    semantic_skill_match = clamp_float(
        safe_float_from_payload("semantic_skill_match", deterministic_skill_match),
        0.0,
        100.0,
    )
    semantic_confidence = clamp_float(
        safe_float_from_payload("semantic_confidence", deterministic_confidence),
        0.0,
        100.0,
    )
    semantic_adjustment = clamp_float(safe_float_from_payload("semantic_overall_adjustment", 0.0), -8.0, 8.0)

    blend = ANALYZE_LLM_BLEND
    blended_skill_match = clamp((1.0 - blend) * deterministic_skill_match + blend * semantic_skill_match)
    blended_confidence = clamp((1.0 - blend) * deterministic_confidence + blend * semantic_confidence)
    blended_confidence = min(96, blended_confidence)
    blended_overall = clamp((1.0 - blend) * deterministic_overall + blend * semantic_skill_match + semantic_adjustment)

    base["skill_match"] = blended_skill_match
    base["confidence"] = blended_confidence
    base["overall_score"] = blended_overall
    base["shortlist_prediction"] = build_shortlist_prediction(blended_overall)
    base["prediction_range"] = build_prediction_band(blended_overall, blended_confidence)
    base["likely_interview_call"] = build_interview_call_likelihood(blended_overall, blended_confidence)

    semantic_reasoning = normalize_string_list(semantic_payload.get("semantic_prediction_reasoning"), limit=3, max_item_len=180)
    if semantic_reasoning:
        base["prediction_reasoning"] = dedupe_preserve_order([*semantic_reasoning, *(base.get("prediction_reasoning") or [])])[:6]

    semantic_quick_wins = normalize_string_list(semantic_payload.get("semantic_quick_wins"), limit=4, max_item_len=160)
    if semantic_quick_wins:
        base["quick_wins"] = dedupe_preserve_order([*semantic_quick_wins, *(base.get("quick_wins") or [])])[:7]

    semantic_missing = normalize_string_list(semantic_payload.get("semantic_missing_skills"), limit=6, max_item_len=64)
    if semantic_missing:
        base["critical_missing_skills"] = dedupe_preserve_order([*(base.get("critical_missing_skills") or []), *semantic_missing])[:10]

    semantic_strengths = normalize_string_list(semantic_payload.get("semantic_strengths"), limit=6, max_item_len=64)
    if semantic_strengths:
        base["matched_keywords"] = dedupe_preserve_order([*semantic_strengths, *(base.get("matched_keywords") or [])])[:12]

    semantic_summary = safe_text(str(semantic_payload.get("semantic_summary", "")))[:240]
    if semantic_summary:
        base["semantic_summary"] = semantic_summary

    seniority = safe_text(str(base.get("seniority_assumption", ""))) or infer_seniority(role)
    critical_missing = [safe_text(str(item)) for item in (base.get("critical_missing_skills") or []) if safe_text(str(item))]
    core_missing = [safe_text(str(item)) for item in (base.get("missing_core_skills") or []) if safe_text(str(item))]
    adjacent_missing = [safe_text(str(item)) for item in (base.get("missing_adjacent_skills") or []) if safe_text(str(item))]
    applications_used = normalize_applications_count(applications_count)
    experience_band = infer_experience_band(experience_years, seniority)

    base["ninety_plus_strategy"] = build_ninety_plus_plan(
        blended_overall,
        role_track,
        role,
        industry,
        experience_band,
        critical_missing,
        core_missing,
        adjacent_missing,
    )
    base["salary_insight"] = build_salary_insight(
        role_track=role_track,
        role=role,
        industry=industry,
        overall_score=blended_overall,
        confidence=blended_confidence,
        seniority=seniority,
        experience_years=experience_years,
        selected_toggle_ids=salary_boost_toggles,
    )
    base["callback_forecast"] = build_callback_estimator(
        blended_overall,
        blended_confidence,
        applications_used,
        base["ninety_plus_strategy"],
    )
    apply_learning_memory_overlay(base, memory, max_items=2)
    base["analysis_mode"] = "hybrid_cached" if cache_hit else "hybrid"
    base["analysis_ai"] = {
        "used": True,
        "model": semantic_model or ANALYZE_LLM_MODEL,
        "blend": ANALYZE_LLM_BLEND,
        "cache_hit": cache_hit,
        "routing": routing,
    }
    persist_learning_memory(
        memory_bucket,
        analysis=base,
        semantic_model=semantic_model or ANALYZE_LLM_MODEL,
        ai_used=True,
        cache_hit=cache_hit,
    )
    return base


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


RESUME_DROP_EXACT_LINES = {
    "references available upon request",
    "optimized resume",
    "optimised resume",
    "resume",
    "resume draft",
}

RESUME_DROP_PREFIX_LINES = {
    "references available upon request",
    "optimized resume",
    "optimised resume",
    "resume draft",
}


def normalize_resume_drop_text(value: str) -> str:
    cleaned = safe_text(value)
    cleaned = re.sub(r"[\[\]\(\)\{\}]+", " ", cleaned)
    cleaned = re.sub(r"[^a-zA-Z0-9]+", " ", cleaned).strip().lower()
    return cleaned


def should_drop_resume_line(value: str) -> bool:
    normalized = normalize_resume_drop_text(value)
    if not normalized:
        return False
    if normalized in RESUME_DROP_EXACT_LINES:
        return True
    words_count = len(normalized.split())
    for blocked_prefix in RESUME_DROP_PREFIX_LINES:
        if normalized.startswith(f"{blocked_prefix} ") and words_count <= 7:
            return True
    return False


def sanitize_resume_output(text: str) -> str:
    normalized_text = safe_text(text)
    if not normalized_text:
        return ""

    lines = normalized_text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    filtered_lines: list[str] = []
    for raw_line in lines:
        if should_drop_resume_line(raw_line):
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
    cleaned = safe_text(value)
    if cleaned and should_drop_resume_line(cleaned):
        cleaned = ""
    base = re.sub(r"[^a-zA-Z0-9._-]+", "-", cleaned or "resume").strip("-").lower()
    return base or "resume"


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

RESUME_PLACEHOLDER_NAMES = {
    "candidate",
    "candidate name",
    "resume",
    "resume candidate",
    "optimized resume",
    "optimised resume",
    "optimized-resume",
    "optimised-resume",
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


def is_placeholder_candidate_name(value: str) -> bool:
    normalized = normalize_resume_drop_text(value)
    if not normalized:
        return True
    if normalized in RESUME_PLACEHOLDER_NAMES:
        return True
    if normalized.startswith("candidate "):
        return True
    return False


def infer_candidate_name_from_resume_lines(lines: list[str]) -> str:
    for raw_line in lines[:10]:
        line = clean_resume_line(re.sub(r"[*_`]+", "", safe_text(raw_line)))
        if not line:
            continue
        if should_drop_resume_line(line):
            continue
        if looks_like_resume_heading(line):
            continue
        if looks_like_contact_line(line):
            continue
        if is_bullet_line(line):
            continue
        if len(line) > 64 or len(line) < 2:
            continue
        if len(line.split()) > 6:
            continue
        if re.search(r"\b(resume|curriculum vitae|professional summary|profile)\b", line.lower()):
            continue
        if re.search(r"\d{3,}", line):
            continue
        return line
    return ""


BULLET_PREFIX_RE = re.compile(r"^(?:[-*•]\s+|\d{1,2}[\).]\s+)")
INLINE_BOLD_RE = re.compile(r"(\*\*|__)(.+?)\1")
INLINE_ITALIC_RE = re.compile(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)")


def clean_resume_line(line: str) -> str:
    text = safe_text(line).replace("\t", " ").strip()
    if not text:
        return ""
    text = re.sub(r"^#+\s*", "", text)
    text = re.sub(r"[ ]{2,}", " ", text).strip()
    return text


def is_bullet_line(line: str) -> bool:
    return bool(BULLET_PREFIX_RE.match(clean_resume_line(line)))


def strip_bullet_prefix(line: str) -> str:
    return BULLET_PREFIX_RE.sub("", clean_resume_line(line)).strip()


def resume_inline_html(line: str) -> str:
    raw = clean_resume_line(line)
    if not raw:
        return ""
    escaped = html.escape(raw)
    escaped = INLINE_BOLD_RE.sub(lambda match: f"<b>{match.group(2).strip()}</b>", escaped)
    escaped = INLINE_ITALIC_RE.sub(lambda match: f"<i>{match.group(1).strip()}</i>", escaped)
    return escaped


def looks_like_role_heading_line(section_key: str, line: str) -> bool:
    text = clean_resume_line(re.sub(r"[*_`]+", "", safe_text(line)))
    if not text or len(text) > 130:
        return False
    if section_key not in {"experience", "projects"}:
        return False
    if re.search(r"\b(19|20)\d{2}\b", text) and ("|" in text or "—" in text or " - " in text):
        return True
    if "—" in text and len(text.split()) <= 18:
        return True
    if "|" in text and len(text.split()) <= 16:
        return True
    return False


def looks_like_meta_note_line(section_key: str, line: str) -> bool:
    text = clean_resume_line(re.sub(r"[*_`]+", "", safe_text(line)))
    if not text or len(text) > 120:
        return False
    if section_key in {"experience", "projects"} and re.search(r"\b(19|20)\d{2}\b", text):
        return True
    if re.match(r"^(location|email|phone|linkedin|github)\b", text.lower()):
        return True
    return False


def parse_resume_sections(name: str, resume_text: str) -> dict[str, Any]:
    raw_lines = [clean_resume_line(line) for line in resume_text.replace("\r", "\n").split("\n")]
    lines = [line for line in raw_lines if line]

    guessed_name = safe_text(name)
    if is_placeholder_candidate_name(guessed_name) or should_drop_resume_line(guessed_name):
        guessed_name = ""
    if not guessed_name:
        guessed_name = infer_candidate_name_from_resume_lines(lines)

    sections: dict[str, list[str]] = {}
    contact_lines: list[str] = []
    current = "summary"
    seen_heading = False

    for index, line in enumerate(lines):
        normalized_line = clean_resume_line(line)
        if not normalized_line:
            continue
        if should_drop_resume_line(normalized_line):
            continue
        if index == 0 and guessed_name and normalized_line.lower() == guessed_name.lower():
            continue

        if looks_like_resume_heading(normalized_line):
            current = normalize_resume_section_key(re.sub(r"[*_`]+", "", normalized_line).strip(":"))
            if current == "meta_ignore":
                current = "summary"
                continue
            sections.setdefault(current, [])
            seen_heading = True
            continue

        if (not seen_heading) and len(contact_lines) < 3 and looks_like_contact_line(normalized_line):
            contact_lines.append(normalized_line)
            continue

        sections.setdefault(current, []).append(normalized_line)

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
    for summary_line in summary_lines:
        candidate = clean_resume_line(summary_line)
        if not candidate or is_bullet_line(candidate):
            continue
        if len(candidate) <= 115 and not looks_like_contact_line(candidate):
            headline = candidate
            break

    return {
        "name": guessed_name or "Candidate",
        "contact_line": " | ".join(contact_lines),
        "headline": headline,
        "sections": [(key, cleaned_sections[key]) for key in ordered_keys],
    }


def coerce_resume_layout_payload(payload: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None

    sections_raw = payload.get("sections")
    collected: dict[str, list[str]] = {}

    if isinstance(sections_raw, dict):
        iterator = [{"key": key, "lines": value} for key, value in sections_raw.items()]
    elif isinstance(sections_raw, list):
        iterator = sections_raw
    else:
        iterator = []

    for item in iterator:
        if not isinstance(item, dict):
            continue
        key = normalize_resume_section_key(safe_text(item.get("key") or item.get("section") or item.get("title")))
        if not key or key == "meta_ignore":
            continue
        if key not in RESUME_SECTION_TITLES:
            key = "summary"

        lines_value = item.get("lines")
        lines: list[str] = []
        if isinstance(lines_value, str):
            lines = [clean_resume_line(part) for part in lines_value.split("\n")]
        elif isinstance(lines_value, list):
            lines = [clean_resume_line(str(part)) for part in lines_value]
        elif isinstance(item.get("content"), str):
            lines = [clean_resume_line(part) for part in safe_text(item.get("content")).split("\n")]

        cleaned = [line for line in lines if line and not should_drop_resume_line(line)]
        if cleaned:
            collected.setdefault(key, []).extend(cleaned[:32])

    if not collected:
        return None

    ordered_keys = [key for key in RESUME_SECTION_ORDER if key in collected]
    ordered_keys += [key for key in collected if key not in ordered_keys]
    sections = [(key, collected[key][:40]) for key in ordered_keys]

    parsed_name = clean_resume_line(safe_text(payload.get("name")))
    if is_placeholder_candidate_name(parsed_name):
        parsed_name = ""
    parsed_contact = clean_resume_line(safe_text(payload.get("contact_line")))
    parsed_headline = clean_resume_line(safe_text(payload.get("headline")))

    return {
        "name": parsed_name,
        "contact_line": parsed_contact,
        "headline": parsed_headline,
        "sections": sections,
    }


def parse_resume_sections_smart(name: str, resume_text: str) -> dict[str, Any]:
    deterministic = parse_resume_sections(name, resume_text)
    if client is None:
        return deterministic
    if len(safe_text(resume_text)) < 120:
        return deterministic

    prompt = f"""
You are a resume layout parser for PDF generation.
Return ONLY one valid JSON object. No markdown, no explanation.

Allowed section keys: {json.dumps(RESUME_SECTION_ORDER)}
Rules:
- Preserve factual content from input.
- Never invent companies, dates, metrics, or skills.
- Keep section lines concise and readable.
- Use key \"summary\" for unmatched content.
- If candidate name is unavailable, return empty string for \"name\".

Input resume text:
{safe_text(resume_text)[:8200]}

Output schema:
{{
  "name": "string",
  "contact_line": "string",
  "headline": "string",
  "sections": [
    {{"key": "summary", "lines": ["line 1", "line 2"]}}
  ]
}}
"""

    models: list[str] = []
    for model in [OPENAI_MODEL, *OPENAI_FALLBACK_MODELS]:
        cleaned = safe_text(model)
        if cleaned and cleaned not in models:
            models.append(cleaned)

    for model in models:
        for attempt in range(2):
            try:
                response = client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": "Return strict JSON only. No markdown."},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.05,
                )
                content = extract_llm_text(response.choices[0].message.content if response.choices else "")
                parsed_json = parse_llm_json_payload(content)
                if not parsed_json:
                    continue
                smart = coerce_resume_layout_payload(parsed_json)
                if not smart:
                    continue

                if not smart["name"]:
                    smart["name"] = deterministic["name"]
                if is_placeholder_candidate_name(smart["name"]):
                    smart["name"] = deterministic["name"]
                if not smart["contact_line"]:
                    smart["contact_line"] = deterministic["contact_line"]
                if not smart["headline"]:
                    smart["headline"] = deterministic["headline"]
                if not smart["sections"]:
                    smart["sections"] = deterministic["sections"]
                return smart
            except Exception as exc:
                logger.exception(
                    "Resume smart parsing failed for model '%s' (attempt %s).",
                    model,
                    attempt + 1,
                )
                if attempt == 0 and is_transient_openai_error(exc):
                    time.sleep(0.2)
                    continue
                break

    return deterministic


def template_palette(template_key: str) -> dict[str, colors.Color]:
    palettes = {
        "minimal": {
            "name": colors.HexColor("#102A3E"),
            "accent": colors.HexColor("#2D6FA9"),
            "accent_soft": colors.HexColor("#CFE2F2"),
            "text": colors.HexColor("#1E3446"),
            "muted": colors.HexColor("#607C8F"),
            "line": colors.HexColor("#D8E7F1"),
            "surface": colors.HexColor("#F5FAFE"),
            "header_bg": colors.white,
            "header_text": colors.HexColor("#102A3E"),
            "footer_text": colors.HexColor("#698398"),
            "highlight": colors.HexColor("#A7C9E5"),
        },
        "executive": {
            "name": colors.HexColor("#101A2A"),
            "accent": colors.HexColor("#1C2A3E"),
            "accent_soft": colors.HexColor("#2A3A55"),
            "text": colors.HexColor("#1C2634"),
            "muted": colors.HexColor("#657487"),
            "line": colors.HexColor("#CAD2DC"),
            "surface": colors.HexColor("#F4F7FA"),
            "header_bg": colors.HexColor("#162132"),
            "header_text": colors.white,
            "footer_text": colors.HexColor("#D6DEE7"),
            "highlight": colors.HexColor("#DAB680"),
        },
        "quantum": {
            "name": colors.HexColor("#083A59"),
            "accent": colors.HexColor("#0B8AB5"),
            "accent_soft": colors.HexColor("#BEE8F5"),
            "text": colors.HexColor("#144760"),
            "muted": colors.HexColor("#4E7489"),
            "line": colors.HexColor("#BFDEEC"),
            "surface": colors.HexColor("#ECF9FF"),
            "header_bg": colors.HexColor("#E8F6FC"),
            "header_text": colors.HexColor("#083A59"),
            "footer_text": colors.HexColor("#4E7489"),
            "highlight": colors.HexColor("#67D4F2"),
        },
        "dublin": {
            "name": colors.HexColor("#2E3445"),
            "accent": colors.HexColor("#0AA594"),
            "accent_soft": colors.HexColor("#CBEDE8"),
            "text": colors.HexColor("#2B3442"),
            "muted": colors.HexColor("#6E7787"),
            "line": colors.HexColor("#CFD9E4"),
            "surface": colors.HexColor("#F8FBFD"),
            "header_bg": colors.HexColor("#EDF5F8"),
            "header_text": colors.HexColor("#2E3445"),
            "footer_text": colors.HexColor("#6D7787"),
            "highlight": colors.HexColor("#0AA594"),
        },
        "slate": {
            "name": colors.HexColor("#333A42"),
            "accent": colors.HexColor("#0A6D6D"),
            "accent_soft": colors.HexColor("#CFE6E6"),
            "text": colors.HexColor("#333A42"),
            "muted": colors.HexColor("#66707A"),
            "line": colors.HexColor("#CAD2D8"),
            "surface": colors.HexColor("#F4F6F7"),
            "header_bg": colors.HexColor("#0A6D6D"),
            "header_text": colors.white,
            "footer_text": colors.HexColor("#E4F4F4"),
            "highlight": colors.HexColor("#0FB5B5"),
        },
        "metro": {
            "name": colors.HexColor("#171D25"),
            "accent": colors.HexColor("#456BB3"),
            "accent_soft": colors.HexColor("#DDE4F4"),
            "text": colors.HexColor("#2D3746"),
            "muted": colors.HexColor("#5F6B7A"),
            "line": colors.HexColor("#CFD6E0"),
            "surface": colors.HexColor("#F7F8FA"),
            "header_bg": colors.white,
            "header_text": colors.HexColor("#171D25"),
            "footer_text": colors.HexColor("#66707D"),
            "highlight": colors.HexColor("#C77852"),
        },
    }
    return palettes.get(template_key, palettes["minimal"])


def build_pdf_styles(template_key: str) -> dict[str, ParagraphStyle]:
    sample = getSampleStyleSheet()
    palette = template_palette(template_key)
    if template_key == "executive":
        header_size = 25.8
        body_size = 10.2
        title_font = "Times-Bold"
        body_font = "Times-Roman"
        body_leading = 14.8
    elif template_key == "dublin":
        header_size = 22.3
        body_size = 9.8
        title_font = "Helvetica-Bold"
        body_font = "Helvetica"
        body_leading = 13.8
    elif template_key == "slate":
        header_size = 20.8
        body_size = 9.6
        title_font = "Times-Bold"
        body_font = "Times-Roman"
        body_leading = 13.2
    elif template_key == "metro":
        header_size = 28.2
        body_size = 10.0
        title_font = "Times-Bold"
        body_font = "Helvetica"
        body_leading = 14.0
    elif template_key == "quantum":
        header_size = 24.8
        body_size = 10.0
        title_font = "Helvetica-Bold"
        body_font = "Helvetica"
        body_leading = 14.3
    else:
        header_size = 24.2
        body_size = 10.05
        title_font = "Helvetica-Bold"
        body_font = "Helvetica"
        body_leading = 14.4

    styles = {
        "name": ParagraphStyle(
            "name",
            parent=sample["Title"],
            fontName=title_font,
            fontSize=header_size,
            leading=header_size + 1.4,
            textColor=palette["name"],
            spaceAfter=2.8,
        ),
        "contact": ParagraphStyle(
            "contact",
            parent=sample["Normal"],
            fontName="Helvetica-Bold" if template_key in {"quantum", "dublin"} else body_font,
            fontSize=9.4,
            leading=12.3,
            textColor=palette["muted"],
            spaceAfter=1.6,
        ),
        "header_inverse": ParagraphStyle(
            "header_inverse",
            parent=sample["Normal"],
            fontName="Times-Bold" if template_key == "executive" else "Helvetica-Bold",
            fontSize=13.0,
            leading=15.6,
            textColor=colors.white,
            spaceAfter=0,
        ),
        "header_inverse_meta": ParagraphStyle(
            "header_inverse_meta",
            parent=sample["Normal"],
            fontName="Times-Roman" if template_key == "executive" else "Helvetica",
            fontSize=9.5,
            leading=12.4,
            textColor=colors.Color(1, 1, 1, alpha=0.92),
            spaceAfter=0,
        ),
        "headline": ParagraphStyle(
            "headline",
            parent=sample["Normal"],
            fontName="Times-Italic" if template_key == "executive" else "Helvetica-Bold",
            fontSize=10.1 if template_key == "dublin" else (10.0 if template_key == "metro" else 10.6),
            leading=14,
            textColor=palette["text"],
            spaceAfter=6.2,
        ),
        "section": ParagraphStyle(
            "section",
            parent=sample["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=10.3 if template_key in {"dublin", "slate"} else (10.7 if template_key == "metro" else (10.9 if template_key == "minimal" else 11.1)),
            leading=13.5,
            textColor=colors.white if template_key == "executive" else palette["accent"],
            spaceBefore=9,
            spaceAfter=4.6,
        ),
        "body": ParagraphStyle(
            "body",
            parent=sample["Normal"],
            fontName=body_font,
            fontSize=body_size,
            leading=body_leading,
            textColor=palette["text"],
            spaceAfter=2.9,
        ),
        "bullet": ParagraphStyle(
            "bullet",
            parent=sample["Normal"],
            fontName=body_font,
            fontSize=body_size,
            leading=body_leading,
            textColor=palette["text"],
            leftIndent=19
            if template_key == "executive"
            else (17 if template_key == "quantum" else (15 if template_key == "dublin" else (13.5 if template_key == "metro" else 14))),
            bulletIndent=8 if template_key == "executive" else 6,
            spaceBefore=0.6,
            spaceAfter=1.8,
        ),
        "role_line": ParagraphStyle(
            "role_line",
            parent=sample["Normal"],
            fontName="Times-Bold" if template_key == "executive" else "Helvetica-Bold",
            fontSize=10.8 if template_key == "executive" else (11.0 if template_key == "metro" else 10.55),
            leading=14.2,
            textColor=palette["name"],
            spaceBefore=1.6,
            spaceAfter=1.9,
        ),
        "meta_line": ParagraphStyle(
            "meta_line",
            parent=sample["Normal"],
            fontName="Times-Italic" if template_key == "executive" else "Helvetica-Oblique",
            fontSize=9.1,
            leading=12.5,
            textColor=palette["muted"],
            spaceBefore=0.4,
            spaceAfter=1.4,
        ),
        "badge": ParagraphStyle(
            "badge",
            parent=sample["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8.6,
            leading=10,
            textColor=palette["accent"],
            spaceAfter=2,
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
        table = Table([["", title_para]], colWidths=[7, width - 7])
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (0, -1), palette["highlight"]),
                    ("BACKGROUND", (1, 0), (1, -1), palette["accent"]),
                    ("TEXTCOLOR", (1, 0), (1, -1), colors.white),
                    ("LEFTPADDING", (1, 0), (1, -1), 8),
                    ("RIGHTPADDING", (1, 0), (1, -1), 8),
                    ("TOPPADDING", (1, 0), (1, -1), 5.2),
                    ("BOTTOMPADDING", (1, 0), (1, -1), 4.2),
                    ("BOX", (0, 0), (-1, -1), 0.7, palette["line"]),
                ]
            )
        )
        return table

    if template_key == "quantum":
        table = Table([["", title_para]], colWidths=[11, width - 11])
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (0, -1), palette["accent"]),
                    ("BACKGROUND", (1, 0), (1, -1), palette["surface"]),
                    ("LEFTPADDING", (1, 0), (1, -1), 8.5),
                    ("RIGHTPADDING", (1, 0), (1, -1), 8),
                    ("TOPPADDING", (1, 0), (1, -1), 4.6),
                    ("BOTTOMPADDING", (1, 0), (1, -1), 4.1),
                    ("BOX", (0, 0), (-1, -1), 0.75, palette["line"]),
                ]
            )
        )
        return table

    if template_key == "dublin":
        table = Table([[Paragraph(html.escape(section_title.upper()), styles["section"])]], colWidths=[width])
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                    ("TEXTCOLOR", (0, 0), (-1, -1), palette["accent"]),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 1.8),
                    ("LINEABOVE", (0, 0), (-1, -1), 0.7, palette["line"]),
                    ("LINEBELOW", (0, 0), (-1, -1), 0.7, palette["line"]),
                ]
            )
        )
        return table

    if template_key == "slate":
        table = Table([[Paragraph(html.escape(section_title.upper()), styles["section"])]], colWidths=[width])
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 1.6),
                    ("LINEBELOW", (0, 0), (-1, -1), 0.75, palette["line"]),
                ]
            )
        )
        return table

    if template_key == "metro":
        table = Table([[Paragraph(html.escape(section_title.upper()), styles["section"])]], colWidths=[width])
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 1.8),
                    ("LINEBELOW", (0, 0), (-1, -1), 0.72, palette["line"]),
                ]
            )
        )
        return table

    table = Table([["", Paragraph(html.escape(section_title.upper()), styles["section"])]], colWidths=[4.5, width - 4.5])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), palette["accent"]),
                ("BACKGROUND", (1, 0), (1, -1), colors.white),
                ("LEFTPADDING", (1, 0), (1, -1), 6),
                ("RIGHTPADDING", (1, 0), (1, -1), 0),
                ("TOPPADDING", (1, 0), (1, -1), 0),
                ("BOTTOMPADDING", (1, 0), (1, -1), 2.1),
                ("LINEBELOW", (1, 0), (1, -1), 0.72, palette["line"]),
            ]
        )
    )
    return table


def draw_template_page_decoration(pdf: canvas.Canvas, doc: SimpleDocTemplate, template_key: str) -> None:
    palette = template_palette(template_key)
    width, height = A4
    pdf.saveState()

    if template_key == "executive":
        pdf.setFillColor(palette["header_bg"])
        pdf.rect(0, height - 35, width, 35, fill=1, stroke=0)
        pdf.setFillColor(palette["highlight"])
        pdf.rect(0, height - 37.8, width, 2.8, fill=1, stroke=0)
        pdf.setFillColor(colors.Color(0.08, 0.12, 0.2, alpha=0.94))
        pdf.rect(0, 0, width, 18, fill=1, stroke=0)
        pdf.setFillColor(colors.Color(1, 1, 1, alpha=0.05))
        pdf.rect(width - 28, 0, 28, height, fill=1, stroke=0)
    elif template_key == "quantum":
        pdf.setFillColor(palette["accent"])
        pdf.rect(0, 0, 13, height, fill=1, stroke=0)
        pdf.setFillColor(colors.Color(0.05, 0.55, 0.73, alpha=0.2))
        pdf.circle(width - doc.rightMargin - 24, height - 21, 9, fill=1, stroke=0)
        pdf.circle(width - doc.rightMargin - 46, height - 26, 5, fill=1, stroke=0)
        pdf.setFillColor(colors.Color(0.08, 0.52, 0.68, alpha=0.12))
        pdf.rect(width - 56, 0, 56, 20, fill=1, stroke=0)
        pdf.setStrokeColor(palette["line"])
        pdf.setLineWidth(0.8)
        pdf.line(doc.leftMargin, height - 24, doc.leftMargin + doc.width, height - 24)
    elif template_key == "dublin":
        pdf.setFillColor(palette["surface"])
        pdf.rect(0, height - 90, width, 90, fill=1, stroke=0)
        pdf.setStrokeColor(palette["line"])
        pdf.setLineWidth(1.0)
        pdf.line(doc.leftMargin, height - 92.5, doc.leftMargin + doc.width, height - 92.5)
        pdf.setFillColor(palette["accent"])
        pdf.rect(doc.leftMargin, height - 94.8, doc.width * 0.74, 2.2, fill=1, stroke=0)
    elif template_key == "slate":
        sidebar_width = width * 0.33
        pdf.setFillColor(palette["accent"])
        pdf.rect(width - sidebar_width, 0, sidebar_width, height, fill=1, stroke=0)
        pdf.setFillColor(colors.Color(1, 1, 1, alpha=0.07))
        pdf.rect(width - sidebar_width, height - 126, sidebar_width, 126, fill=1, stroke=0)
        pdf.setFillColor(colors.HexColor("#EFEFEF"))
        pdf.rect(0, 0, width - sidebar_width, height, fill=1, stroke=0)
        pdf.setStrokeColor(colors.HexColor("#C8CED3"))
        pdf.setLineWidth(0.95)
        pdf.line(doc.leftMargin, height - 116, width - sidebar_width - 16, height - 116)
    elif template_key == "metro":
        pdf.setFillColor(palette["surface"])
        pdf.rect(0, height - 42, width, 42, fill=1, stroke=0)
        pdf.setFillColor(palette["highlight"])
        pdf.rect(doc.leftMargin, height - 78, 3.2, 22, fill=1, stroke=0)
        pdf.setStrokeColor(palette["line"])
        pdf.setLineWidth(0.88)
        pdf.line(doc.leftMargin + 8, height - 62, doc.leftMargin + doc.width, height - 62)
    else:
        pdf.setFillColor(palette["surface"])
        pdf.rect(0, height - 27, width, 27, fill=1, stroke=0)
        pdf.setStrokeColor(palette["line"])
        pdf.setLineWidth(1.0)
        pdf.line(doc.leftMargin, height - 26, doc.leftMargin + doc.width, height - 26)
        pdf.setLineWidth(0.55)
        pdf.line(doc.leftMargin, height - 29.3, doc.leftMargin + doc.width * 0.84, height - 29.3)

    pdf.setStrokeColor(palette["line"])
    pdf.setLineWidth(0.62)
    pdf.line(doc.leftMargin, 22.8, doc.leftMargin + doc.width, 22.8)
    pdf.setFont("Helvetica", 8)
    if template_key == "slate":
        sidebar_width = width * 0.33
        pdf.setFillColor(colors.Color(1, 1, 1, alpha=0.85))
        pdf.drawRightString(width - 10, 11.2, f"Page {pdf.getPageNumber()}")
        pdf.setFillColor(colors.HexColor("#5E6B75"))
        pdf.drawString(doc.leftMargin, 11.2, "HireScore Resume")
        pdf.setStrokeColor(colors.Color(1, 1, 1, alpha=0.2))
        pdf.line(width - sidebar_width + 10, 22.8, width - 10, 22.8)
    else:
        pdf.setFillColor(palette["footer_text"])
        pdf.drawRightString(doc.leftMargin + doc.width, 11.2, f"Page {pdf.getPageNumber()}")
    pdf.restoreState()


def append_resume_sections_to_story(
    story: list[Any],
    template_key: str,
    sections: list[tuple[str, list[str]]],
    styles: dict[str, ParagraphStyle],
    palette: dict[str, colors.Color],
    section_width: float,
) -> None:
    for section_key, lines in sections:
        section_title = RESUME_SECTION_TITLES.get(section_key, section_key.replace("_", " ").title())
        story.append(section_header_flowable(template_key, section_title, styles, palette, section_width))
        if template_key in {"minimal", "dublin", "slate", "metro"}:
            story.append(HRFlowable(width="100%", color=palette["line"], thickness=0.48, spaceBefore=0.8, spaceAfter=3.0))
        else:
            story.append(Spacer(1, 4.4))

        for line in lines:
            content = clean_resume_line(line)
            if not content:
                continue
            if is_bullet_line(content):
                bullet_text = resume_inline_html(strip_bullet_prefix(content))
                bullet_symbol = "▪" if template_key == "executive" else ("▸" if template_key == "quantum" else "•")
                story.append(Paragraph(bullet_text, styles["bullet"], bulletText=f"{bullet_symbol} "))
            elif looks_like_role_heading_line(section_key, content):
                story.append(Paragraph(resume_inline_html(content), styles["role_line"]))
            elif looks_like_meta_note_line(section_key, content):
                story.append(Paragraph(resume_inline_html(content), styles["meta_line"]))
            else:
                story.append(Paragraph(resume_inline_html(content), styles["body"]))

        story.append(Spacer(1, 4.8 if template_key in {"dublin", "slate"} else (5 if template_key in {"minimal", "metro"} else 6.5)))


def wrap_canvas_text(pdf: canvas.Canvas, text: str, font_name: str, font_size: float, max_width: float) -> list[str]:
    cleaned = re.sub(r"\s+", " ", safe_text(text)).strip()
    if not cleaned:
        return []
    words = cleaned.split(" ")
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if pdf.stringWidth(candidate, font_name, font_size) <= max_width:
            current = candidate
            continue
        if current:
            lines.append(current)
            current = word
        else:
            lines.append(word)
            current = ""
    if current:
        lines.append(current)
    return lines


def draw_canvas_paragraph(
    pdf: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    max_width: float,
    font_name: str,
    font_size: float,
    text_color: colors.Color,
    leading: float,
    max_lines: int | None = None,
) -> float:
    lines = wrap_canvas_text(pdf, text, font_name, font_size, max_width)
    if max_lines is not None:
        lines = lines[: max(1, max_lines)]
    pdf.setFont(font_name, font_size)
    pdf.setFillColor(text_color)
    for line in lines:
        pdf.drawString(x, y, line)
        y -= leading
    return y


def collect_slate_sidebar_sections(parsed: dict[str, Any]) -> list[tuple[str, list[str]]]:
    sections_map: dict[str, list[str]] = {key: value for key, value in parsed.get("sections", [])}
    sidebar_order = ["achievements", "education", "skills", "certifications", "languages"]
    blocks: list[tuple[str, list[str]]] = []
    for key in sidebar_order:
        lines = sections_map.get(key) or []
        clipped = [safe_text(line) for line in lines if safe_text(line)][:14]
        if clipped:
            blocks.append((key, clipped))
    return blocks


def draw_slate_sidebar_content(pdf: canvas.Canvas, parsed: dict[str, Any], sidebar_sections: list[tuple[str, list[str]]]) -> None:
    width, height = A4
    sidebar_width = width * 0.33
    x = width - sidebar_width + 16
    text_width = sidebar_width - 30
    y = height - 42

    # Profile circle placeholder
    photo_radius = 34
    center_x = width - sidebar_width / 2
    center_y = height - 54
    pdf.setFillColor(colors.Color(1, 1, 1, alpha=0.18))
    pdf.circle(center_x, center_y, photo_radius, fill=1, stroke=0)
    pdf.setStrokeColor(colors.Color(1, 1, 1, alpha=0.6))
    pdf.setLineWidth(0.9)
    pdf.circle(center_x, center_y, photo_radius, fill=0, stroke=1)
    initial = (safe_text(parsed.get("name")) or "C")[0].upper()
    pdf.setFont("Helvetica-Bold", 26)
    pdf.setFillColor(colors.white)
    pdf.drawCentredString(center_x, center_y - 9, initial)

    y = height - 116
    heading_color = colors.white
    body_color = colors.Color(1, 1, 1, alpha=0.93)
    muted_color = colors.Color(1, 1, 1, alpha=0.78)

    for section_key, lines in sidebar_sections[:4]:
        title = RESUME_SECTION_TITLES.get(section_key, section_key.replace("_", " ").title()).upper()
        pdf.setFont("Helvetica-Bold", 10.8)
        pdf.setFillColor(heading_color)
        pdf.drawString(x, y, title)
        y -= 5
        pdf.setStrokeColor(colors.Color(1, 1, 1, alpha=0.55))
        pdf.setLineWidth(0.7)
        pdf.line(x, y, x + text_width, y)
        y -= 12

        for raw_line in lines[:7]:
            line = strip_bullet_prefix(raw_line) if is_bullet_line(raw_line) else clean_resume_line(raw_line)
            if not line:
                continue
            pdf.setFillColor(body_color)
            pdf.circle(x + 1.8, y + 3.2, 1.2, fill=1, stroke=0)
            y = draw_canvas_paragraph(
                pdf,
                line,
                x + 8,
                y,
                text_width - 8,
                "Helvetica",
                9.2,
                muted_color,
                leading=11.3,
                max_lines=3,
            )
            y -= 1.5
            if y < 74:
                return
        y -= 7
        if y < 74:
            return


def render_resume_pdf_bytes(name: str, _template: str, resume_text: str) -> bytes:
    # All PDF exports now use one ATS-safe layout; legacy template requests are intentionally ignored.
    template_key = "minimal"

    sanitized_resume = sanitize_resume_output(resume_text)
    parsed = parse_resume_sections_smart(name, sanitized_resume)
    if is_placeholder_candidate_name(safe_text(parsed.get("name"))):
        fallback_name = infer_candidate_name_from_resume_lines(sanitized_resume.split("\n"))
        if fallback_name:
            parsed["name"] = fallback_name
    styles = build_pdf_styles(template_key)
    palette = template_palette(template_key)

    output = io.BytesIO()
    if template_key == "slate":
        left_margin = 36
        right_margin = 214
        top_margin = 40
        bottom_margin = 34
    elif template_key == "quantum":
        left_margin = 52
        right_margin = left_margin
        top_margin = 44
        bottom_margin = 34
    elif template_key == "executive":
        left_margin = 36
        right_margin = left_margin
        top_margin = 54
        bottom_margin = 34
    elif template_key == "dublin":
        left_margin = 38
        right_margin = 38
        top_margin = 56
        bottom_margin = 34
    elif template_key == "metro":
        left_margin = 42
        right_margin = 42
        top_margin = 58
        bottom_margin = 35
    else:
        left_margin = 44
        right_margin = left_margin
        top_margin = 48
        bottom_margin = 35
    doc = SimpleDocTemplate(
        output,
        pagesize=A4,
        leftMargin=left_margin,
        rightMargin=right_margin,
        topMargin=top_margin,
        bottomMargin=bottom_margin,
        title=f"{parsed['name']} Resume",
        author="HireScore AI",
    )

    story: list[Any] = []
    if template_key == "dublin":
        name_tokens = [token for token in safe_text(parsed["name"]).split(" ") if token]
        first_name = html.escape(name_tokens[0] if name_tokens else "Candidate")
        last_name = html.escape(" ".join(name_tokens[1:]) if len(name_tokens) > 1 else "")

        name_lines: list[Any] = [Paragraph(f"<font color='#2E3445'>{first_name}</font>", styles["name"])]
        if last_name:
            name_lines.append(
                Paragraph(
                    f"<font color='#0AA594'>{last_name}</font>",
                    ParagraphStyle(
                        "dublin_last_name",
                        parent=styles["name"],
                        fontSize=20.8,
                        leading=22.8,
                        textColor=palette["accent"],
                        spaceAfter=0.5,
                    ),
                )
            )
        if parsed["headline"]:
            name_lines.append(Paragraph(resume_inline_html(parsed["headline"]).upper(), styles["meta_line"]))

        profile_cell = Table([[Paragraph("PHOTO", styles["meta_line"])]], colWidths=[56], rowHeights=[56])
        profile_cell.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                    ("BOX", (0, 0), (-1, -1), 1.0, palette["line"]),
                    ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ]
            )
        )

        right_lines: list[Any] = []
        if parsed["contact_line"]:
            right_lines.append(Paragraph(resume_inline_html(parsed["contact_line"]), styles["contact"]))
        right_lines.append(Paragraph("Dublin Profile Resume", styles["meta_line"]))

        header_table = Table(
            [[profile_cell, name_lines, right_lines]],
            colWidths=[66, doc.width * 0.51, doc.width * 0.29],
        )
        header_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), palette["header_bg"]),
                    ("BOX", (0, 0), (-1, -1), 0.8, palette["line"]),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 7.5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6.8),
                    ("LINEBEFORE", (2, 0), (2, 0), 0.7, palette["line"]),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ]
            )
        )
        story.append(header_table)
        story.append(Spacer(1, 8))
    elif template_key == "executive":
        left_block: list[Any] = [Paragraph(html.escape(parsed["name"]), styles["header_inverse"])]
        if parsed["headline"]:
            left_block.append(Paragraph(resume_inline_html(parsed["headline"]), styles["header_inverse_meta"]))

        right_block: list[Any] = []
        if parsed["contact_line"]:
            right_block.append(Paragraph(resume_inline_html(parsed["contact_line"]), styles["header_inverse_meta"]))
        right_block.append(Paragraph("Executive Edge Resume", styles["header_inverse_meta"]))

        header_rows: list[list[Any]] = [[left_block, right_block]]
        header_table = Table(header_rows, colWidths=[doc.width * 0.62, doc.width * 0.38])
        header_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), palette["header_bg"]),
                    ("LEFTPADDING", (0, 0), (-1, -1), 10.5),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 10.5),
                    ("TOPPADDING", (0, 0), (-1, -1), 7),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6.3),
                    ("BOX", (0, 0), (-1, -1), 0.8, palette["line"]),
                    ("LINEBELOW", (0, 0), (-1, -1), 0.55, colors.Color(1, 1, 1, alpha=0.28)),
                ]
            )
        )
        story.append(header_table)
        story.append(Spacer(1, 9))
    elif template_key == "quantum":
        left_header: list[Any] = [Paragraph(resume_inline_html(parsed["name"]), styles["name"])]
        if parsed["headline"]:
            left_header.append(Paragraph(resume_inline_html(parsed["headline"]), styles["headline"]))

        right_header: list[Any] = []
        if parsed["contact_line"]:
            right_header.append(Paragraph(resume_inline_html(parsed["contact_line"]), styles["contact"]))
        right_header.append(Paragraph("Quantum Grid Resume", styles["meta_line"]))

        header_table = Table(
            [[left_header, right_header]],
            colWidths=[doc.width * 0.63, doc.width * 0.37],
            hAlign="LEFT",
        )
        header_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (0, 0), colors.white),
                    ("BACKGROUND", (1, 0), (1, 0), palette["header_bg"]),
                    ("LEFTPADDING", (0, 0), (-1, -1), 9.5),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                    ("TOPPADDING", (0, 0), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 7.5),
                    ("BOX", (0, 0), (-1, -1), 0.8, palette["line"]),
                    ("LINEBEFORE", (1, 0), (1, 0), 0.8, palette["line"]),
                ]
            )
        )
        story.append(header_table)
        story.append(Spacer(1, 7.8))
    elif template_key == "slate":
        story.append(
            Paragraph(
                html.escape(parsed["name"]).upper(),
                ParagraphStyle(
                    "slate_name",
                    parent=styles["name"],
                    fontSize=20.2,
                    leading=22.8,
                    textColor=palette["name"],
                    spaceAfter=2.2,
                ),
            )
        )
        if parsed["headline"]:
            story.append(
                Paragraph(
                    resume_inline_html(parsed["headline"]),
                    ParagraphStyle(
                        "slate_headline",
                        parent=styles["headline"],
                        fontName="Helvetica",
                        fontSize=10.7,
                        leading=13.6,
                        textColor=colors.HexColor("#0A8C90"),
                        spaceAfter=3.5,
                    ),
                )
            )
        if parsed["contact_line"]:
            story.append(
                Paragraph(
                    resume_inline_html(parsed["contact_line"]),
                    ParagraphStyle(
                        "slate_contact",
                        parent=styles["contact"],
                        fontName="Helvetica",
                        fontSize=9.6,
                        leading=12.3,
                        textColor=palette["muted"],
                        spaceAfter=6.8,
                    ),
                )
            )
        story.append(HRFlowable(width="100%", color=palette["line"], thickness=0.72, spaceBefore=1, spaceAfter=4.6))
    elif template_key == "metro":
        left_header: list[Any] = [
            Paragraph(
                resume_inline_html(parsed["name"]),
                ParagraphStyle(
                    "metro_name",
                    parent=styles["name"],
                    fontName="Times-Bold",
                    fontSize=31,
                    leading=32.8,
                    textColor=palette["name"],
                    spaceAfter=2.4,
                ),
            )
        ]
        if parsed["headline"]:
            left_header.append(
                Paragraph(
                    resume_inline_html(parsed["headline"]),
                    ParagraphStyle(
                        "metro_headline",
                        parent=styles["headline"],
                        fontName="Helvetica-Bold",
                        fontSize=11.2,
                        leading=14.1,
                        textColor=palette["accent"],
                        spaceAfter=0,
                    ),
                )
            )

        right_lines: list[Any] = []
        for item in [piece.strip() for piece in safe_text(parsed["contact_line"]).split("|") if piece.strip()]:
            right_lines.append(
                Paragraph(
                    resume_inline_html(item),
                    ParagraphStyle(
                        "metro_contact_item",
                        parent=styles["contact"],
                        fontName="Helvetica-Bold",
                        fontSize=9.3,
                        leading=11.8,
                        textColor=palette["text"],
                        alignment=2,
                        spaceAfter=0.5,
                    ),
                )
            )
        if not right_lines:
            right_lines.append(Paragraph("Metro Prime Resume", styles["meta_line"]))

        header_table = Table([[left_header, right_lines]], colWidths=[doc.width * 0.64, doc.width * 0.36])
        header_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4.8),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ]
            )
        )
        story.append(header_table)
        story.append(HRFlowable(width="100%", color=palette["line"], thickness=0.86, spaceBefore=0.8, spaceAfter=5.8))
    else:
        story.append(Paragraph("MINIMAL FLOW", styles["badge"]))
        story.append(Paragraph(resume_inline_html(parsed["name"]), styles["name"]))
        if parsed["contact_line"]:
            story.append(Paragraph(resume_inline_html(parsed["contact_line"]), styles["contact"]))
        if parsed["headline"]:
            story.append(Paragraph(resume_inline_html(parsed["headline"]), styles["headline"]))
        surface_meta = ""
        if parsed["contact_line"]:
            surface_meta = parsed["contact_line"]
        if parsed["headline"]:
            surface_meta = f"{surface_meta} | {parsed['headline']}" if surface_meta else parsed["headline"]
        if surface_meta:
            meta_table = Table([[Paragraph(resume_inline_html(surface_meta), styles["meta_line"])]], colWidths=[doc.width])
            meta_table.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, -1), palette["surface"]),
                        ("LEFTPADDING", (0, 0), (-1, -1), 8),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                        ("TOPPADDING", (0, 0), (-1, -1), 5),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 4.6),
                        ("BOX", (0, 0), (-1, -1), 0.6, palette["line"]),
                    ]
                )
            )
            story.append(meta_table)
            story.append(Spacer(1, 3.2))
        story.append(HRFlowable(width="100%", color=palette["line"], thickness=0.9, spaceBefore=1.5, spaceAfter=6.4))

    sidebar_sections: list[tuple[str, list[str]]] = []
    if template_key == "slate":
        sidebar_sections = collect_slate_sidebar_sections(parsed)
        sidebar_keys = {key for key, _lines in sidebar_sections}
        main_sections = [(key, lines) for key, lines in parsed["sections"] if key not in sidebar_keys] or parsed["sections"]
        append_resume_sections_to_story(story, template_key, main_sections, styles, palette, doc.width)
    else:
        append_resume_sections_to_story(story, template_key, parsed["sections"], styles, palette, doc.width)

    if template_key == "slate":
        def _on_first(pdf: canvas.Canvas, page_doc: SimpleDocTemplate) -> None:
            draw_template_page_decoration(pdf, page_doc, template_key)
            draw_slate_sidebar_content(pdf, parsed, sidebar_sections)

        def _on_later(pdf: canvas.Canvas, page_doc: SimpleDocTemplate) -> None:
            draw_template_page_decoration(pdf, page_doc, template_key)
            draw_slate_sidebar_content(pdf, parsed, sidebar_sections)

        doc.build(story, onFirstPage=_on_first, onLaterPages=_on_later)
    else:
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


@app.get("/version")
def version() -> dict[str, Any]:
    short_sha = APP_BUILD_SHA[:12] if APP_BUILD_SHA else "unknown"
    return {
        "service": "hirescore-backend",
        "version": short_sha,
        "commit_sha": APP_BUILD_SHA or None,
        "started_at": APP_STARTED_AT,
        "analyze_mode": ANALYZE_MODE,
    }


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
    if not EMAIL_OTP_REQUIRED:
        return signup(AuthRequest(email=data.email, password=data.password))

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
        if is_google_sso_user(int(user["id"])):
            log_analytics_event("auth", "login_failed_google_password_attempt", user_id=int(user["id"]), meta={"email": email})
            raise HTTPException(status_code=401, detail="This account uses Google sign-in. Click Continue with Google.")
        log_analytics_event("auth", "login_failed_wrong_password", user_id=int(user["id"]), meta={"email": email})
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    log_analytics_event("auth", "login_success", user_id=int(user["id"]), meta={"email": email})
    return auth_response_payload(user, create_auth_token(int(user["id"]), str(user["email"])))


@app.post("/auth/google")
def google_auth(data: GoogleAuthRequest) -> dict[str, Any]:
    claims = verify_google_id_token(data.credential)
    email = claims["email"]
    user = fetch_user_by_email(email)
    is_new_user = user is None

    if not user:
        synthetic_password = f"google::{safe_text(claims.get('sub') or '') or 'user'}::{secrets.token_hex(18)}"
        user = create_user_with_welcome_credits(email, synthetic_password, source="google_sso")
        send_welcome_email(email)

    sync_user_after_google_login(int(user["id"]), claims.get("name"))
    refreshed_user = fetch_user_by_id(int(user["id"])) or user
    event_name = "signup_success" if is_new_user else "login_success"
    log_analytics_event("auth", event_name, user_id=int(refreshed_user["id"]), meta={"email": email, "via": "google"})
    return auth_response_payload(
        refreshed_user,
        create_auth_token(int(refreshed_user["id"]), str(refreshed_user["email"])),
    )


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


@app.post("/auth/public-access-session")
def public_access_session(data: PublicAccessSessionRequest | None = None) -> dict[str, Any]:
    if not public_feature_access_enabled():
        raise HTTPException(status_code=403, detail="Public feature access is currently disabled.")

    guest_key = normalize_public_access_key(data.guest_key if data else None)
    user = get_or_create_public_access_user(guest_key, data.name if data else None)
    auth_token = create_auth_token(
        int(user["id"]),
        str(user["email"]),
        ttl_seconds=PUBLIC_ACCESS_GUEST_TOKEN_TTL_HOURS * 3600,
    )
    key_fingerprint = hashlib.sha256(guest_key.encode("utf-8")).hexdigest()[:12]
    log_analytics_event(
        "auth",
        "public_access_session_started",
        user_id=int(user["id"]),
        meta={"guest_key_fingerprint": key_fingerprint},
    )
    payload = auth_response_payload(user, auth_token)
    payload["guest_mode"] = True
    payload["guest_key"] = guest_key
    payload["token_expires_hours"] = PUBLIC_ACCESS_GUEST_TOKEN_TTL_HOURS
    payload["public_feature_access_enabled"] = True
    return payload


@app.patch("/auth/profile")
def auth_profile_update(data: AuthProfileUpdateRequest, request: Request) -> dict[str, Any]:
    user = require_authenticated_user(request, data.auth_token)

    if data.name is None:
        return auth_response_payload(user)

    name = normalize_profile_name(data.name)

    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            cursor.execute("UPDATE users SET full_name = ? WHERE id = ?", (name, int(user["id"])))
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    refreshed = fetch_user_by_id(int(user["id"]))
    if not refreshed:
        raise HTTPException(status_code=500, detail="Unable to refresh profile right now.")

    log_analytics_event(
        "auth",
        "profile_name_updated",
        user_id=int(refreshed["id"]),
        meta={"guest_mode": is_public_access_guest_user(refreshed)},
    )
    return auth_response_payload(refreshed)


@app.get("/feature-flags")
def feature_flags(request: Request, auth_token: str | None = None) -> dict[str, Any]:
    user_id: int | None = None
    try:
        user = require_authenticated_user(request, auth_token)
        user_id = int(user["id"])
    except HTTPException:
        user_id = None
    return {
        "feature_flags": build_feature_flags(user_id),
        "variant_seed": int(user_id or 0),
    }


@app.get("/dashboard/bootstrap")
def dashboard_bootstrap(
    request: Request,
    auth_token: str | None = None,
    reports_limit: int = 30,
    roadmap_limit: int = 24,
) -> dict[str, Any]:
    user = require_authenticated_user(request, auth_token)
    user_id = int(user["id"])
    safe_reports_limit = int(clamp_float(float(reports_limit), 1.0, 120.0))
    safe_roadmap_limit = int(clamp_float(float(roadmap_limit), 1.0, 64.0))

    connection = auth_db_connection()
    try:
        reports = collect_analysis_reports_for_user(connection, user_id, safe_reports_limit)
        job_tracks = fetch_application_job_tracks_for_user(connection, user_id, limit=12)
        roadmaps = fetch_goal_roadmaps_for_user(connection, user_id, limit=safe_roadmap_limit)
        roadmap = roadmaps[0] if roadmaps else None
        analysis_comparison = build_analysis_comparison_payload(connection, user_id)
        role_benchmark = build_role_benchmark_payload(
            connection,
            user_id,
            report_id=int((analysis_comparison.get("latest") or {}).get("id") or 0) or None,
        )
    finally:
        connection.close()

    return {
        "auth": auth_response_payload(user),
        "reports": reports,
        "job_tracks": job_tracks,
        "roadmap": roadmap,
        "roadmaps": roadmaps,
        "analysis_comparison": analysis_comparison,
        "weekly_execution_coach": build_weekly_execution_coach_payload(roadmap),
        "role_benchmark": role_benchmark,
        "feature_flags": build_feature_flags(user_id),
    }


@app.get("/roadmap/current")
def user_goal_roadmap(request: Request, auth_token: str | None = None) -> dict[str, Any]:
    user = require_authenticated_user(request, auth_token)
    connection = auth_db_connection()
    try:
        roadmap = fetch_goal_roadmap_for_user(connection, int(user["id"]), roadmap_id=None)
        roadmaps = fetch_goal_roadmaps_for_user(connection, int(user["id"]), limit=32)
    finally:
        connection.close()
    return {"roadmap": roadmap, "roadmaps": roadmaps}


@app.get("/roadmap/list")
def user_goal_roadmap_list(request: Request, auth_token: str | None = None, limit: int = 32) -> dict[str, Any]:
    user = require_authenticated_user(request, auth_token)
    safe_limit = int(clamp_float(float(limit), 1.0, 64.0))
    connection = auth_db_connection()
    try:
        roadmaps = fetch_goal_roadmaps_for_user(connection, int(user["id"]), limit=safe_limit)
    finally:
        connection.close()
    return {
        "roadmaps": roadmaps,
        "roadmap": roadmaps[0] if roadmaps else None,
        "count": len(roadmaps),
    }


@app.post("/roadmap/preview-upsert")
def user_goal_roadmap_preview_upsert(data: GoalRoadmapUpsertRequest, request: Request) -> dict[str, Any]:
    user = require_authenticated_user(request, data.auth_token)
    milestones_count = len(data.milestones or [])
    if milestones_count > 24:
        raise HTTPException(status_code=400, detail="Roadmap supports up to 24 milestones.")

    connection = auth_db_connection()
    try:
        preview_payload = preview_goal_roadmap_upsert_for_user(connection, int(user["id"]), data)
    finally:
        connection.close()

    log_analytics_event(
        "roadmap",
        "roadmap_preview_upsert_requested",
        user_id=int(user["id"]),
        meta={
            "incoming_milestones": milestones_count,
            "action": safe_text(preview_payload.get("action")),
            "similarity_score": float(preview_payload.get("similarity_score") or 0),
        },
    )
    return preview_payload


@app.post("/roadmap/upsert")
def user_goal_roadmap_upsert(data: GoalRoadmapUpsertRequest, request: Request) -> dict[str, Any]:
    user = require_authenticated_user(request, data.auth_token)
    milestones_count = len(data.milestones or [])
    if milestones_count > 24:
        raise HTTPException(status_code=400, detail="Roadmap supports up to 24 milestones.")

    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            result_payload = upsert_goal_roadmap_for_user(connection, int(user["id"]), data)
            connection.commit()
        except HTTPException:
            connection.rollback()
            raise
        except Exception as exc:
            connection.rollback()
            logger.exception("Failed to upsert roadmap for user %s", int(user["id"]))
            raise HTTPException(status_code=500, detail="Unable to update roadmap right now.") from exc
        finally:
            connection.close()

    log_analytics_event(
        "roadmap",
        "roadmap_upserted",
        user_id=int(user["id"]),
        meta={
            "action": safe_text(result_payload.get("action")),
            "created_new_track": bool(result_payload.get("created_new_track")),
            "added_milestones": int(result_payload.get("added_milestones") or 0),
            "similarity_score": float(result_payload.get("similarity_score") or 0),
            "milestones": int((result_payload.get("roadmap") or {}).get("total_milestones") or 0),
            "progress_percent": int((result_payload.get("roadmap") or {}).get("progress_percent") or 0),
        },
    )
    return {
        **result_payload,
        "message": "Roadmap updated.",
    }


def toggle_roadmap_milestone_handler(
    roadmap_id: int | None,
    milestone_id: str,
    data: GoalRoadmapMilestoneToggleRequest,
    request: Request,
) -> dict[str, Any]:
    user = require_authenticated_user(request, data.auth_token)
    if not safe_text(milestone_id):
        raise HTTPException(status_code=400, detail="Invalid milestone id.")

    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            toggle_payload = toggle_goal_roadmap_milestone_for_user(
                connection,
                int(user["id"]),
                milestone_id,
                bool(data.completed),
                roadmap_id=roadmap_id,
            )
            connection.commit()
        except HTTPException:
            connection.rollback()
            raise
        except Exception as exc:
            connection.rollback()
            logger.exception("Failed to toggle roadmap milestone for user %s", int(user["id"]))
            raise HTTPException(status_code=500, detail="Unable to update milestone right now.") from exc
        finally:
            connection.close()

    log_analytics_event(
        "roadmap",
        "roadmap_milestone_toggled",
        user_id=int(user["id"]),
        meta={
            "roadmap_id": int((toggle_payload.get("roadmap") or {}).get("id") or 0),
            "milestone_id": sanitize_goal_roadmap_milestone_id(milestone_id, 1),
            "completed": bool(data.completed),
            "progress_percent": int((toggle_payload.get("roadmap") or {}).get("progress_percent") or 0),
        },
    )
    return toggle_payload


@app.post("/roadmap/{roadmap_id}/milestones/{milestone_id}/toggle")
def user_goal_roadmap_toggle_milestone_by_track(
    roadmap_id: int,
    milestone_id: str,
    data: GoalRoadmapMilestoneToggleRequest,
    request: Request,
) -> dict[str, Any]:
    if roadmap_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid roadmap id.")
    return toggle_roadmap_milestone_handler(roadmap_id, milestone_id, data, request)


@app.post("/roadmap/milestones/{milestone_id}/toggle")
def user_goal_roadmap_toggle_milestone(
    milestone_id: str,
    data: GoalRoadmapMilestoneToggleRequest,
    request: Request,
) -> dict[str, Any]:
    return toggle_roadmap_milestone_handler(None, milestone_id, data, request)


def evidence_roadmap_milestone_handler(
    roadmap_id: int | None,
    milestone_id: str,
    data: GoalRoadmapMilestoneEvidenceRequest,
    request: Request,
) -> dict[str, Any]:
    user = require_authenticated_user(request, data.auth_token)
    if not safe_text(milestone_id):
        raise HTTPException(status_code=400, detail="Invalid milestone id.")

    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            evidence_payload = update_goal_roadmap_milestone_evidence_for_user(
                connection,
                int(user["id"]),
                milestone_id,
                data.note,
                data.link,
                roadmap_id=roadmap_id,
            )
            connection.commit()
        except HTTPException:
            connection.rollback()
            raise
        except Exception as exc:
            connection.rollback()
            logger.exception("Failed to update roadmap milestone evidence for user %s", int(user["id"]))
            raise HTTPException(status_code=500, detail="Unable to update milestone evidence right now.") from exc
        finally:
            connection.close()

    log_analytics_event(
        "roadmap",
        "roadmap_milestone_evidence_updated",
        user_id=int(user["id"]),
        meta={
            "roadmap_id": int((evidence_payload.get("roadmap") or {}).get("id") or 0),
            "milestone_id": sanitize_goal_roadmap_milestone_id(milestone_id, 1),
            "has_note": bool(safe_text(data.note)),
            "has_link": bool(safe_text(data.link)),
        },
    )
    return evidence_payload


@app.post("/roadmap/{roadmap_id}/milestones/{milestone_id}/evidence")
def user_goal_roadmap_milestone_evidence_by_track(
    roadmap_id: int,
    milestone_id: str,
    data: GoalRoadmapMilestoneEvidenceRequest,
    request: Request,
) -> dict[str, Any]:
    if roadmap_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid roadmap id.")
    return evidence_roadmap_milestone_handler(roadmap_id, milestone_id, data, request)


@app.post("/roadmap/milestones/{milestone_id}/evidence")
def user_goal_roadmap_milestone_evidence(
    milestone_id: str,
    data: GoalRoadmapMilestoneEvidenceRequest,
    request: Request,
) -> dict[str, Any]:
    return evidence_roadmap_milestone_handler(None, milestone_id, data, request)


@app.post("/public/instant-fit-check")
def public_instant_fit_check(data: PublicInstantFitCheckRequest, request: Request) -> dict[str, Any]:
    session_id = normalize_session_id(data.session_id)
    _usage_key, usage_count, remaining = consume_public_instant_quota(request, session_id, action="analyze")
    role = safe_text(data.role) or "Target role"
    industry = safe_text(data.industry) or "General"
    resume_text = safe_text(data.resume_text).strip()
    job_description = safe_text(data.job_description).strip()

    if len(resume_text) < 24:
        raise HTTPException(status_code=400, detail="Resume text is too short.")
    if len(job_description) < 24:
        raise HTTPException(status_code=400, detail="Job description text is too short.")

    resume_text = resume_text[:PUBLIC_INSTANT_MAX_TEXT_CHARS]
    job_description = job_description[:PUBLIC_INSTANT_MAX_TEXT_CHARS]

    try:
        jd_match_payload = build_jd_match_payload(industry, role, resume_text, job_description)
        instant_result = build_public_instant_fit_result(jd_match_payload, role=role, industry=industry)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Unable to run instant JD fit check right now.") from exc

    result_id = secrets.token_urlsafe(10).replace("-", "").replace("_", "")[:16]
    created_at_iso = now_utc_iso()
    now_ts = time.time()
    client_key = public_instant_client_key(request, session_id)
    with PUBLIC_INSTANT_LOCK:
        cleanup_public_instant_stores(now_ts)
        PUBLIC_INSTANT_RESULT_STORE[result_id] = {
            "created_at": created_at_iso,
            "created_at_ts": now_ts,
            "client_key": client_key,
            "session_id": session_id,
            "result": instant_result,
        }

    log_analytics_event(
        "analysis",
        "analysis_public_instant_fit_generated",
        meta={
            "match_percentage": int(instant_result.get("match_percentage") or 0),
            "missing_skills": len(instant_result.get("missing_skills") or []),
            "is_field_mismatch": bool((instant_result.get("jd_relevance") or {}).get("is_field_mismatch")),
            "usage_count": usage_count,
        },
    )
    return {
        **instant_result,
        "result_id": result_id,
        "created_at": created_at_iso,
        "rate_limit": {
            "window_seconds": PUBLIC_INSTANT_REQUEST_WINDOW_SECONDS,
            "limit": PUBLIC_INSTANT_REQUEST_LIMIT,
            "remaining": remaining,
        },
    }


@app.post("/public/instant-fit-check/extract")
async def public_instant_fit_check_extract(
    request: Request,
    file: UploadFile = File(...),
    session_id: str | None = Form(None),
) -> dict[str, Any]:
    consume_public_instant_quota(request, session_id, action="extract")
    file_name = safe_text(file.filename) or "uploaded-document"
    content_type = safe_text(file.content_type)
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(contents) > PUBLIC_INSTANT_FILE_MAX_BYTES:
        raise HTTPException(status_code=400, detail="File is too large. Upload a file smaller than 12 MB.")

    extracted_text = extract_job_description_text_from_upload(file_name, content_type, contents).strip()
    if len(extracted_text) < 24:
        raise HTTPException(status_code=400, detail="Could not extract enough text. Upload a clearer file or paste text.")

    return {
        "extracted_text": extracted_text[:PUBLIC_INSTANT_MAX_TEXT_CHARS],
        "extracted_chars": len(extracted_text),
        "file_name": file_name,
        "file_type": content_type or "",
    }


@app.post("/public/instant-fit-check/share")
def public_instant_fit_share_create(data: PublicInstantFitShareRequest, request: Request) -> dict[str, Any]:
    result_id = safe_text(data.result_id)
    if len(result_id) < 8:
        raise HTTPException(status_code=400, detail="Invalid result id.")

    client_key = public_instant_client_key(request, data.session_id)
    share_id = secrets.token_urlsafe(9).replace("-", "").replace("_", "")[:14]
    now_iso = now_utc_iso()
    now_ts = time.time()

    with PUBLIC_INSTANT_LOCK:
        cleanup_public_instant_stores(now_ts)
        result_entry = PUBLIC_INSTANT_RESULT_STORE.get(result_id)
        if not result_entry:
            raise HTTPException(status_code=404, detail="Result not found. Run Instant Fit Check again.")
        if safe_text(result_entry.get("client_key")) != client_key:
            raise HTTPException(status_code=403, detail="This result belongs to a different session.")

        while share_id in PUBLIC_INSTANT_SHARE_STORE:
            share_id = secrets.token_urlsafe(9).replace("-", "").replace("_", "")[:14]

        PUBLIC_INSTANT_SHARE_STORE[share_id] = {
            "share_id": share_id,
            "source_result_id": result_id,
            "created_at": now_iso,
            "created_at_ts": now_ts,
            "result": result_entry.get("result") if isinstance(result_entry.get("result"), dict) else {},
        }

    return {
        "share_id": share_id,
        "share_path": f"/instant-fit/share/{share_id}",
        "created_at": now_iso,
        "expires_in_seconds": PUBLIC_INSTANT_SHARE_TTL_SECONDS,
    }


@app.get("/public/instant-fit-check/share/{share_id}")
def public_instant_fit_share_fetch(share_id: str) -> dict[str, Any]:
    normalized_share_id = re.sub(r"[^A-Za-z0-9]", "", safe_text(share_id))[:32]
    if len(normalized_share_id) < 8:
        raise HTTPException(status_code=400, detail="Invalid share id.")

    now_ts = time.time()
    with PUBLIC_INSTANT_LOCK:
        cleanup_public_instant_stores(now_ts)
        share_entry = PUBLIC_INSTANT_SHARE_STORE.get(normalized_share_id)
        if not share_entry:
            raise HTTPException(status_code=404, detail="Shared result not found or expired.")

    result_payload = share_entry.get("result") if isinstance(share_entry.get("result"), dict) else {}
    return {
        "share_id": normalized_share_id,
        "created_at": safe_text(share_entry.get("created_at")) or "",
        "result": result_payload,
    }


@app.post("/analysis/jd-match")
def analysis_jd_match(data: JobDescriptionMatchRequest, request: Request) -> dict[str, Any]:
    user = require_authenticated_user(request, data.auth_token)
    job_description = safe_text(data.job_description)
    resume_text = safe_text(data.resume_text)
    if len(job_description) < 24:
        raise HTTPException(status_code=400, detail="Job description is too short.")
    if len(resume_text) < 24:
        raise HTTPException(status_code=400, detail="Resume text is too short.")

    debit = debit_credits(
        int(user["id"]),
        "jd_match",
        CREDIT_COSTS["jd_match"],
        meta={"route": "/analysis/jd-match", "role": safe_text(data.role), "industry": safe_text(data.industry)},
    )
    try:
        payload = build_jd_match_payload(data.industry, data.role, resume_text, job_description)
        payload["wallet"] = debit["wallet"]
        payload["credit_transaction_id"] = debit["transaction_id"]
        log_analytics_event(
            "analysis",
            "analysis_jd_match_generated",
            user_id=int(user["id"]),
            meta={
                "role": safe_text(data.role),
                "industry": safe_text(data.industry),
                "match_score": int(payload.get("match_score") or 0),
                "missing_keywords": len(payload.get("missing_keywords") or []),
                "credit_transaction_id": debit["transaction_id"],
            },
        )
        return payload
    except HTTPException:
        credit_credits(
            int(user["id"]),
            "refund_jd_match",
            CREDIT_COSTS["jd_match"],
            meta={"reason": "jd_match_failed"},
        )
        raise
    except Exception as exc:
        credit_credits(
            int(user["id"]),
            "refund_jd_match",
            CREDIT_COSTS["jd_match"],
            meta={"reason": "jd_match_failed_unhandled"},
        )
        raise HTTPException(status_code=500, detail="Unable to run JD match right now.") from exc


@app.post("/analysis/jd-match/extract")
async def analysis_jd_match_extract_from_file(
    request: Request,
    file: UploadFile = File(...),
    auth_token: str | None = Form(None),
) -> dict[str, Any]:
    user = resolve_optional_authenticated_user(request, auth_token)
    file_name = safe_text(file.filename) or "uploaded-jd"
    content_type = safe_text(file.content_type)
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(contents) > 12 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="JD file is too large. Upload a file smaller than 12 MB.")

    job_description = extract_job_description_text_from_upload(file_name, content_type, contents).strip()
    if len(job_description) < 24:
        raise HTTPException(
            status_code=400,
            detail="Could not extract enough JD text. Upload a clearer file or paste the description manually.",
        )

    log_analytics_event(
        "analysis",
        "analysis_jd_file_extracted",
        user_id=int(user["id"]) if user else None,
        meta={
            "file_type": content_type or "unknown",
            "file_name": file_name[:120],
            "chars": len(job_description),
        },
    )
    return {
        "job_description": job_description[:16000],
        "extracted_chars": len(job_description),
        "file_name": file_name,
        "file_type": content_type or "",
    }


@app.get("/analysis/reports/compare")
def analysis_reports_compare(request: Request, auth_token: str | None = None) -> dict[str, Any]:
    user = require_authenticated_user(request, auth_token)
    connection = auth_db_connection()
    try:
        return build_analysis_comparison_payload(connection, int(user["id"]))
    finally:
        connection.close()


@app.get("/analysis/role-benchmark")
def analysis_role_benchmark(
    request: Request,
    auth_token: str | None = None,
    report_id: int | None = None,
    role: str | None = None,
    industry: str | None = None,
    score: int | None = None,
) -> dict[str, Any]:
    user = require_authenticated_user(request, auth_token)
    connection = auth_db_connection()
    try:
        return build_role_benchmark_payload(
            connection,
            int(user["id"]),
            role=role,
            industry=industry,
            score=score,
            report_id=report_id,
        )
    finally:
        connection.close()


@app.post("/analysis/interview-prep")
def analysis_interview_prep(data: InterviewPrepRequest, request: Request) -> dict[str, Any]:
    user = require_authenticated_user(request, data.auth_token)
    payload = build_interview_prep_payload(data)
    log_analytics_event(
        "analysis",
        "analysis_interview_prep_generated",
        user_id=int(user["id"]),
        meta={
            "role": safe_text(data.role),
            "industry": safe_text(data.industry),
            "ai_used": bool((payload.get("ai") or {}).get("used")),
        },
    )
    return payload


@app.post("/analysis/interview-simulator/start")
def analysis_interview_simulator_start(data: InterviewSimulatorStartRequest, request: Request) -> dict[str, Any]:
    user = resolve_optional_authenticated_user(request, data.auth_token)
    owner_user_id = int(user["id"]) if user else 0
    candidate_name = safe_text(data.candidate_name).strip()
    role = safe_text(data.role).strip()
    industry = safe_text(data.industry).strip() or "General"
    if len(candidate_name) < 2:
        raise HTTPException(status_code=400, detail="Enter your name before starting the simulator.")
    if len(role) < 2:
        raise HTTPException(status_code=400, detail="Enter a valid role before starting the simulator.")

    difficulty = normalize_interview_simulator_difficulty(data.difficulty)
    mode = normalize_interview_simulator_mode(data.mode)
    resume_text = safe_text(data.resume_text)[:14000]
    job_description = safe_text(data.job_description)[:14000]
    if mode == INTERVIEW_SIMULATOR_MODE_FULL:
        if len(resume_text.strip()) < 24:
            raise HTTPException(status_code=400, detail="Upload or paste your resume before starting.")
        if len(job_description.strip()) < 24:
            raise HTTPException(status_code=400, detail="Upload or paste the JD before starting.")
    candidate_level = infer_interview_simulator_candidate_level(role, resume_text)
    if mode == INTERVIEW_SIMULATOR_MODE_DEMO:
        stage_plan = build_interview_simulator_demo_stage_plan()
    else:
        stage_plan = build_interview_simulator_stage_plan(difficulty, candidate_level=candidate_level)
    total_rounds = len(stage_plan)
    guest_fingerprint = ""
    guest_free_interviews_remaining: int | None = None
    if owner_user_id <= 0 and mode == INTERVIEW_SIMULATOR_MODE_FULL:
        guest_fingerprint, _guest_usage_count, guest_remaining = enforce_guest_interview_quota(request)
        guest_free_interviews_remaining = max(0, guest_remaining - 1)
    focus_skills = sanitize_interview_simulator_focus_skills(
        collect_interview_simulator_focus_skills(role, industry, resume_text, job_description),
        limit=10,
    )
    resume_focus_skills = sanitize_interview_simulator_focus_skills(
        collect_interview_simulator_resume_focus_skills(resume_text),
        limit=10,
    )
    interviewer_profile = build_interview_simulator_interviewer_profile(role, industry)
    interviewer_name = safe_text(interviewer_profile.get("name")) or pick_interview_simulator_interviewer_name(role, industry)
    interviewer_title = safe_text(interviewer_profile.get("title")) or "Lead Interviewer"
    interviewer_voice = normalize_interview_simulator_tts_voice(interviewer_profile.get("voice"))
    interviewer_style = safe_text(interviewer_profile.get("style")) or "warm, concise, and observant"
    candidate_profile_note = build_interview_simulator_candidate_profile_note(
        candidate_name,
        role,
        industry,
        resume_focus_skills,
        resume_text,
    )
    candidate_reports_no_direct_experience = any(
        token in safe_text(candidate_profile_note).strip().lower()
        for token in ["transition", "moving toward", "moving into", "transferable experience", "adjacent path"]
    )
    opening_remark = build_interview_simulator_opening_remark(
        candidate_name,
        interviewer_name,
        interviewer_title,
        role,
        candidate_profile_note,
    )
    closing_remark = build_interview_simulator_closing_remark(candidate_name, interviewer_name, [])
    opening_question = build_interview_simulator_opening_question(
        role,
        industry,
        difficulty,
        focus_skills,
        candidate_profile_note=candidate_profile_note,
        candidate_level=candidate_level,
    )

    opener_model: str | None = None
    opener_error: str | None = None
    if client is not None:
        opener_prompt = f"""
You are an interview panel. Generate one concise opening question for round 1 screening in a live interview simulation.
Role: {safe_text(role)}
Industry: {safe_text(industry)}
Difficulty: {safe_text(difficulty)}
Focus skills: {json.dumps(focus_skills[:8], ensure_ascii=False)}
Candidate background note: {safe_text(candidate_profile_note)}
Interviewer persona: {safe_text(interviewer_name)}, {safe_text(interviewer_title)}. Style: {safe_text(interviewer_style)}.
Output JSON schema:
{{"opening_question":"question text"}}
"""
        opener_payload, opener_model, opener_error = request_structured_json_with_llm(opener_prompt, temperature=0.18)
        if isinstance(opener_payload, dict):
            candidate = safe_text(opener_payload.get("opening_question"))
            if len(candidate) >= 12:
                opening_question = candidate[:240]

    session_id = secrets.token_urlsafe(14).replace("-", "").replace("_", "")[:22]
    session_secret = secrets.token_urlsafe(16).replace("-", "").replace("_", "")[:28]
    now_iso = now_utc_iso()
    now_ts = time.time()
    opening_question_entry = build_interview_simulator_question_entry(stage_plan, "screening", opening_question, 1)
    session_payload = {
        "id": session_id,
        "session_secret": session_secret,
        "user_id": owner_user_id,
        "guest_fingerprint": guest_fingerprint,
        "candidate_name": candidate_name,
        "role": role,
        "industry": industry,
        "interviewer_name": interviewer_name,
        "interviewer_title": interviewer_title,
        "interviewer_voice": interviewer_voice,
        "interviewer_style": interviewer_style,
        "candidate_profile_note": candidate_profile_note,
        "candidate_reports_no_direct_experience": candidate_reports_no_direct_experience,
        "candidate_connection_notes": [],
        "opening_remark": opening_remark,
        "closing_remark": closing_remark,
        "mode": mode,
        "difficulty": difficulty,
        "candidate_level": candidate_level,
        "focus_skills": focus_skills,
        "resume_focus_skills": resume_focus_skills,
        "total_rounds": total_rounds,
        "stage_plan": stage_plan,
        "question_flow": [opening_question_entry],
        "questions": [opening_question],
        "turns": [],
        "stage_decisions": {},
        "status": "active",
        "saved_report_id": 0,
        "current_stage_key": "screening",
        "current_stage_label": "Screening",
        "current_stage_number": 1,
        "question_number_in_stage": 1,
        "created_at": now_iso,
        "updated_at": now_iso,
        "created_at_ts": now_ts,
        "expires_at_ts": now_ts + INTERVIEW_SIMULATOR_TTL_SECONDS,
        "ai": {
            "used": bool(opener_model),
            "model": opener_model,
            "reason": opener_error or ("llm_opening" if opener_model else "rules_opening"),
        },
    }
    if owner_user_id <= 0 and mode == INTERVIEW_SIMULATOR_MODE_FULL and guest_fingerprint:
        consume_guest_interview_quota(guest_fingerprint, request)

    with INTERVIEW_SIMULATOR_LOCK:
        cleanup_interview_simulator_sessions(now_ts)
        while session_id in INTERVIEW_SIMULATOR_SESSIONS:
            session_id = secrets.token_urlsafe(14).replace("-", "").replace("_", "")[:22]
            session_payload["id"] = session_id
        INTERVIEW_SIMULATOR_SESSIONS[session_id] = session_payload

    queue_interview_simulator_tts_prefetch(
        session_id,
        build_interview_simulator_spoken_text(
            opening_question,
            1,
            1,
            opening_remark=opening_remark,
        ),
        requested_voice=interviewer_voice or INTERVIEW_SIMULATOR_TTS_PREFETCH_VOICE,
    )

    log_analytics_event(
        "interview",
        "interview_simulator_started",
        user_id=owner_user_id or None,
        meta={
            "candidate_name": candidate_name[:80],
            "role": role,
            "industry": industry,
            "difficulty": difficulty,
            "mode": mode,
            "total_rounds": total_rounds,
            "focus_skills": focus_skills[:6],
            "guest_mode": owner_user_id <= 0,
        },
    )
    return {
        "session_id": session_id,
        "session_secret": session_secret,
        "candidate_name": candidate_name,
        "role": role,
        "industry": industry,
        "interviewer_name": interviewer_name,
        "interviewer_title": interviewer_title,
        "interviewer_voice": interviewer_voice,
        "opening_remark": opening_remark,
        "closing_remark": closing_remark,
        "mode": mode,
        "difficulty": difficulty,
        "candidate_level": candidate_level,
        "focus_skills": sanitize_interview_simulator_focus_skills(focus_skills, limit=8),
        "round_number": 1,
        "current_stage_key": "screening",
        "current_stage_label": "Screening",
        "question_number_in_stage": 1,
        "total_rounds": total_rounds,
        "progress_percent": int(round((1 / max(1, total_rounds)) * 100)),
        "current_question": opening_question,
        "status": "active",
        "report": None,
        "guest_free_interviews_remaining": guest_free_interviews_remaining,
        "ai": session_payload["ai"],
    }


@app.post("/analysis/interview-simulator/turn")
def analysis_interview_simulator_turn(data: InterviewSimulatorTurnRequest, request: Request) -> dict[str, Any]:
    user = resolve_optional_authenticated_user(request, data.auth_token)
    session_id = re.sub(r"[^A-Za-z0-9]", "", safe_text(data.session_id))[:32]
    session_secret = safe_text(data.session_secret)[:64]
    answer_text = safe_text(data.answer_text).strip()
    video_frame_samples = sanitize_interview_simulator_video_frames(
        data.video_frame_samples,
        limit=INTERVIEW_SIMULATOR_VIDEO_SENTIMENT_MAX_FRAMES,
    )
    answer_too_short = len(answer_text) < 18
    if len(session_id) < 8:
        raise HTTPException(status_code=400, detail="Invalid simulator session id.")

    now_ts = time.time()
    existing_screening_decision = ""
    existing_screening_decision_reason = ""
    with INTERVIEW_SIMULATOR_LOCK:
        cleanup_interview_simulator_sessions(now_ts)
        existing = INTERVIEW_SIMULATOR_SESSIONS.get(session_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Simulator session not found or expired.")
        owner_user_id = int(existing.get("user_id") or 0)
        requester_user_id = int(user["id"]) if user else 0
        secret_matches = session_secret and safe_text(existing.get("session_secret")) == session_secret
        if owner_user_id > 0:
            if requester_user_id != owner_user_id and not secret_matches:
                raise HTTPException(status_code=403, detail="This simulator session belongs to a different user.")
        elif not secret_matches:
            raise HTTPException(status_code=401, detail="Session secret mismatch. Restart the simulator.")
        elif requester_user_id > 0:
            existing["user_id"] = requester_user_id
            owner_user_id = requester_user_id
        stage_plan = get_interview_simulator_stage_plan(existing)
        total_rounds = len(stage_plan)
        if safe_text(existing.get("status")) == "completed":
            report_payload = build_interview_simulator_report_payload(existing)
            existing_turns = existing.get("turns") if isinstance(existing.get("turns"), list) else []
            last_turn = existing_turns[-1] if existing_turns else {}
            return {
                "session_id": session_id,
                "mode": normalize_interview_simulator_mode(safe_text(existing.get("mode"))),
                "completed": True,
                "round_number": int(last_turn.get("round_number") or len(build_interview_simulator_stage_summaries(existing_turns, stage_plan)) or 1),
                "current_stage_key": normalize_interview_simulator_turn_stage_key(last_turn if isinstance(last_turn, dict) else {}),
                "current_stage_label": safe_text((last_turn or {}).get("stage_label")) or safe_text(get_interview_simulator_stage_entry(stage_plan, normalize_interview_simulator_turn_stage_key(last_turn if isinstance(last_turn, dict) else {})).get("label")),
                "question_number_in_stage": int((last_turn or {}).get("question_number_in_stage") or 0),
                "total_rounds": total_rounds,
                "progress_percent": 100,
                "next_question": None,
                "turn_feedback": None,
                "report": report_payload,
                "status": "completed",
                "interviewer_bridge": None,
                "closing_remark": safe_text(existing.get("closing_remark")),
                "interviewer_title": safe_text(existing.get("interviewer_title")),
                "interviewer_voice": safe_text(existing.get("interviewer_voice")),
                "saved_report_id": int(existing.get("saved_report_id") or 0) or None,
                "screening_decision": safe_text(existing.get("screening_decision")).strip().lower() or None,
                "screening_decision_reason": safe_text(existing.get("screening_decision_reason")) or None,
            }
        turns = existing.get("turns") if isinstance(existing.get("turns"), list) else []
        expected_turn_count = len(turns)
        role = safe_text(existing.get("role")) or "Target role"
        industry = safe_text(existing.get("industry")) or "General"
        candidate_name = safe_text(existing.get("candidate_name")) or "there"
        mode = normalize_interview_simulator_mode(safe_text(existing.get("mode")))
        difficulty = normalize_interview_simulator_difficulty(safe_text(existing.get("difficulty")))
        focus_skills = dedupe_text_list(existing.get("focus_skills") or [], limit=10, max_item_len=80)
        interviewer_name = safe_text(existing.get("interviewer_name")) or "Avery Bennett"
        interviewer_title = safe_text(existing.get("interviewer_title")) or "Lead Interviewer"
        interviewer_voice = normalize_interview_simulator_tts_voice(existing.get("interviewer_voice"))
        interviewer_style = safe_text(existing.get("interviewer_style")) or "warm, concise, and observant"
        candidate_level = safe_text(existing.get("candidate_level")).strip().lower() or infer_interview_simulator_candidate_level(role, "")
        candidate_reports_no_direct_experience = bool(existing.get("candidate_reports_no_direct_experience"))
        candidate_profile_note = safe_text(existing.get("candidate_profile_note")).strip()
        if not candidate_profile_note:
            resume_focus_skills = dedupe_text_list(existing.get("resume_focus_skills") or [], limit=10, max_item_len=80)
            candidate_profile_note = build_interview_simulator_candidate_profile_note(
                candidate_name,
                role,
                industry,
                resume_focus_skills or focus_skills,
                "",
            )
            if not candidate_reports_no_direct_experience:
                candidate_reports_no_direct_experience = any(
                    token in candidate_profile_note.lower()
                    for token in ["transition", "moving toward", "moving into", "transferable experience", "adjacent path"]
                )
        candidate_connection_notes = normalize_string_list(existing.get("candidate_connection_notes"), limit=6, max_item_len=140)
        question_flow = extract_interview_simulator_question_flow(existing, stage_plan)
        current_question_entry = question_flow[-1] if question_flow else build_interview_simulator_question_entry(
            stage_plan,
            "screening",
            build_interview_simulator_opening_question(
                role,
                industry,
                difficulty,
                focus_skills,
                candidate_profile_note=candidate_profile_note,
                candidate_level=candidate_level,
            ),
            1,
        )
        question = safe_text(current_question_entry.get("question")) or build_interview_simulator_opening_question(
            role,
            industry,
            difficulty,
            focus_skills,
            candidate_profile_note=candidate_profile_note,
            candidate_level=candidate_level,
        )
        current_stage_key = safe_text(current_question_entry.get("stage_key")) or "screening"
        current_stage_label = safe_text(current_question_entry.get("stage_label")) or safe_text(get_interview_simulator_stage_entry(stage_plan, current_stage_key).get("label"))
        round_number = int(current_question_entry.get("stage_number") or get_interview_simulator_stage_entry(stage_plan, current_stage_key).get("stage_number") or 1)
        question_number_in_stage = int(current_question_entry.get("question_number_in_stage") or 1)
        existing_screening_decision = safe_text(existing.get("screening_decision")).strip().lower()
        existing_screening_decision_reason = safe_text(existing.get("screening_decision_reason")).strip()

    candidate_asked_cross_question = detect_interview_simulator_candidate_cross_question(answer_text, question)
    if answer_too_short and not candidate_asked_cross_question:
        raise HTTPException(status_code=400, detail="Answer is too short. Add more context before submitting.")

    if detect_interview_simulator_no_direct_experience_signal(answer_text):
        candidate_reports_no_direct_experience = True

    if candidate_asked_cross_question:
        clarification_bridge = build_interview_simulator_clarification_bridge(
            candidate_name,
            role,
            current_stage_key,
            answer_text,
        )
        clarification_signal = extract_interview_simulator_candidate_signal(answer_text) or "asked for clarification"
        clarification_saved_report_id = 0

        with INTERVIEW_SIMULATOR_LOCK:
            refreshed = INTERVIEW_SIMULATOR_SESSIONS.get(session_id)
            if not refreshed:
                raise HTTPException(status_code=404, detail="Simulator session expired. Start a new one.")
            refreshed_turns = refreshed.get("turns") if isinstance(refreshed.get("turns"), list) else []
            if len(refreshed_turns) != expected_turn_count:
                raise HTTPException(status_code=409, detail="Session was updated from another tab. Refresh and continue.")
            if candidate_reports_no_direct_experience:
                refreshed["candidate_reports_no_direct_experience"] = True
            refreshed["candidate_connection_notes"] = dedupe_text_list(
                [*normalize_string_list(refreshed.get("candidate_connection_notes"), limit=6, max_item_len=140), clarification_signal],
                limit=6,
                max_item_len=140,
            )
            refreshed["updated_at"] = now_utc_iso()
            refreshed["expires_at_ts"] = time.time() + INTERVIEW_SIMULATOR_TTL_SECONDS
            existing_screening_decision = safe_text(refreshed.get("screening_decision")).strip().lower()
            existing_screening_decision_reason = safe_text(refreshed.get("screening_decision_reason")).strip()
            clarification_saved_report_id = int(refreshed.get("saved_report_id") or 0)

        queue_interview_simulator_tts_prefetch(
            session_id,
            build_interview_simulator_spoken_text(
                question,
                round_number,
                question_number_in_stage,
                interviewer_bridge=clarification_bridge,
            ),
            requested_voice=interviewer_voice or INTERVIEW_SIMULATOR_TTS_PREFETCH_VOICE,
        )
        log_analytics_event(
            "interview",
            "interview_simulator_turn_clarification",
            user_id=owner_user_id or None,
            meta={
                "role": role,
                "industry": industry,
                "round_number": round_number,
                "stage_key": current_stage_key,
                "guest_mode": owner_user_id <= 0,
            },
        )
        return {
            "session_id": session_id,
            "mode": mode,
            "completed": False,
            "round_number": round_number,
            "current_stage_key": current_stage_key,
            "current_stage_label": current_stage_label,
            "question_number_in_stage": question_number_in_stage,
            "total_rounds": total_rounds,
            "progress_percent": int(round((round_number / max(1, total_rounds)) * 100)),
            "next_question": question[:260],
            "turn_feedback": None,
            "report": None,
            "status": "active",
            "interviewer_bridge": clarification_bridge,
            "closing_remark": None,
            "interviewer_title": interviewer_title,
            "interviewer_voice": interviewer_voice,
            "saved_report_id": clarification_saved_report_id or None,
            "screening_decision": existing_screening_decision or None,
            "screening_decision_reason": existing_screening_decision_reason or None,
            "round_decision": None,
            "round_decision_reason": None,
            "round_decision_stage_key": None,
            "round_decision_stage_label": None,
        }

    heuristic_payload = build_interview_turn_heuristics(
        question=question,
        answer_text=answer_text,
        role=role,
        industry=industry,
        focus_skills=focus_skills,
        response_time_seconds=data.response_time_seconds,
        difficulty=difficulty,
    )
    video_sentiment_payload, video_sentiment_model, video_sentiment_error = request_interview_simulator_video_sentiment(
        video_frame_samples,
        role=role,
        industry=industry,
        stage_label=current_stage_label,
        question=question,
        answer_text=answer_text,
    )
    llm_overlay, llm_model, llm_error = request_interview_simulator_turn_overlay(
        candidate_name=candidate_name,
        interviewer_name=interviewer_name,
        interviewer_title=interviewer_title,
        interviewer_style=interviewer_style,
        role=role,
        industry=industry,
        difficulty=difficulty,
        stage_key=current_stage_key,
        stage_label=current_stage_label,
        round_number=round_number,
        total_rounds=total_rounds,
        question_number_in_stage=question_number_in_stage,
        focus_skills=focus_skills,
        candidate_profile_note=candidate_profile_note,
        candidate_connection_notes=candidate_connection_notes,
        recent_turn_memory=build_interview_simulator_recent_turn_memory(turns),
        question=question,
        answer_text=answer_text,
        heuristic_payload=heuristic_payload,
        candidate_level=candidate_level,
        candidate_reports_no_direct_experience=candidate_reports_no_direct_experience,
    )

    scores = dict((heuristic_payload.get("scores") or {}))
    strengths = dedupe_text_list(heuristic_payload.get("strengths") or [], limit=4, max_item_len=180)
    improvements = dedupe_text_list(heuristic_payload.get("improvements") or [], limit=4, max_item_len=180)
    feedback_summary = safe_text(heuristic_payload.get("feedback_summary"))[:220]
    next_focus_skill = ""
    follow_up_question = ""
    interviewer_bridge = ""
    llm_stage_action = ""
    candidate_signal = ""
    ai_used = False

    if isinstance(llm_overlay, dict):
        ai_used = True
        scores["communication"] = clamp(
            (1.0 - INTERVIEW_SIMULATOR_LLM_BLEND) * safe_float(scores.get("communication"), 0.0)
            + INTERVIEW_SIMULATOR_LLM_BLEND * safe_float(llm_overlay.get("communication_score"), 0.0)
        )
        scores["clarity"] = clamp(
            (1.0 - INTERVIEW_SIMULATOR_LLM_BLEND) * safe_float(scores.get("clarity"), 0.0)
            + INTERVIEW_SIMULATOR_LLM_BLEND * safe_float(llm_overlay.get("clarity_score"), 0.0)
        )
        scores["domain_depth"] = clamp(
            (1.0 - INTERVIEW_SIMULATOR_LLM_BLEND) * safe_float(scores.get("domain_depth"), 0.0)
            + INTERVIEW_SIMULATOR_LLM_BLEND * safe_float(llm_overlay.get("domain_depth_score"), 0.0)
        )
        scores["confidence"] = clamp(
            (1.0 - INTERVIEW_SIMULATOR_LLM_BLEND) * safe_float(scores.get("confidence"), 0.0)
            + INTERVIEW_SIMULATOR_LLM_BLEND * safe_float(llm_overlay.get("confidence_score"), 0.0)
        )
        feedback_summary = safe_text(llm_overlay.get("feedback_summary"))[:220] or feedback_summary
        strengths = dedupe_text_list([*normalize_string_list(llm_overlay.get("strengths"), limit=4, max_item_len=180), *strengths], limit=4, max_item_len=180)
        improvements = dedupe_text_list([*normalize_string_list(llm_overlay.get("improvements"), limit=4, max_item_len=180), *improvements], limit=4, max_item_len=180)
        next_focus_skill = safe_text(llm_overlay.get("next_focus_skill"))[:72]
        interviewer_bridge = safe_text(llm_overlay.get("interviewer_bridge"))[:180]
        follow_up_question = safe_text(llm_overlay.get("follow_up_question"))[:240]
        candidate_signal = safe_text(llm_overlay.get("candidate_signal"))[:140]
        llm_stage_action = safe_text(llm_overlay.get("stage_action")).strip().lower()

    if not candidate_signal:
        candidate_signal = extract_interview_simulator_candidate_signal(answer_text)

    adaptive_follow_up_probe = build_interview_simulator_answer_adaptive_probe(
        stage_key=current_stage_key,
        role=role,
        answer_text=answer_text,
        current_question=question,
        candidate_reports_no_direct_experience=candidate_reports_no_direct_experience,
        next_focus_skill=next_focus_skill,
    )
    if adaptive_follow_up_probe:
        if not follow_up_question or len(follow_up_question) < 18:
            follow_up_question = adaptive_follow_up_probe
        elif candidate_reports_no_direct_experience and follow_up_question_demands_direct_experience(follow_up_question):
            follow_up_question = adaptive_follow_up_probe

    if safe_float(heuristic_payload.get("relevance_score"), 0.0) < 58:
        suppress_false_positive_patterns = [
            r"\brelevant\b",
            r"\bmaintained direction\b",
            r"\bmeasurable\b",
            r"\bcredib",
            r"\bimpact\b",
            r"\baligned\b",
        ]
        strengths = [
            item
            for item in strengths
            if not any(re.search(pattern, safe_text(item).lower()) for pattern in suppress_false_positive_patterns)
        ]
        if not strengths:
            strengths = dedupe_text_list(heuristic_payload.get("strengths") or [], limit=4, max_item_len=180)
        if re.search(r"\b(?:strong|solid|relevant|credible|aligned)\b", feedback_summary.lower()):
            feedback_summary = safe_text(heuristic_payload.get("feedback_summary"))[:220] or feedback_summary

    relevance_score_for_video = safe_float(heuristic_payload.get("relevance_score"), 0.0)
    scores = blend_interview_simulator_video_confidence(
        scores,
        video_sentiment_payload,
        relevance_score_for_video,
    )
    if isinstance(video_sentiment_payload, dict) and video_sentiment_payload.get("used"):
        video_sentiment_label = safe_text(video_sentiment_payload.get("sentiment_label")).strip().lower()
        video_confidence_signal = clamp(safe_float(video_sentiment_payload.get("confidence_signal_score"), 0.0))
        if video_sentiment_label in {"positive", "steady"} and video_confidence_signal >= 64:
            strengths = dedupe_text_list(
                ["Your on-camera presence looked composed and interview-ready.", *strengths],
                limit=4,
                max_item_len=180,
            )
        elif video_sentiment_label in {"nervous", "negative"}:
            improvements = dedupe_text_list(
                ["Steady your pace and eye contact to improve on-camera confidence signals.", *improvements],
                limit=4,
                max_item_len=180,
            )

    scores["overall"] = clamp(
        0.27 * safe_float(scores.get("communication"), 0.0)
        + 0.23 * safe_float(scores.get("clarity"), 0.0)
        + 0.32 * safe_float(scores.get("domain_depth"), 0.0)
        + 0.18 * safe_float(scores.get("confidence"), 0.0)
    )
    interviewer_bridge = build_interview_simulator_interviewer_bridge(
        candidate_name,
        answer_text,
        safe_float(scores.get("overall"), 0.0),
        improvements,
        stage_label=current_stage_label,
        candidate_signal=candidate_signal,
        candidate_profile_note=candidate_profile_note,
        off_topic=bool(heuristic_payload.get("off_topic")),
        llm_bridge=interviewer_bridge,
    )

    video_sentiment_turn_payload: dict[str, Any] = {
        "used": bool(video_sentiment_payload and video_sentiment_payload.get("used")),
        "sentiment_label": safe_text((video_sentiment_payload or {}).get("sentiment_label")),
        "sentiment_score": clamp(safe_float((video_sentiment_payload or {}).get("sentiment_score"), 0.0)),
        "confidence_signal_score": clamp(safe_float((video_sentiment_payload or {}).get("confidence_signal_score"), 0.0)),
        "eye_contact_score": clamp(safe_float((video_sentiment_payload or {}).get("eye_contact_score"), 0.0)),
        "engagement_score": clamp(safe_float((video_sentiment_payload or {}).get("engagement_score"), 0.0)),
        "notes": dedupe_text_list(normalize_string_list((video_sentiment_payload or {}).get("notes"), limit=2, max_item_len=140), limit=2, max_item_len=140),
        "frames_analyzed": int((video_sentiment_payload or {}).get("frames_analyzed") or len(video_frame_samples)),
        "model": video_sentiment_model if video_sentiment_payload else None,
        "reason": "vision_overlay" if video_sentiment_payload else (video_sentiment_error or ("no_video_frames" if not video_frame_samples else "vision_unavailable")),
    }

    turn_payload = {
        "round_number": round_number,
        "stage_key": current_stage_key,
        "stage_label": current_stage_label,
        "question_number_in_stage": question_number_in_stage,
        "question": question[:240],
        "answer": answer_text[:5000],
        "answer_word_count": int(heuristic_payload.get("word_count") or 0),
        "response_time_seconds": int(heuristic_payload.get("response_time_seconds") or 0),
        "scores": {
            "communication": clamp(safe_float(scores.get("communication"), 0.0)),
            "clarity": clamp(safe_float(scores.get("clarity"), 0.0)),
            "domain_depth": clamp(safe_float(scores.get("domain_depth"), 0.0)),
            "confidence": clamp(safe_float(scores.get("confidence"), 0.0)),
            "overall": clamp(safe_float(scores.get("overall"), 0.0)),
        },
        "matched_focus_skills": dedupe_text_list(heuristic_payload.get("matched_focus_skills") or [], limit=6, max_item_len=80),
        "missing_focus_skills": dedupe_text_list(heuristic_payload.get("missing_focus_skills") or [], limit=6, max_item_len=80),
        "relevance_score": clamp(safe_float(heuristic_payload.get("relevance_score"), 0.0)),
        "evidence_score": clamp(safe_float(heuristic_payload.get("evidence_score"), 0.0)),
        "off_topic": bool(heuristic_payload.get("off_topic")),
        "feedback_summary": feedback_summary,
        "strengths": strengths,
        "improvements": improvements,
        "candidate_signal": candidate_signal,
        "next_focus_skill": next_focus_skill,
        "interviewer_bridge": interviewer_bridge,
        "video_sentiment": video_sentiment_turn_payload,
        "ai": {
            "used": ai_used,
            "model": llm_model if ai_used else None,
            "reason": "hybrid_overlay" if ai_used else (llm_error or "rules_only"),
        },
        "created_at": now_utc_iso(),
    }

    report_payload: dict[str, Any] | None = None
    session_snapshot_for_archive: dict[str, Any] | None = None
    saved_report_id = 0
    next_question: str | None = None
    completed = False
    response_round_number = round_number
    response_stage_key = current_stage_key
    response_stage_label = current_stage_label
    response_question_number_in_stage = question_number_in_stage
    screening_decision = ""
    screening_decision_reason = ""
    round_decision = ""
    round_decision_reason = ""
    round_decision_stage_key = ""
    round_decision_stage_label = ""

    with INTERVIEW_SIMULATOR_LOCK:
        refreshed = INTERVIEW_SIMULATOR_SESSIONS.get(session_id)
        if not refreshed:
            raise HTTPException(status_code=404, detail="Simulator session expired. Start a new one.")
        refreshed_turns = refreshed.get("turns") if isinstance(refreshed.get("turns"), list) else []
        if len(refreshed_turns) != expected_turn_count:
            raise HTTPException(status_code=409, detail="Session was updated from another tab. Refresh and continue.")

        refreshed_turns.append(turn_payload)
        refreshed["turns"] = refreshed_turns
        if candidate_reports_no_direct_experience:
            refreshed["candidate_reports_no_direct_experience"] = True
        merged_connection_notes = dedupe_text_list(
            [*normalize_string_list(refreshed.get("candidate_connection_notes"), limit=6, max_item_len=140), candidate_signal],
            limit=6,
            max_item_len=140,
        )
        refreshed["candidate_connection_notes"] = merged_connection_notes
        refreshed_question_flow = extract_interview_simulator_question_flow(refreshed, stage_plan)
        if not refreshed_question_flow:
            refreshed_question_flow = [build_interview_simulator_question_entry(stage_plan, current_stage_key, question, question_number_in_stage)]
        refreshed["updated_at"] = now_utc_iso()
        refreshed["expires_at_ts"] = time.time() + INTERVIEW_SIMULATOR_TTL_SECONDS
        current_stage_turns = [turn for turn in refreshed_turns if normalize_interview_simulator_turn_stage_key(turn) == current_stage_key]
        screening_decision = safe_text(refreshed.get("screening_decision")).strip().lower()
        screening_decision_reason = safe_text(refreshed.get("screening_decision_reason")).strip()
        if current_stage_key == "screening" and len(current_stage_turns) >= max(
            2,
            int(get_interview_simulator_stage_entry(stage_plan, "screening").get("min_questions") or 1),
        ):
            screening_outcome = decide_interview_simulator_screening_outcome(current_stage_turns)
            screening_decision = safe_text(screening_outcome.get("decision")).strip().lower()
            screening_decision_reason = safe_text(screening_outcome.get("reason")).strip()
            if screening_decision in {"shortlisted", "rejected"}:
                refreshed["screening_decision"] = screening_decision
                refreshed["screening_decision_reason"] = screening_decision_reason
                turn_payload["screening_decision"] = screening_decision
                turn_payload["screening_decision_reason"] = screening_decision_reason
        stage_completed, next_stage_key = decide_interview_simulator_stage_progression(
            stage_plan=stage_plan,
            current_stage_key=current_stage_key,
            current_stage_turns=current_stage_turns,
            all_turns=refreshed_turns,
            difficulty=difficulty,
            llm_stage_action=llm_stage_action,
            screening_decision=screening_decision,
            candidate_level=candidate_level,
        )
        if stage_completed:
            stage_outcome = decide_interview_simulator_stage_outcome(
                stage_key=current_stage_key,
                stage_turns=current_stage_turns,
                candidate_level=candidate_level,
                screening_decision=screening_decision,
                screening_decision_reason=screening_decision_reason,
            )
            round_decision = safe_text(stage_outcome.get("decision")).strip().lower()
            round_decision_reason = safe_text(stage_outcome.get("reason")).strip()
            round_decision_stage_key = current_stage_key
            round_decision_stage_label = current_stage_label
            if round_decision in {"shortlisted", "rejected"}:
                turn_payload["round_decision"] = round_decision
                turn_payload["round_decision_reason"] = round_decision_reason
                stage_decisions_raw = refreshed.get("stage_decisions") if isinstance(refreshed.get("stage_decisions"), dict) else {}
                stage_decisions = {
                    safe_text(key): value
                    for key, value in stage_decisions_raw.items()
                    if isinstance(key, str) and isinstance(value, dict)
                }
                stage_decisions[current_stage_key] = {
                    "stage_key": current_stage_key,
                    "stage_label": current_stage_label,
                    "stage_number": int(get_interview_simulator_stage_entry(stage_plan, current_stage_key).get("stage_number") or round_number),
                    "decision": round_decision,
                    "reason": round_decision_reason,
                    "updated_at": now_utc_iso(),
                }
                refreshed["stage_decisions"] = stage_decisions

            if round_decision == "rejected":
                next_stage_key = None
                completed = True
            elif round_decision == "shortlisted":
                completed = not bool(next_stage_key)
            else:
                completed = stage_completed and not next_stage_key
        else:
            completed = False

        if completed:
            refreshed["status"] = "completed"
            refreshed["closing_remark"] = build_interview_simulator_closing_remark(
                safe_text(refreshed.get("candidate_name")),
                safe_text(refreshed.get("interviewer_name")),
                normalize_string_list(refreshed.get("candidate_connection_notes"), limit=6, max_item_len=140),
            )
            report_payload = build_interview_simulator_report_payload(refreshed)
            session_snapshot_for_archive = {
                "id": safe_text(refreshed.get("id")),
                "candidate_name": safe_text(refreshed.get("candidate_name")),
                "role": safe_text(refreshed.get("role")),
                "industry": safe_text(refreshed.get("industry")),
                "interviewer_name": safe_text(refreshed.get("interviewer_name")),
                "interviewer_title": safe_text(refreshed.get("interviewer_title")),
                "interviewer_voice": safe_text(refreshed.get("interviewer_voice")),
                "opening_remark": safe_text(refreshed.get("opening_remark")),
                "closing_remark": safe_text(refreshed.get("closing_remark")),
                "mode": normalize_interview_simulator_mode(safe_text(refreshed.get("mode"))),
                "difficulty": safe_text(refreshed.get("difficulty")),
                "stage_plan": json.loads(json.dumps(stage_plan, ensure_ascii=False, default=str)),
                "focus_skills": json.loads(json.dumps(refreshed.get("focus_skills") or [], ensure_ascii=False, default=str)),
                "total_rounds": int(refreshed.get("total_rounds") or total_rounds),
                "question_flow": json.loads(json.dumps(refreshed_question_flow, ensure_ascii=False, default=str)),
                "questions": [safe_text(item.get("question")) for item in refreshed_question_flow if isinstance(item, dict)],
                "turns": json.loads(json.dumps(refreshed_turns, ensure_ascii=False, default=str)),
                "stage_decisions": json.loads(json.dumps(refreshed.get("stage_decisions") or {}, ensure_ascii=False, default=str)),
                "status": safe_text(refreshed.get("status")) or "completed",
                "created_at": safe_text(refreshed.get("created_at")),
                "updated_at": safe_text(refreshed.get("updated_at")),
                "saved_report_id": int(refreshed.get("saved_report_id") or 0),
                "screening_decision": screening_decision,
                "screening_decision_reason": screening_decision_reason,
            }
            saved_report_id = int(refreshed.get("saved_report_id") or 0)
        else:
            next_stage_key = safe_text(next_stage_key) or current_stage_key
            next_stage_entry = get_interview_simulator_stage_entry(stage_plan, next_stage_key)
            next_question_number_in_stage = len([turn for turn in refreshed_turns if normalize_interview_simulator_turn_stage_key(turn) == next_stage_key]) + 1
            if next_stage_key != current_stage_key:
                next_question_number_in_stage = 1
                interviewer_bridge = build_interview_simulator_stage_transition_bridge(next_stage_entry, interviewer_bridge)
            safe_fallback_question = follow_up_question
            if (
                candidate_reports_no_direct_experience
                and next_stage_key in {"screening", "technical_assessment", "in_depth_assessment"}
                and follow_up_question_demands_direct_experience(safe_fallback_question)
            ):
                safe_fallback_question = ""
            next_question = build_interview_simulator_follow_up_question(
                role=role,
                industry=industry,
                difficulty=difficulty,
                stage_plan=stage_plan,
                stage_key=next_stage_key,
                question_number_in_stage=next_question_number_in_stage,
                focus_skills=focus_skills,
                missing_focus_skills=turn_payload.get("missing_focus_skills") or [],
                improvements=improvements,
                fallback_question=safe_fallback_question,
                next_focus_skill=next_focus_skill,
                candidate_profile_note=candidate_profile_note,
                candidate_level=candidate_level,
                candidate_reports_no_direct_experience=candidate_reports_no_direct_experience,
            )[:260]
            next_question_entry = build_interview_simulator_question_entry(
                stage_plan,
                next_stage_key,
                next_question,
                next_question_number_in_stage,
            )
            refreshed_question_flow.append(next_question_entry)
            refreshed["question_flow"] = refreshed_question_flow
            refreshed["questions"] = [safe_text(item.get("question")) for item in refreshed_question_flow if isinstance(item, dict)]
            refreshed["current_stage_key"] = safe_text(next_question_entry.get("stage_key"))
            refreshed["current_stage_label"] = safe_text(next_question_entry.get("stage_label"))
            refreshed["current_stage_number"] = int(next_question_entry.get("stage_number") or response_round_number)
            refreshed["question_number_in_stage"] = int(next_question_entry.get("question_number_in_stage") or 1)
            response_round_number = int(next_question_entry.get("stage_number") or response_round_number)
            response_stage_key = safe_text(next_question_entry.get("stage_key")) or response_stage_key
            response_stage_label = safe_text(next_question_entry.get("stage_label")) or response_stage_label
            response_question_number_in_stage = int(next_question_entry.get("question_number_in_stage") or response_question_number_in_stage)

    if next_question:
        queue_interview_simulator_tts_prefetch(
            session_id,
            build_interview_simulator_spoken_text(
                next_question,
                response_round_number,
                response_question_number_in_stage,
                interviewer_bridge=interviewer_bridge,
            ),
            requested_voice=interviewer_voice or INTERVIEW_SIMULATOR_TTS_PREFETCH_VOICE,
        )

    if (
        completed
        and report_payload
        and mode == INTERVIEW_SIMULATOR_MODE_FULL
        and owner_user_id > 0
        and saved_report_id <= 0
        and session_snapshot_for_archive
    ):
        archive_payload = build_interview_simulator_archive_payload(session_snapshot_for_archive, report_payload)
        persisted_report_id = save_analysis_report(
            owner_user_id,
            "interview_simulator",
            industry,
            role,
            archive_payload,
        )
        if persisted_report_id:
            saved_report_id = int(persisted_report_id)
            with INTERVIEW_SIMULATOR_LOCK:
                live_session = INTERVIEW_SIMULATOR_SESSIONS.get(session_id)
                if live_session and int(live_session.get("saved_report_id") or 0) <= 0:
                    live_session["saved_report_id"] = saved_report_id

    if completed and report_payload:
        log_analytics_event(
            "interview",
            "interview_simulator_completed",
            user_id=owner_user_id or None,
            meta={
                "role": role,
                "industry": industry,
                "rounds_completed": len(build_interview_simulator_stage_summaries(refreshed_turns, stage_plan)),
                "overall_score": int(report_payload.get("overall_score") or 0),
                "readiness": safe_text(report_payload.get("readiness_label")),
                "ai_used": ai_used,
                "video_sentiment_used": bool(video_sentiment_payload),
                "mode": mode,
                "saved_report_id": saved_report_id or None,
                "guest_mode": owner_user_id <= 0,
            },
        )
    else:
        log_analytics_event(
            "interview",
            "interview_simulator_turn_scored",
            user_id=owner_user_id or None,
            meta={
                "role": role,
                "industry": industry,
                "round_number": response_round_number,
                "overall": int((turn_payload.get("scores") or {}).get("overall") or 0),
                "ai_used": ai_used,
                "video_sentiment_used": bool(video_sentiment_payload),
                "mode": mode,
                "guest_mode": owner_user_id <= 0,
            },
        )

    return {
        "session_id": session_id,
        "mode": mode,
        "completed": completed,
        "round_number": response_round_number,
        "current_stage_key": response_stage_key,
        "current_stage_label": response_stage_label,
        "question_number_in_stage": response_question_number_in_stage,
        "total_rounds": total_rounds,
        "progress_percent": 100 if completed else int(round((response_round_number / max(1, total_rounds)) * 100)),
        "next_question": next_question,
        "turn_feedback": turn_payload,
        "report": report_payload,
        "status": "completed" if completed else "active",
        "interviewer_bridge": None if completed else interviewer_bridge,
        "closing_remark": safe_text((session_snapshot_for_archive or {}).get("closing_remark")) if completed else None,
        "interviewer_title": safe_text((session_snapshot_for_archive or existing).get("interviewer_title")) if completed else interviewer_title,
        "interviewer_voice": safe_text((session_snapshot_for_archive or existing).get("interviewer_voice")) if completed else interviewer_voice,
        "saved_report_id": saved_report_id or None,
        "screening_decision": screening_decision or None,
        "screening_decision_reason": screening_decision_reason or None,
        "round_decision": round_decision or None,
        "round_decision_reason": round_decision_reason or None,
        "round_decision_stage_key": round_decision_stage_key or None,
        "round_decision_stage_label": round_decision_stage_label or None,
    }


@app.post("/analysis/interview-simulator/report")
def analysis_interview_simulator_report(data: InterviewSimulatorReportRequest, request: Request) -> dict[str, Any]:
    user = resolve_optional_authenticated_user(request, data.auth_token)
    session_id = re.sub(r"[^A-Za-z0-9]", "", safe_text(data.session_id))[:32]
    session_secret = safe_text(data.session_secret)[:64]
    if len(session_id) < 8:
        raise HTTPException(status_code=400, detail="Invalid simulator session id.")

    now_ts = time.time()
    with INTERVIEW_SIMULATOR_LOCK:
        cleanup_interview_simulator_sessions(now_ts)
        session_payload = INTERVIEW_SIMULATOR_SESSIONS.get(session_id)
        if not session_payload:
            raise HTTPException(status_code=404, detail="Simulator session not found or expired.")
        owner_user_id = int(session_payload.get("user_id") or 0)
        requester_user_id = int(user["id"]) if user else 0
        secret_matches = session_secret and safe_text(session_payload.get("session_secret")) == session_secret
        if owner_user_id > 0:
            if requester_user_id != owner_user_id and not secret_matches:
                raise HTTPException(status_code=403, detail="This simulator session belongs to a different user.")
        elif not secret_matches:
            raise HTTPException(status_code=401, detail="Session secret mismatch. Restart the simulator.")
        elif requester_user_id > 0:
            session_payload["user_id"] = requester_user_id
            owner_user_id = requester_user_id

        report_payload = build_interview_simulator_report_payload(session_payload)
        turns = session_payload.get("turns") if isinstance(session_payload.get("turns"), list) else []
        stage_plan = get_interview_simulator_stage_plan(session_payload)
        question_flow = extract_interview_simulator_question_flow(session_payload, stage_plan)
        current_question_entry = question_flow[-1] if question_flow else {}

    return {
        "session_id": session_id,
        "mode": normalize_interview_simulator_mode(safe_text(session_payload.get("mode"))),
        "candidate_name": safe_text(session_payload.get("candidate_name")),
        "role": safe_text(session_payload.get("role")) or "Target role",
        "industry": safe_text(session_payload.get("industry")) or "General",
        "interviewer_name": safe_text(session_payload.get("interviewer_name")),
        "interviewer_title": safe_text(session_payload.get("interviewer_title")),
        "interviewer_voice": safe_text(session_payload.get("interviewer_voice")),
        "opening_remark": safe_text(session_payload.get("opening_remark")),
        "closing_remark": safe_text(session_payload.get("closing_remark")),
        "difficulty": normalize_interview_simulator_difficulty(safe_text(session_payload.get("difficulty"))),
        "round_number": int(current_question_entry.get("stage_number") or session_payload.get("current_stage_number") or 1),
        "current_stage_key": safe_text(current_question_entry.get("stage_key")) or safe_text(session_payload.get("current_stage_key")) or "screening",
        "current_stage_label": safe_text(current_question_entry.get("stage_label")) or safe_text(session_payload.get("current_stage_label")) or "Screening",
        "question_number_in_stage": int(current_question_entry.get("question_number_in_stage") or session_payload.get("question_number_in_stage") or 1),
        "total_rounds": len(stage_plan) or int(session_payload.get("total_rounds") or 0),
        "status": safe_text(session_payload.get("status")) or "active",
        "focus_skills": sanitize_interview_simulator_focus_skills(session_payload.get("focus_skills"), limit=8),
        "current_question": safe_text(current_question_entry.get("question"))[:260],
        "questions": [safe_text(item.get("question"))[:260] for item in question_flow[:20] if isinstance(item, dict) and safe_text(item.get("question"))],
        "turns": turns,
        "report": report_payload,
        "saved_report_id": int(session_payload.get("saved_report_id") or 0) or None,
        "screening_decision": safe_text(session_payload.get("screening_decision")).strip().lower() or None,
        "screening_decision_reason": safe_text(session_payload.get("screening_decision_reason")) or None,
    }


@app.post("/analysis/interview-simulator/tts")
def analysis_interview_simulator_tts(data: InterviewSimulatorTtsRequest, request: Request) -> StreamingResponse:
    if not INTERVIEW_SIMULATOR_TTS_ENABLED:
        raise HTTPException(status_code=503, detail="AI voice is temporarily unavailable.")
    user = resolve_optional_authenticated_user(request, data.auth_token)
    session_id = re.sub(r"[^A-Za-z0-9]", "", safe_text(data.session_id))[:32]
    session_secret = safe_text(data.session_secret)[:64]
    if len(session_id) < 8:
        raise HTTPException(status_code=400, detail="Invalid simulator session id.")

    now_ts = time.time()
    source_text = safe_text(data.text).strip()
    fallback_question = ""
    owner_user_id = 0
    with INTERVIEW_SIMULATOR_LOCK:
        cleanup_interview_simulator_sessions(now_ts)
        session_payload = INTERVIEW_SIMULATOR_SESSIONS.get(session_id)
        if not session_payload:
            raise HTTPException(status_code=404, detail="Simulator session not found or expired.")
        owner_user_id = int(session_payload.get("user_id") or 0)
        requester_user_id = int(user["id"]) if user else 0
        secret_matches = session_secret and safe_text(session_payload.get("session_secret")) == session_secret
        if owner_user_id > 0:
            if requester_user_id != owner_user_id and not secret_matches:
                raise HTTPException(status_code=403, detail="This simulator session belongs to a different user.")
        elif not secret_matches:
            raise HTTPException(status_code=401, detail="Session secret mismatch. Restart the simulator.")
        elif requester_user_id > 0:
            session_payload["user_id"] = requester_user_id
            owner_user_id = requester_user_id
        questions = session_payload.get("questions") if isinstance(session_payload.get("questions"), list) else []
        fallback_question = safe_text(questions[-1]) if questions else ""
        session_payload["updated_at"] = now_utc_iso()
        session_payload["expires_at_ts"] = time.time() + INTERVIEW_SIMULATOR_TTL_SECONDS

    source_text = source_text or fallback_question
    script_text = build_interview_simulator_tts_script(source_text)
    if len(script_text) < 8:
        raise HTTPException(status_code=400, detail="Question text is empty. Generate a question first.")
    requested_voice = normalize_interview_simulator_tts_voice(data.voice)
    cache_key = build_interview_simulator_tts_cache_key(script_text, requested_voice)
    cache_hit = False
    cached_audio_bytes: bytes | None = None
    cached_model = ""
    cached_voice = requested_voice

    with INTERVIEW_SIMULATOR_LOCK:
        session_payload = INTERVIEW_SIMULATOR_SESSIONS.get(session_id)
        if session_payload:
            tts_cache = session_payload.get("tts_cache") if isinstance(session_payload.get("tts_cache"), dict) else {}
            if not isinstance(session_payload.get("tts_cache"), dict):
                session_payload["tts_cache"] = tts_cache
            cleanup_interview_simulator_tts_cache(tts_cache, now_ts)
            cache_entry = tts_cache.get(cache_key)
            if isinstance(cache_entry, dict) and isinstance(cache_entry.get("audio"), (bytes, bytearray)):
                cached_audio_bytes = bytes(cache_entry.get("audio") or b"")
                cached_model = safe_text(cache_entry.get("model"))
                cached_voice = safe_text(cache_entry.get("voice")) or requested_voice
                cache_hit = bool(cached_audio_bytes)

    audio_bytes: bytes | None = cached_audio_bytes
    model: str | None = cached_model or None
    resolved_voice = cached_voice
    if not audio_bytes:
        generated_audio_bytes, generated_model, tts_error, generated_voice = generate_interview_simulator_tts_audio(
            script_text,
            requested_voice,
        )
        if not generated_audio_bytes:
            raise HTTPException(status_code=503, detail=tts_error or "Unable to synthesize AI voice right now.")
        audio_bytes = generated_audio_bytes
        model = generated_model
        resolved_voice = generated_voice

        with INTERVIEW_SIMULATOR_LOCK:
            session_payload = INTERVIEW_SIMULATOR_SESSIONS.get(session_id)
            if session_payload:
                tts_cache = session_payload.get("tts_cache") if isinstance(session_payload.get("tts_cache"), dict) else {}
                if not isinstance(session_payload.get("tts_cache"), dict):
                    session_payload["tts_cache"] = tts_cache
                cleanup_interview_simulator_tts_cache(tts_cache, time.time())
                tts_cache[cache_key] = {
                    "audio": audio_bytes,
                    "model": safe_text(model),
                    "voice": resolved_voice,
                    "created_at_ts": time.time(),
                }
                cleanup_interview_simulator_tts_cache(tts_cache, time.time())

    media_type_map = {
        "mp3": "audio/mpeg",
        "mpeg": "audio/mpeg",
        "wav": "audio/wav",
        "opus": "audio/ogg",
        "aac": "audio/aac",
        "flac": "audio/flac",
    }
    media_type = media_type_map.get(INTERVIEW_SIMULATOR_TTS_RESPONSE_FORMAT, "application/octet-stream")
    log_analytics_event(
        "interview",
        "interview_simulator_tts_generated",
        user_id=owner_user_id or None,
        meta={
            "model": safe_text(model),
            "voice": resolved_voice,
            "chars": len(script_text),
            "cache_hit": cache_hit,
            "guest_mode": owner_user_id <= 0,
        },
    )
    return StreamingResponse(
        io.BytesIO(audio_bytes),
        media_type=media_type,
        headers={
            "Cache-Control": "no-store, max-age=0",
            "X-Interview-TTS-Model": safe_text(model),
            "X-Interview-TTS-Voice": resolved_voice,
            "X-Interview-TTS-Cache": "hit" if cache_hit else "miss",
        },
    )


@app.post("/analysis/application-pack")
def analysis_application_pack(data: ApplicationPackRequest, request: Request) -> dict[str, Any]:
    user = require_authenticated_user(request, data.auth_token)
    payload = build_application_pack_payload(data)
    log_analytics_event(
        "analysis",
        "analysis_application_pack_generated",
        user_id=int(user["id"]),
        meta={
            "role": safe_text(data.role),
            "industry": safe_text(data.industry),
            "ai_used": bool((payload.get("ai") or {}).get("used")),
        },
    )
    return payload


@app.post("/analysis/application-copilot")
def analysis_application_copilot(data: ApplicationCopilotRequest, request: Request) -> dict[str, Any]:
    user = resolve_optional_authenticated_user(request, data.auth_token)
    resume_text = safe_text(data.resume_text)
    job_description = safe_text(data.job_description)
    if len(resume_text) < 24:
        raise HTTPException(status_code=400, detail="Resume text is too short for Application Copilot.")
    if len(job_description) < 24:
        raise HTTPException(status_code=400, detail="Job description is too short for Application Copilot.")

    try:
        if user:
            sync_public_access_user_name_from_resume(user, resume_text)
        payload = build_application_copilot_payload(data)
        if user:
            payload["wallet"] = wallet_payload(int(user["credits"] or 0))
            payload["credit_transaction_id"] = 0
        log_analytics_event(
            "analysis",
            "analysis_application_copilot_generated",
            user_id=int(user["id"]) if user else None,
            meta={
                "role": safe_text(data.role),
                "industry": safe_text(data.industry),
                "company": safe_text(data.company),
                "match_percentage": int(payload.get("match_percentage") or 0),
                "missing_skills": len(payload.get("missing_skills") or []),
                "credit_transaction_id": 0,
            },
        )
        return payload
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Unable to run Application Copilot right now.") from exc


@app.get("/application-copilot/job-tracks")
def application_copilot_job_tracks(request: Request, auth_token: str | None = None, limit: int = 24) -> dict[str, Any]:
    user = require_authenticated_user(request, auth_token)
    safe_limit = int(clamp_float(float(limit), 1.0, 120.0))
    connection = auth_db_connection()
    try:
        tracks = fetch_application_job_tracks_for_user(connection, int(user["id"]), safe_limit)
    finally:
        connection.close()
    return {
        "job_tracks": tracks,
        "count": len(tracks),
        "status_options": sorted(APPLICATION_COPILOT_TRACK_STATUSES),
    }


@app.post("/application-copilot/job-tracks")
def application_copilot_job_track_create(data: ApplicationCopilotTrackCreateRequest, request: Request) -> dict[str, Any]:
    user = require_authenticated_user(request, data.auth_token)
    copilot_payload = data.copilot_payload if isinstance(data.copilot_payload, dict) else {}
    industry = safe_text(data.industry) or safe_text(copilot_payload.get("industry")) or "General"
    raw_role = safe_text(data.role) or safe_text(copilot_payload.get("role"))
    role = raw_role
    if is_placeholder_role_value(role):
        inferred_role = infer_role_from_copilot_payload(copilot_payload, industry_hint=industry)
        if inferred_role:
            role = inferred_role
    if not role:
        role = "Target role"
    if len(role) < 2:
        raise HTTPException(status_code=400, detail="Role is required to save a job track.")
    company = (safe_text(data.company) or safe_text(copilot_payload.get("company")))[:120]
    status = normalize_application_copilot_status(data.status or copilot_payload.get("status"))
    match_percentage = int(clamp_float(float(copilot_payload.get("match_percentage") or 0), 0.0, 100.0))
    matched_skills = normalize_string_list(copilot_payload.get("matched_skills"), limit=20, max_item_len=80)
    missing_skills = normalize_string_list(copilot_payload.get("missing_skills"), limit=20, max_item_len=80)
    feedback = normalize_string_list(copilot_payload.get("feedback"), limit=8, max_item_len=220)
    next_steps_7_day = normalize_string_list(copilot_payload.get("next_steps_7_day"), limit=10, max_item_len=220)
    persisted_payload = {
        "role": role,
        "industry": industry,
        "company": company,
        "match_percentage": match_percentage,
        "matched_skills": matched_skills,
        "missing_skills": missing_skills,
        "feedback": feedback,
        "resume_improvements": normalize_string_list(copilot_payload.get("resume_improvements"), limit=10, max_item_len=220),
        "next_steps_7_day": next_steps_7_day,
        "interview_questions": normalize_string_list(copilot_payload.get("interview_questions"), limit=7, max_item_len=240),
        "jd_focus_keywords": normalize_string_list(copilot_payload.get("jd_focus_keywords"), limit=8, max_item_len=80),
        "application_checklist": normalize_string_list(copilot_payload.get("application_checklist"), limit=8, max_item_len=180),
        "application_pack": copilot_payload.get("application_pack") if isinstance(copilot_payload.get("application_pack"), dict) else {},
    }
    now_iso = now_utc_iso()

    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            cursor.execute(
                """
                INSERT INTO application_job_tracks (
                    user_id, role, industry, company, status, match_percentage,
                    matched_skills_json, missing_skills_json, feedback_json, next_steps_json,
                    payload_json, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    int(user["id"]),
                    role[:120],
                    industry[:80],
                    company,
                    status,
                    match_percentage,
                    json.dumps(matched_skills, separators=(",", ":"), ensure_ascii=False),
                    json.dumps(missing_skills, separators=(",", ":"), ensure_ascii=False),
                    json.dumps(feedback, separators=(",", ":"), ensure_ascii=False),
                    json.dumps(next_steps_7_day, separators=(",", ":"), ensure_ascii=False),
                    json.dumps(persisted_payload, separators=(",", ":"), ensure_ascii=False),
                    now_iso,
                    now_iso,
                ),
            )
            track_id = inserted_row_id(connection, cursor)
            row = cursor.execute(
                """
                SELECT id, user_id, role, industry, company, status, match_percentage,
                       matched_skills_json, missing_skills_json, feedback_json, next_steps_json,
                       payload_json, created_at, updated_at
                FROM application_job_tracks
                WHERE id = ? AND user_id = ?
                LIMIT 1
                """,
                (track_id, int(user["id"])),
            ).fetchone()
            connection.commit()
        except HTTPException:
            connection.rollback()
            raise
        except Exception as exc:
            connection.rollback()
            raise HTTPException(status_code=500, detail="Unable to save job track right now.") from exc
        finally:
            connection.close()

    if not row:
        raise HTTPException(status_code=500, detail="Unable to load saved job track.")

    track_payload = serialize_application_job_track_row(row)
    log_analytics_event(
        "copilot",
        "application_job_track_saved",
        user_id=int(user["id"]),
        meta={
            "track_id": int(track_payload.get("id") or 0),
            "role": safe_text(track_payload.get("role")),
            "status": safe_text(track_payload.get("status")),
            "match_percentage": int(track_payload.get("match_percentage") or 0),
        },
    )
    return {"job_track": track_payload}


@app.post("/application-copilot/job-tracks/{track_id}/status")
def application_copilot_job_track_status(
    track_id: int,
    data: ApplicationCopilotTrackStatusRequest,
    request: Request,
) -> dict[str, Any]:
    if track_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid track id.")
    user = require_authenticated_user(request, data.auth_token)
    status = normalize_application_copilot_status(data.status)

    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            cursor.execute(
                """
                UPDATE application_job_tracks
                SET status = ?, updated_at = ?
                WHERE id = ? AND user_id = ?
                """,
                (status, now_utc_iso(), track_id, int(user["id"])),
            )
            if cursor.rowcount <= 0:
                connection.rollback()
                raise HTTPException(status_code=404, detail="Job track not found.")
            row = cursor.execute(
                """
                SELECT id, user_id, role, industry, company, status, match_percentage,
                       matched_skills_json, missing_skills_json, feedback_json, next_steps_json,
                       payload_json, created_at, updated_at
                FROM application_job_tracks
                WHERE id = ? AND user_id = ?
                LIMIT 1
                """,
                (track_id, int(user["id"])),
            ).fetchone()
            connection.commit()
        except HTTPException:
            connection.rollback()
            raise
        except Exception as exc:
            connection.rollback()
            raise HTTPException(status_code=500, detail="Unable to update job track status right now.") from exc
        finally:
            connection.close()

    if not row:
        raise HTTPException(status_code=404, detail="Job track not found.")
    track_payload = serialize_application_job_track_row(row)
    log_analytics_event(
        "copilot",
        "application_job_track_status_updated",
        user_id=int(user["id"]),
        meta={
            "track_id": int(track_payload.get("id") or 0),
            "status": safe_text(track_payload.get("status")),
        },
    )
    return {"job_track": track_payload}


@app.get("/analysis/reports")
def user_analysis_reports(request: Request, auth_token: str | None = None, limit: int = 40) -> dict[str, Any]:
    user = require_authenticated_user(request, auth_token)
    safe_limit = int(clamp_float(float(limit), 1, 120))
    connection = auth_db_connection()
    try:
        reports = collect_analysis_reports_for_user(connection, int(user["id"]), safe_limit)
    finally:
        connection.close()
    return {"reports": reports}


@app.get("/analysis/reports/{report_id}/download")
def download_user_analysis_report(report_id: int, request: Request, auth_token: str | None = None) -> StreamingResponse:
    if report_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid report id.")
    user = require_authenticated_user(request, auth_token)
    user_id = int(user["id"])
    connection = auth_db_connection()
    try:
        row = fetch_analysis_report_for_user(connection, user_id, report_id)
    finally:
        connection.close()
    if not row:
        raise HTTPException(status_code=404, detail="Analysis report not found.")

    parsed_payload = parse_meta_json(row["report_json"])
    if not isinstance(parsed_payload, dict):
        parsed_payload = {"analysis": parsed_payload}
    parsed_payload["report_meta"] = serialize_analysis_report_row(row)
    parsed_payload.setdefault("role", safe_text(row["role"]))
    parsed_payload.setdefault("industry", safe_text(row["industry"]))
    parsed_payload.setdefault("created_at", safe_text(row["created_at"]))
    parsed_payload.setdefault("source", safe_text(row["source"]))

    filename_base = sanitize_download_name(
        f"{safe_text(row['role']) or 'analysis'}-{safe_text(row['created_at'])[:10] or 'report'}-{report_id}"
    )
    try:
        if safe_text(row["source"]).lower() == "interview_simulator" or safe_text(parsed_payload.get("report_kind")).lower() == "interview_simulator":
            pdf_bytes = render_interview_simulator_report_pdf_bytes(parsed_payload, row)
        else:
            pdf_bytes = render_analysis_report_pdf_bytes(parsed_payload, row)
    except Exception as exc:
        logger.exception("Failed to render analysis report PDF for report_id=%s user_id=%s", report_id, user_id)
        raise HTTPException(status_code=500, detail="Unable to generate report PDF right now.") from exc
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename_base}.pdf"'},
    )


@app.post("/security/leak-trace")
def security_leak_trace(data: SecurityLeakTraceRequest, request: Request) -> dict[str, Any]:
    action = re.sub(r"[^a-z0-9_:-]", "", safe_text(data.action).lower())[:64] or "unknown"
    user_id: int | None = None
    try:
        user = require_authenticated_user(request, data.auth_token)
        user_id = int(user["id"])
    except HTTPException:
        user_id = None

    meta = {
        "action": action,
        "source": safe_text(data.source)[:64],
        "detail": safe_text(data.detail)[:200],
        "path": safe_text(data.path)[:240],
        "user_agent": safe_text(data.user_agent or request.headers.get("user-agent"))[:240],
        "ip_hint": safe_text((request.client.host if request.client else ""))[:64],
    }
    log_analytics_event("security", "capture_deterrence_triggered", user_id=user_id, meta=meta)
    return {"ok": True}


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
    apply_feedback_learning_signal(int(user["id"]), rating)
    refreshed = fetch_user_by_id(int(user["id"]))
    if not refreshed:
        raise HTTPException(status_code=500, detail="Unable to refresh account.")
    payload = auth_response_payload(refreshed)
    payload["feedback_saved"] = True
    return payload


@app.post("/chat/guest-session")
def chat_guest_session(data: GuestChatSessionRequest | None = None) -> dict[str, Any]:
    guest_key = normalize_guest_chat_key(data.guest_key if data else None)
    contact_name = normalize_guest_contact_name(data.name if data else None)
    contact_email = normalize_guest_contact_email(data.email if data else None)
    user = get_or_create_guest_chat_user(guest_key)
    guest_profile = upsert_guest_chat_profile(
        guest_key=guest_key,
        user_id=int(user["id"]),
        contact_name=contact_name,
        contact_email=contact_email,
    )
    auth_token = create_auth_token(
        int(user["id"]),
        str(user["email"]),
        ttl_seconds=GUEST_CHAT_TOKEN_TTL_HOURS * 3600,
    )
    key_fingerprint = hashlib.sha256(guest_key.encode("utf-8")).hexdigest()[:12]
    log_analytics_event(
        "chat",
        "guest_session_started",
        user_id=int(user["id"]),
        meta={"guest_key_fingerprint": key_fingerprint},
    )
    payload = auth_response_payload(user, auth_token)
    payload["guest_mode"] = True
    payload["guest_key"] = guest_key
    payload["guest_profile"] = guest_profile
    payload["token_expires_hours"] = GUEST_CHAT_TOKEN_TTL_HOURS
    return payload


@app.get("/chat/messages")
def user_chat_messages(request: Request, auth_token: str | None = None, limit: int = 200) -> dict[str, Any]:
    user = require_authenticated_user(request, auth_token)
    safe_limit = int(clamp_float(float(limit), 1, 400))
    user_id = int(user["id"])

    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            messages = collect_chat_messages_for_user(connection, user_id, safe_limit)
            cursor.execute(
                """
                UPDATE user_chat_messages
                SET read_by_user = 1
                WHERE user_id = ? AND sender_role = 'admin' AND read_by_user = 0
                """,
                (user_id,),
            )
            connection.commit()
        finally:
            connection.close()

    return {"messages": messages}


@app.post("/chat/messages")
def user_chat_send_message(data: ChatMessageCreateRequest, request: Request) -> dict[str, Any]:
    user = require_authenticated_user(request, data.auth_token)
    message = normalize_chat_message_body(data.message)
    if len(message) < 2:
        raise HTTPException(status_code=400, detail="Please enter a longer message.")

    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            saved = insert_chat_message(
                connection=connection,
                user_id=int(user["id"]),
                sender_role="user",
                message=message,
                read_by_user=True,
                read_by_admin=False,
            )
            connection.commit()
        finally:
            connection.close()

    log_analytics_event("chat", "user_message_sent", user_id=int(user["id"]), meta={"chars": len(message)})
    return {"message": saved}


@app.get("/payments/packages")
def payment_packages() -> dict[str, Any]:
    if FOCUSED_MATCHER_MODE:
        return {
            "payment_gateway": "none",
            "payment_enabled": False,
            "stripe_enabled": False,
            "razorpay_enabled": False,
            "razorpay_key_id": "",
            "packages": [],
        }
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
    if FOCUSED_MATCHER_MODE:
        raise HTTPException(status_code=503, detail="Payments are temporarily disabled while HireScore is focused on resume matching.")
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
    if FOCUSED_MATCHER_MODE:
        raise HTTPException(status_code=503, detail="Payments are temporarily disabled while HireScore is focused on resume matching.")
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
        email_error = send_payment_success_email(
            safe_text(str(user["email"])),
            "razorpay",
            safe_text(str(checkout_logged_meta.get("package_id", ""))),
            int(checkout_logged_meta.get("credits") or 0),
            int(checkout_logged_meta.get("credits_after") or 0),
        )
        if email_error:
            logger.warning("Payment success email failed for user %s: %s", int(user["id"]), email_error)
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
    if FOCUSED_MATCHER_MODE:
        return {"received": True}
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
        user_email = ""
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
                            "SELECT id, email, credits FROM users WHERE id = ?",
                            (user_id,),
                        ).fetchone()
                        if not user_row:
                            connection.rollback()
                            return {"received": True}
                        user_email = safe_text(str(user_row["email"]))
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
                email_error = send_payment_success_email(
                    user_email,
                    "stripe",
                    safe_text(str(checkout_logged_meta.get("package_id", package_id))),
                    int(checkout_logged_meta.get("credits") or credits),
                    int(checkout_logged_meta.get("credits_after") or 0),
                )
                if email_error:
                    logger.warning("Payment success email failed for user %s: %s", user_id, email_error)

    return {"received": True}


def parse_meta_json(meta_json: Any) -> dict[str, Any]:
    try:
        return json.loads(meta_json or "{}")
    except Exception:
        return {}


def normalize_application_copilot_status(value: Any) -> str:
    token = safe_text(str(value)).lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "saved": "saved",
        "draft": "saved",
        "tracking": "saved",
        "applied": "applied",
        "application_sent": "applied",
        "interview": "interview",
        "interviewing": "interview",
        "in_interview": "interview",
        "offer": "offer",
        "offered": "offer",
        "rejected": "rejected",
    }
    resolved = aliases.get(token, token)
    if resolved in APPLICATION_COPILOT_TRACK_STATUSES:
        return resolved
    return "saved"


def parse_json_string_list(value: Any, limit: int = 16, max_item_len: int = 120) -> list[str]:
    if isinstance(value, list):
        return normalize_string_list(value, limit=limit, max_item_len=max_item_len)
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except Exception:
            return []
        if isinstance(parsed, list):
            return normalize_string_list(parsed, limit=limit, max_item_len=max_item_len)
    return []


def normalize_role_track_token(value: Any) -> str:
    token = normalize_search_text(str(value)).replace(" ", "_")
    aliases = {
        "human_resources": "hr",
        "people_ops": "hr",
        "customer_support": "support",
        "customer_success": "support",
        "site_reliability": "devops",
        "sre": "devops",
        "business_ops": "operations",
        "business_operations": "operations",
    }
    resolved = aliases.get(token, token)
    if resolved in ROLE_BLUEPRINTS:
        return resolved
    return ""


def role_display_name_from_track(role_track: str) -> str:
    labels = {
        "hr": "HR",
        "qa": "QA",
        "devops": "DevOps",
    }
    if role_track in labels:
        return labels[role_track]
    return role_track.replace("_", " ").title()


def is_placeholder_role_value(value: str) -> bool:
    token = normalize_search_text(value)
    return token in {
        "",
        "target role",
        "role",
        "target",
        "general role",
        "general",
        "not specified",
        "none",
        "na",
        "n a",
    }


def infer_role_from_copilot_payload(copilot_payload: dict[str, Any], industry_hint: str = "") -> str:
    raw_payload = copilot_payload.get("raw") if isinstance(copilot_payload, dict) else {}
    raw_jd_match = raw_payload.get("jd_match") if isinstance(raw_payload, dict) else {}
    jd_match = copilot_payload.get("jd_match") if isinstance(copilot_payload.get("jd_match"), dict) else {}

    candidate_tracks = [
        raw_jd_match.get("target_track") if isinstance(raw_jd_match, dict) else None,
        raw_jd_match.get("role_track") if isinstance(raw_jd_match, dict) else None,
        raw_jd_match.get("detected_jd_track") if isinstance(raw_jd_match, dict) else None,
        jd_match.get("target_track") if isinstance(jd_match, dict) else None,
        jd_match.get("detected_jd_track") if isinstance(jd_match, dict) else None,
    ]
    for candidate in candidate_tracks:
        role_track = normalize_role_track_token(candidate)
        if role_track and role_track != "general":
            return role_display_name_from_track(role_track)

    fallback_role = safe_text(copilot_payload.get("role"))
    inferred_track = normalize_role_track_token(infer_role_track(fallback_role, industry_hint))
    if inferred_track and inferred_track != "general":
        return role_display_name_from_track(inferred_track)
    return ""


def serialize_application_job_track_row(row: Any) -> dict[str, Any]:
    payload = parse_meta_json(row.get("payload_json") if isinstance(row, dict) else row["payload_json"])
    return {
        "id": int(row.get("id") if isinstance(row, dict) else row["id"]),
        "role": safe_text((row.get("role") if isinstance(row, dict) else row["role"])) or "Target role",
        "industry": safe_text((row.get("industry") if isinstance(row, dict) else row["industry"])) or "General",
        "company": safe_text((row.get("company") if isinstance(row, dict) else row["company"])),
        "status": normalize_application_copilot_status(row.get("status") if isinstance(row, dict) else row["status"]),
        "match_percentage": int(
            clamp_float(
                float((row.get("match_percentage") if isinstance(row, dict) else row["match_percentage"]) or 0),
                0.0,
                100.0,
            )
        ),
        "matched_skills": parse_json_string_list(
            row.get("matched_skills_json") if isinstance(row, dict) else row["matched_skills_json"],
            limit=20,
            max_item_len=80,
        ),
        "missing_skills": parse_json_string_list(
            row.get("missing_skills_json") if isinstance(row, dict) else row["missing_skills_json"],
            limit=20,
            max_item_len=80,
        ),
        "feedback": parse_json_string_list(
            row.get("feedback_json") if isinstance(row, dict) else row["feedback_json"],
            limit=8,
            max_item_len=220,
        ),
        "next_steps_7_day": parse_json_string_list(
            row.get("next_steps_json") if isinstance(row, dict) else row["next_steps_json"],
            limit=10,
            max_item_len=220,
        ),
        "created_at": safe_text((row.get("created_at") if isinstance(row, dict) else row["created_at"])),
        "updated_at": safe_text((row.get("updated_at") if isinstance(row, dict) else row["updated_at"])),
        "copilot_payload": payload if isinstance(payload, dict) else {},
    }


def fetch_application_job_tracks_for_user(connection: AuthDBConnection, user_id: int, limit: int) -> list[dict[str, Any]]:
    safe_limit = int(clamp_float(float(limit), 1.0, 120.0))
    rows = connection.execute(
        """
        SELECT id, user_id, role, industry, company, status, match_percentage,
               matched_skills_json, missing_skills_json, feedback_json, next_steps_json,
               payload_json, created_at, updated_at
        FROM application_job_tracks
        WHERE user_id = ?
        ORDER BY updated_at DESC, id DESC
        LIMIT ?
        """,
        (int(user_id), safe_limit),
    ).fetchall()
    return [serialize_application_job_track_row(row) for row in rows]


def serialize_analysis_report_row(row: Any) -> dict[str, Any]:
    try:
        raw_score = row["overall_score"]
    except Exception:
        raw_score = None
    overall_score = int(raw_score) if raw_score is not None else None
    return {
        "id": int(row["id"]),
        "source": safe_text(row["source"]) or "manual_input",
        "industry": safe_text(row["industry"]),
        "role": safe_text(row["role"]),
        "overall_score": overall_score,
        "shortlist_prediction": safe_text(row["shortlist_prediction"]),
        "created_at": safe_text(row["created_at"]),
    }


def keyword_tokens_from_text(value: str, limit: int = 90) -> list[str]:
    normalized = normalize_search_text(value)
    if not normalized:
        return []
    tokens: list[str] = []
    for raw in normalized.split():
        token = safe_text(raw).strip()
        if len(token) < 3:
            continue
        if token.isdigit():
            continue
        if token in STOPWORDS:
            continue
        if token not in tokens:
            tokens.append(token)
        if len(tokens) >= limit:
            break
    return tokens


def dedupe_text_list(values: list[str], limit: int = 6, max_item_len: int = 180) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []
    for value in values:
        text = re.sub(r"\s+", " ", safe_text(value)).strip()
        if not text:
            continue
        normalized = normalize_search_text(text)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(text[:max_item_len])
        if len(deduped) >= limit:
            break
    return deduped


def infer_track_from_document(text: str) -> tuple[str, int]:
    normalized = normalize_search_text(text)
    if not normalized:
        return "general", 0
    search_space = f" {normalized} "

    def contains_phrase(phrase: str) -> bool:
        normalized_phrase = normalize_search_text(phrase)
        if not normalized_phrase:
            return False
        return f" {normalized_phrase} " in search_space

    best_track = "general"
    best_score = 0
    for track, keywords in ROLE_TRACK_KEYWORDS.items():
        score = 0
        for keyword in keywords:
            if contains_phrase(keyword):
                score += 2 if " " in keyword else 1
        blueprint = ROLE_BLUEPRINTS.get(track, ROLE_BLUEPRINTS["general"])
        for core_skill in blueprint["core"][:6]:
            if contains_phrase(core_skill):
                score += 1
        if score > best_score:
            best_score = score
            best_track = track
    return best_track, best_score


def jd_relevance_verdict_from_score(score: int, is_field_mismatch: bool) -> str:
    if is_field_mismatch and score < 72:
        return "likely_mismatch"
    if score >= 78:
        return "high_relevance"
    if score >= 56:
        return "moderate_relevance"
    return "low_relevance"


def normalize_jd_relevance_verdict(value: str, score: int, is_field_mismatch: bool) -> str:
    normalized = normalize_search_text(value).replace(" ", "_")
    if normalized in {"high_relevance", "moderate_relevance", "low_relevance", "likely_mismatch"}:
        return normalized
    return jd_relevance_verdict_from_score(score, is_field_mismatch)


def build_jd_relevance_baseline(industry: str, role: str, job_description: str, target_track: str) -> dict[str, Any]:
    resolved_target_track = safe_text(target_track) or infer_role_track(role, industry)
    target_family = TRACK_FIELD_FAMILIES.get(resolved_target_track, "general")
    detected_track, detected_track_score = infer_track_from_document(job_description)
    detected_family = TRACK_FIELD_FAMILIES.get(detected_track, "general")
    is_field_mismatch = (
        resolved_target_track not in {"", "general"}
        and detected_track not in {"", "general"}
        and detected_family != target_family
        and detected_track_score >= 3
    )

    blueprint = ROLE_BLUEPRINTS.get(resolved_target_track, ROLE_BLUEPRINTS["general"])
    critical = ROLE_CRITICAL_SKILLS.get(resolved_target_track, ROLE_CRITICAL_SKILLS["general"])
    target_phrases = dedupe_preserve_order(
        [*ROLE_TRACK_KEYWORDS.get(resolved_target_track, []), *blueprint["core"], *critical]
    )[:22]
    target_hits = sum(1 for phrase in target_phrases if phrase_in_text(job_description, phrase))
    target_signal = (target_hits / max(1, len(target_phrases))) * 100.0

    detected_bonus = 14 if detected_track == resolved_target_track else 5 if detected_family == target_family else -20
    confidence_bonus = min(10, detected_track_score * 2)
    relevance_score = clamp(36 + target_signal * 0.44 + detected_bonus + confidence_bonus)
    relevance_verdict = jd_relevance_verdict_from_score(relevance_score, is_field_mismatch)

    reasoning: list[str] = []
    if is_field_mismatch:
        reasoning.append(
            f"JD appears closer to {detected_track.replace('_', ' ')} while target role maps to {resolved_target_track.replace('_', ' ')}."
        )
    elif detected_track != "general":
        reasoning.append(f"JD role language aligns with {detected_track.replace('_', ' ')} track signals.")
    reasoning.append(f"{target_hits} of {max(1, len(target_phrases))} target-role phrases were detected in the JD.")
    if relevance_score >= 75:
        reasoning.append("JD context is strongly relevant to your selected target role.")
    elif relevance_score >= 56:
        reasoning.append("JD is partially relevant; role-specific signals are present but not complete.")
    else:
        reasoning.append("JD has weak role alignment signals for the selected target.")

    return {
        "score": relevance_score,
        "verdict": relevance_verdict,
        "target_track": resolved_target_track or "general",
        "target_family": target_family,
        "detected_jd_track": detected_track,
        "detected_jd_track_score": detected_track_score,
        "detected_family": detected_family,
        "is_field_mismatch": is_field_mismatch,
        "reasoning": dedupe_text_list(reasoning, limit=4, max_item_len=180),
    }


JD_REQUIRED_MARKERS = (
    "must",
    "must have",
    "mandatory",
    "required",
    "requirements",
    "essential",
    "minimum",
    "core",
    "non negotiable",
    "non-negotiable",
)

JD_PREFERRED_MARKERS = (
    "nice to have",
    "good to have",
    "preferred",
    "desirable",
    "plus",
    "bonus",
    "optional",
    "added advantage",
)


def normalize_skill_token(value: str) -> str:
    return normalize_search_text(value).strip()


def classify_jd_skill_priority(job_description: str, jd_skills: list[str], critical_skills: list[str]) -> dict[str, list[str]]:
    normalized_jd = safe_text(job_description)
    windows = [
        safe_text(chunk)
        for chunk in re.split(r"[\n\r]+|(?<=[.!?])\s+", normalized_jd)
        if safe_text(chunk)
    ]
    if not windows:
        windows = [normalized_jd]

    critical_norm = {
        normalize_skill_token(skill)
        for skill in normalize_string_list(critical_skills, limit=32, max_item_len=80)
        if normalize_skill_token(skill)
    }
    ordered_skills = dedupe_text_list(jd_skills, limit=36, max_item_len=80)
    must_have: list[str] = []
    good_to_have: list[str] = []

    for skill in ordered_skills:
        token = normalize_skill_token(skill)
        if not token:
            continue

        matching_windows = [window for window in windows if phrase_in_text(window, skill)]
        window_text = " ".join(matching_windows).lower()
        has_required_marker = any(marker in window_text for marker in JD_REQUIRED_MARKERS)
        has_preferred_marker = any(marker in window_text for marker in JD_PREFERRED_MARKERS)

        if token in critical_norm or (has_required_marker and not has_preferred_marker):
            must_have.append(skill)
            continue
        if has_preferred_marker:
            good_to_have.append(skill)
            continue
        if len(must_have) < 6 and token in critical_norm:
            must_have.append(skill)
            continue
        good_to_have.append(skill)

    if not must_have:
        seeded = dedupe_text_list([*critical_skills, *ordered_skills], limit=12, max_item_len=80)
        must_have = seeded[: max(1, min(6, len(seeded)))]
        must_norm = {normalize_skill_token(skill) for skill in must_have}
        good_to_have = [skill for skill in ordered_skills if normalize_skill_token(skill) not in must_norm]

    must_have = dedupe_text_list(must_have, limit=14, max_item_len=80)
    must_norm = {normalize_skill_token(skill) for skill in must_have}
    good_to_have = dedupe_text_list(
        [skill for skill in good_to_have if normalize_skill_token(skill) not in must_norm],
        limit=16,
        max_item_len=80,
    )
    return {"must_have": must_have, "good_to_have": good_to_have}


def extract_resume_skill_evidence(resume_text: str, skills: list[str], limit_per_skill: int = 2) -> dict[str, list[str]]:
    lines = [
        safe_text(re.sub(r"\s+", " ", line)).strip()
        for line in safe_text(resume_text).replace("\r\n", "\n").replace("\r", "\n").split("\n")
        if safe_text(line)
    ]
    focused_lines = [line for line in lines if len(line) >= 18][:220]
    evidence_map: dict[str, list[str]] = {}

    for skill in dedupe_text_list(skills, limit=24, max_item_len=80):
        hits: list[str] = []
        for line in focused_lines:
            if phrase_in_text(line, skill):
                hits.append(line[:200])
            if len(hits) >= max(1, limit_per_skill):
                break
        if hits:
            evidence_map[skill] = dedupe_text_list(hits, limit=max(1, limit_per_skill), max_item_len=220)
    return evidence_map


def request_structured_json_with_llm(
    prompt: str,
    *,
    temperature: float = 0.18,
    system_prompt: str = "Return strict JSON only. No markdown.",
) -> tuple[dict[str, Any] | None, str | None, str | None]:
    if client is None:
        return None, None, "OPENAI_API_KEY not configured"

    models: list[str] = []
    for model in [ANALYZE_LLM_MODEL, OPENAI_MODEL, *OPENAI_FALLBACK_MODELS]:
        cleaned = safe_text(model)
        if cleaned and cleaned not in models:
            models.append(cleaned)

    last_error: str | None = None
    for model in models:
        for attempt in range(3):
            try:
                response = client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=temperature,
                )
                content = extract_llm_text(response.choices[0].message.content if response.choices else "")
                parsed = parse_llm_json_payload(content)
                if isinstance(parsed, dict):
                    return parsed, model, None
                last_error = f"invalid_json_from_{model}"
                logger.error("Structured LLM response returned non-JSON content for model '%s'.", model)
                break
            except Exception as exc:
                last_error = f"{type(exc).__name__} on model {model}"
                logger.exception("Structured LLM request failed for model '%s' (attempt %s).", model, attempt + 1)
                if attempt < 2 and is_transient_openai_error(exc):
                    time.sleep(0.35 * (attempt + 1))
                    continue
                break
    return None, None, last_error


def request_jd_match_overlay(
    industry: str,
    role: str,
    resume_text: str,
    job_description: str,
    deterministic_baseline: dict[str, Any],
) -> tuple[dict[str, Any] | None, str | None, str | None]:
    if client is None:
        return None, None, "OPENAI_API_KEY not configured"

    models: list[str] = []
    for model in [ANALYZE_LLM_MODEL, OPENAI_MODEL, *OPENAI_FALLBACK_MODELS]:
        cleaned = safe_text(model)
        if cleaned and cleaned not in models:
            models.append(cleaned)

    prompt = f"""
You are an expert hiring evaluator. Compare resume vs job description and return strict JSON only.

Target role: {safe_text(role)}
Target industry: {safe_text(industry)}

Resume text:
{safe_text(resume_text)[:6500]}

Job description text:
{safe_text(job_description)[:6500]}

Deterministic baseline:
{json.dumps(deterministic_baseline, ensure_ascii=False)}

Rules:
- Score true JD-resume fit, not generic keyword stuffing.
- If JD appears from a different role field than target role, mark likely mismatch and explain.
- Feedback should be specific and actionable.

JSON schema (all keys required):
{{
  "match_percentage": <number 0-100>,
  "jd_relevance_score": <number 0-100>,
  "jd_relevance_verdict": "high_relevance|moderate_relevance|low_relevance|likely_mismatch",
  "detected_jd_track": "<short track name>",
  "matched_skills": ["skill 1", "skill 2", "skill 3"],
  "missing_skills": ["skill 1", "skill 2", "skill 3"],
  "feedback": ["feedback line 1", "feedback line 2", "feedback line 3"],
  "improvements": ["improvement 1", "improvement 2", "improvement 3"],
  "next_steps": ["next step 1", "next step 2", "next step 3"],
  "reasoning": ["reason 1", "reason 2", "reason 3"]
}}
"""

    last_error: str | None = None
    for model in models:
        for attempt in range(3):
            try:
                response = client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": "Return strict JSON only. No markdown."},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.12,
                )
                content = extract_llm_text(response.choices[0].message.content if response.choices else "")
                parsed = parse_llm_json_payload(content)
                if isinstance(parsed, dict):
                    return parsed, model, None
                last_error = f"invalid_json_from_{model}"
                logger.error("JD match LLM overlay returned non-JSON content for model '%s'.", model)
                break
            except Exception as exc:
                last_error = f"{type(exc).__name__} on model {model}"
                logger.exception("JD match LLM overlay failed for model '%s' (attempt %s).", model, attempt + 1)
                if attempt < 2 and is_transient_openai_error(exc):
                    time.sleep(0.35 * (attempt + 1))
                    continue
                break
    return None, None, last_error


def build_jd_match_payload(industry: str, role: str, resume_text: str, job_description: str) -> dict[str, Any]:
    jd_skills = extract_skills_from_text(job_description)
    resume_skills = extract_skills_from_text(resume_text)
    resume_skill_set = set(resume_skills)
    jd_tokens = dedupe_preserve_order([*jd_skills, *keyword_tokens_from_text(job_description, limit=120)])[:80]
    resume_tokens = set(dedupe_preserve_order([*resume_skills, *keyword_tokens_from_text(resume_text, limit=120)]))
    if not jd_tokens:
        jd_tokens = keyword_tokens_from_text(f"{industry} {role}", limit=16)

    matched = [token for token in jd_tokens if token in resume_tokens][:20]
    missing = [token for token in jd_tokens if token not in resume_tokens][:20]
    matched_skills_base = [skill for skill in jd_skills if skill in resume_skill_set][:20]
    missing_skills_base = [skill for skill in jd_skills if skill not in resume_skill_set][:20]
    if not matched_skills_base:
        matched_skills_base = matched[:20]
    if not missing_skills_base:
        missing_skills_base = missing[:20]
    denominator = max(1, len(jd_tokens))
    coverage = (len(matched) / denominator) * 100.0

    requested_track, requested_track_score = infer_role_track_with_score(role, industry)
    detected_jd_track, detected_jd_track_score = infer_track_from_document(job_description)
    if requested_track_score > 0 and requested_track in ROLE_BLUEPRINTS:
        target_track = requested_track
    elif detected_jd_track in ROLE_BLUEPRINTS and detected_jd_track not in {"", "general"} and detected_jd_track_score >= 3:
        # If role/industry hints are weak or omitted, use JD intent as the scoring anchor.
        target_track = detected_jd_track
    else:
        target_track = "general"

    role_track = target_track
    blueprint = ROLE_BLUEPRINTS.get(role_track, ROLE_BLUEPRINTS["general"])
    critical_skills = ROLE_CRITICAL_SKILLS.get(role_track, ROLE_CRITICAL_SKILLS["general"])
    skill_priority = classify_jd_skill_priority(job_description, jd_skills, critical_skills)
    must_have_skills = skill_priority.get("must_have") or []
    good_to_have_skills = skill_priority.get("good_to_have") or []
    missing_must_have_base = [skill for skill in must_have_skills if not phrase_in_text(resume_text, skill)]
    critical_total = max(1, len(critical_skills))
    critical_hits = len(
        [
            skill
            for skill in critical_skills
            if phrase_in_text(resume_text, skill) or normalize_token(skill) in resume_tokens
        ]
    )
    critical_coverage = (critical_hits / critical_total) * 100.0
    deterministic_match_score = clamp(0.68 * coverage + 0.32 * critical_coverage)

    relevance = build_jd_relevance_baseline(industry, role, job_description, target_track=target_track)

    suggested_bullets: list[str] = []
    for skill in [*missing_must_have_base, *missing_skills_base][:5]:
        suggested_bullets.append(
            f"Add one quantified bullet proving {skill} impact for {safe_text(role) or 'the target role'}."
        )
    if not suggested_bullets and matched_skills_base:
        suggested_bullets.append("Your keyword alignment is strong. Focus on quantified outcomes and role-specific proof.")

    deterministic_feedback: list[str] = []
    if deterministic_match_score >= 75:
        deterministic_feedback.append("Resume and JD show strong role alignment.")
    elif deterministic_match_score >= 50:
        deterministic_feedback.append("Resume is moderately aligned but key JD requirements are still missing.")
    else:
        deterministic_feedback.append("Current resume and JD alignment is low.")
    deterministic_feedback.extend(relevance.get("reasoning") or [])

    deterministic_improvements: list[str] = []
    for missing_skill in [*missing_must_have_base, *missing_skills_base][:4]:
        deterministic_improvements.append(f"Add role-specific proof for '{missing_skill}' with measurable outcomes.")
    if int(round(critical_coverage)) < 60:
        deterministic_improvements.append("Strengthen must-have skills from the JD before applying.")
    if not deterministic_improvements:
        deterministic_improvements.append("Tighten bullets with metrics and business outcomes for stronger screening impact.")

    deterministic_next_steps: list[str] = []
    if relevance.get("is_field_mismatch"):
        deterministic_next_steps.append(
            f"Verify JD relevance: it appears closer to {safe_text(relevance.get('detected_jd_track')).replace('_', ' ') or 'another'} roles."
        )
        deterministic_next_steps.append(f"Upload or paste a JD specifically for {safe_text(role) or 'your target role'}.")
    deterministic_next_steps.extend(
        [
            "Prioritize the top 3 missing JD skills in your resume summary and latest experience bullets.",
            "Re-run JD Match after edits to validate score uplift and coverage gains.",
        ]
    )

    deterministic_baseline = {
        "match_percentage": deterministic_match_score,
        "critical_coverage": int(round(critical_coverage)),
        "keyword_coverage": clamp(coverage),
        "matched_keywords": matched[:12],
        "missing_keywords": missing[:12],
        "matched_skills": matched_skills_base[:12],
        "missing_skills": missing_skills_base[:12],
        "must_have_skills": must_have_skills[:10],
        "good_to_have_skills": good_to_have_skills[:10],
        "missing_must_have_skills": missing_must_have_base[:8],
        "target_track": target_track,
        "detected_jd_track": safe_text(relevance.get("detected_jd_track")),
        "jd_relevance_score": int(relevance.get("score") or 0),
        "jd_relevance_verdict": safe_text(relevance.get("verdict")),
        "is_field_mismatch": bool(relevance.get("is_field_mismatch")),
    }

    llm_payload, llm_model, llm_error = request_jd_match_overlay(
        industry=industry,
        role=role,
        resume_text=resume_text,
        job_description=job_description,
        deterministic_baseline=deterministic_baseline,
    )

    final_match_score = deterministic_match_score
    relevance_score = int(relevance.get("score") or 0)
    relevance_verdict = safe_text(relevance.get("verdict"))
    detected_jd_track = safe_text(relevance.get("detected_jd_track")) or "general"
    matched_skills = dedupe_text_list(matched_skills_base, limit=20, max_item_len=80)
    missing_skills = dedupe_text_list(missing_skills_base, limit=20, max_item_len=80)
    feedback = dedupe_text_list(deterministic_feedback, limit=6, max_item_len=180)
    improvements = dedupe_text_list([*deterministic_improvements, *suggested_bullets], limit=6, max_item_len=180)
    next_steps = dedupe_text_list(deterministic_next_steps, limit=5, max_item_len=180)
    relevance_reasoning = dedupe_text_list(relevance.get("reasoning") or [], limit=4, max_item_len=180)
    ai_used = False

    if isinstance(llm_payload, dict):
        llm_match = clamp_float(safe_float(llm_payload.get("match_percentage"), float(deterministic_match_score)), 0.0, 100.0)
        llm_relevance = clamp_float(safe_float(llm_payload.get("jd_relevance_score"), float(relevance_score)), 0.0, 100.0)
        final_match_score = clamp((1.0 - JD_MATCH_LLM_BLEND) * deterministic_match_score + JD_MATCH_LLM_BLEND * llm_match)
        blended_relevance = clamp((1.0 - JD_MATCH_LLM_BLEND) * relevance_score + JD_MATCH_LLM_BLEND * llm_relevance)

        llm_detected_track = safe_text(llm_payload.get("detected_jd_track"))
        if llm_detected_track in ROLE_BLUEPRINTS:
            detected_jd_track = llm_detected_track
        detected_family = TRACK_FIELD_FAMILIES.get(detected_jd_track, "general")
        target_family = TRACK_FIELD_FAMILIES.get(target_track, "general")
        is_field_mismatch = (
            target_track not in {"", "general"}
            and detected_jd_track not in {"", "general"}
            and target_family != detected_family
        )

        relevance_score = blended_relevance
        relevance_verdict = normalize_jd_relevance_verdict(
            safe_text(llm_payload.get("jd_relevance_verdict")),
            relevance_score,
            is_field_mismatch,
        )

        llm_feedback = normalize_string_list(llm_payload.get("feedback"), limit=6, max_item_len=180)
        llm_improvements = normalize_string_list(llm_payload.get("improvements"), limit=6, max_item_len=180)
        llm_next_steps = normalize_string_list(llm_payload.get("next_steps"), limit=5, max_item_len=180)
        llm_reasoning = normalize_string_list(llm_payload.get("reasoning"), limit=4, max_item_len=180)
        llm_matched_skills = normalize_string_list(llm_payload.get("matched_skills"), limit=20, max_item_len=80)
        llm_missing_skills = normalize_string_list(llm_payload.get("missing_skills"), limit=20, max_item_len=80)

        matched_skills = dedupe_text_list([*llm_matched_skills, *matched_skills], limit=20, max_item_len=80)
        missing_skills = dedupe_text_list([*llm_missing_skills, *missing_skills], limit=20, max_item_len=80)
        feedback = dedupe_text_list([*llm_feedback, *feedback], limit=6, max_item_len=180)
        improvements = dedupe_text_list([*llm_improvements, *improvements], limit=6, max_item_len=180)
        next_steps = dedupe_text_list([*llm_next_steps, *next_steps], limit=5, max_item_len=180)
        relevance_reasoning = dedupe_text_list([*llm_reasoning, *relevance_reasoning], limit=4, max_item_len=180)
        ai_used = True
    else:
        detected_family = TRACK_FIELD_FAMILIES.get(detected_jd_track, "general")
        target_family = TRACK_FIELD_FAMILIES.get(target_track, "general")
        is_field_mismatch = bool(relevance.get("is_field_mismatch"))

    if is_field_mismatch or relevance_verdict == "likely_mismatch":
        alignment_summary = (
            f"Potential field mismatch: JD looks closer to {detected_jd_track.replace('_', ' ')} roles than {target_track.replace('_', ' ')}."
        )
    elif final_match_score >= 75 and relevance_score >= 70:
        alignment_summary = "Strong role-JD alignment with good resume coverage for this target role."
    elif final_match_score >= 50:
        alignment_summary = "Moderate alignment. Improve missing must-have skills and quantified proof."
    else:
        alignment_summary = "Low alignment. Prioritize core JD requirements first."

    if not feedback:
        feedback = [alignment_summary]
    if not improvements:
        improvements = ["Add quantified achievements tied to the most important JD requirements."]
    if not next_steps:
        next_steps = ["Update the resume with missing role skills and rerun JD Match."]
    if not matched_skills:
        matched_skills = dedupe_text_list(matched[:20], limit=20, max_item_len=80)
    if not missing_skills:
        missing_skills = dedupe_text_list(missing[:20], limit=20, max_item_len=80)

    must_have_skills = dedupe_text_list(must_have_skills, limit=14, max_item_len=80)
    must_have_norm = {normalize_skill_token(skill) for skill in must_have_skills if normalize_skill_token(skill)}
    if not good_to_have_skills:
        good_to_have_skills = [
            skill
            for skill in dedupe_text_list(jd_skills, limit=20, max_item_len=80)
            if normalize_skill_token(skill) not in must_have_norm
        ][:12]
    good_to_have_skills = dedupe_text_list(good_to_have_skills, limit=16, max_item_len=80)
    matched_norm = {normalize_skill_token(skill) for skill in matched_skills if normalize_skill_token(skill)}

    def is_skill_covered(skill: str) -> bool:
        token = normalize_skill_token(skill)
        if not token:
            return False
        return token in matched_norm or phrase_in_text(resume_text, skill)

    matched_must_have_skills = [skill for skill in must_have_skills if is_skill_covered(skill)]
    missing_must_have_skills = [skill for skill in must_have_skills if skill not in matched_must_have_skills]
    matched_good_to_have_skills = [skill for skill in good_to_have_skills if is_skill_covered(skill)]
    missing_good_to_have_skills = [skill for skill in good_to_have_skills if skill not in matched_good_to_have_skills]
    must_have_coverage = int(round((len(matched_must_have_skills) / max(1, len(must_have_skills))) * 100.0))
    good_to_have_coverage = int(round((len(matched_good_to_have_skills) / max(1, len(good_to_have_skills))) * 100.0))
    if must_have_coverage < 45 or len(missing_must_have_skills) >= 3:
        gap_severity = "high"
    elif must_have_coverage < 75 or len(missing_must_have_skills) >= 1:
        gap_severity = "medium"
    else:
        gap_severity = "low"

    matched_skill_evidence = extract_resume_skill_evidence(
        resume_text,
        [*matched_must_have_skills, *matched_good_to_have_skills, *matched_skills[:6]],
        limit_per_skill=2,
    )

    return {
        "role_track": role_track,
        "match_score": final_match_score,
        "match_percentage": final_match_score,
        "matched_keywords": matched,
        "missing_keywords": missing,
        "matched_skills": matched_skills,
        "missing_skills": missing_skills,
        "must_have_skills": must_have_skills,
        "good_to_have_skills": good_to_have_skills,
        "matched_must_have_skills": matched_must_have_skills,
        "missing_must_have_skills": missing_must_have_skills,
        "matched_good_to_have_skills": matched_good_to_have_skills,
        "missing_good_to_have_skills": missing_good_to_have_skills,
        "matched_skill_evidence": matched_skill_evidence,
        "skill_breakdown": {
            "must_have_coverage": must_have_coverage,
            "good_to_have_coverage": good_to_have_coverage,
            "gap_severity": gap_severity,
            "must_have_total": len(must_have_skills),
            "good_to_have_total": len(good_to_have_skills),
        },
        "jd_keyword_count": len(jd_tokens),
        "resume_keyword_count": len(resume_tokens),
        "critical_coverage": int(round(critical_coverage)),
        "suggested_bullets": improvements[:5] or suggested_bullets,
        "alignment_summary": alignment_summary,
        "feedback": feedback,
        "improvements": improvements,
        "next_steps": next_steps,
        "jd_relevance": {
            "score": relevance_score,
            "verdict": relevance_verdict,
            "target_track": target_track,
            "detected_jd_track": detected_jd_track,
            "target_field_family": target_family,
            "detected_field_family": detected_family,
            "is_field_mismatch": bool(is_field_mismatch or relevance_verdict == "likely_mismatch"),
            "reasoning": relevance_reasoning,
            "ai": {
                "used": ai_used,
                "model": llm_model,
                "blend": JD_MATCH_LLM_BLEND if ai_used else 0.0,
                "deterministic_match_score": deterministic_match_score,
                "deterministic_relevance_score": int(relevance.get("score") or 0),
                "reason": "hybrid" if ai_used else (llm_error or "rules_only"),
            },
        },
        "role_profile": {
            "core": blueprint["core"][:8],
            "critical": critical_skills[:5],
        },
    }


def analysis_snapshot_from_row(row: Any) -> dict[str, Any]:
    payload = parse_meta_json(row["report_json"])
    callback_forecast = payload.get("callback_forecast") if isinstance(payload.get("callback_forecast"), dict) else {}
    confidence = int(clamp_float(float(payload.get("confidence") or 0), 0.0, 100.0))
    callback_rate = round(clamp_float(float(callback_forecast.get("estimated_callback_rate") or 0), 0.0, 100.0), 1)
    return {
        "id": int(row["id"]),
        "created_at": safe_text(row["created_at"]),
        "source": safe_text(row["source"]) or "manual_input",
        "industry": safe_text(row["industry"]),
        "role": safe_text(row["role"]),
        "overall_score": int(clamp_float(float(row["overall_score"] or payload.get("overall_score") or 0), 0.0, 100.0)),
        "confidence": confidence,
        "critical_missing_count": len(normalize_string_list(payload.get("critical_missing_skills"), limit=24, max_item_len=80)),
        "estimated_callback_rate": callback_rate,
        "shortlist_prediction": safe_text(payload.get("shortlist_prediction") or row["shortlist_prediction"]),
    }


def build_analysis_comparison_payload(connection: AuthDBConnection, user_id: int) -> dict[str, Any]:
    rows = connection.execute(
        """
        SELECT id, source, industry, role, overall_score, shortlist_prediction, report_json, created_at
        FROM analysis_reports
        WHERE user_id = ? AND lower(source) != 'interview_simulator'
        ORDER BY id DESC
        LIMIT 2
        """,
        (user_id,),
    ).fetchall()
    if not rows:
        return {"latest": None, "previous": None, "delta": None}

    latest = analysis_snapshot_from_row(rows[0])
    previous = analysis_snapshot_from_row(rows[1]) if len(rows) > 1 else None
    if not previous:
        return {"latest": latest, "previous": None, "delta": None}

    delta = {
        "overall_score": int(latest["overall_score"]) - int(previous["overall_score"]),
        "confidence": int(latest["confidence"]) - int(previous["confidence"]),
        "critical_missing_count": int(previous["critical_missing_count"]) - int(latest["critical_missing_count"]),
        "estimated_callback_rate": round(float(latest["estimated_callback_rate"]) - float(previous["estimated_callback_rate"]), 1),
    }
    return {"latest": latest, "previous": previous, "delta": delta}


def build_weekly_execution_coach_payload(roadmap: dict[str, Any] | None) -> dict[str, Any] | None:
    if not roadmap:
        return None
    milestones = roadmap.get("milestones") if isinstance(roadmap.get("milestones"), list) else []
    pending = [item for item in milestones if not bool(item.get("completed"))]
    if not pending:
        return {
            "title": "Roadmap Completed",
            "coach_note": "All milestones are complete. Run a fresh analysis to generate your next track.",
            "next_three_tasks": [],
            "week_focus": "Validate gains with a new analysis run and maintain momentum.",
        }

    next_three = []
    for item in pending[:3]:
        next_three.append(
            {
                "id": safe_text(item.get("id")),
                "title": safe_text(item.get("title")) or "Milestone task",
                "detail": safe_text(item.get("detail"))[:220],
                "timeframe": safe_text(item.get("timeframe")) or "This week",
                "done_when": safe_text(item.get("done_when"))[:220],
            }
        )
    return {
        "title": "Weekly Execution Coach",
        "coach_note": "Complete these three actions this week to improve shortlist outcomes measurably.",
        "next_three_tasks": next_three,
        "week_focus": safe_text(next_three[0]["title"]) if next_three else "Prioritize your top pending milestone.",
    }


def build_feature_flags(user_id: int | None = None) -> dict[str, Any]:
    base = {
        "onboarding_copy_variant": "A",
        "roadmap_prompt_variant": "A",
        "pricing_cta_variant": "A",
        "public_feature_access_enabled": public_feature_access_enabled(),
    }
    if AB_FLAGS_JSON:
        try:
            parsed = json.loads(AB_FLAGS_JSON)
            if isinstance(parsed, dict):
                for key in base:
                    value = safe_text(parsed.get(key))
                    if value in {"A", "B"}:
                        base[key] = value
        except Exception:
            pass
    if user_id and user_id > 0:
        bucket = int(user_id) % 2
        if bucket == 1:
            base["roadmap_prompt_variant"] = "B"
        if int(user_id) % 3 == 1:
            base["pricing_cta_variant"] = "B"
    return base


def enqueue_async_job(user_id: int, job_type: str, worker_fn) -> dict[str, Any]:
    job_id = f"job_{uuid.uuid4().hex[:20]}"
    now = now_utc_iso()
    with ASYNC_JOB_LOCK:
        ASYNC_JOB_STORE[job_id] = {
            "id": job_id,
            "user_id": int(user_id),
            "job_type": safe_text(job_type) or "job",
            "status": "queued",
            "attempts": 0,
            "created_at": now,
            "updated_at": now,
            "started_at": None,
            "completed_at": None,
            "error": None,
            "result": None,
        }

    def _run_job() -> None:
        attempts = 0
        while attempts <= ASYNC_JOB_RETRY_ATTEMPTS:
            attempts += 1
            with ASYNC_JOB_LOCK:
                if job_id not in ASYNC_JOB_STORE:
                    return
                ASYNC_JOB_STORE[job_id]["status"] = "running"
                ASYNC_JOB_STORE[job_id]["attempts"] = attempts
                ASYNC_JOB_STORE[job_id]["started_at"] = ASYNC_JOB_STORE[job_id]["started_at"] or now_utc_iso()
                ASYNC_JOB_STORE[job_id]["updated_at"] = now_utc_iso()

            try:
                result_payload = worker_fn()
                with ASYNC_JOB_LOCK:
                    if job_id not in ASYNC_JOB_STORE:
                        return
                    ASYNC_JOB_STORE[job_id]["status"] = "succeeded"
                    ASYNC_JOB_STORE[job_id]["result"] = result_payload
                    ASYNC_JOB_STORE[job_id]["error"] = None
                    ASYNC_JOB_STORE[job_id]["completed_at"] = now_utc_iso()
                    ASYNC_JOB_STORE[job_id]["updated_at"] = now_utc_iso()
                return
            except Exception as exc:
                retryable = is_transient_openai_error(exc) or (
                    isinstance(exc, HTTPException) and int(exc.status_code or 500) >= 500
                )
                if attempts <= ASYNC_JOB_RETRY_ATTEMPTS and retryable:
                    time.sleep(0.35 * attempts)
                    continue
                if isinstance(exc, HTTPException):
                    detail_text = safe_text(exc.detail if isinstance(exc.detail, str) else json.dumps(exc.detail))
                else:
                    detail_text = safe_text(str(exc))
                with ASYNC_JOB_LOCK:
                    if job_id not in ASYNC_JOB_STORE:
                        return
                    ASYNC_JOB_STORE[job_id]["status"] = "failed"
                    ASYNC_JOB_STORE[job_id]["error"] = detail_text[:320] or "Job failed."
                    ASYNC_JOB_STORE[job_id]["completed_at"] = now_utc_iso()
                    ASYNC_JOB_STORE[job_id]["updated_at"] = now_utc_iso()
                return

    ASYNC_JOB_EXECUTOR.submit(_run_job)
    with ASYNC_JOB_LOCK:
        return dict(ASYNC_JOB_STORE[job_id])


def get_async_job_for_user(job_id: str, user_id: int) -> dict[str, Any] | None:
    token = safe_text(job_id)
    if not token:
        return None
    with ASYNC_JOB_LOCK:
        row = ASYNC_JOB_STORE.get(token)
        if not row:
            return None
        if int(row.get("user_id") or 0) != int(user_id):
            return None
        return dict(row)


def serialize_async_job_payload(job: dict[str, Any] | None) -> dict[str, Any]:
    if not job:
        return {}
    return {
        "id": safe_text(job.get("id")),
        "job_type": safe_text(job.get("job_type")),
        "status": safe_text(job.get("status")) or "queued",
        "attempts": int(job.get("attempts") or 0),
        "created_at": safe_text(job.get("created_at")),
        "updated_at": safe_text(job.get("updated_at")),
        "started_at": safe_text(job.get("started_at")),
        "completed_at": safe_text(job.get("completed_at")),
        "error": safe_text(job.get("error")),
        "result": job.get("result") if isinstance(job.get("result"), dict) else None,
    }


def request_interview_prep_overlay(
    role: str,
    industry: str,
    prep_focus: list[str],
    job_description: str,
    deterministic_payload: dict[str, Any],
) -> tuple[dict[str, Any] | None, str | None, str | None]:
    prompt = f"""
You are a senior interview coach.
Return ONLY one strict JSON object. No markdown.

Target role: {safe_text(role)}
Target industry: {safe_text(industry)}
Focus skills: {json.dumps(prep_focus[:8], ensure_ascii=False)}
Job description:
{safe_text(job_description)[:4500]}

Deterministic baseline:
{json.dumps(deterministic_payload, ensure_ascii=False)}

Output schema:
{{
  "coach_note": "max 55 words",
  "focus_skills": ["skill 1", "skill 2", "skill 3"],
  "mock_questions": ["question 1", "question 2", "question 3", "question 4", "question 5", "question 6"],
  "star_drills": [
    {{"title": "drill title", "prompt": "drill prompt"}}
  ],
  "prep_sprint": ["day step 1", "day step 2", "day step 3", "day step 4", "day step 5"]
}}

Rules:
- Keep advice specific for this role.
- Questions should evaluate outcomes, decision quality, and stakeholder clarity.
- Do not invent fake background details.
"""

    parsed, model, error = request_structured_json_with_llm(prompt, temperature=0.26)
    if not isinstance(parsed, dict):
        return None, model, error

    star_drills_value = parsed.get("star_drills")
    star_drills: list[dict[str, str]] = []
    if isinstance(star_drills_value, list):
        for item in star_drills_value:
            if not isinstance(item, dict):
                continue
            title = safe_text(item.get("title"))[:80]
            prompt_text = safe_text(item.get("prompt"))[:220]
            if title and prompt_text:
                star_drills.append({"title": title, "prompt": prompt_text})
            if len(star_drills) >= 5:
                break

    payload = {
        "coach_note": safe_text(parsed.get("coach_note"))[:320],
        "focus_skills": normalize_string_list(parsed.get("focus_skills"), limit=8, max_item_len=64),
        "mock_questions": normalize_string_list(parsed.get("mock_questions"), limit=6, max_item_len=220),
        "prep_sprint": normalize_string_list(parsed.get("prep_sprint"), limit=5, max_item_len=140),
        "star_drills": star_drills,
    }
    return payload, model, None


def request_application_pack_overlay(
    role: str,
    industry: str,
    resume_text: str,
    job_description: str,
    deterministic_payload: dict[str, Any],
) -> tuple[dict[str, Any] | None, str | None, str | None]:
    prompt = f"""
You are an expert job-application strategist.
Return ONLY one strict JSON object. No markdown.

Target role: {safe_text(role)}
Target industry: {safe_text(industry)}
Resume excerpt:
{safe_text(resume_text)[:5200]}

Job description:
{safe_text(job_description)[:4200]}

Deterministic baseline:
{json.dumps(deterministic_payload, ensure_ascii=False)}

Output schema:
{{
  "subject_line": "email subject",
  "outreach_email": "plain-text email draft",
  "linkedin_message": "short DM",
  "cover_letter_opening": "opening paragraph",
  "jd_focus_keywords": ["keyword 1", "keyword 2", "keyword 3"],
  "application_checklist": ["checklist item 1", "checklist item 2", "checklist item 3"],
  "recruiter_follow_up": "follow-up note after 5 days"
}}

Rules:
- Keep claims factual and aligned to supplied content.
- Keep language concise, professional, and role-specific.
- Do not include placeholders like [Company] unless unavoidable.
"""

    parsed, model, error = request_structured_json_with_llm(prompt, temperature=0.22)
    if not isinstance(parsed, dict):
        return None, model, error

    payload = {
        "subject_line": safe_text(parsed.get("subject_line"))[:180],
        "outreach_email": safe_text(parsed.get("outreach_email"))[:1800],
        "linkedin_message": safe_text(parsed.get("linkedin_message"))[:420],
        "cover_letter_opening": safe_text(parsed.get("cover_letter_opening"))[:600],
        "jd_focus_keywords": normalize_string_list(parsed.get("jd_focus_keywords"), limit=8, max_item_len=64),
        "application_checklist": normalize_string_list(parsed.get("application_checklist"), limit=8, max_item_len=180),
        "recruiter_follow_up": safe_text(parsed.get("recruiter_follow_up"))[:420],
    }
    return payload, model, None


def build_interview_prep_payload(data: InterviewPrepRequest) -> dict[str, Any]:
    role = safe_text(data.role) or "Target role"
    industry = safe_text(data.industry) or "General"
    missing_from_input = normalize_string_list(data.critical_missing_skills, limit=8, max_item_len=64)
    jd_skills = extract_skills_from_text(safe_text(data.job_description))[:8]
    _, _, critical_skills, _ = resolve_role_profile(role, industry, missing_from_input)

    prep_focus = dedupe_preserve_order([*missing_from_input, *jd_skills, *critical_skills])[:6]
    if not prep_focus:
        prep_focus = ["role narrative", "problem solving", "impact metrics", "stakeholder communication"]

    mock_questions = [
        f"Walk me through a project where you applied {prep_focus[0]} and measurable outcomes.",
        f"How would you prioritize your first 30 days as a {role} in {industry}?",
        f"Describe a challenge where you had to improve {prep_focus[min(1, len(prep_focus) - 1)]}. What changed?",
        f"Tell me about a decision with incomplete data and how you reduced risk.",
        f"How do you collaborate with cross-functional stakeholders under tight timelines?",
    ]
    if len(prep_focus) > 2:
        mock_questions.append(f"What is your plan to close the {prep_focus[2]} gap in the next 4 weeks?")

    star_drills = [
        {
            "title": "High-impact story",
            "prompt": "Situation + Task + Action + Result with one hard metric and clear ownership.",
        },
        {
            "title": "Conflict resolution story",
            "prompt": "Explain disagreement context, decision framing, compromise, and business outcome.",
        },
        {
            "title": "Failure recovery story",
            "prompt": "Share what failed, your correction loop, and the measurable recovery result.",
        },
    ]

    fallback_note = (
        f"Prepare answers around {', '.join(prep_focus[:3])}. Keep every answer metric-backed and role-specific for {role}."
    )
    deterministic_payload = {
        "role": role,
        "industry": industry,
        "focus_skills": prep_focus[:6],
        "coach_note": fallback_note,
        "mock_questions": mock_questions[:6],
        "star_drills": star_drills,
        "prep_sprint": [
            "Day 1: Draft 6 role-specific story bullets.",
            "Day 2: Convert each bullet into STAR format with one metric.",
            "Day 3: Practice concise 90-second answers and record yourself.",
            "Day 4: Mock interview with follow-up challenge questions.",
            "Day 5: Tighten weak answers and finalize interview cheat sheet.",
        ],
    }

    llm_overlay, llm_model, llm_error = request_interview_prep_overlay(
        role=role,
        industry=industry,
        prep_focus=prep_focus,
        job_description=safe_text(data.job_description),
        deterministic_payload=deterministic_payload,
    )

    coach_note = fallback_note
    coach_note_ai_generated = False
    coach_note_ai_error: str | None = None
    final_focus_skills = prep_focus[:6]
    final_mock_questions = mock_questions[:6]
    final_star_drills = star_drills
    final_prep_sprint = deterministic_payload["prep_sprint"]
    overlay_used = False

    if isinstance(llm_overlay, dict):
        overlay_used = True
        final_focus_skills = dedupe_text_list(
            [*normalize_string_list(llm_overlay.get("focus_skills"), limit=8, max_item_len=64), *prep_focus],
            limit=8,
            max_item_len=64,
        )
        final_mock_questions = dedupe_text_list(
            [*normalize_string_list(llm_overlay.get("mock_questions"), limit=6, max_item_len=220), *mock_questions],
            limit=6,
            max_item_len=220,
        )
        overlay_star_drills = llm_overlay.get("star_drills") if isinstance(llm_overlay.get("star_drills"), list) else []
        normalized_star_drills: list[dict[str, str]] = []
        for item in overlay_star_drills:
            if not isinstance(item, dict):
                continue
            title = safe_text(item.get("title"))[:80]
            prompt_text = safe_text(item.get("prompt"))[:220]
            if title and prompt_text:
                normalized_star_drills.append({"title": title, "prompt": prompt_text})
            if len(normalized_star_drills) >= 5:
                break
        final_star_drills = normalized_star_drills or final_star_drills
        final_prep_sprint = dedupe_text_list(
            [*normalize_string_list(llm_overlay.get("prep_sprint"), limit=5, max_item_len=140), *final_prep_sprint],
            limit=5,
            max_item_len=140,
        )
        coach_note = safe_text(llm_overlay.get("coach_note")) or coach_note
        coach_note_ai_generated = True
    else:
        coach_note, coach_note_ai_generated, coach_note_ai_error = generate_with_llm(
            system_prompt="You are an interview coach. Give concise and practical guidance.",
            user_prompt=(
                f"Role: {role}\nIndustry: {industry}\n"
                f"Focus gaps: {', '.join(prep_focus)}\n"
                "Write one short coaching note (max 55 words) to improve interview performance."
            ),
            temperature=0.2,
            fallback_text=fallback_note,
        )

    return {
        "role": role,
        "industry": industry,
        "focus_skills": final_focus_skills,
        "coach_note": safe_text(coach_note) or fallback_note,
        "coach_note_ai_generated": bool(coach_note_ai_generated),
        "mock_questions": final_mock_questions,
        "star_drills": final_star_drills,
        "prep_sprint": final_prep_sprint,
        "ai": {
            "used": bool(overlay_used or coach_note_ai_generated),
            "model": llm_model if overlay_used else (OPENAI_MODEL if coach_note_ai_generated else None),
            "reason": "hybrid_overlay" if overlay_used else (coach_note_ai_error or llm_error or "rules_only"),
        },
    }


def build_application_pack_payload(data: ApplicationPackRequest) -> dict[str, Any]:
    role = safe_text(data.role) or "Target role"
    industry = safe_text(data.industry) or "General"
    resume_text = safe_text(data.resume_text)
    job_description = safe_text(data.job_description)

    resume_lines = [
        safe_text(re.sub(r"^[\-\*\u2022]+\s*", "", line))
        for line in resume_text.splitlines()
        if safe_text(line)
    ]
    highlight_lines = [line for line in resume_lines if len(line) > 30][:5]
    jd_skills = extract_skills_from_text(job_description)[:8]
    if not highlight_lines:
        highlight_lines = [
            f"Role-fit profile built for {role}.",
            "Outcome-focused bullets with measurable impact.",
        ]

    deterministic_subject_line = f"Application for {role} - measurable impact profile"
    deterministic_outreach_email = (
        f"Hi Hiring Team,\n\n"
        f"I am applying for the {role} position in {industry}. I’ve aligned my profile to your role requirements and focused on quantified outcomes.\n\n"
        f"Highlights:\n"
        f"- {highlight_lines[0]}\n"
        f"- {highlight_lines[min(1, len(highlight_lines) - 1)]}\n"
        f"- {highlight_lines[min(2, len(highlight_lines) - 1)]}\n\n"
        "I would value an opportunity to discuss how this experience can contribute to your team goals.\n\n"
        "Regards,"
    )
    deterministic_linkedin_message = (
        f"Hi, I’m exploring {role} opportunities in {industry}. "
        f"I’ve recently refined my profile around {', '.join(jd_skills[:3]) or 'core role outcomes'} "
        "and would appreciate a quick conversation."
    )
    deterministic_cover_letter_opening = (
        f"I’m excited to apply for the {role} role. My profile combines execution depth in {industry} "
        "with measurable outcomes and recruiter-ready positioning."
    )
    deterministic_checklist = [
        "Resume title and summary aligned to role + industry.",
        "Top 4 bullets include measurable business outcomes.",
        "Core JD keywords appear naturally in resume sections.",
        "Outreach message customized for role and company context.",
        "Portfolio/proof links updated and working.",
    ]
    deterministic_follow_up = (
        f"Hi, just following up on my {role} application shared earlier. "
        "Happy to provide any additional context on role-fit impact and measurable outcomes."
    )
    deterministic_payload = {
        "subject_line": deterministic_subject_line,
        "outreach_email": deterministic_outreach_email,
        "linkedin_message": deterministic_linkedin_message,
        "cover_letter_opening": deterministic_cover_letter_opening,
        "jd_focus_keywords": jd_skills[:6],
        "application_checklist": deterministic_checklist,
        "recruiter_follow_up": deterministic_follow_up,
    }
    llm_overlay, llm_model, llm_error = request_application_pack_overlay(
        role=role,
        industry=industry,
        resume_text=resume_text,
        job_description=job_description,
        deterministic_payload=deterministic_payload,
    )

    subject_line = deterministic_subject_line
    outreach_email = deterministic_outreach_email
    linkedin_message = deterministic_linkedin_message
    cover_letter_opening = deterministic_cover_letter_opening
    jd_focus_keywords = jd_skills[:6]
    application_checklist = deterministic_checklist
    recruiter_follow_up = deterministic_follow_up
    ai_used = False

    if isinstance(llm_overlay, dict):
        ai_used = True
        subject_line = safe_text(llm_overlay.get("subject_line")) or subject_line
        outreach_email = safe_text(llm_overlay.get("outreach_email")) or outreach_email
        linkedin_message = safe_text(llm_overlay.get("linkedin_message")) or linkedin_message
        cover_letter_opening = safe_text(llm_overlay.get("cover_letter_opening")) or cover_letter_opening
        recruiter_follow_up = safe_text(llm_overlay.get("recruiter_follow_up")) or recruiter_follow_up
        jd_focus_keywords = dedupe_text_list(
            [*normalize_string_list(llm_overlay.get("jd_focus_keywords"), limit=8, max_item_len=64), *jd_focus_keywords],
            limit=8,
            max_item_len=64,
        )
        application_checklist = dedupe_text_list(
            [
                *normalize_string_list(llm_overlay.get("application_checklist"), limit=8, max_item_len=180),
                *application_checklist,
            ],
            limit=8,
            max_item_len=180,
        )

    return {
        "role": role,
        "industry": industry,
        "subject_line": subject_line[:180],
        "outreach_email": outreach_email[:1800],
        "linkedin_message": linkedin_message[:420],
        "cover_letter_opening": cover_letter_opening[:600],
        "jd_focus_keywords": jd_focus_keywords,
        "application_checklist": application_checklist,
        "recruiter_follow_up": recruiter_follow_up[:420],
        "ai": {
            "used": ai_used,
            "model": llm_model if ai_used else None,
            "reason": "hybrid_overlay" if ai_used else (llm_error or "rules_only"),
        },
    }


def build_application_copilot_resume_improvements(
    jd_match_payload: dict[str, Any],
    interview_prep_payload: dict[str, Any],
    application_pack_payload: dict[str, Any],
) -> list[str]:
    improvements = dedupe_text_list(
        [
            *normalize_string_list(jd_match_payload.get("improvements"), limit=8, max_item_len=220),
            *normalize_string_list(jd_match_payload.get("suggested_bullets"), limit=8, max_item_len=220),
            *normalize_string_list(jd_match_payload.get("feedback"), limit=6, max_item_len=220),
            *normalize_string_list(interview_prep_payload.get("prep_sprint"), limit=5, max_item_len=160),
            *normalize_string_list(application_pack_payload.get("application_checklist"), limit=6, max_item_len=200),
        ],
        limit=10,
        max_item_len=220,
    )
    if improvements:
        return improvements
    return [
        "Add measurable outcomes to your top 5 experience bullets.",
        "Mirror must-have JD skills naturally inside summary, skills, and project lines.",
        "Prepare one STAR story per critical missing skill before your next interview.",
    ]


def build_application_copilot_next_steps_7_day(
    jd_match_payload: dict[str, Any],
    interview_prep_payload: dict[str, Any],
    application_pack_payload: dict[str, Any],
) -> list[str]:
    raw_steps = dedupe_text_list(
        [
            *normalize_string_list(jd_match_payload.get("next_steps"), limit=6, max_item_len=180),
            *normalize_string_list(interview_prep_payload.get("prep_sprint"), limit=6, max_item_len=180),
            *normalize_string_list(application_pack_payload.get("application_checklist"), limit=6, max_item_len=180),
        ],
        limit=10,
        max_item_len=180,
    )
    if not raw_steps:
        raw_steps = [
            "Tailor your headline and summary to role intent.",
            "Rewrite key bullets with scope, ownership, and outcomes.",
            "Practice 4 role-fit interview answers with STAR structure.",
            "Send focused applications with personalized outreach.",
        ]
    day_steps: list[str] = []
    for index, item in enumerate(raw_steps[:7]):
        day_steps.append(f"Day {index + 1}: {item}")
    return day_steps


def build_application_copilot_payload(data: ApplicationCopilotRequest) -> dict[str, Any]:
    role = safe_text(data.role) or "Target role"
    industry = safe_text(data.industry) or "General"
    company = safe_text(data.company)[:120]
    resume_text = safe_text(data.resume_text)
    job_description = safe_text(data.job_description)

    jd_match_payload = build_jd_match_payload(industry, role, resume_text, job_description)
    critical_missing = normalize_string_list(
        jd_match_payload.get("missing_skills") or jd_match_payload.get("missing_keywords") or [],
        limit=8,
        max_item_len=72,
    )
    interview_prep_payload = build_interview_prep_payload(
        InterviewPrepRequest(
            industry=industry,
            role=role,
            job_description=job_description,
            critical_missing_skills=critical_missing,
            auth_token=None,
        )
    )
    application_pack_payload = build_application_pack_payload(
        ApplicationPackRequest(
            industry=industry,
            role=role,
            resume_text=resume_text,
            job_description=job_description,
            auth_token=None,
        )
    )

    match_percentage = int(
        clamp_float(
            float(jd_match_payload.get("match_percentage") or jd_match_payload.get("match_score") or 0),
            0.0,
            100.0,
        )
    )
    matched_skills = normalize_string_list(
        jd_match_payload.get("matched_skills") or jd_match_payload.get("matched_keywords") or [],
        limit=18,
        max_item_len=80,
    )
    missing_skills = normalize_string_list(
        jd_match_payload.get("missing_skills") or jd_match_payload.get("missing_keywords") or [],
        limit=18,
        max_item_len=80,
    )
    feedback = dedupe_text_list(
        [
            *normalize_string_list(jd_match_payload.get("feedback"), limit=6, max_item_len=220),
            safe_text(jd_match_payload.get("alignment_summary")),
            safe_text(interview_prep_payload.get("coach_note")),
        ],
        limit=7,
        max_item_len=220,
    )
    resume_improvements = build_application_copilot_resume_improvements(
        jd_match_payload,
        interview_prep_payload,
        application_pack_payload,
    )
    next_steps_7_day = build_application_copilot_next_steps_7_day(
        jd_match_payload,
        interview_prep_payload,
        application_pack_payload,
    )

    ai_models = dedupe_text_list(
        [
            safe_text(((jd_match_payload.get("analysis_ai") or {}).get("model"))),
            safe_text((((jd_match_payload.get("jd_relevance") or {}).get("ai") or {}).get("model"))),
            safe_text(((interview_prep_payload.get("ai") or {}).get("model"))),
            safe_text(((application_pack_payload.get("ai") or {}).get("model"))),
        ],
        limit=4,
        max_item_len=64,
    )
    ai_used = bool(ai_models) or bool(((jd_match_payload.get("jd_relevance") or {}).get("ai") or {}).get("used"))
    return {
        "role": role,
        "industry": industry,
        "company": company,
        "match_percentage": match_percentage,
        "matched_skills": matched_skills,
        "missing_skills": missing_skills,
        "feedback": feedback,
        "resume_improvements": resume_improvements,
        "next_steps_7_day": next_steps_7_day,
        "interview_questions": normalize_string_list(
            interview_prep_payload.get("mock_questions"),
            limit=7,
            max_item_len=240,
        ),
        "jd_focus_keywords": normalize_string_list(
            application_pack_payload.get("jd_focus_keywords"),
            limit=8,
            max_item_len=80,
        ),
        "application_checklist": normalize_string_list(
            application_pack_payload.get("application_checklist"),
            limit=8,
            max_item_len=180,
        ),
        "application_pack": {
            "subject_line": safe_text(application_pack_payload.get("subject_line"))[:180],
            "linkedin_message": safe_text(application_pack_payload.get("linkedin_message"))[:420],
            "cover_letter_opening": safe_text(application_pack_payload.get("cover_letter_opening"))[:600],
        },
        "jd_match": {
            "critical_coverage": int(clamp_float(float(jd_match_payload.get("critical_coverage") or 0), 0.0, 100.0)),
            "must_have_coverage": int(
                clamp_float(
                    float((jd_match_payload.get("skill_breakdown") or {}).get("must_have_coverage") or 0),
                    0.0,
                    100.0,
                )
            ),
            "good_to_have_coverage": int(
                clamp_float(
                    float((jd_match_payload.get("skill_breakdown") or {}).get("good_to_have_coverage") or 0),
                    0.0,
                    100.0,
                )
            ),
            "jd_relevance": int(
                clamp_float(
                    float((jd_match_payload.get("jd_relevance") or {}).get("score") or 0),
                    0.0,
                    100.0,
                )
            ),
            "alignment_summary": safe_text(jd_match_payload.get("alignment_summary"))[:320],
        },
        "ai": {
            "used": ai_used,
            "models": ai_models,
            "engine": "hybrid_llm_rules",
        },
        "raw": {
            "jd_match": jd_match_payload,
            "interview_prep": interview_prep_payload,
            "application_pack": application_pack_payload,
        },
    }


def normalize_interview_simulator_difficulty(value: str | None) -> str:
    token = safe_text(value).strip().lower()
    if token in {"foundation", "beginner", "easy"}:
        return "foundation"
    if token in {"advanced", "hard", "expert"}:
        return "advanced"
    return "standard"


def normalize_interview_simulator_mode(value: str | None) -> str:
    token = safe_text(value).strip().lower()
    if token in {"demo", "quick_demo", "quick", "preview"}:
        return INTERVIEW_SIMULATOR_MODE_DEMO
    return INTERVIEW_SIMULATOR_MODE_FULL


def normalize_interview_simulator_rounds(value: int | None) -> int:
    if value is None:
        return len(INTERVIEW_SIMULATOR_STAGE_BLUEPRINTS)
    return int(clamp_float(float(value), float(INTERVIEW_SIMULATOR_MIN_ROUNDS), float(INTERVIEW_SIMULATOR_MAX_ROUNDS)))


def cleanup_interview_simulator_sessions(now_ts: float) -> None:
    stale_keys = []
    for session_id, payload in INTERVIEW_SIMULATOR_SESSIONS.items():
        expires_at_ts = float(payload.get("expires_at_ts") or 0)
        if expires_at_ts and expires_at_ts < now_ts:
            stale_keys.append(session_id)
    for session_id in stale_keys:
        INTERVIEW_SIMULATOR_SESSIONS.pop(session_id, None)


def normalize_interview_simulator_tts_voice(value: str | None) -> str:
    token = safe_text(value).strip().lower()
    allowed = {
        "alloy",
        "ash",
        "ballad",
        "coral",
        "echo",
        "fable",
        "nova",
        "onyx",
        "sage",
        "shimmer",
        "verse",
    }
    if token in allowed:
        return token
    fallback = safe_text(INTERVIEW_SIMULATOR_TTS_DEFAULT_VOICE).strip().lower()
    if fallback in allowed:
        return fallback
    return "verse"


def build_interview_simulator_tts_script(text: str) -> str:
    cleaned = safe_text(text).replace("\r\n", " ").replace("\n", " ").replace("\r", " ")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not cleaned:
        return ""
    cleaned = cleaned[:INTERVIEW_SIMULATOR_TTS_MAX_CHARS]
    # Convert rigid punctuation into spoken cadence with natural pause hints.
    cleaned = re.sub(r"\s*[:;]\s*", ", ", cleaned)
    cleaned = re.sub(r"\s*([,.!?])\s*", r"\1 ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    paced = cleaned.replace("? ", "?\n").replace("! ", "!\n").replace(". ", ".\n")
    paced = re.sub(r"\n{2,}", "\n", paced).strip()
    if not re.search(r"[.!?]$", paced):
        paced = f"{paced}."
    return paced[: INTERVIEW_SIMULATOR_TTS_MAX_CHARS + 80]


def extract_audio_bytes_from_openai_response(response: Any) -> bytes:
    if response is None:
        return b""
    if isinstance(response, (bytes, bytearray)):
        return bytes(response)

    content = getattr(response, "content", None)
    if isinstance(content, (bytes, bytearray)):
        return bytes(content)

    read_fn = getattr(response, "read", None)
    if callable(read_fn):
        try:
            raw = read_fn()
            if isinstance(raw, (bytes, bytearray)):
                return bytes(raw)
        except Exception:
            pass

    iter_bytes_fn = getattr(response, "iter_bytes", None)
    if callable(iter_bytes_fn):
        try:
            return b"".join(chunk for chunk in iter_bytes_fn() if isinstance(chunk, (bytes, bytearray)))
        except Exception:
            pass

    nested_response = getattr(response, "response", None)
    if nested_response is not None:
        nested_content = getattr(nested_response, "content", None)
        if isinstance(nested_content, (bytes, bytearray)):
            return bytes(nested_content)
        nested_read = getattr(nested_response, "read", None)
        if callable(nested_read):
            try:
                raw = nested_read()
                if isinstance(raw, (bytes, bytearray)):
                    return bytes(raw)
            except Exception:
                pass

    return b""


def generate_interview_simulator_tts_audio(
    script_text: str, requested_voice: str | None = None
) -> tuple[bytes | None, str | None, str | None, str]:
    if client is None:
        return None, None, "OPENAI_API_KEY not configured", normalize_interview_simulator_tts_voice(requested_voice)
    if not INTERVIEW_SIMULATOR_TTS_ENABLED:
        return None, None, "Interview simulator AI voice is disabled", normalize_interview_simulator_tts_voice(requested_voice)

    voice_candidates: list[str] = []
    for voice in [
        normalize_interview_simulator_tts_voice(requested_voice),
        normalize_interview_simulator_tts_voice(INTERVIEW_SIMULATOR_TTS_DEFAULT_VOICE),
        "alloy",
    ]:
        if voice and voice not in voice_candidates:
            voice_candidates.append(voice)

    models: list[str] = []
    for model in [INTERVIEW_SIMULATOR_TTS_MODEL, *INTERVIEW_SIMULATOR_TTS_FALLBACK_MODELS]:
        token = safe_text(model).strip()
        if token and token not in models:
            models.append(token)

    last_error: str | None = None
    for model in models:
        for voice in voice_candidates:
            for attempt in range(2):
                try:
                    response = client.audio.speech.create(
                        model=model,
                        voice=voice,
                        input=script_text,
                        response_format=INTERVIEW_SIMULATOR_TTS_RESPONSE_FORMAT,
                    )
                    audio_bytes = extract_audio_bytes_from_openai_response(response)
                    if audio_bytes and len(audio_bytes) >= 900:
                        return audio_bytes, model, None, voice
                    last_error = f"empty_tts_audio_from_{model}_{voice}"
                    logger.error("Interview simulator TTS returned empty audio for model '%s' voice '%s'.", model, voice)
                    break
                except Exception as exc:
                    last_error = f"{type(exc).__name__} on model {model}, voice {voice}"
                    logger.exception(
                        "Interview simulator TTS failed for model '%s', voice '%s' (attempt %s).",
                        model,
                        voice,
                        attempt + 1,
                    )
                    if attempt < 1 and is_transient_openai_error(exc):
                        time.sleep(0.35 * (attempt + 1))
                        continue
                    break

    return None, None, last_error, voice_candidates[0] if voice_candidates else "alloy"


def build_interview_simulator_tts_cache_key(script_text: str, voice: str) -> str:
    raw = f"{safe_text(voice).strip().lower()}::{safe_text(script_text).strip()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def cleanup_interview_simulator_tts_cache(cache: dict[str, Any], now_ts: float) -> None:
    stale_keys: list[str] = []
    for key, payload in cache.items():
        if not isinstance(payload, dict):
            stale_keys.append(key)
            continue
        created_at_ts = safe_float(payload.get("created_at_ts"), 0.0)
        if created_at_ts <= 0 or now_ts - created_at_ts > INTERVIEW_SIMULATOR_TTS_CACHE_TTL_SECONDS:
            stale_keys.append(key)
    for key in stale_keys:
        cache.pop(key, None)
    if len(cache) <= INTERVIEW_SIMULATOR_TTS_CACHE_MAX_ITEMS:
        return
    sortable: list[tuple[str, float]] = []
    for key, payload in cache.items():
        if not isinstance(payload, dict):
            continue
        sortable.append((key, safe_float(payload.get("created_at_ts"), 0.0)))
    sortable.sort(key=lambda item: item[1], reverse=True)
    for key, _ in sortable[INTERVIEW_SIMULATOR_TTS_CACHE_MAX_ITEMS :]:
        cache.pop(key, None)


def queue_interview_simulator_tts_prefetch(session_id: str, question_text: str, requested_voice: str | None = None) -> None:
    if not INTERVIEW_SIMULATOR_TTS_ENABLED:
        return
    normalized_session_id = re.sub(r"[^A-Za-z0-9]", "", safe_text(session_id))[:32]
    if len(normalized_session_id) < 8:
        return
    script_text = build_interview_simulator_tts_script(question_text)
    if len(script_text) < 8:
        return
    preferred_voice = normalize_interview_simulator_tts_voice(
        requested_voice or INTERVIEW_SIMULATOR_TTS_PREFETCH_VOICE or INTERVIEW_SIMULATOR_TTS_DEFAULT_VOICE
    )
    cache_key = build_interview_simulator_tts_cache_key(script_text, preferred_voice)
    now_ts = time.time()

    with INTERVIEW_SIMULATOR_LOCK:
        session_payload = INTERVIEW_SIMULATOR_SESSIONS.get(normalized_session_id)
        if not session_payload:
            return
        tts_cache = session_payload.get("tts_cache") if isinstance(session_payload.get("tts_cache"), dict) else {}
        if not isinstance(session_payload.get("tts_cache"), dict):
            session_payload["tts_cache"] = tts_cache
        cleanup_interview_simulator_tts_cache(tts_cache, now_ts)
        cache_entry = tts_cache.get(cache_key)
        if isinstance(cache_entry, dict) and isinstance(cache_entry.get("audio"), (bytes, bytearray)):
            return

        inflight = session_payload.get("tts_prefetch_inflight")
        if isinstance(inflight, set):
            inflight_keys = inflight
        elif isinstance(inflight, (list, tuple)):
            inflight_keys = {safe_text(item) for item in inflight if safe_text(item)}
            session_payload["tts_prefetch_inflight"] = inflight_keys
        else:
            inflight_keys = set()
            session_payload["tts_prefetch_inflight"] = inflight_keys
        if cache_key in inflight_keys:
            return
        inflight_keys.add(cache_key)

    def _worker() -> None:
        audio_bytes, model, _, resolved_voice = generate_interview_simulator_tts_audio(script_text, preferred_voice)
        with INTERVIEW_SIMULATOR_LOCK:
            session_payload = INTERVIEW_SIMULATOR_SESSIONS.get(normalized_session_id)
            if not session_payload:
                return
            inflight = session_payload.get("tts_prefetch_inflight")
            if isinstance(inflight, set):
                inflight.discard(cache_key)
            elif isinstance(inflight, list):
                session_payload["tts_prefetch_inflight"] = [item for item in inflight if safe_text(item) != cache_key]

            if not audio_bytes:
                return
            tts_cache = session_payload.get("tts_cache") if isinstance(session_payload.get("tts_cache"), dict) else {}
            if not isinstance(session_payload.get("tts_cache"), dict):
                session_payload["tts_cache"] = tts_cache
            cleanup_interview_simulator_tts_cache(tts_cache, time.time())
            tts_cache[cache_key] = {
                "audio": audio_bytes,
                "model": safe_text(model),
                "voice": resolved_voice,
                "created_at_ts": time.time(),
            }
            cleanup_interview_simulator_tts_cache(tts_cache, time.time())

    try:
        ASYNC_JOB_EXECUTOR.submit(_worker)
    except Exception:
        with INTERVIEW_SIMULATOR_LOCK:
            session_payload = INTERVIEW_SIMULATOR_SESSIONS.get(normalized_session_id)
            if not session_payload:
                return
            inflight = session_payload.get("tts_prefetch_inflight")
            if isinstance(inflight, set):
                inflight.discard(cache_key)


def normalize_interview_simulator_focus_skill(value: str, allow_single_word: bool = False) -> str:
    skill = re.sub(r"\s+", " ", safe_text(value).strip(" ,.;:-")).strip()
    if not skill:
        return ""
    lowered = skill.lower()
    if "[" in lowered or "]" in lowered:
        return ""
    if re.search(r"[.!?]", skill):
        return ""
    blocked_fragments = (
        "your company",
        "looking to hire",
        "developed a reputation",
        "forward thinking",
        "consistently delivering",
        "based in ",
        "high performing sales team",
        "staying informed",
    )
    if any(fragment in lowered for fragment in blocked_fragments):
        return ""
    if any(token in lowered for token in ["\n", ". ", " and ", " or "]):
        if len(skill.split()) > 4:
            return ""
    skill = re.sub(r"^(?:and|or|with|for|to|the|a|an)\s+", "", skill, flags=re.IGNORECASE).strip()
    lowered = skill.lower()
    if len(skill) < 3 or len(skill) > 40:
        return ""
    words = [word for word in skill.split(" ") if word]
    if len(words) > 4:
        return ""
    blocked_single_words = {
        "business",
        "campaign",
        "communication",
        "data",
        "general",
        "growth",
        "leadership",
        "manager",
        "marketing",
        "product",
        "sales",
        "strategy",
    }
    blocked_prefixes = (
        "coordinate ",
        "drive ",
        "lead ",
        "present ",
        "run ",
        "turn ",
        "use ",
        "using ",
    )
    if any(lowered.startswith(prefix) for prefix in blocked_prefixes):
        return ""
    if len(words) == 1 and not allow_single_word and lowered in blocked_single_words:
        return ""
    alpha_chars = sum(1 for char in skill if char.isalpha())
    if alpha_chars < max(3, int(len(skill) * 0.65)):
        return ""
    return skill


def sanitize_interview_simulator_focus_skills(values: Any, limit: int = 10) -> list[str]:
    raw_values = normalize_string_list(values, limit=max(12, limit * 3), max_item_len=96)
    cleaned: list[str] = []
    seen: set[str] = set()
    for item in raw_values:
        normalized = normalize_interview_simulator_focus_skill(item, allow_single_word=False)
        if not normalized:
            normalized = normalize_interview_simulator_focus_skill(item, allow_single_word=True)
        if not normalized:
            continue
        dedupe_key = normalized.lower()
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        cleaned.append(normalized)
        if len(cleaned) >= max(1, int(limit)):
            break
    return cleaned


def collect_interview_simulator_focus_skills(role: str, industry: str, resume_text: str, job_description: str) -> list[str]:
    resume_skills_raw = collect_interview_simulator_resume_focus_skills(resume_text)[:10]
    jd_skills_raw = extract_skills_from_text(job_description)[:12]
    role_track = infer_role_track(role, industry)
    blueprint = ROLE_BLUEPRINTS.get(role_track, ROLE_BLUEPRINTS["general"])
    blueprint_core = dedupe_text_list(blueprint.get("core") or [], limit=8, max_item_len=80)
    _, _, critical_skills, _ = resolve_role_profile(role, industry, blueprint_core[:4])

    combined_candidates: list[str] = []
    for item in critical_skills:
        normalized = normalize_interview_simulator_focus_skill(item, allow_single_word=True)
        if normalized:
            combined_candidates.append(normalized)
    for item in blueprint_core:
        normalized = normalize_interview_simulator_focus_skill(item, allow_single_word=True)
        if normalized:
            combined_candidates.append(normalized)
    for item in [*resume_skills_raw, *jd_skills_raw]:
        normalized = normalize_interview_simulator_focus_skill(item, allow_single_word=False)
        if normalized:
            combined_candidates.append(normalized)

    combined = dedupe_text_list(combined_candidates, limit=10, max_item_len=80)
    if combined:
        return combined
    return dedupe_text_list(blueprint.get("core") or [], limit=8, max_item_len=80) or [
        "problem solving",
        "ownership",
        "stakeholder communication",
    ]


def collect_interview_simulator_resume_focus_skills(resume_text: str) -> list[str]:
    resume_skills_raw = extract_skills_from_text(resume_text)[:14]
    normalized_candidates: list[str] = []
    for item in resume_skills_raw:
        normalized = normalize_interview_simulator_focus_skill(item, allow_single_word=False)
        if normalized:
            normalized_candidates.append(normalized)
    return dedupe_text_list(normalized_candidates, limit=10, max_item_len=80)


def build_interview_simulator_demo_stage_plan() -> list[dict[str, Any]]:
    screening_blueprint = INTERVIEW_SIMULATOR_STAGE_BLUEPRINT_MAP.get("screening") or {}
    return [
        {
            "stage_number": 1,
            "key": "screening",
            "label": safe_text(screening_blueprint.get("label")) or "Screening",
            "objective": safe_text(screening_blueprint.get("objective")) or "confirm initial role fit quickly",
            "min_questions": INTERVIEW_SIMULATOR_DEMO_QUESTION_COUNT,
            "max_questions": INTERVIEW_SIMULATOR_DEMO_QUESTION_COUNT,
        }
    ]


def build_interview_simulator_stage_plan(difficulty: str, candidate_level: str | None = None) -> list[dict[str, Any]]:
    normalized_difficulty = normalize_interview_simulator_difficulty(difficulty)
    normalized_candidate_level = safe_text(candidate_level).strip().lower()
    plan: list[dict[str, Any]] = []
    for index, blueprint in enumerate(INTERVIEW_SIMULATOR_STAGE_BLUEPRINTS, start=1):
        stage_key = safe_text(blueprint.get("key")).strip().lower()
        min_questions = int(blueprint.get("min_questions") or 1)
        max_questions = int(blueprint.get("max_questions") or min_questions)
        if normalized_difficulty == "foundation":
            if stage_key == "technical_assessment":
                max_questions = max(min_questions, 2)
            elif stage_key in {"in_depth_assessment", "hr"}:
                max_questions = max(min_questions, 1)
        elif normalized_difficulty == "advanced":
            if stage_key in {"technical_assessment", "in_depth_assessment", "hr"}:
                max_questions = min(3, max_questions + 1)

        if normalized_candidate_level == "fresher":
            if stage_key == "technical_assessment":
                max_questions = max(min_questions, min(2, max_questions))
            elif stage_key in {"in_depth_assessment", "hr"}:
                max_questions = 1
        elif normalized_candidate_level == "experienced":
            if stage_key in {"technical_assessment", "in_depth_assessment"}:
                max_questions = max(max_questions, min_questions + 1)

        plan.append(
            {
                "stage_number": index,
                "key": safe_text(blueprint.get("key")) or f"stage_{index}",
                "label": safe_text(blueprint.get("label")) or f"Round {index}",
                "objective": safe_text(blueprint.get("objective")),
                "min_questions": min_questions,
                "max_questions": max(min_questions, max_questions),
            }
        )
    return plan


def get_interview_simulator_stage_plan(session_payload: dict[str, Any]) -> list[dict[str, Any]]:
    raw_plan = session_payload.get("stage_plan")
    if isinstance(raw_plan, list):
        normalized: list[dict[str, Any]] = []
        for index, item in enumerate(raw_plan, start=1):
            if not isinstance(item, dict):
                continue
            blueprint = INTERVIEW_SIMULATOR_STAGE_BLUEPRINT_MAP.get(safe_text(item.get("key")).strip().lower()) or {}
            min_questions = int(item.get("min_questions") or blueprint.get("min_questions") or 1)
            max_questions = int(item.get("max_questions") or blueprint.get("max_questions") or min_questions)
            normalized.append(
                {
                    "stage_number": int(item.get("stage_number") or index),
                    "key": safe_text(item.get("key")) or safe_text(blueprint.get("key")) or f"stage_{index}",
                    "label": safe_text(item.get("label")) or safe_text(blueprint.get("label")) or f"Round {index}",
                    "objective": safe_text(item.get("objective")) or safe_text(blueprint.get("objective")),
                    "min_questions": max(1, min_questions),
                    "max_questions": max(max(1, min_questions), max_questions),
                }
            )
        if normalized:
            return normalized
    return build_interview_simulator_stage_plan(
        normalize_interview_simulator_difficulty(safe_text(session_payload.get("difficulty"))),
        candidate_level=safe_text(session_payload.get("candidate_level")) or None,
    )


def interview_simulator_stage_exists(stage_plan: list[dict[str, Any]], stage_key: str) -> bool:
    normalized_stage_key = safe_text(stage_key).strip().lower()
    if not normalized_stage_key:
        return False
    for stage in stage_plan:
        if safe_text(stage.get("key")).strip().lower() == normalized_stage_key:
            return True
    return False


def get_interview_simulator_stage_entry(stage_plan: list[dict[str, Any]], stage_key: str) -> dict[str, Any]:
    normalized = safe_text(stage_key).strip().lower()
    for item in stage_plan:
        if safe_text(item.get("key")).strip().lower() == normalized:
            return item
    return stage_plan[0] if stage_plan else {
        "stage_number": 1,
        "key": "screening",
        "label": "Screening",
        "objective": "",
        "min_questions": 1,
        "max_questions": 2,
    }


def build_interview_simulator_question_entry(
    stage_plan: list[dict[str, Any]],
    stage_key: str,
    question_text: str,
    question_number_in_stage: int,
) -> dict[str, Any]:
    stage_entry = get_interview_simulator_stage_entry(stage_plan, stage_key)
    return {
        "stage_key": safe_text(stage_entry.get("key")) or stage_key,
        "stage_label": safe_text(stage_entry.get("label")) or "Round",
        "stage_number": int(stage_entry.get("stage_number") or 1),
        "question_number_in_stage": max(1, int(question_number_in_stage or 1)),
        "question": safe_text(question_text)[:260],
    }


def extract_interview_simulator_question_flow(session_payload: dict[str, Any], stage_plan: list[dict[str, Any]]) -> list[dict[str, Any]]:
    raw_flow = session_payload.get("question_flow")
    if isinstance(raw_flow, list):
        normalized_flow: list[dict[str, Any]] = []
        for item in raw_flow:
            if not isinstance(item, dict):
                continue
            question_text = safe_text(item.get("question"))[:260]
            if not question_text:
                continue
            stage_key = safe_text(item.get("stage_key")) or "screening"
            question_number_in_stage = int(item.get("question_number_in_stage") or 1)
            normalized_flow.append(
                build_interview_simulator_question_entry(
                    stage_plan,
                    stage_key,
                    question_text,
                    question_number_in_stage,
                )
            )
        if normalized_flow:
            return normalized_flow

    legacy_questions = session_payload.get("questions") if isinstance(session_payload.get("questions"), list) else []
    fallback_flow: list[dict[str, Any]] = []
    for index, item in enumerate(legacy_questions):
        question_text = safe_text(item)[:260]
        if not question_text:
            continue
        stage_entry = stage_plan[min(index, max(0, len(stage_plan) - 1))] if stage_plan else {
            "stage_number": index + 1,
            "key": "screening",
            "label": "Screening",
        }
        fallback_flow.append(
            build_interview_simulator_question_entry(
                stage_plan,
                safe_text(stage_entry.get("key")) or "screening",
                question_text,
                1 if index == 0 else max(1, index - len(fallback_flow) + 1),
            )
        )
    return fallback_flow


def normalize_interview_simulator_turn_stage_key(turn_payload: dict[str, Any]) -> str:
    stage_key = safe_text(turn_payload.get("stage_key")).strip().lower()
    if stage_key in INTERVIEW_SIMULATOR_STAGE_BLUEPRINT_MAP:
        return stage_key
    round_number = int(turn_payload.get("round_number") or 0)
    if 1 <= round_number <= len(INTERVIEW_SIMULATOR_STAGE_BLUEPRINTS):
        return safe_text(INTERVIEW_SIMULATOR_STAGE_BLUEPRINTS[round_number - 1]["key"])
    return "screening"


def build_interview_simulator_stage_summaries(turns: list[dict[str, Any]], stage_plan: list[dict[str, Any]]) -> list[dict[str, Any]]:
    summaries: list[dict[str, Any]] = []
    for stage in stage_plan:
        stage_key = safe_text(stage.get("key"))
        stage_turns = [turn for turn in turns if normalize_interview_simulator_turn_stage_key(turn) == stage_key]
        if not stage_turns:
            continue
        overall_values = [safe_float(((turn.get("scores") or {}).get("overall")), 0.0) for turn in stage_turns]
        summaries.append(
            {
                "stage_key": stage_key,
                "stage_label": safe_text(stage.get("label")) or "Round",
                "stage_number": int(stage.get("stage_number") or len(summaries) + 1),
                "question_count": len(stage_turns),
                "average_score": clamp(sum(overall_values) / max(1, len(overall_values))),
            }
        )
    return summaries


INTERVIEW_SIMULATOR_QUESTION_NOISE_WORDS = {
    "about",
    "best",
    "close",
    "deeper",
    "describe",
    "example",
    "experience",
    "first",
    "fit",
    "give",
    "going",
    "last",
    "makes",
    "matters",
    "question",
    "recent",
    "role",
    "round",
    "screening",
    "share",
    "specific",
    "start",
    "still",
    "strong",
    "stronger",
    "technical",
    "tell",
    "through",
    "used",
    "using",
    "walk",
    "what",
    "when",
    "why",
}


def choose_interview_simulator_target_skill(
    focus_skills: list[str],
    missing_focus_skills: list[str] | None = None,
    next_focus_skill: str | None = None,
    offset: int = 0,
) -> str:
    explicit = safe_text(next_focus_skill).strip()
    if explicit:
        return explicit
    missing = dedupe_text_list(missing_focus_skills or [], limit=6, max_item_len=80)
    if missing:
        return missing[0]
    curated = dedupe_text_list(focus_skills or [], limit=10, max_item_len=80)
    if curated:
        return curated[min(max(0, offset), len(curated) - 1)]
    return "execution"


def detect_interview_simulator_no_direct_experience_signal(answer_text: str) -> bool:
    normalized = safe_text(answer_text).strip().lower()
    if not normalized:
        return False
    patterns = [
        r"\bi (?:do not|don't|did not|didn't|have not|haven't|never)\s+(?:have\s+)?(?:any\s+)?(?:direct\s+)?(?:background|experience)\b",
        r"\bno\s+(?:direct\s+)?(?:background|experience)\b",
        r"\bnew to (?:this|the)\s+(?:role|domain|industry|field)\b",
        r"\b(?:from|in)\s+another\s+(?:domain|industry|field)\b",
        r"\bno\s+(?:project|projects|campaign|campaigns)\s+experience\b",
    ]
    return any(re.search(pattern, normalized) for pattern in patterns)


def detect_interview_simulator_candidate_cross_question(answer_text: str, current_question: str = "") -> bool:
    normalized = re.sub(r"\s+", " ", safe_text(answer_text).strip().lower())
    if not normalized:
        return False
    word_count = len(re.findall(r"[A-Za-z0-9][A-Za-z0-9'\-]*", normalized))
    if word_count <= 1 or word_count > 56:
        return False

    clarification_patterns = [
        r"\b(?:can|could|would)\s+you\s+(?:please\s+)?(?:clarify|explain|repeat|rephrase|break\s+that\s+down|elaborate)\b",
        r"\bwhat\s+(?:exactly\s+)?do\s+you\s+mean\b",
        r"\bdo\s+you\s+mean\b",
        r"\bi(?:'m| am)\s+not\s+(?:clear|sure|following)\b",
        r"\b(?:which|what)\s+(?:part|area|example)\s+(?:do you want|should i)\b",
        r"\bbefore\s+i\s+answer\b",
        r"\bcan\s+i\s+(?:answer|use)\b",
        r"\bshould\s+i\s+(?:focus|answer)\b",
        r"\bcould\s+you\s+give\s+(?:an?\s+)?example\b",
        r"\bquestion\s+again\b",
    ]
    if any(re.search(pattern, normalized) for pattern in clarification_patterns):
        return True

    has_question_mark = "?" in safe_text(answer_text)
    starts_like_question = bool(
        re.match(r"^(?:what|why|how|when|where|which|can|could|would|should|do|does|did|is|are|am)\b", normalized)
    )
    if not (has_question_mark or starts_like_question):
        return False

    if re.search(r"\b(?:clarify|explain|repeat|rephrase|mean|question|understand|example|scope|expect)\b", normalized):
        return True

    direct_answer_markers = re.findall(
        r"\b(?:i\s+(?:led|built|managed|worked|delivered|improved|increased|reduced)|my\s+(?:experience|project)|we\s+(?:built|launched|improved|delivered))\b",
        normalized,
    )
    if direct_answer_markers and word_count > 16:
        return False

    question_tokens = tokenize_keywords(current_question)
    answer_tokens = tokenize_keywords(normalized)
    overlap = len(question_tokens.intersection(answer_tokens))
    return has_question_mark and word_count <= 20 and overlap <= 2


def build_interview_simulator_clarification_bridge(
    candidate_name: str,
    role: str,
    stage_key: str,
    answer_text: str,
) -> str:
    normalized = safe_text(answer_text).strip().lower()
    greeting = "Good question."
    if re.search(r"\b(?:repeat|again|once more)\b", normalized):
        greeting = "Of course."
    elif re.search(r"\b(?:example|sample)\b", normalized):
        greeting = "Great question."
    elif re.search(r"\b(?:clarify|explain|rephrase|mean)\b", normalized):
        greeting = "Absolutely."

    role_label = safe_text(role).strip() or "this role"
    normalized_stage = safe_text(stage_key).strip().lower()
    stage_hint = "Share one concrete example, your action, and the measurable result."
    if normalized_stage == "screening":
        stage_hint = f"Keep it role-fit focused for {role_label}: one relevant example, your action, and the outcome."
    elif normalized_stage == "technical_assessment":
        stage_hint = "Use one technical or process example, explain your decisions, and include a measurable outcome."
    elif normalized_stage == "in_depth_assessment":
        stage_hint = "Focus on trade-offs, stakeholder judgment, and what result you finally drove."
    elif normalized_stage == "hr":
        stage_hint = "Focus on communication, ownership, and collaboration behavior."

    transferable_hint = ""
    if detect_interview_simulator_no_direct_experience_signal(answer_text):
        transferable_hint = " If your background is adjacent, use transferable examples and map them to this role."

    candidate_label = safe_text(candidate_name).strip() or "there"
    return f"{greeting} {candidate_label}, {stage_hint}{transferable_hint} I will restate the question now."[:220]


def follow_up_question_demands_direct_experience(question_text: str) -> bool:
    normalized = safe_text(question_text).strip().lower()
    if not normalized:
        return False
    patterns = [
        r"\b(?:your|recent|past)\s+(?:experience|project|projects|campaign|campaigns)\b",
        r"\btell me about (?:a|an|your)\s+(?:project|campaign)\b",
        r"\bwhen you (?:worked|led|managed|executed)\b",
        r"\bwhat did you do in (?:that|your)\s+(?:project|campaign|role)\b",
    ]
    return any(re.search(pattern, normalized) for pattern in patterns)


def build_interview_simulator_answer_adaptive_probe(
    stage_key: str,
    role: str,
    answer_text: str,
    current_question: str,
    candidate_reports_no_direct_experience: bool = False,
    next_focus_skill: str | None = None,
) -> str:
    normalized_stage = safe_text(stage_key).strip().lower() or "screening"
    role_label = safe_text(role).strip() or "this role"
    focus = safe_text(next_focus_skill).strip()
    if candidate_reports_no_direct_experience and normalized_stage in {"screening", "technical_assessment", "in_depth_assessment"}:
        focus_label = focus or "problem solving"
        return (
            f"You mentioned limited direct background. Share one transferable example where you used {focus_label} "
            f"and map your action and result to this {role_label} role."
        )[:260]

    raw_tokens = re.findall(r"[A-Za-z][A-Za-z0-9+#.-]{2,}", safe_text(answer_text).lower())
    current_question_tokens = tokenize_keywords(current_question)
    blocked = {
        *STOPWORDS,
        *INTERVIEW_SIMULATOR_QUESTION_NOISE_WORDS,
        "experience",
        "project",
        "projects",
        "role",
        "industry",
        "answer",
        "question",
    }
    token_counts = Counter(
        token
        for token in raw_tokens
        if token not in blocked and token not in current_question_tokens and len(token) >= 4
    )
    anchor = token_counts.most_common(1)[0][0] if token_counts else ""
    if not anchor:
        return ""
    if normalized_stage == "screening":
        return f"You mentioned {anchor}. How does that specifically prove fit for this {role_label} role?"[:260]
    if normalized_stage == "technical_assessment":
        return f"You mentioned {anchor}. What decision did you make, why did you choose it, and what measurable result followed?"[:260]
    if normalized_stage == "in_depth_assessment":
        return f"You mentioned {anchor}. Walk me through the toughest trade-off there and what you would do differently now."[:260]
    if normalized_stage == "hr":
        return f"You mentioned {anchor}. How does that shape the way you work with a team and manager in this role?"[:260]
    return ""


def build_interview_simulator_stage_question(
    role: str,
    industry: str,
    difficulty: str,
    stage_key: str,
    question_number_in_stage: int,
    focus_skills: list[str],
    missing_focus_skills: list[str],
    improvements: list[str],
    fallback_question: str | None = None,
    next_focus_skill: str | None = None,
    candidate_profile_note: str | None = None,
    candidate_level: str | None = None,
    candidate_reports_no_direct_experience: bool = False,
) -> str:
    candidate_fallback = safe_text(fallback_question).strip()
    if len(candidate_fallback) >= 12:
        return candidate_fallback[:260]

    role_label = safe_text(role).strip() or "this role"
    industry_label = safe_text(industry).strip() or "the business"
    improvement_note = safe_text(improvements[0] if improvements else "").strip()
    target_skill = choose_interview_simulator_target_skill(
        focus_skills,
        missing_focus_skills=missing_focus_skills,
        next_focus_skill=next_focus_skill,
        offset=max(0, question_number_in_stage - 1),
    )
    stage = safe_text(stage_key).strip().lower()
    normalized_difficulty = normalize_interview_simulator_difficulty(difficulty)
    profile_note = safe_text(candidate_profile_note).strip().lower()
    normalized_candidate_level = safe_text(candidate_level).strip().lower()
    transitioning_profile = any(
        token in profile_note
        for token in [
            "transition",
            "moving toward",
            "moving into",
            "clear intent to move into",
            "transferable experience",
        ]
    )
    fresher_profile = normalized_candidate_level == "fresher" or any(
        token in profile_note for token in ["entry", "fresher", "intern", "trainee"]
    )
    no_direct_experience_profile = candidate_reports_no_direct_experience or transitioning_profile

    if stage == "screening":
        if question_number_in_stage <= 1:
            return f"Let’s start with the screening round. What makes you a strong fit for this {role_label} role, and which recent experience proves it best?"
        if no_direct_experience_profile:
            return (
                f"Still in screening, your background is from an adjacent path. Share one transferable win that maps clearly to {role_label}, "
                f"and one gap you are actively closing."
            )
        return f"Still in screening, tell me about a specific example where you used {target_skill} and why that experience matters for a {role_label} role."

    if stage == "technical_assessment":
        if question_number_in_stage <= 1:
            if no_direct_experience_profile:
                return (
                    f"Moving into technical assessment: since your background is from another domain, walk me through a concrete problem you solved "
                    f"and map your decisions to this {role_label} role."
                )
            if fresher_profile:
                return (
                    f"Moving into technical assessment, pick one project, internship, or practical assignment and explain how you used {target_skill} "
                    f"to deliver a clear result."
                )
            return f"Moving into the technical assessment round, walk me through a concrete situation where you used {target_skill} to drive results in {industry_label}."
        if question_number_in_stage == 2:
            if no_direct_experience_profile:
                return (
                    f"If you did not have direct {industry_label} experience on day one, how would you learn the domain quickly, test your assumptions, "
                    f"and still deliver useful output in the first month?"
                )
            if fresher_profile:
                return (
                    f"Second technical question: when you face an unfamiliar domain problem, how do you break it down, choose what to learn first, "
                    f"and show progress without guessing?"
                )
            return f"In that technical round, how did you measure success, make trade-offs, and adjust your approach when the first plan was not enough?"
        if improvement_note:
            return f"One thing I still need to hear is this: {improvement_note} Give me a sharper example tied to {target_skill}."
        return f"Give me a second technical example where your judgment on {target_skill} changed a business outcome."

    if stage == "in_depth_assessment":
        if (fresher_profile or no_direct_experience_profile) and question_number_in_stage <= 1:
            return (
                f"Now for an in-depth scenario: describe a situation where you had limited experience but still took ownership, aligned others, "
                f"and delivered the expected outcome."
            )
        if question_number_in_stage <= 1:
            return f"Now let’s go deeper. Tell me about a high-pressure situation in this {role_label} path where the stakes were high, the data was incomplete, and you still had to decide."
        if normalized_difficulty == "advanced":
            return f"Stay in the in-depth round and unpack a decision that forced you to balance speed, stakeholder alignment, and risk. What did you choose and what was the consequence?"
        return f"In this in-depth round, describe a time when your first answer was not enough and you had to recover, influence others, and still deliver the outcome."

    if question_number_in_stage <= 1:
        return f"We’ll close with the HR round. What kind of team environment helps you do your best work, and why does this {role_label} role fit where you want to grow next?"
    return f"Last HR question. Tell me about a difficult people situation, how you handled it, and what you would repeat or change next time."


def build_interview_simulator_opening_question(
    role: str,
    industry: str,
    difficulty: str,
    focus_skills: list[str],
    candidate_profile_note: str | None = None,
    candidate_level: str | None = None,
) -> str:
    return build_interview_simulator_stage_question(
        role=role,
        industry=industry,
        difficulty=difficulty,
        stage_key="screening",
        question_number_in_stage=1,
        focus_skills=focus_skills,
        missing_focus_skills=[],
        improvements=[],
        candidate_profile_note=candidate_profile_note,
        candidate_level=candidate_level,
    )


def extract_interview_simulator_experience_years(resume_text: str) -> int | None:
    text = safe_text(resume_text)
    patterns = [
        r"\b(\d{1,2})\+?\s+years?\b",
        r"\b(\d{1,2})\s*\+\s*years?\b",
        r"\bover\s+(\d{1,2})\s+years?\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text.lower())
        if match:
            years = safe_int(match.group(1), 0)
            if 0 < years <= 40:
                return years
    return None


def infer_interview_simulator_candidate_level(role: str, resume_text: str) -> str:
    role_text = safe_text(role).strip().lower()
    years = extract_interview_simulator_experience_years(resume_text)
    explicit_fresher = any(
        token in role_text for token in ["intern", "fresher", "trainee", "entry level", "entry-level", "graduate"]
    )
    explicit_experienced = any(
        token in role_text for token in ["senior", "lead", "principal", "staff", "head", "manager", "director"]
    )
    if explicit_fresher or (years is not None and years <= 1):
        return "fresher"
    if explicit_experienced or (years is not None and years >= 2):
        return "experienced"
    return "balanced"


def curate_interview_simulator_profile_skills(focus_skills: list[str]) -> list[str]:
    curated: list[str] = []
    blocked_fragments = {
        "responsibilities",
        "requirements",
        "qualification",
        "qualifications",
        "experience",
        "leadership",
        "leadership team",
    }
    for raw_skill in focus_skills[:10]:
        skill = re.sub(r"\s+", " ", safe_text(raw_skill).strip(" ,.;:-")).strip()
        if len(skill) < 3 or len(skill) > 34:
            continue
        words = [word for word in skill.split(" ") if word]
        if len(words) > 4:
            continue
        lowered = skill.lower()
        if lowered in blocked_fragments:
            continue
        if any(char.isdigit() for char in skill):
            continue
        alpha_chars = sum(1 for char in skill if char.isalpha())
        if alpha_chars < max(3, int(len(skill) * 0.6)):
            continue
        if re.search(r"[|/\\@_]{2,}", skill):
            continue
        curated.append(skill)
    return dedupe_text_list(curated, limit=3, max_item_len=34)


def format_interview_simulator_skill_label(skill: str) -> str:
    text = safe_text(skill).strip()
    if not text:
        return ""
    replacements = {
        "api": "API",
        "b2b": "B2B",
        "b2c": "B2C",
        "crm": "CRM",
        "hr": "HR",
        "seo": "SEO",
        "sem": "SEM",
        "sql": "SQL",
        "ui": "UI",
        "ux": "UX",
    }
    parts = []
    for token in text.split(" "):
        lowered = token.lower()
        parts.append(replacements.get(lowered, token))
    return " ".join(parts).strip()


def format_interview_simulator_track_label(track: str) -> str:
    normalized = safe_text(track).strip().lower()
    labels = {
        "marketing": "marketing",
        "sales": "sales",
        "product": "product",
        "engineering": "engineering",
        "data": "data",
        "finance": "finance",
        "hr": "people operations",
        "general": "general business",
    }
    return labels.get(normalized, normalized.replace("_", " ").strip() or "general business")


def build_interview_simulator_candidate_profile_note(
    candidate_name: str,
    role: str,
    industry: str,
    focus_skills: list[str],
    resume_text: str,
) -> str:
    role_label = safe_text(role).strip() or "this role"
    industry_label = safe_text(industry).strip()
    years = extract_interview_simulator_experience_years(resume_text)
    curated_resume_skills = curate_interview_simulator_profile_skills(focus_skills or [])
    top_skills = [format_interview_simulator_skill_label(item) for item in curated_resume_skills]
    target_track = infer_role_track(role, industry)
    resume_track, resume_track_score = infer_role_track_with_score(" ".join(curated_resume_skills[:6]), "")
    if resume_track_score <= 0:
        resume_track, resume_track_score = infer_role_track_with_score(resume_text[:1800], "")
    track_mismatch = (
        target_track not in {"", "general"}
        and resume_track not in {"", "general"}
        and resume_track != target_track
        and resume_track_score > 0
    )

    if years and top_skills:
        if len(top_skills) == 1:
            skills_text = top_skills[0]
        else:
            skills_text = ", ".join(top_skills[:-1]) + f", and {top_skills[-1]}"
        if track_mismatch:
            return (
                f"about {years} years of experience with {skills_text}, mostly in "
                f"{format_interview_simulator_track_label(resume_track)}, and is now transitioning into {role_label}"
            )
        return f"about {years} years of experience with {skills_text}"
    if top_skills:
        if len(top_skills) == 1:
            skills_text = top_skills[0]
        else:
            skills_text = ", ".join(top_skills[:-1]) + f", and {top_skills[-1]}"
        if track_mismatch:
            return (
                f"hands-on work around {skills_text}, with most direct exposure in "
                f"{format_interview_simulator_track_label(resume_track)} and clear intent to move into {role_label}"
            )
        if industry_label and industry_label.lower() != "general":
            return f"hands-on work around {skills_text} in {industry_label}"
        return f"hands-on work around {skills_text}"
    if years:
        if track_mismatch:
            return (
                f"about {years} years of experience in {format_interview_simulator_track_label(resume_track)} "
                f"and is now moving toward {role_label}"
            )
        return f"about {years} years of relevant experience for {role_label}"
    if track_mismatch:
        return (
            f"transferable experience from {format_interview_simulator_track_label(resume_track)} "
            f"with clear intent around the {role_label} path"
        )
    return f"clear intent around the {role_label} path"


def build_interview_simulator_recent_turn_memory(turns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    memory: list[dict[str, Any]] = []
    for turn in turns[-2:]:
        if not isinstance(turn, dict):
            continue
        memory.append(
            {
                "stage": safe_text(turn.get("stage_label")) or safe_text(turn.get("stage_key")) or "Round",
                "question": safe_text(turn.get("question"))[:120],
                "feedback_summary": safe_text(turn.get("feedback_summary"))[:120],
                "candidate_signal": safe_text(turn.get("candidate_signal"))[:120],
                "off_topic": bool(turn.get("off_topic")),
                "overall_score": int(round(clamp_float(safe_float(((turn.get("scores") or {}).get("overall")), 0.0), 0.0, 100.0))),
            }
        )
    return memory


def pick_interview_simulator_interviewer_name(role: str, industry: str) -> str:
    pool = [
        "Avery Bennett",
        "Jordan Lee",
        "Riya Kapoor",
        "Marcus Hale",
        "Nina Foster",
        "Samir Patel",
    ]
    seed = f"{normalize_search_text(role)}|{normalize_search_text(industry)}".encode("utf-8")
    digest = hashlib.sha256(seed).hexdigest()
    return pool[int(digest[:8], 16) % len(pool)]


def build_interview_simulator_interviewer_profile(role: str, industry: str) -> dict[str, str]:
    role_track = infer_role_track(role, industry)
    profiles: dict[str, list[dict[str, str]]] = {
        "marketing": [
            {
                "name": "Riya Kapoor",
                "title": "Hiring Lead, Growth & Brand",
                "voice": "verse",
                "style": "warm, commercially sharp, observant, and quick to probe specifics",
            },
            {
                "name": "Avery Bennett",
                "title": "Senior Marketing Hiring Manager",
                "voice": "sage",
                "style": "calm, strategic, and focused on decision quality",
            },
        ],
        "product": [
            {
                "name": "Jordan Lee",
                "title": "Product Hiring Lead",
                "voice": "sage",
                "style": "structured, thoughtful, and curious about trade-offs",
            },
            {
                "name": "Nina Foster",
                "title": "Director of Product Interviews",
                "voice": "shimmer",
                "style": "measured, clear, and strong on judgment calls",
            },
        ],
        "engineering": [
            {
                "name": "Marcus Hale",
                "title": "Senior Engineering Interviewer",
                "voice": "echo",
                "style": "direct, technical, and quietly personable",
            },
            {
                "name": "Samir Patel",
                "title": "Engineering Hiring Manager",
                "voice": "alloy",
                "style": "calm, rigorous, and interested in practical engineering choices",
            },
        ],
        "data": [
            {
                "name": "Nina Foster",
                "title": "Data Hiring Lead",
                "voice": "shimmer",
                "style": "analytical, grounded, and precise about evidence",
            },
            {
                "name": "Samir Patel",
                "title": "Senior Analytics Interviewer",
                "voice": "sage",
                "style": "clear, numbers-driven, and quietly warm",
            },
        ],
        "sales": [
            {
                "name": "Marcus Hale",
                "title": "Sales Hiring Lead",
                "voice": "echo",
                "style": "energetic, commercially aware, and quick to test conviction",
            },
            {
                "name": "Riya Kapoor",
                "title": "Commercial Hiring Manager",
                "voice": "verse",
                "style": "warm, fast-moving, and attentive to persuasion",
            },
        ],
        "finance": [
            {
                "name": "Jordan Lee",
                "title": "Finance Hiring Lead",
                "voice": "sage",
                "style": "measured, precise, and attentive to judgment under pressure",
            },
            {
                "name": "Avery Bennett",
                "title": "Senior Finance Interviewer",
                "voice": "alloy",
                "style": "steady, direct, and evidence-first",
            },
        ],
        "hr": [
            {
                "name": "Nina Foster",
                "title": "People Operations Hiring Lead",
                "voice": "shimmer",
                "style": "warm, attentive, and strong on interpersonal nuance",
            },
            {
                "name": "Riya Kapoor",
                "title": "Senior People Interviewer",
                "voice": "verse",
                "style": "calm, empathetic, and lightly conversational",
            },
        ],
        "general": [
            {
                "name": "Avery Bennett",
                "title": "Senior Hiring Manager",
                "voice": "verse",
                "style": "warm, concise, and observant",
            },
            {
                "name": "Jordan Lee",
                "title": "Lead Interviewer",
                "voice": "sage",
                "style": "calm, structured, and human",
            },
        ],
    }
    pool = profiles.get(role_track, profiles["general"])
    seed = f"{normalize_search_text(role)}|{normalize_search_text(industry)}".encode("utf-8")
    digest = hashlib.sha256(seed).hexdigest()
    profile = dict(pool[int(digest[:8], 16) % len(pool)])
    if not safe_text(profile.get("name")).strip():
        profile["name"] = pick_interview_simulator_interviewer_name(role, industry)
    if not safe_text(profile.get("voice")).strip():
        profile["voice"] = "verse"
    return profile


def build_interview_simulator_opening_remark(
    candidate_name: str,
    interviewer_name: str,
    interviewer_title: str,
    role: str,
    candidate_profile_note: str | None = None,
) -> str:
    candidate = safe_text(candidate_name).strip() or "there"
    interviewer = safe_text(interviewer_name).strip() or "Avery"
    interviewer_role = safe_text(interviewer_title).strip() or "Lead Interviewer"
    target_role = safe_text(role).strip() or "this role"
    profile_note = safe_text(candidate_profile_note).strip()
    profile_sentence = ""
    if profile_note:
        profile_sentence = f" I had a quick look at your background, and it seems you bring {profile_note}, so I'll use that as context as we talk."
    return (
        f"Hi {candidate}, good to meet you. I'm {interviewer}, {interviewer_role}, and I'll be leading this interview for the {target_role} role."
        f"{profile_sentence} "
        "We’ll keep this conversational and practical. I’ll start broad, then go deeper only where your answers earn it. "
        "Take a breath, answer naturally, and if I interrupt it will only be to go deeper on something important."
    )


def build_interview_simulator_closing_remark(
    candidate_name: str,
    interviewer_name: str,
    candidate_connection_notes: list[str] | None = None,
) -> str:
    candidate = safe_text(candidate_name).strip() or "there"
    interviewer = safe_text(interviewer_name).strip() or "Avery"
    connection_note = safe_text((candidate_connection_notes or [None])[0]).strip()
    appreciation = ""
    if connection_note:
        appreciation = f" I appreciated how you came across when you spoke about {connection_note}."
    return (
        f"Thanks for spending the time with me today, {candidate}. I'm {interviewer}.{appreciation} "
        "That wraps up the interview, and your report is ready below."
    )


def extract_interview_simulator_candidate_signal(answer_text: str) -> str:
    text = safe_text(answer_text).strip()
    if not text:
        return ""
    sentences = [segment.strip(" -") for segment in re.split(r"(?<=[.!?])\s+", text) if segment.strip()]
    cue_patterns = [
        r"\b(?:i enjoy|i love|i care about|i value|i prefer|i'm at my best when|i am at my best when|what motivates me|i learned|i realized|i try to|i like to)\b",
        r"\b(?:my style|my approach|what matters to me|i work best when|i get energized by|i get energy from)\b",
    ]
    for sentence in sentences[:6]:
        normalized = sentence.lower()
        if any(re.search(pattern, normalized) for pattern in cue_patterns):
            clipped = safe_text(sentence)[:140].strip()
            return clipped.rstrip(".!?")
    return ""


def format_interview_simulator_candidate_signal_for_bridge(signal: str) -> str:
    text = safe_text(signal).strip().rstrip(".!?")
    if not text:
        return ""
    replacements = [
        ("i'm at my best when ", "you seem to be at your best when "),
        ("i am at my best when ", "you seem to be at your best when "),
        ("i get energized by ", "you get energized by "),
        ("i get energy from ", "you get energy from "),
        ("i care about ", "you care about "),
        ("i value ", "you value "),
        ("i enjoy ", "you enjoy "),
        ("i love ", "you love "),
        ("i prefer ", "you prefer "),
        ("i learned ", "you learned "),
        ("i realized ", "you realized "),
        ("i like to ", "you like to "),
        ("my approach is ", "your approach is "),
        ("my style is ", "your style is "),
    ]
    lowered = text.lower()
    for source, target in replacements:
        if lowered.startswith(source):
            return f"{target}{text[len(source):]}".strip()
    return text


def interviewer_bridge_references_signal(bridge: str, signal: str) -> bool:
    bridge_text = safe_text(bridge).strip().lower()
    signal_text = safe_text(signal).strip().lower()
    if not bridge_text or not signal_text:
        return False
    if phrase_in_text(bridge_text, signal_text) or phrase_in_text(signal_text, bridge_text):
        return True
    ignored = {"value", "values", "team", "teams", "work", "working", "approach", "style"}
    bridge_tokens = {
        token
        for token in tokenize_keywords(bridge_text)
        if token not in STOPWORDS and token not in ignored and len(token) > 2
    }
    signal_tokens = {
        token
        for token in tokenize_keywords(signal_text)
        if token not in STOPWORDS and token not in ignored and len(token) > 2
    }
    return len(bridge_tokens.intersection(signal_tokens)) >= 2


def answer_shows_playful_humor(answer_text: str) -> bool:
    normalized = safe_text(answer_text).strip().lower()
    if not normalized:
        return False
    playful_markers = [
        r"\b(?:haha|hehe|lol|lmao|rofl)\b",
        r"\b(?:joking|just kidding|kidding)\b",
        r"[😂🤣😄😅]",
        r"\b(?:because i(?:'| a)?m batman|plot twist)\b",
    ]
    return any(re.search(pattern, normalized) for pattern in playful_markers)


def build_interview_simulator_interviewer_bridge(
    candidate_name: str,
    answer_text: str,
    overall_score: float,
    improvements: list[str],
    stage_label: str | None = None,
    candidate_signal: str | None = None,
    candidate_profile_note: str | None = None,
    off_topic: bool = False,
    llm_bridge: str | None = None,
) -> str:
    candidate = safe_text(candidate_name).strip() or "there"
    suggested = safe_text(llm_bridge).strip()
    remembered_signal = safe_text(candidate_signal).strip()
    remembered_signal_for_bridge = format_interview_simulator_candidate_signal_for_bridge(remembered_signal)
    profile_note = safe_text(candidate_profile_note).strip()
    round_label = safe_text(stage_label).strip().lower()
    if answer_shows_playful_humor(answer_text):
        if suggested and re.search(r"\b(?:nice one|good one|smile|laugh|gave me that)\b", suggested.lower()):
            return suggested[:180]
        return f"Fair enough, {candidate}. I'll give you that one. Let me bring us back to the interview."
    if off_topic:
        if suggested:
            return suggested[:180]
        if remembered_signal_for_bridge:
            return f"I caught that, especially the part about {remembered_signal_for_bridge.lower()}, but I need to pull us back to the role for a moment."
        return f"I’m going to stop you there for a second. I need you to bring this back to the role and the question I asked."
    if suggested and (not remembered_signal_for_bridge or interviewer_bridge_references_signal(suggested, remembered_signal_for_bridge)):
        return suggested[:180]
    if remembered_signal_for_bridge:
        return f"You mentioned that {remembered_signal_for_bridge.lower()}. Stay with that and make it concrete for me."
    if profile_note and round_label == "screening":
        return "I can see the shape of your background. Let me pressure-test one part of it."
    if overall_score >= 78:
        return "That was clear and well grounded. Now make the decision logic explicit for me."
    if overall_score >= 56:
        return "I follow you. Give me the part that actually made the difference."
    if improvements:
        return "I see the outline. Now make it more concrete for me."
    return "All right. Let’s keep moving."


def build_interview_simulator_spoken_text(
    question_text: str,
    round_number: int,
    question_number_in_stage: int,
    opening_remark: str | None = None,
    interviewer_bridge: str | None = None,
) -> str:
    question = re.sub(r"\s+", " ", safe_text(question_text).strip())
    if not question:
        return ""
    opening = ""
    if round_number <= 1 and question_number_in_stage <= 1:
        opening = re.sub(r"\s+", " ", safe_text(opening_remark).strip())
    bridge = ""
    if not opening and (round_number > 1 or question_number_in_stage > 1):
        bridge = re.sub(r"\s+", " ", safe_text(interviewer_bridge).strip()) or "All right. Here's the next question."
    return re.sub(r"\s+", " ", " ".join(item for item in [opening, bridge, question] if item)).strip()


def build_interview_simulator_stage_transition_bridge(next_stage: dict[str, Any], prior_bridge: str | None = None) -> str:
    stage_key = safe_text(next_stage.get("key")).strip().lower()
    stage_number = int(next_stage.get("stage_number") or 1)
    stage_label = safe_text(next_stage.get("label")) or f"Round {stage_number}"
    base = f"Let’s move into round {stage_number}, {stage_label.lower()}."
    if stage_key == "technical_assessment":
        base = "Good. Let’s move into round 2, the technical assessment."
    elif stage_key == "in_depth_assessment":
        base = "Good. Let’s move into round 3, the in-depth assessment."
    elif stage_key == "hr":
        base = "Good. We’ll wrap with round 4, the HR conversation."
    bridge = safe_text(prior_bridge).strip()
    if bridge and not phrase_in_text(bridge, stage_label):
        return f"{base} {bridge}"[:180]
    return base[:180]


def summarize_interview_simulator_scores(turns: list[dict[str, Any]]) -> float:
    if not turns:
        return 0.0
    values = [safe_float(((turn.get("scores") or {}).get("overall")), 0.0) for turn in turns]
    return clamp(sum(values) / max(1, len(values)))


def build_interview_simulator_context_keywords(role: str, industry: str, focus_skills: list[str]) -> set[str]:
    keywords = {
        token
        for token in tokenize_keywords(f"{safe_text(role)} {safe_text(industry)}")
        if token not in STOPWORDS and token not in GENERIC_ROLE_WORDS and token not in INTERVIEW_SIMULATOR_QUESTION_NOISE_WORDS
    }
    for skill in focus_skills[:8]:
        normalized_skill = normalize_token(skill)
        if not normalized_skill:
            continue
        keywords.update(
            token
            for token in tokenize_keywords(normalized_skill)
            if token not in STOPWORDS and token not in INTERVIEW_SIMULATOR_QUESTION_NOISE_WORDS
        )
    return {token for token in keywords if token}


def analyze_interview_simulator_answer_relevance(
    question: str,
    answer_text: str,
    role: str,
    industry: str,
    focus_skills: list[str],
    matched_focus: list[str],
) -> dict[str, Any]:
    question_keywords = {
        token for token in tokenize_keywords(question) if token not in INTERVIEW_SIMULATOR_QUESTION_NOISE_WORDS
    }
    answer_keywords = tokenize_keywords(answer_text)
    context_keywords = build_interview_simulator_context_keywords(role, industry, focus_skills)
    question_hits = sorted(question_keywords.intersection(answer_keywords))
    context_hits = sorted(context_keywords.intersection(answer_keywords))
    role_explicit_hit = phrase_in_text(answer_text, role)
    clean_industry = safe_text(industry).strip()
    industry_explicit_hit = bool(clean_industry and clean_industry.lower() not in {"general"}) and phrase_in_text(answer_text, clean_industry)
    matched_focus_count = len(dedupe_text_list(matched_focus, limit=8, max_item_len=80))
    normalized_answer = safe_text(answer_text).lower()
    target_track = infer_role_track(role, industry)
    answer_track, answer_track_score = infer_role_track_with_score(answer_text[:1800], "")
    cross_track_mismatch = (
        target_track not in {"", "general"}
        and answer_track not in {"", "general"}
        and answer_track != target_track
        and answer_track_score >= 2
    )
    self_disqualifying_patterns = [
        r"\b(?:unrelated|irrelevant|off[- ]topic)\b",
        r"\b(?:did not connect|not connected|not connect|don't connect|doesn't connect|not related|not relevant|nothing to do with)\b",
    ]
    self_disqualifying_hits = sum(1 for pattern in self_disqualifying_patterns if re.search(pattern, normalized_answer))

    relevance_score = clamp(
        14
        + min(28, len(question_hits) * 8.0)
        + min(18, len(context_hits) * 4.5)
        + min(28, matched_focus_count * 8.0)
        + (10 if role_explicit_hit else 0)
        + (6 if industry_explicit_hit else 0)
    )
    if question_keywords and not question_hits:
        relevance_score = clamp(relevance_score - 8)
    if not context_hits and matched_focus_count <= 0 and not role_explicit_hit:
        relevance_score = clamp(relevance_score - 14)
    if question_keywords and len(question_hits) <= 1 and matched_focus_count <= 0 and not role_explicit_hit:
        relevance_score = clamp(relevance_score - 18)
    if len(context_hits) <= 1 and matched_focus_count <= 0 and len(answer_keywords) >= 12:
        relevance_score = clamp(relevance_score - 8)
    if len(answer_keywords) < 10:
        relevance_score = clamp(relevance_score - 6)
    if cross_track_mismatch and not role_explicit_hit and matched_focus_count <= 1:
        relevance_score = clamp(relevance_score - 18)
    if self_disqualifying_hits:
        relevance_score = clamp(relevance_score - min(34, self_disqualifying_hits * 16))

    return {
        "score": relevance_score,
        "question_hits": question_hits[:8],
        "context_hits": context_hits[:8],
        "role_explicit_hit": role_explicit_hit,
        "industry_explicit_hit": industry_explicit_hit,
        "cross_track_mismatch": cross_track_mismatch,
        "off_topic": relevance_score < 42,
        "severely_off_topic": relevance_score < 28,
    }


def decide_interview_simulator_screening_outcome(screening_turns: list[dict[str, Any]]) -> dict[str, str]:
    if not screening_turns:
        return {"decision": "pending", "reason": ""}
    overall_average = summarize_interview_simulator_scores(screening_turns)
    relevance_average = clamp(
        sum(safe_float(turn.get("relevance_score"), 0.0) for turn in screening_turns) / max(1, len(screening_turns))
    )
    evidence_average = clamp(
        sum(safe_float(turn.get("evidence_score"), 0.0) for turn in screening_turns) / max(1, len(screening_turns))
    )
    latest_turn = screening_turns[-1]
    latest_overall = safe_float(((latest_turn.get("scores") or {}).get("overall")), 0.0)
    latest_relevance = safe_float(latest_turn.get("relevance_score"), 0.0)

    shortlisted = (
        overall_average >= 54
        and relevance_average >= 48
        and latest_overall >= 52
        and latest_relevance >= 46
    )
    if shortlisted:
        return {
            "decision": "shortlisted",
            "reason": "Shortlisted for round 2 because the screening answers stayed relevant and showed enough proof to continue.",
        }
    if relevance_average < 42 or latest_relevance < 40:
        return {
            "decision": "rejected",
            "reason": "Rejected after screening because the answers stayed too far from the target role and question.",
        }
    if evidence_average < 46:
        return {
            "decision": "rejected",
            "reason": "Rejected after screening because the answers lacked role-specific evidence and credible examples.",
        }
    return {
        "decision": "rejected",
        "reason": "Rejected after screening because the overall first-round performance was not strong enough to move forward.",
    }


def decide_interview_simulator_stage_outcome(
    stage_key: str,
    stage_turns: list[dict[str, Any]],
    candidate_level: str | None = None,
    screening_decision: str | None = None,
    screening_decision_reason: str | None = None,
) -> dict[str, str]:
    normalized_stage = safe_text(stage_key).strip().lower()
    normalized_level = safe_text(candidate_level).strip().lower()
    if normalized_stage == "screening":
        decision = safe_text(screening_decision).strip().lower()
        if decision in {"shortlisted", "rejected"}:
            return {
                "decision": decision,
                "reason": safe_text(screening_decision_reason).strip()
                or (
                    "Shortlisted for round 2 after screening."
                    if decision == "shortlisted"
                    else "Rejected after screening."
                ),
            }
        fallback = decide_interview_simulator_screening_outcome(stage_turns)
        return {
            "decision": safe_text(fallback.get("decision")).strip().lower() or "rejected",
            "reason": safe_text(fallback.get("reason")).strip() or "Round 1 decision is ready.",
        }

    if not stage_turns:
        return {"decision": "pending", "reason": ""}

    stage_average = summarize_interview_simulator_scores(stage_turns)
    relevance_average = clamp(
        sum(safe_float(turn.get("relevance_score"), 0.0) for turn in stage_turns) / max(1, len(stage_turns))
    )
    evidence_average = clamp(
        sum(safe_float(turn.get("evidence_score"), 0.0) for turn in stage_turns) / max(1, len(stage_turns))
    )
    latest_turn = stage_turns[-1]
    latest_overall = safe_float(((latest_turn.get("scores") or {}).get("overall")), 0.0)
    shortlist_floor = 52.0
    relevance_floor = 44.0
    evidence_floor = 44.0

    if normalized_level == "fresher":
        shortlist_floor -= 4.0
        relevance_floor -= 3.0
        evidence_floor -= 2.0

    if normalized_stage == "technical_assessment":
        shortlist_floor += 2.0
        relevance_floor += 1.0
    elif normalized_stage == "in_depth_assessment":
        shortlist_floor += 1.0
    elif normalized_stage == "hr":
        shortlist_floor -= 2.0

    if stage_average >= shortlist_floor and latest_overall >= (shortlist_floor - 2.0) and relevance_average >= relevance_floor:
        return {
            "decision": "shortlisted",
            "reason": (
                f"Shortlisted after {normalized_stage.replace('_', ' ')} because answers stayed relevant, structured, and role-aligned."
            ),
        }
    if relevance_average < max(30.0, relevance_floor - 6.0):
        return {
            "decision": "rejected",
            "reason": (
                f"Rejected after {normalized_stage.replace('_', ' ')} because answers drifted away from the role expectations and question intent."
            ),
        }
    if evidence_average < max(28.0, evidence_floor - 6.0):
        return {
            "decision": "rejected",
            "reason": (
                f"Rejected after {normalized_stage.replace('_', ' ')} because role-specific proof and credible evidence were not strong enough."
            ),
        }
    return {
        "decision": "rejected",
        "reason": f"Rejected after {normalized_stage.replace('_', ' ')} because round performance was below shortlist threshold.",
    }


def decide_interview_simulator_stage_progression(
    stage_plan: list[dict[str, Any]],
    current_stage_key: str,
    current_stage_turns: list[dict[str, Any]],
    all_turns: list[dict[str, Any]],
    difficulty: str,
    llm_stage_action: str | None = None,
    screening_decision: str | None = None,
    candidate_level: str | None = None,
) -> tuple[bool, str | None]:
    stage_entry = get_interview_simulator_stage_entry(stage_plan, current_stage_key)
    stage_question_count = len(current_stage_turns)
    min_questions = int(stage_entry.get("min_questions") or 1)
    max_questions = int(stage_entry.get("max_questions") or min_questions)
    stage_average = summarize_interview_simulator_scores(current_stage_turns)
    latest_score = safe_float((((current_stage_turns[-1].get("scores") or {}).get("overall")) if current_stage_turns else 0), 0.0)
    overall_average = summarize_interview_simulator_scores(all_turns)
    action = safe_text(llm_stage_action).strip().lower()
    normalized_difficulty = normalize_interview_simulator_difficulty(difficulty)
    normalized_candidate_level = safe_text(candidate_level).strip().lower()

    def pick_stage_if_present(stage_key: str) -> str | None:
        if interview_simulator_stage_exists(stage_plan, stage_key):
            return stage_key
        return None

    if stage_question_count < min_questions:
        return False, current_stage_key

    stage_complete = stage_question_count >= max_questions
    if not stage_complete:
        if current_stage_key == "screening":
            stage_complete = stage_question_count >= 2
        elif current_stage_key == "technical_assessment":
            if action in {"advance", "skip_to_hr"} and stage_average >= 52:
                stage_complete = True
            elif stage_question_count >= 2 and (stage_average >= 64 or latest_score >= 72):
                stage_complete = True
        elif current_stage_key == "in_depth_assessment":
            if action == "advance" and stage_average >= 48:
                stage_complete = True
            elif stage_question_count >= 1 and (stage_average >= 66 or latest_score >= 70):
                stage_complete = True
        elif current_stage_key == "hr":
            stage_complete = stage_question_count >= 1 and action != "stay"

    if not stage_complete:
        return False, current_stage_key

    if current_stage_key == "screening":
        if safe_text(screening_decision).strip().lower() == "shortlisted":
            return True, pick_stage_if_present("technical_assessment")
        return True, None

    if current_stage_key == "technical_assessment":
        if action == "finish" and stage_average < 48 and overall_average < 50:
            return True, None
        if action == "skip_to_hr" and stage_average >= 56:
            return True, pick_stage_if_present("hr")
        if normalized_candidate_level == "fresher":
            if stage_average >= 62 and normalized_difficulty == "advanced" and action == "advance":
                return True, pick_stage_if_present("in_depth_assessment") or pick_stage_if_present("hr")
            if stage_average >= 42 or overall_average >= 45:
                return True, pick_stage_if_present("hr")
            return True, None
        if stage_average >= 74 or (normalized_difficulty == "foundation" and stage_average >= 64):
            return True, pick_stage_if_present("hr")
        if stage_average >= 50 or (action == "advance" and stage_average >= 46) or overall_average >= 52:
            return True, pick_stage_if_present("in_depth_assessment") or pick_stage_if_present("hr")
        if stage_average >= 42 and action in {"advance", "skip_to_hr"}:
            return True, pick_stage_if_present("hr")
        return True, None

    if current_stage_key == "in_depth_assessment":
        if action == "finish" and stage_average < 45:
            return True, None
        if normalized_candidate_level == "fresher":
            if stage_average >= 42 or action == "advance":
                return True, pick_stage_if_present("hr")
            return True, None
        if stage_average >= 48 or overall_average >= 55 or normalized_difficulty == "foundation":
            return True, pick_stage_if_present("hr")
        return True, None

    return True, None


def sanitize_interview_simulator_video_frames(values: Any, limit: int = INTERVIEW_SIMULATOR_VIDEO_SENTIMENT_MAX_FRAMES) -> list[str]:
    if not isinstance(values, list):
        return []
    effective_limit = max(1, min(6, int(limit or INTERVIEW_SIMULATOR_VIDEO_SENTIMENT_MAX_FRAMES)))
    cleaned: list[str] = []
    seen_fingerprints: set[str] = set()

    for item in values[: effective_limit * 3]:
        raw = safe_text(item)
        if not raw:
            continue

        data_url = ""
        if raw.startswith("data:image/") and ";base64," in raw:
            header, _, encoded = raw.partition(",")
            normalized_encoded = re.sub(r"\s+", "", encoded)
            if len(normalized_encoded) < 120:
                continue
            if not re.fullmatch(r"[A-Za-z0-9+/=]+", normalized_encoded):
                continue
            capped_encoded = normalized_encoded[: max(120, INTERVIEW_SIMULATOR_VIDEO_SENTIMENT_MAX_DATA_URL_CHARS)]
            capped_encoded = capped_encoded[: len(capped_encoded) - (len(capped_encoded) % 4)] or capped_encoded
            data_url = f"{safe_text(header)},{capped_encoded}"
        else:
            normalized_encoded = re.sub(r"\s+", "", raw)
            if len(normalized_encoded) < 120:
                continue
            if not re.fullmatch(r"[A-Za-z0-9+/=]+", normalized_encoded):
                continue
            capped_encoded = normalized_encoded[: max(120, INTERVIEW_SIMULATOR_VIDEO_SENTIMENT_MAX_DATA_URL_CHARS)]
            capped_encoded = capped_encoded[: len(capped_encoded) - (len(capped_encoded) % 4)] or capped_encoded
            data_url = f"data:image/jpeg;base64,{capped_encoded}"

        if len(data_url) < 140:
            continue
        _, _, fingerprint_source = data_url.partition(",")
        fingerprint = hashlib.sha1(fingerprint_source[-2200:].encode("utf-8")).hexdigest()
        if fingerprint in seen_fingerprints:
            continue
        seen_fingerprints.add(fingerprint)
        cleaned.append(data_url)
        if len(cleaned) >= effective_limit:
            break

    return cleaned


def request_interview_simulator_video_sentiment(
    video_frame_samples: list[str],
    *,
    role: str,
    industry: str,
    stage_label: str,
    question: str,
    answer_text: str,
) -> tuple[dict[str, Any] | None, str | None, str | None]:
    if not INTERVIEW_SIMULATOR_VIDEO_SENTIMENT_ENABLED:
        return None, None, "video_sentiment_disabled"
    if client is None:
        return None, None, "OPENAI_API_KEY not configured"

    cleaned_frames = sanitize_interview_simulator_video_frames(video_frame_samples, limit=INTERVIEW_SIMULATOR_VIDEO_SENTIMENT_MAX_FRAMES)
    if not cleaned_frames:
        return None, None, "no_video_frames"

    prompt = f"""
You are an interview behavior analyst.
Assess only visible non-verbal interview cues from the provided video snapshots.

Role context: {safe_text(role)}
Industry context: {safe_text(industry)}
Round context: {safe_text(stage_label)}
Question asked: {safe_text(question)}
Candidate answer transcript (for context only): {safe_text(answer_text)[:900]}

Return strict JSON only:
{{
  "sentiment_label": "positive|steady|nervous|negative|unknown",
  "sentiment_score": 0,
  "confidence_signal_score": 0,
  "eye_contact_score": 0,
  "engagement_score": 0,
  "notes": ["short non-verbal cue 1", "short non-verbal cue 2"]
}}

Rules:
- Focus on facial expression, visible composure, engagement, and eye-contact alignment.
- Do not infer protected traits or identity labels.
- If frames are unclear, lower confidence and use "unknown" or "steady" conservatively.
- Keep notes short, factual, and interview-relevant.
"""

    models: list[str] = []
    for model in [ANALYZE_LLM_MODEL, OPENAI_MODEL, *OPENAI_FALLBACK_MODELS]:
        candidate = safe_text(model)
        if candidate and candidate not in models:
            models.append(candidate)

    last_error: str | None = None
    for model in models:
        for attempt in range(2):
            try:
                content_parts: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
                for data_url in cleaned_frames:
                    content_parts.append({"type": "image_url", "image_url": {"url": data_url}})

                response = client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": "Return strict JSON only. No markdown."},
                        {"role": "user", "content": content_parts},
                    ],
                    temperature=0.0,
                )
                content = extract_llm_text(response.choices[0].message.content if response.choices else "")
                parsed = parse_llm_json_payload(content)
                if not isinstance(parsed, dict):
                    last_error = f"invalid_json_from_{model}"
                    logger.error("Interview video sentiment returned non-JSON content for model '%s'.", model)
                    break

                sentiment_label = safe_text(parsed.get("sentiment_label")).strip().lower()
                if sentiment_label not in {"positive", "steady", "nervous", "negative", "unknown"}:
                    sentiment_label = "unknown"
                sentiment_score = clamp(safe_float(parsed.get("sentiment_score"), 0.0))
                confidence_signal_score = clamp(safe_float(parsed.get("confidence_signal_score"), 0.0))
                eye_contact_score = clamp(safe_float(parsed.get("eye_contact_score"), 0.0))
                engagement_score = clamp(safe_float(parsed.get("engagement_score"), 0.0))
                notes = dedupe_text_list(normalize_string_list(parsed.get("notes"), limit=3, max_item_len=140), limit=2, max_item_len=140)

                payload = {
                    "used": True,
                    "sentiment_label": sentiment_label,
                    "sentiment_score": sentiment_score,
                    "confidence_signal_score": confidence_signal_score,
                    "eye_contact_score": eye_contact_score,
                    "engagement_score": engagement_score,
                    "notes": notes,
                    "frames_analyzed": len(cleaned_frames),
                }
                return payload, model, None
            except Exception as exc:
                last_error = f"{type(exc).__name__} on model {model}"
                logger.exception("Interview video sentiment failed for model '%s' (attempt %s).", model, attempt + 1)
                if attempt == 0 and is_transient_openai_error(exc):
                    time.sleep(0.25)
                    continue
                break

    return None, None, last_error


def blend_interview_simulator_video_confidence(
    score_payload: dict[str, Any],
    video_sentiment_payload: dict[str, Any] | None,
    relevance_score: float,
) -> dict[str, Any]:
    if not isinstance(score_payload, dict):
        return score_payload
    if not isinstance(video_sentiment_payload, dict) or not video_sentiment_payload.get("used"):
        return score_payload

    base_confidence = clamp_float(safe_float(score_payload.get("confidence"), 0.0), 0.0, 100.0)
    sentiment_score = clamp_float(safe_float(video_sentiment_payload.get("sentiment_score"), 0.0), 0.0, 100.0)
    confidence_signal = clamp_float(safe_float(video_sentiment_payload.get("confidence_signal_score"), 0.0), 0.0, 100.0)
    eye_contact = clamp_float(safe_float(video_sentiment_payload.get("eye_contact_score"), 0.0), 0.0, 100.0)
    engagement = clamp_float(safe_float(video_sentiment_payload.get("engagement_score"), 0.0), 0.0, 100.0)
    target_confidence = clamp_float(0.42 * confidence_signal + 0.24 * sentiment_score + 0.2 * eye_contact + 0.14 * engagement, 0.0, 100.0)
    blended = clamp_float(0.76 * base_confidence + 0.24 * target_confidence, 0.0, 100.0)

    max_shift = 11.0
    if blended > base_confidence + max_shift:
        blended = base_confidence + max_shift
    elif blended < base_confidence - max_shift:
        blended = base_confidence - max_shift

    if relevance_score < 45 and blended > base_confidence + 4.0:
        blended = base_confidence + 4.0

    score_payload["confidence"] = clamp(blended)
    return score_payload


def build_interview_turn_heuristics(
    question: str,
    answer_text: str,
    role: str,
    industry: str,
    focus_skills: list[str],
    response_time_seconds: int | None,
    difficulty: str,
) -> dict[str, Any]:
    normalized_answer = safe_text(answer_text).strip()
    normalized_question = safe_text(question).strip()
    words = re.findall(r"[A-Za-z0-9][A-Za-z0-9\-\+/#\.]*", normalized_answer)
    word_count = len(words)
    sentences = [segment.strip() for segment in re.split(r"[.!?]+", normalized_answer) if segment.strip()]
    sentence_count = len(sentences)
    avg_sentence_words = (word_count / max(1, sentence_count)) if sentence_count else float(word_count)

    metric_hits = len(
        re.findall(
            r"\b\d+(?:\.\d+)?\s*(?:%|percent|x|k|m|cr|lakh|crore|hours?|days?|weeks?|months?|years?)?\b",
            normalized_answer.lower(),
        )
    )
    uncertain_hits = len(re.findall(r"\b(?:maybe|probably|perhaps|not sure|guess|i think)\b", normalized_answer.lower()))
    impact_hits = len(
        re.findall(
            r"\b(?:improved|reduced|increased|optimized|delivered|launched|scaled|closed|saved|accelerated|led)\b",
            normalized_answer.lower(),
        )
    )
    structure_hits = len(re.findall(r"\b(?:situation|task|action|result|because|therefore|first|then|finally)\b", normalized_answer.lower()))

    focus_hits = 0
    matched_focus: list[str] = []
    for skill in focus_skills[:8]:
        if phrase_in_text(normalized_answer, skill):
            focus_hits += 1
            matched_focus.append(skill)
    missing_focus = [skill for skill in focus_skills[:8] if skill not in matched_focus]
    relevance_payload = analyze_interview_simulator_answer_relevance(
        question=normalized_question,
        answer_text=normalized_answer,
        role=role,
        industry=industry,
        focus_skills=focus_skills,
        matched_focus=matched_focus,
    )
    relevance_score = safe_float(relevance_payload.get("score"), 0.0)

    speaking_time = int(clamp_float(float(response_time_seconds or 0), 0.0, 1800.0))
    timing_bonus = 0
    if speaking_time:
        if 35 <= speaking_time <= 140:
            timing_bonus = 6
        elif speaking_time < 20:
            timing_bonus = -4
        elif speaking_time > 210:
            timing_bonus = -2

    communication_score = clamp(
        32
        + min(28, word_count * 0.42)
        + min(14, structure_hits * 3.0)
        + min(10, metric_hits * 2.0)
        - min(16, uncertain_hits * 3.5)
        + timing_bonus
    )
    if relevance_score < 45:
        communication_score = clamp(communication_score - 8)
    clarity_score = clamp(
        34
        + min(18, max(0.0, (24.0 - abs(avg_sentence_words - 16.0)) * 0.9))
        + min(18, sentence_count * 1.8)
        + min(10, structure_hits * 2.0)
        - min(14, uncertain_hits * 3.2)
    )
    if relevance_score < 45:
        clarity_score = clamp(clarity_score - 6)
    domain_depth_base = clamp(
        28
        + min(30, focus_hits * (25.0 / max(1, min(5, len(focus_skills)))))
        + min(18, metric_hits * 2.6)
        + min(14, impact_hits * 2.0)
    )
    domain_depth_score = clamp(0.45 * domain_depth_base + 0.55 * relevance_score)
    confidence_score = clamp(
        35
        + min(14, impact_hits * 1.8)
        + min(10, metric_hits * 1.5)
        + min(8, structure_hits * 1.5)
        - min(20, uncertain_hits * 4.0)
        + timing_bonus
    )
    if relevance_score < 45:
        confidence_score = clamp(confidence_score - 6)

    evidence_score = clamp(
        18
        + min(24, metric_hits * 6.0)
        + min(20, impact_hits * 4.0)
        + min(12, structure_hits * 2.0)
        + min(18, focus_hits * 4.0)
    )
    if relevance_score < 48:
        evidence_score = clamp(evidence_score - 24)

    if difficulty == "advanced":
        domain_depth_score = clamp(domain_depth_score - 5 + min(8, focus_hits * 2.0))
        clarity_score = clamp(clarity_score - 2 + min(4, structure_hits))
    elif difficulty == "foundation":
        communication_score = clamp(communication_score + 4)
        confidence_score = clamp(confidence_score + 3)

    base_overall_score = clamp(
        0.27 * communication_score + 0.23 * clarity_score + 0.32 * domain_depth_score + 0.18 * confidence_score
    )
    overall_score = clamp(0.58 * base_overall_score + 0.42 * relevance_score)
    if relevance_score < 35:
        overall_score = clamp(min(overall_score, relevance_score + 10))
    elif relevance_score < 48:
        overall_score = clamp(min(overall_score, relevance_score + 16))

    strengths: list[str] = []
    improvements: list[str] = []
    if metric_hits >= 1 and relevance_score >= 62 and evidence_score >= 56:
        strengths.append("You tied measurable evidence directly to the question, which improved credibility.")
    if focus_hits >= max(1, int(round(max(1, len(focus_skills[:6])) * 0.5))) and relevance_score >= 62:
        strengths.append("Your answer stayed aligned with key role skills expected in this interview.")
    if structure_hits >= 2:
        strengths.append("Answer structure was clear and easy to follow.")
    if impact_hits >= 1 and relevance_score >= 60:
        strengths.append("You explained business impact instead of generic activity.")

    if word_count < 55:
        improvements.append("Expand depth: include context, your action, and final outcome in one answer.")
    if relevance_score < 45:
        improvements.append("Your answer drifted away from the question or target role. Re-anchor it to the scenario being asked.")
    if metric_hits >= 1 and relevance_score < 48:
        improvements.append("Metrics did not help this answer because they were not tied to a relevant role-specific example.")
    if metric_hits < 1 and relevance_score >= 48:
        improvements.append("Add at least one hard metric or timeline to strengthen trust.")
    if focus_hits < max(1, min(3, len(focus_skills[:6]))):
        improvements.append("Anchor the answer to role-critical skills from the JD.")
    if uncertain_hits >= 1:
        improvements.append("Use direct language and reduce uncertain phrases to project confidence.")
    if not strengths:
        strengths.append(
            "You gave enough material for the interviewer to assess, but the answer needs sharper role alignment."
            if word_count >= 35
            else "You gave a basic response, but it needs much stronger relevance and detail."
        )
    if not improvements:
        improvements.append("Add a sharper close: what changed, by how much, and what you learned.")

    return {
        "question": normalized_question,
        "word_count": word_count,
        "response_time_seconds": speaking_time,
        "scores": {
            "communication": communication_score,
            "clarity": clarity_score,
            "domain_depth": domain_depth_score,
            "confidence": confidence_score,
            "overall": overall_score,
        },
        "relevance_score": relevance_score,
        "evidence_score": evidence_score,
        "question_keyword_hits": relevance_payload.get("question_hits") or [],
        "context_keyword_hits": relevance_payload.get("context_hits") or [],
        "off_topic": bool(relevance_payload.get("off_topic")),
        "matched_focus_skills": matched_focus[:6],
        "missing_focus_skills": missing_focus[:6],
        "strengths": dedupe_text_list(strengths, limit=4, max_item_len=180),
        "improvements": dedupe_text_list(improvements, limit=4, max_item_len=180),
        "feedback_summary": (
            "Answer was mostly off-topic for the question and target role."
            if relevance_score < 35
            else "Strong response with clear role alignment."
            if overall_score >= 78 and relevance_score >= 68
            else "Reasonably aligned answer with room to add sharper proof."
            if overall_score >= 56 and relevance_score >= 50
            else "Answer needs stronger relevance, structure, and role-specific depth."
        ),
    }


def request_interview_simulator_turn_overlay(
    candidate_name: str,
    interviewer_name: str,
    interviewer_title: str,
    interviewer_style: str,
    role: str,
    industry: str,
    difficulty: str,
    stage_key: str,
    stage_label: str,
    round_number: int,
    total_rounds: int,
    question_number_in_stage: int,
    focus_skills: list[str],
    candidate_profile_note: str,
    candidate_connection_notes: list[str],
    recent_turn_memory: list[dict[str, Any]],
    question: str,
    answer_text: str,
    heuristic_payload: dict[str, Any],
    candidate_level: str | None = None,
    candidate_reports_no_direct_experience: bool = False,
) -> tuple[dict[str, Any] | None, str | None, str | None]:
    if client is None:
        return None, None, "OPENAI_API_KEY not configured"

    prompt = f"""
You are {safe_text(interviewer_name) or "Avery Bennett"}, {safe_text(interviewer_title) or "Lead Interviewer"}.
You are leading a live interview for {safe_text(role)} hiring in {safe_text(industry)}.
Interviewer style: {safe_text(interviewer_style) or "warm, concise, observant, and direct"}.
Evaluate the candidate answer and decide whether the current interview round should continue, advance, or end.
Candidate name: {safe_text(candidate_name) or "Candidate"}

Difficulty: {safe_text(difficulty)}
Candidate level: {safe_text(candidate_level) or "balanced"}
Candidate explicitly reported no direct background: {"yes" if candidate_reports_no_direct_experience else "no"}
Round: {round_number}/{total_rounds}
Current round label: {safe_text(stage_label)}
Current round key: {safe_text(stage_key)}
Question number in this round: {question_number_in_stage}
Focus skills: {json.dumps(focus_skills[:8], ensure_ascii=False)}
Candidate background note: {safe_text(candidate_profile_note)}
Human notes already gathered: {json.dumps(candidate_connection_notes[:4], ensure_ascii=False)}
Recent turn memory: {json.dumps(recent_turn_memory[:2], ensure_ascii=False)}

Current question:
{safe_text(question)}

Candidate answer:
{safe_text(answer_text)[:2500]}

Heuristic baseline:
{json.dumps(heuristic_payload, ensure_ascii=False)}

Return strict JSON only with this schema:
{{
  "feedback_summary": "single concise summary",
  "strengths": ["point 1", "point 2", "point 3"],
  "improvements": ["point 1", "point 2", "point 3"],
  "interviewer_bridge": "one short interviewer line before the next question",
  "follow_up_question": "one targeted next question",
  "candidate_signal": "one short human detail to remember about this candidate",
  "next_focus_skill": "skill phrase",
  "stage_action": "stay|advance|skip_to_hr|finish",
  "communication_score": 0,
  "clarity_score": 0,
  "domain_depth_score": 0,
  "confidence_score": 0
}}

Rules:
- Sound like a sharp human interviewer: warm, concise, observant, and direct.
- Sound like a real person in a live video call, not a synthetic assistant or scripted tutor.
- The interview ladder is: screening -> technical_assessment -> in_depth_assessment -> hr.
- Use "stay" if the current round needs another question.
- Use "advance" if the candidate should move to the next deeper round.
- Use "skip_to_hr" only after technical_assessment when the candidate is strong enough to skip in_depth_assessment.
- Use "finish" if the interview should end after this round.
- Make the follow_up_question match the stage_action you chose.
- If the answer is off-topic, say so clearly in improvements and do not invent role relevance.
- Never claim metrics improved credibility unless the metrics were clearly tied to the question and role.
- Make interviewer_bridge feel personal by reacting to something concrete in the answer or gap.
- The bridge should sound like natural spoken conversation, not an AI coach or dashboard summary.
- Keep continuity with the recent turn memory when it helps; do not sound like you forgot the earlier exchange.
- Avoid generic praise like "great answer" unless you immediately say what specifically was strong.
- If the bridge does not reference a concrete detail, redirect crisply instead of sounding vague.
- Use the candidate's name sparingly and only when it sounds natural.
- If the candidate reveals a motivation, value, team preference, or memorable detail, capture it in candidate_signal as a short phrase.
- Do not overpraise. A smart interviewer is precise, not flattering.
- If the candidate answer is playful or funny, you may acknowledge it with light professional humor.
- If the candidate is transitioning from another domain or has limited direct domain experience, ask technical follow-ups that test transferable judgment and learning agility before deep tool trivia.
- If the candidate explicitly reports no direct background, do not ask "in your direct role experience/project" style questions next.
- Never mock the candidate or derail the interview.
"""
    parsed, model, error = request_structured_json_with_llm(prompt, temperature=0.22)
    if not isinstance(parsed, dict):
        return None, model, error

    payload = {
        "feedback_summary": safe_text(parsed.get("feedback_summary"))[:220],
        "strengths": normalize_string_list(parsed.get("strengths"), limit=4, max_item_len=180),
        "improvements": normalize_string_list(parsed.get("improvements"), limit=4, max_item_len=180),
        "interviewer_bridge": safe_text(parsed.get("interviewer_bridge"))[:180],
        "follow_up_question": safe_text(parsed.get("follow_up_question"))[:240],
        "candidate_signal": safe_text(parsed.get("candidate_signal"))[:140],
        "next_focus_skill": safe_text(parsed.get("next_focus_skill"))[:72],
        "stage_action": safe_text(parsed.get("stage_action")).strip().lower()[:24],
        "communication_score": clamp_float(safe_float(parsed.get("communication_score"), 0.0), 0.0, 100.0),
        "clarity_score": clamp_float(safe_float(parsed.get("clarity_score"), 0.0), 0.0, 100.0),
        "domain_depth_score": clamp_float(safe_float(parsed.get("domain_depth_score"), 0.0), 0.0, 100.0),
        "confidence_score": clamp_float(safe_float(parsed.get("confidence_score"), 0.0), 0.0, 100.0),
    }
    return payload, model, None


def build_interview_simulator_follow_up_question(
    role: str,
    industry: str,
    difficulty: str,
    stage_plan: list[dict[str, Any]],
    stage_key: str,
    question_number_in_stage: int,
    focus_skills: list[str],
    missing_focus_skills: list[str],
    improvements: list[str],
    fallback_question: str | None = None,
    next_focus_skill: str | None = None,
    candidate_profile_note: str | None = None,
    candidate_level: str | None = None,
    candidate_reports_no_direct_experience: bool = False,
) -> str:
    return build_interview_simulator_stage_question(
        role=role,
        industry=industry,
        difficulty=difficulty,
        stage_key=stage_key,
        question_number_in_stage=question_number_in_stage,
        focus_skills=focus_skills,
        missing_focus_skills=missing_focus_skills,
        improvements=improvements,
        fallback_question=fallback_question,
        next_focus_skill=next_focus_skill,
        candidate_profile_note=candidate_profile_note,
        candidate_level=candidate_level,
        candidate_reports_no_direct_experience=candidate_reports_no_direct_experience,
    )


def build_interview_simulator_report_payload(session_payload: dict[str, Any]) -> dict[str, Any]:
    turns = session_payload.get("turns") if isinstance(session_payload.get("turns"), list) else []
    stage_plan = get_interview_simulator_stage_plan(session_payload)
    stage_summaries = build_interview_simulator_stage_summaries(turns, stage_plan)
    role = safe_text(session_payload.get("role")) or "Target role"
    industry = safe_text(session_payload.get("industry")) or "General"
    difficulty = normalize_interview_simulator_difficulty(safe_text(session_payload.get("difficulty")))
    mode = normalize_interview_simulator_mode(safe_text(session_payload.get("mode")))
    candidate_name = safe_text(session_payload.get("candidate_name"))
    interviewer_name = safe_text(session_payload.get("interviewer_name"))
    interviewer_title = safe_text(session_payload.get("interviewer_title"))
    interviewer_voice = safe_text(session_payload.get("interviewer_voice"))
    screening_decision = safe_text(session_payload.get("screening_decision")).strip().lower()
    screening_decision_reason = safe_text(session_payload.get("screening_decision_reason")).strip()
    raw_stage_decisions = session_payload.get("stage_decisions") if isinstance(session_payload.get("stage_decisions"), dict) else {}
    round_decisions: list[dict[str, Any]] = []
    for stage in stage_plan:
        stage_key = safe_text(stage.get("key"))
        stage_decision_entry = raw_stage_decisions.get(stage_key) if stage_key else None
        if not isinstance(stage_decision_entry, dict):
            continue
        decision = safe_text(stage_decision_entry.get("decision")).strip().lower()
        reason = safe_text(stage_decision_entry.get("reason")).strip()
        if decision not in {"shortlisted", "rejected"}:
            continue
        round_decisions.append(
            {
                "stage_key": stage_key,
                "stage_label": safe_text(stage_decision_entry.get("stage_label")) or safe_text(stage.get("label")) or "Round",
                "stage_number": int(stage_decision_entry.get("stage_number") or stage.get("stage_number") or len(round_decisions) + 1),
                "decision": decision,
                "reason": reason,
            }
        )
    if not turns:
        return {
            "overall_score": 0,
            "readiness_label": "not_started",
            "score_breakdown": {"communication": 0, "clarity": 0, "domain_depth": 0, "confidence": 0},
            "strength_signals": [],
            "improvement_signals": [],
            "next_steps": ["Start the simulation and answer at least one question to get a report."],
            "turns_completed": 0,
            "rounds_completed": 0,
            "stage_summaries": [],
            "total_rounds": len(stage_plan),
            "shortlist_prediction": "Interview readiness: Not Started",
            "source": "interview_simulator",
            "role": role,
            "industry": industry,
            "difficulty": difficulty,
            "mode": mode,
            "candidate_name": candidate_name,
            "interviewer_name": interviewer_name,
            "interviewer_title": interviewer_title,
            "interviewer_voice": interviewer_voice,
            "screening_decision": screening_decision,
            "screening_decision_reason": screening_decision_reason,
            "round_decisions": round_decisions,
        }

    communication_values = [safe_float(((turn.get("scores") or {}).get("communication")), 0.0) for turn in turns]
    clarity_values = [safe_float(((turn.get("scores") or {}).get("clarity")), 0.0) for turn in turns]
    domain_values = [safe_float(((turn.get("scores") or {}).get("domain_depth")), 0.0) for turn in turns]
    confidence_values = [safe_float(((turn.get("scores") or {}).get("confidence")), 0.0) for turn in turns]

    communication_avg = clamp(sum(communication_values) / max(1, len(communication_values)))
    clarity_avg = clamp(sum(clarity_values) / max(1, len(clarity_values)))
    domain_avg = clamp(sum(domain_values) / max(1, len(domain_values)))
    confidence_avg = clamp(sum(confidence_values) / max(1, len(confidence_values)))
    overall_score = clamp(0.27 * communication_avg + 0.23 * clarity_avg + 0.32 * domain_avg + 0.18 * confidence_avg)

    strength_counter: dict[str, int] = {}
    improvement_counter: dict[str, int] = {}
    for turn in turns:
        for item in normalize_string_list(turn.get("strengths"), limit=8, max_item_len=180):
            upsert_counter_phrase(strength_counter, item, delta=1)
        for item in normalize_string_list(turn.get("improvements"), limit=8, max_item_len=180):
            upsert_counter_phrase(improvement_counter, item, delta=1)

    strength_signals = [item for item in sorted(strength_counter, key=lambda key: (-strength_counter[key], key))[:5]]
    improvement_signals = [item for item in sorted(improvement_counter, key=lambda key: (-improvement_counter[key], key))[:6]]

    readiness_label = "high"
    if overall_score < 75:
        readiness_label = "medium"
    if overall_score < 55:
        readiness_label = "low"
    readiness_title = readiness_label.replace("_", " ").title()
    shortlist_prediction = f"Interview readiness: {readiness_title}"
    if screening_decision == "rejected":
        shortlist_prediction = "Screening decision: Rejected after round 1"
    elif screening_decision == "shortlisted":
        shortlist_prediction = "Screening decision: Shortlisted for round 2"
        if len(stage_summaries) > 1:
            shortlist_prediction = "Interview decision: Advanced beyond screening"
    elif overall_score >= 76:
        shortlist_prediction = "Interview decision: Likely shortlisted for later rounds"
    elif overall_score < 55:
        shortlist_prediction = "Interview decision: Needs stronger relevance before shortlist"

    if mode == INTERVIEW_SIMULATOR_MODE_DEMO:
        if screening_decision == "shortlisted":
            shortlist_prediction = "Demo result: Shortlisted in screening preview"
        elif screening_decision == "rejected":
            shortlist_prediction = "Demo result: Not shortlisted in screening preview"
        elif overall_score >= 60:
            shortlist_prediction = "Demo result: Positive screening signal"
        else:
            shortlist_prediction = "Demo result: Needs stronger screening alignment"

    next_steps = [
        "Build 5 STAR stories with one quantified result each.",
        "Practice 90-second answers for your top 3 weak-signal questions.",
        "Run another simulator round and target a +8 score lift.",
    ]
    if improvement_signals:
        next_steps[0] = improvement_signals[0]
    if len(improvement_signals) > 1:
        next_steps[1] = improvement_signals[1]
    if len(improvement_signals) > 2:
        next_steps[2] = improvement_signals[2]
    if mode == INTERVIEW_SIMULATOR_MODE_DEMO:
        next_steps = [
            "Upload resume + JD and run the full adaptive interview for detailed round-by-round scoring.",
            "Practice concise, role-relevant answers with measurable outcomes in 60-90 seconds.",
            "Repeat the 90-second demo until screening readiness crosses 70%.",
        ]

    return {
        "overall_score": overall_score,
        "readiness_label": readiness_label,
        "shortlist_prediction": shortlist_prediction,
        "source": "interview_simulator",
        "role": role,
        "industry": industry,
        "difficulty": difficulty,
        "mode": mode,
        "candidate_name": candidate_name,
        "interviewer_name": interviewer_name,
        "interviewer_title": interviewer_title,
        "interviewer_voice": interviewer_voice,
        "screening_decision": screening_decision,
        "screening_decision_reason": screening_decision_reason,
        "round_decisions": round_decisions,
        "score_breakdown": {
            "communication": communication_avg,
            "clarity": clarity_avg,
            "domain_depth": domain_avg,
            "confidence": confidence_avg,
        },
        "strength_signals": strength_signals,
        "improvement_signals": improvement_signals,
        "next_steps": dedupe_text_list(next_steps, limit=5, max_item_len=220),
        "turns_completed": len(turns),
        "rounds_completed": len(stage_summaries),
        "stage_summaries": stage_summaries,
        "total_rounds": len(stage_plan) or int(session_payload.get("total_rounds") or len(turns)),
    }


def build_interview_simulator_archive_payload(
    session_payload: dict[str, Any],
    report_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    report_summary = dict(report_payload or build_interview_simulator_report_payload(session_payload))
    turns = session_payload.get("turns") if isinstance(session_payload.get("turns"), list) else []
    stage_plan = get_interview_simulator_stage_plan(session_payload)
    question_flow = extract_interview_simulator_question_flow(session_payload, stage_plan)
    questions = [safe_text(item.get("question"))[:260] for item in question_flow if isinstance(item, dict) and safe_text(item.get("question"))]
    role = safe_text(session_payload.get("role")) or "Target role"
    industry = safe_text(session_payload.get("industry")) or "General"
    difficulty = normalize_interview_simulator_difficulty(safe_text(session_payload.get("difficulty")))
    mode = normalize_interview_simulator_mode(safe_text(session_payload.get("mode")))
    candidate_name = safe_text(session_payload.get("candidate_name"))
    interviewer_name = safe_text(session_payload.get("interviewer_name"))
    interviewer_title = safe_text(session_payload.get("interviewer_title"))
    interviewer_voice = safe_text(session_payload.get("interviewer_voice"))
    opening_remark = safe_text(session_payload.get("opening_remark"))
    closing_remark = safe_text(session_payload.get("closing_remark"))
    completed_at = safe_text(session_payload.get("updated_at")) or now_utc_iso()

    return {
        "report_kind": "interview_simulator",
        "source": "interview_simulator",
        "role": role,
        "industry": industry,
        "difficulty": difficulty,
        "mode": mode,
        "candidate_name": candidate_name,
        "interviewer_name": interviewer_name,
        "interviewer_title": interviewer_title,
        "interviewer_voice": interviewer_voice,
        "opening_remark": opening_remark,
        "closing_remark": closing_remark,
        "stage_plan": stage_plan,
        "question_flow": question_flow,
        "focus_skills": sanitize_interview_simulator_focus_skills(session_payload.get("focus_skills"), limit=10),
        "questions": questions[:20],
        "turns": turns,
        "overall_score": int(clamp_float(float(report_summary.get("overall_score") or 0), 0.0, 100.0)),
        "shortlist_prediction": safe_text(report_summary.get("shortlist_prediction")) or "Interview readiness: Medium",
        "readiness_label": safe_text(report_summary.get("readiness_label")) or "medium",
        "screening_decision": safe_text(report_summary.get("screening_decision")),
        "screening_decision_reason": safe_text(report_summary.get("screening_decision_reason")),
        "round_decisions": report_summary.get("round_decisions") if isinstance(report_summary.get("round_decisions"), list) else [],
        "score_breakdown": report_summary.get("score_breakdown") if isinstance(report_summary.get("score_breakdown"), dict) else {},
        "strength_signals": normalize_string_list(report_summary.get("strength_signals"), limit=8, max_item_len=180),
        "improvement_signals": normalize_string_list(report_summary.get("improvement_signals"), limit=8, max_item_len=180),
        "next_steps": normalize_string_list(report_summary.get("next_steps"), limit=8, max_item_len=220),
        "turns_completed": int(report_summary.get("turns_completed") or len(turns)),
        "rounds_completed": int(report_summary.get("rounds_completed") or len(build_interview_simulator_stage_summaries(turns, stage_plan))),
        "stage_summaries": report_summary.get("stage_summaries") if isinstance(report_summary.get("stage_summaries"), list) else build_interview_simulator_stage_summaries(turns, stage_plan),
        "total_rounds": int(report_summary.get("total_rounds") or len(stage_plan) or session_payload.get("total_rounds") or len(turns)),
        "created_at": safe_text(session_payload.get("created_at")) or completed_at,
        "completed_at": completed_at,
        "session_status": safe_text(session_payload.get("status")) or "completed",
        "report": report_summary,
    }


def build_role_benchmark_payload(
    connection: AuthDBConnection,
    user_id: int,
    role: str | None = None,
    industry: str | None = None,
    score: int | None = None,
    report_id: int | None = None,
) -> dict[str, Any]:
    subject_role = safe_text(role)
    subject_industry = safe_text(industry)
    subject_score = score

    if report_id and int(report_id) > 0:
        row = fetch_analysis_report_for_user(connection, int(user_id), int(report_id))
        if row:
            subject_role = safe_text(row["role"]) or subject_role
            subject_industry = safe_text(row["industry"]) or subject_industry
            if subject_score is None:
                raw = row["overall_score"]
                if raw is not None:
                    try:
                        subject_score = int(clamp_float(float(raw), 0.0, 100.0))
                    except Exception:
                        subject_score = None

    if subject_score is None:
        latest_rows = connection.execute(
            """
            SELECT role, industry, overall_score
            FROM analysis_reports
            WHERE user_id = ? AND lower(source) != 'interview_simulator'
            ORDER BY id DESC
            LIMIT 1
            """,
            (int(user_id),),
        ).fetchall()
        if latest_rows:
            latest = latest_rows[0]
            subject_role = subject_role or safe_text(latest["role"])
            subject_industry = subject_industry or safe_text(latest["industry"])
            raw = latest["overall_score"]
            if raw is not None:
                try:
                    subject_score = int(clamp_float(float(raw), 0.0, 100.0))
                except Exception:
                    subject_score = None

    if subject_score is None:
        subject_score = 0

    query = "SELECT overall_score FROM analysis_reports WHERE overall_score IS NOT NULL AND lower(source) != 'interview_simulator'"
    params: list[Any] = []
    if subject_role:
        query += " AND lower(role) = ?"
        params.append(subject_role.lower())
    if subject_industry:
        query += " AND lower(industry) = ?"
        params.append(subject_industry.lower())
    query += " ORDER BY id DESC LIMIT 500"

    rows = connection.execute(query, tuple(params)).fetchall()
    scores = [int(clamp_float(float(row["overall_score"] or 0), 0.0, 100.0)) for row in rows]
    if not scores:
        rows = connection.execute(
            "SELECT overall_score FROM analysis_reports WHERE overall_score IS NOT NULL AND lower(source) != 'interview_simulator' ORDER BY id DESC LIMIT 500"
        ).fetchall()
        scores = [int(clamp_float(float(row["overall_score"] or 0), 0.0, 100.0)) for row in rows]

    if not scores:
        scores = [subject_score]

    ordered = sorted(scores)
    peer_count = len(ordered)
    count_less_equal = sum(1 for value in ordered if value <= subject_score)
    percentile = int(round((count_less_equal / max(1, peer_count)) * 100))

    def percentile_value(frac: float) -> int:
        if not ordered:
            return 0
        index = int(round((len(ordered) - 1) * frac))
        return int(ordered[max(0, min(len(ordered) - 1, index))])

    if percentile >= 90:
        band = "Top 10%"
    elif percentile >= 75:
        band = "Top 25%"
    elif percentile >= 50:
        band = "Above Median"
    else:
        band = "Below Median"

    return {
        "role": subject_role or "All roles",
        "industry": subject_industry or "All industries",
        "score": int(subject_score),
        "peer_count": peer_count,
        "percentile": int(clamp_float(float(percentile), 0.0, 100.0)),
        "band_label": band,
        "benchmarks": {
            "p25": percentile_value(0.25),
            "p50": percentile_value(0.50),
            "p75": percentile_value(0.75),
            "p90": percentile_value(0.90),
        },
    }


def normalize_goal_roadmap_score(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(clamp_float(float(value), 0.0, 100.0))
    except Exception:
        return None


def sanitize_goal_roadmap_milestone_id(value: str, fallback_index: int) -> str:
    token = re.sub(r"[^a-z0-9]+", "-", safe_text(value).lower()).strip("-")
    if not token:
        token = f"{max(1, int(fallback_index))}"
    if not token.startswith("milestone-"):
        token = f"milestone-{token}"
    return token[:72]


def sanitize_goal_roadmap_milestone_title(value: Any, fallback_index: int) -> str:
    title = re.sub(r"\s+", " ", safe_text(str(value or "")).strip())
    if not title:
        title = f"Milestone {max(1, int(fallback_index))}"
    return title[:140]


def sanitize_goal_roadmap_milestone_detail(value: Any, fallback_title: str) -> str:
    detail = re.sub(r"\s+", " ", safe_text(str(value or "")).strip())
    if detail:
        return detail[:520]
    return f"Complete {fallback_title.lower()} and update progress in your dashboard."


def sanitize_goal_roadmap_meta_text(value: Any, max_len: int = 280) -> str:
    text = re.sub(r"\s+", " ", safe_text(str(value or "")).strip())
    if not text:
        return ""
    return text[: max(1, int(max_len))]


def sanitize_goal_roadmap_milestone_category(value: Any) -> str:
    category = sanitize_goal_roadmap_meta_text(value, 56)
    return category or "Execution"


def sanitize_goal_roadmap_milestone_priority(value: Any) -> str:
    token = sanitize_goal_roadmap_meta_text(value, 16).lower()
    aliases = {
        "p0": "critical",
        "urgent": "critical",
        "p1": "high",
        "p2": "medium",
        "p3": "low",
    }
    normalized = aliases.get(token, token)
    if normalized not in {"critical", "high", "medium", "low"}:
        return "medium"
    return normalized


def sanitize_goal_roadmap_focus_skills(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    skills: list[str] = []
    seen: set[str] = set()
    for item in value:
        token = sanitize_goal_roadmap_meta_text(item, 42)
        if not token:
            continue
        dedupe_key = token.lower()
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        skills.append(token)
        if len(skills) >= 5:
            break
    return skills


def sanitize_goal_roadmap_evidence_link(value: Any) -> str:
    token = sanitize_goal_roadmap_meta_text(value, 320)
    if not token:
        return ""
    if token.startswith(("http://", "https://")):
        return token
    return ""


def default_goal_roadmap_milestones() -> list[dict[str, Any]]:
    return [
        {
            "id": "milestone-role-fit-baseline",
            "title": "Establish your role-fit baseline",
            "detail": "Run one focused analysis and review score drivers before editing your profile.",
            "category": "Baseline",
            "priority": "high",
            "timeframe": "Week 1",
            "why": "A clear baseline makes every later milestone measurable and easier to execute.",
            "done_when": "You can list the top 3 score gaps and the first role-fit action in your dashboard notes.",
            "focus_skills": [],
            "completed": False,
            "completed_at": None,
            "evidence_note": None,
            "evidence_link": None,
            "evidence_updated_at": None,
        },
        {
            "id": "milestone-priority-gap-closure",
            "title": "Close top skill and evidence gaps",
            "detail": "Address the highest-impact missing skills and add quantified proof bullets.",
            "category": "Gap Closure",
            "priority": "critical",
            "timeframe": "Weeks 1-3",
            "why": "Closing core gaps improves screening pass rate before advanced polishing.",
            "done_when": "At least 2 must-have gaps are addressed with concrete resume evidence.",
            "focus_skills": [],
            "completed": False,
            "completed_at": None,
            "evidence_note": None,
            "evidence_link": None,
            "evidence_updated_at": None,
        },
        {
            "id": "milestone-validate-improved-score",
            "title": "Validate improved shortlist score",
            "detail": "Run analysis again after updates and confirm progress against your target role.",
            "category": "Validation",
            "priority": "high",
            "timeframe": "Week 4",
            "why": "Validation confirms your improvements are converting into a stronger shortlist signal.",
            "done_when": "Your updated analysis score and roadmap progress both improve versus baseline.",
            "focus_skills": [],
            "completed": False,
            "completed_at": None,
            "evidence_note": None,
            "evidence_link": None,
            "evidence_updated_at": None,
        },
    ]


def roadmap_progress_from_milestones(milestones: list[dict[str, Any]]) -> tuple[int, int, int]:
    total = len(milestones)
    completed = sum(1 for milestone in milestones if bool(milestone.get("completed")))
    if total <= 0:
        return 0, 0, 0
    progress = int(round((completed / total) * 100))
    return total, completed, int(clamp_float(float(progress), 0.0, 100.0))


def normalize_goal_roadmap_milestones(
    raw_milestones: Any,
    existing_completion: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    items = raw_milestones if isinstance(raw_milestones, list) else []
    completion_state = existing_completion or {}
    normalized: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    for index, item in enumerate(items, start=1):
        if isinstance(item, dict):
            raw_id = item.get("id")
            raw_title = item.get("title")
            raw_detail = item.get("detail")
            raw_category = item.get("category")
            raw_priority = item.get("priority")
            raw_timeframe = item.get("timeframe")
            raw_why = item.get("why")
            raw_done_when = item.get("done_when")
            raw_focus_skills = item.get("focus_skills")
            raw_completed = item.get("completed")
            raw_completed_at = item.get("completed_at")
            raw_evidence_note = item.get("evidence_note")
            raw_evidence_link = item.get("evidence_link")
            raw_evidence_updated_at = item.get("evidence_updated_at")
        else:
            raw_id = getattr(item, "id", None)
            raw_title = getattr(item, "title", None)
            raw_detail = getattr(item, "detail", None)
            raw_category = getattr(item, "category", None)
            raw_priority = getattr(item, "priority", None)
            raw_timeframe = getattr(item, "timeframe", None)
            raw_why = getattr(item, "why", None)
            raw_done_when = getattr(item, "done_when", None)
            raw_focus_skills = getattr(item, "focus_skills", None)
            raw_completed = getattr(item, "completed", None)
            raw_completed_at = getattr(item, "completed_at", None)
            raw_evidence_note = getattr(item, "evidence_note", None)
            raw_evidence_link = getattr(item, "evidence_link", None)
            raw_evidence_updated_at = getattr(item, "evidence_updated_at", None)

        title = sanitize_goal_roadmap_milestone_title(raw_title, index)
        detail = sanitize_goal_roadmap_milestone_detail(raw_detail, title)
        category = sanitize_goal_roadmap_milestone_category(raw_category)
        priority = sanitize_goal_roadmap_milestone_priority(raw_priority)
        timeframe = sanitize_goal_roadmap_meta_text(raw_timeframe, 56)
        why = sanitize_goal_roadmap_meta_text(raw_why, 280)
        done_when = sanitize_goal_roadmap_meta_text(raw_done_when, 280)
        focus_skills = sanitize_goal_roadmap_focus_skills(raw_focus_skills)
        milestone_id = sanitize_goal_roadmap_milestone_id(safe_text(str(raw_id or title)), index)

        if milestone_id in seen_ids:
            suffix = 2
            candidate = milestone_id
            while candidate in seen_ids:
                candidate = f"{milestone_id}-{suffix}"
                suffix += 1
            milestone_id = candidate[:72]

        seen_ids.add(milestone_id)
        preserved_state = completion_state.get(milestone_id)
        completed = bool(preserved_state.get("completed")) if preserved_state else bool(raw_completed)
        completed_at = safe_text(str((preserved_state or {}).get("completed_at") or raw_completed_at or ""))
        if not completed:
            completed_at = ""
        evidence_note = sanitize_goal_roadmap_meta_text(
            (preserved_state or {}).get("evidence_note") if preserved_state else raw_evidence_note,
            420,
        )
        evidence_link = sanitize_goal_roadmap_evidence_link(
            (preserved_state or {}).get("evidence_link") if preserved_state else raw_evidence_link
        )
        evidence_updated_at = safe_text(
            str((preserved_state or {}).get("evidence_updated_at") or raw_evidence_updated_at or "")
        )

        normalized.append(
            {
                "id": milestone_id,
                "title": title,
                "detail": detail,
                "category": category,
                "priority": priority,
                "timeframe": timeframe or None,
                "why": why or None,
                "done_when": done_when or None,
                "focus_skills": focus_skills,
                "completed": completed,
                "completed_at": completed_at or None,
                "evidence_note": evidence_note or None,
                "evidence_link": evidence_link or None,
                "evidence_updated_at": evidence_updated_at or None,
            }
        )

    if not normalized:
        normalized = default_goal_roadmap_milestones()

    return normalized[:12]


def serialize_goal_roadmap_row(row: Any) -> dict[str, Any]:
    raw_milestones: Any = []
    try:
        parsed = json.loads(safe_text(row["milestones_json"]) or "[]")
        raw_milestones = parsed if isinstance(parsed, list) else []
    except Exception:
        raw_milestones = []

    milestones = normalize_goal_roadmap_milestones(raw_milestones)
    total_milestones, completed_milestones, progress_percent = roadmap_progress_from_milestones(milestones)

    try:
        raw_target_score = row["target_score"]
    except Exception:
        raw_target_score = None
    try:
        raw_current_score = row["current_score"]
    except Exception:
        raw_current_score = None
    target_score = int(raw_target_score) if raw_target_score is not None else None
    current_score = int(raw_current_score) if raw_current_score is not None else None

    return {
        "id": int(row["id"]),
        "goal_title": safe_text(row["goal_title"]) or "Reach your target role",
        "goal_context": safe_text(row["goal_context"]),
        "target_role": safe_text(row["target_role"]),
        "target_industry": safe_text(row["target_industry"]),
        "target_score": target_score,
        "current_score": current_score,
        "milestones": milestones,
        "total_milestones": total_milestones,
        "completed_milestones": completed_milestones,
        "progress_percent": progress_percent,
        "created_at": safe_text(row["created_at"]),
        "updated_at": safe_text(row["updated_at"]),
    }


def fetch_goal_roadmap_rows_for_user(connection: AuthDBConnection, user_id: int, limit: int | None = 24) -> list[Any]:
    query = """
        SELECT
            id,
            user_id,
            goal_title,
            goal_context,
            target_role,
            target_industry,
            target_score,
            current_score,
            milestones_json,
            created_at,
            updated_at
        FROM user_goal_roadmaps
        WHERE user_id = ?
        ORDER BY updated_at DESC, id DESC
    """
    params: tuple[Any, ...] = (int(user_id),)
    if limit is not None:
        query += "\nLIMIT ?"
        params = (int(user_id), int(limit))
    return connection.execute(query, params).fetchall()


def fetch_goal_roadmap_row_for_user(connection: AuthDBConnection, user_id: int, roadmap_id: int | None = None) -> Any:
    if roadmap_id is not None and int(roadmap_id) > 0:
        return connection.execute(
            """
            SELECT
                id,
                user_id,
                goal_title,
                goal_context,
                target_role,
                target_industry,
                target_score,
                current_score,
                milestones_json,
                created_at,
                updated_at
            FROM user_goal_roadmaps
            WHERE user_id = ? AND id = ?
            LIMIT 1
            """,
            (int(user_id), int(roadmap_id)),
        ).fetchone()
    rows = fetch_goal_roadmap_rows_for_user(connection, user_id, limit=1)
    return rows[0] if rows else None


def fetch_goal_roadmaps_for_user(connection: AuthDBConnection, user_id: int, limit: int | None = 24) -> list[dict[str, Any]]:
    rows = fetch_goal_roadmap_rows_for_user(connection, user_id, limit=limit)
    return [serialize_goal_roadmap_row(row) for row in rows]


def fetch_goal_roadmap_for_user(connection: AuthDBConnection, user_id: int, roadmap_id: int | None = None) -> dict[str, Any] | None:
    row = fetch_goal_roadmap_row_for_user(connection, user_id, roadmap_id)
    if not row:
        return None
    return serialize_goal_roadmap_row(row)


def roadmap_focus_skill_tokens(milestones: list[dict[str, Any]]) -> set[str]:
    tokens: set[str] = set()
    for milestone in milestones:
        for skill in milestone.get("focus_skills") or []:
            normalized = normalize_token(safe_text(str(skill)))
            if normalized:
                tokens.add(normalized)
    return tokens


def roadmap_text_signature(text: str) -> set[str]:
    return {
        token
        for token in tokenize_keywords(text)
        if token and token not in STOPWORDS
    }


def jaccard_similarity(left: set[str], right: set[str]) -> float:
    if not left and not right:
        return 0.0
    union = left.union(right)
    if not union:
        return 0.0
    return len(left.intersection(right)) / len(union)


def roadmap_direction_similarity(
    roadmap: dict[str, Any],
    target_role: str,
    target_industry: str,
    incoming_milestones: list[dict[str, Any]],
) -> float:
    requested_signature = roadmap_text_signature(f"{target_role} {target_industry}")
    existing_signature = roadmap_text_signature(f"{roadmap.get('target_role', '')} {roadmap.get('target_industry', '')}")
    role_similarity = jaccard_similarity(requested_signature, existing_signature)

    incoming_skills = roadmap_focus_skill_tokens(incoming_milestones)
    existing_skills = roadmap_focus_skill_tokens(roadmap.get("milestones") or [])
    skill_similarity = jaccard_similarity(incoming_skills, existing_skills)

    score = role_similarity * 0.62 + skill_similarity * 0.38
    requested_role_norm = normalize_search_text(target_role)
    existing_role_norm = normalize_search_text(safe_text(roadmap.get("target_role")))
    if requested_role_norm and existing_role_norm and requested_role_norm == existing_role_norm:
        score += 0.18
    return float(clamp_float(score, 0.0, 1.0))


def milestone_signature(milestone: dict[str, Any]) -> set[str]:
    title = safe_text(milestone.get("title"))
    detail = safe_text(milestone.get("detail"))
    return roadmap_text_signature(f"{title} {detail}")


def merge_goal_roadmap_milestones(
    existing_milestones: list[dict[str, Any]],
    incoming_milestones: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], int]:
    merged: list[dict[str, Any]] = [dict(item) for item in existing_milestones]
    merged_signatures = [milestone_signature(item) for item in merged]
    existing_skill_tokens = roadmap_focus_skill_tokens(merged)
    existing_title_index: dict[str, int] = {
        normalize_search_text(safe_text(item.get("title"))): index
        for index, item in enumerate(merged)
        if safe_text(item.get("title"))
    }
    added_count = 0

    for candidate in incoming_milestones:
        candidate_copy = dict(candidate)
        candidate_title_key = normalize_search_text(safe_text(candidate_copy.get("title")))
        candidate_signature = milestone_signature(candidate_copy)
        candidate_focus = roadmap_focus_skill_tokens([candidate_copy])

        duplicate_index: int | None = None
        if candidate_title_key and candidate_title_key in existing_title_index:
            duplicate_index = existing_title_index[candidate_title_key]
        elif candidate_signature:
            for index, existing_signature in enumerate(merged_signatures):
                if jaccard_similarity(candidate_signature, existing_signature) >= 0.68:
                    duplicate_index = index
                    break

        if duplicate_index is not None:
            existing_item = merged[duplicate_index]
            if not safe_text(existing_item.get("why")) and safe_text(candidate_copy.get("why")):
                existing_item["why"] = safe_text(candidate_copy.get("why"))
            if not safe_text(existing_item.get("done_when")) and safe_text(candidate_copy.get("done_when")):
                existing_item["done_when"] = safe_text(candidate_copy.get("done_when"))
            if not safe_text(existing_item.get("timeframe")) and safe_text(candidate_copy.get("timeframe")):
                existing_item["timeframe"] = safe_text(candidate_copy.get("timeframe"))
            merged_skills = dedupe_preserve_order(
                [
                    *[safe_text(skill) for skill in (existing_item.get("focus_skills") or [])],
                    *[safe_text(skill) for skill in (candidate_copy.get("focus_skills") or [])],
                ]
            )[:5]
            existing_item["focus_skills"] = merged_skills
            existing_skill_tokens.update(roadmap_focus_skill_tokens([existing_item]))
            merged_signatures[duplicate_index] = milestone_signature(existing_item)
            continue

        has_new_focus_skill = bool(candidate_focus - existing_skill_tokens)
        candidate_is_distinct = jaccard_similarity(candidate_signature, set().union(*merged_signatures) if merged_signatures else set()) < 0.34
        if not has_new_focus_skill and not candidate_is_distinct:
            continue

        merged.append(candidate_copy)
        merged_signatures.append(candidate_signature)
        if candidate_title_key:
            existing_title_index[candidate_title_key] = len(merged) - 1
        existing_skill_tokens.update(candidate_focus)
        added_count += 1

    return merged[:18], added_count


def pick_goal_roadmap_for_update(
    existing_roadmaps: list[dict[str, Any]],
    target_role: str,
    target_industry: str,
    incoming_milestones: list[dict[str, Any]],
) -> tuple[dict[str, Any] | None, float]:
    if not existing_roadmaps:
        return None, 0.0

    best_match: dict[str, Any] | None = None
    best_score = 0.0
    for roadmap in existing_roadmaps:
        score = roadmap_direction_similarity(roadmap, target_role, target_industry, incoming_milestones)
        if score > best_score:
            best_score = score
            best_match = roadmap
    if best_match is None:
        return None, 0.0
    if best_score < 0.42:
        return None, best_score
    return best_match, best_score


def upsert_goal_roadmap_for_user(connection: AuthDBConnection, user_id: int, data: GoalRoadmapUpsertRequest) -> dict[str, Any]:
    goal_title = safe_text(data.goal_title).strip() or "Reach your target role"
    goal_context = safe_text(data.goal_context).strip()
    target_role = safe_text(data.target_role).strip()
    target_industry = safe_text(data.target_industry).strip()
    target_score = normalize_goal_roadmap_score(data.target_score)
    current_score = normalize_goal_roadmap_score(data.current_score)
    incoming_milestones = normalize_goal_roadmap_milestones(data.milestones, None)
    now = now_utc_iso()

    existing_roadmaps = fetch_goal_roadmaps_for_user(connection, int(user_id), limit=32)
    matched_roadmap, similarity_score = pick_goal_roadmap_for_update(
        existing_roadmaps,
        target_role,
        target_industry,
        incoming_milestones,
    )

    cursor = connection.cursor()
    action = "created_first_track"
    created_new_track = False
    added_milestones = len(incoming_milestones)
    roadmap_id: int

    if matched_roadmap:
        existing_completion: dict[str, dict[str, Any]] = {}
        for milestone in matched_roadmap.get("milestones") or []:
            existing_completion[safe_text(milestone.get("id"))] = {
                "completed": bool(milestone.get("completed")),
                "completed_at": safe_text(milestone.get("completed_at")),
                "evidence_note": safe_text(milestone.get("evidence_note")),
                "evidence_link": safe_text(milestone.get("evidence_link")),
                "evidence_updated_at": safe_text(milestone.get("evidence_updated_at")),
            }

        merged_raw, added_milestones = merge_goal_roadmap_milestones(matched_roadmap.get("milestones") or [], incoming_milestones)
        merged_milestones = normalize_goal_roadmap_milestones(merged_raw, existing_completion)
        roadmap_id = int(matched_roadmap["id"])
        action = "merged_missing_skills" if added_milestones > 0 else "no_new_missing_skills"

        cursor.execute(
            """
            UPDATE user_goal_roadmaps
            SET
                goal_title = ?,
                goal_context = ?,
                target_role = ?,
                target_industry = ?,
                target_score = ?,
                current_score = ?,
                milestones_json = ?,
                updated_at = ?
            WHERE user_id = ? AND id = ?
            """,
            (
                goal_title or safe_text(matched_roadmap.get("goal_title")),
                goal_context or safe_text(matched_roadmap.get("goal_context")),
                target_role or safe_text(matched_roadmap.get("target_role")),
                target_industry or safe_text(matched_roadmap.get("target_industry")),
                target_score if target_score is not None else matched_roadmap.get("target_score"),
                current_score if current_score is not None else matched_roadmap.get("current_score"),
                json.dumps(merged_milestones, ensure_ascii=False, separators=(",", ":"), default=str),
                now,
                int(user_id),
                roadmap_id,
            ),
        )
    else:
        created_new_track = bool(existing_roadmaps)
        action = "created_new_track" if created_new_track else "created_first_track"
        cursor.execute(
            """
            INSERT INTO user_goal_roadmaps (
                user_id,
                goal_title,
                goal_context,
                target_role,
                target_industry,
                target_score,
                current_score,
                milestones_json,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                int(user_id),
                goal_title,
                goal_context,
                target_role,
                target_industry,
                target_score,
                current_score,
                json.dumps(incoming_milestones, ensure_ascii=False, separators=(",", ":"), default=str),
                now,
                now,
            ),
        )
        roadmap_id = inserted_row_id(connection, cursor)

    roadmap = fetch_goal_roadmap_for_user(connection, int(user_id), roadmap_id=roadmap_id)
    if not roadmap:
        raise HTTPException(status_code=500, detail="Unable to persist roadmap right now.")
    roadmaps = fetch_goal_roadmaps_for_user(connection, int(user_id), limit=32)
    return {
        "roadmap": roadmap,
        "roadmaps": roadmaps,
        "action": action,
        "created_new_track": created_new_track,
        "added_milestones": int(max(0, added_milestones)),
        "similarity_score": round(float(similarity_score), 3),
    }


def preview_goal_roadmap_upsert_for_user(connection: AuthDBConnection, user_id: int, data: GoalRoadmapUpsertRequest) -> dict[str, Any]:
    goal_title = safe_text(data.goal_title).strip() or "Reach your target role"
    target_role = safe_text(data.target_role).strip()
    target_industry = safe_text(data.target_industry).strip()
    incoming_milestones = normalize_goal_roadmap_milestones(data.milestones, None)

    existing_roadmaps = fetch_goal_roadmaps_for_user(connection, int(user_id), limit=32)
    matched_roadmap, similarity_score = pick_goal_roadmap_for_update(
        existing_roadmaps,
        target_role,
        target_industry,
        incoming_milestones,
    )

    if matched_roadmap:
        merged_raw, added_milestones = merge_goal_roadmap_milestones(
            matched_roadmap.get("milestones") or [],
            incoming_milestones,
        )
        merged_milestones = normalize_goal_roadmap_milestones(merged_raw, None)
        existing_ids = {safe_text(item.get("id")) for item in (matched_roadmap.get("milestones") or [])}
        added_titles = [safe_text(item.get("title")) for item in merged_milestones if safe_text(item.get("id")) not in existing_ids][:6]
        action = "merged_missing_skills" if added_milestones > 0 else "no_new_missing_skills"
        return {
            "action": action,
            "created_new_track": False,
            "matched_roadmap_id": int(matched_roadmap["id"]),
            "matched_track_title": safe_text(matched_roadmap.get("goal_title")) or "Existing track",
            "incoming_milestones": len(incoming_milestones),
            "added_milestones": int(max(0, added_milestones)),
            "resulting_total_milestones": len(merged_milestones),
            "similarity_score": round(float(similarity_score), 3),
            "added_titles": [title for title in added_titles if title],
            "summary": (
                "No new missing-skill milestones detected. Existing roadmap will remain unchanged."
                if action == "no_new_missing_skills"
                else f"{added_milestones} missing-skill milestone(s) will be added to your matched roadmap track."
            ),
        }

    created_new_track = bool(existing_roadmaps)
    return {
        "action": "created_new_track" if created_new_track else "created_first_track",
        "created_new_track": created_new_track,
        "matched_roadmap_id": None,
        "matched_track_title": None,
        "incoming_milestones": len(incoming_milestones),
        "added_milestones": len(incoming_milestones),
        "resulting_total_milestones": len(incoming_milestones),
        "similarity_score": round(float(similarity_score), 3),
        "added_titles": [safe_text(item.get("title")) for item in incoming_milestones[:6] if safe_text(item.get("title"))],
        "summary": (
            "A separate roadmap track will be created for this new direction."
            if created_new_track
            else f"Your first roadmap track '{goal_title}' will be created."
        ),
    }


def update_goal_roadmap_milestone_evidence_for_user(
    connection: AuthDBConnection,
    user_id: int,
    milestone_id: str,
    note: str | None,
    link: str | None,
    roadmap_id: int | None = None,
) -> dict[str, Any]:
    existing_row = fetch_goal_roadmap_row_for_user(connection, user_id, roadmap_id=roadmap_id)
    if not existing_row:
        raise HTTPException(status_code=404, detail="Roadmap not found for this account.")

    roadmap = serialize_goal_roadmap_row(existing_row)
    target_id = sanitize_goal_roadmap_milestone_id(milestone_id, 1)
    sanitized_note = sanitize_goal_roadmap_meta_text(note, 420)
    sanitized_link = sanitize_goal_roadmap_evidence_link(link)
    now = now_utc_iso()
    found = False

    for milestone in roadmap["milestones"]:
        if safe_text(milestone.get("id")) != target_id:
            continue
        has_payload = bool(sanitized_note or sanitized_link)
        milestone["evidence_note"] = sanitized_note or None
        milestone["evidence_link"] = sanitized_link or None
        milestone["evidence_updated_at"] = now if has_payload else None
        found = True
        break

    if not found:
        raise HTTPException(status_code=404, detail="Milestone not found in roadmap.")

    cursor = connection.cursor()
    cursor.execute(
        """
        UPDATE user_goal_roadmaps
        SET milestones_json = ?, updated_at = ?
        WHERE user_id = ? AND id = ?
        """,
        (
            json.dumps(roadmap["milestones"], ensure_ascii=False, separators=(",", ":"), default=str),
            now,
            int(user_id),
            int(roadmap["id"]),
        ),
    )

    refreshed = fetch_goal_roadmap_for_user(connection, int(user_id), roadmap_id=int(roadmap["id"]))
    if not refreshed:
        raise HTTPException(status_code=500, detail="Unable to refresh roadmap right now.")
    return {
        "roadmap": refreshed,
        "roadmaps": fetch_goal_roadmaps_for_user(connection, int(user_id), limit=32),
    }


def toggle_goal_roadmap_milestone_for_user(
    connection: AuthDBConnection,
    user_id: int,
    milestone_id: str,
    completed: bool,
    roadmap_id: int | None = None,
) -> dict[str, Any]:
    existing_row = fetch_goal_roadmap_row_for_user(connection, user_id, roadmap_id=roadmap_id)
    if not existing_row:
        raise HTTPException(status_code=404, detail="Roadmap not found for this account.")

    roadmap = serialize_goal_roadmap_row(existing_row)
    target_id = sanitize_goal_roadmap_milestone_id(milestone_id, 1)
    found = False
    now = now_utc_iso()

    for milestone in roadmap["milestones"]:
        if safe_text(milestone.get("id")) != target_id:
            continue
        milestone["completed"] = bool(completed)
        if completed:
            existing_completed_at = safe_text(milestone.get("completed_at"))
            milestone["completed_at"] = existing_completed_at or now
        else:
            milestone["completed_at"] = None
        found = True
        break

    if not found:
        raise HTTPException(status_code=404, detail="Milestone not found in roadmap.")

    cursor = connection.cursor()
    cursor.execute(
        """
        UPDATE user_goal_roadmaps
        SET milestones_json = ?, updated_at = ?
        WHERE user_id = ? AND id = ?
        """,
        (
            json.dumps(roadmap["milestones"], ensure_ascii=False, separators=(",", ":"), default=str),
            now,
            int(user_id),
            int(roadmap["id"]),
        ),
    )

    refreshed = fetch_goal_roadmap_for_user(connection, int(user_id), roadmap_id=int(roadmap["id"]))
    if not refreshed:
        raise HTTPException(status_code=500, detail="Unable to refresh roadmap right now.")
    return {
        "roadmap": refreshed,
        "roadmaps": fetch_goal_roadmaps_for_user(connection, int(user_id), limit=32),
    }


def save_analysis_report(
    user_id: int,
    source: str,
    industry: str,
    role: str,
    report_payload: dict[str, Any],
) -> int | None:
    overall_score: int | None = None
    raw_score = report_payload.get("overall_score")
    if raw_score is not None:
        try:
            overall_score = int(clamp_float(float(raw_score), 0, 100))
        except Exception:
            overall_score = None

    shortlist_prediction = safe_text(str(report_payload.get("shortlist_prediction", "")))[:120]
    report_json = json.dumps(report_payload, ensure_ascii=False, separators=(",", ":"), default=str)

    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            cursor.execute(
                """
                INSERT INTO analysis_reports (
                    user_id,
                    source,
                    industry,
                    role,
                    overall_score,
                    shortlist_prediction,
                    report_json,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    safe_text(source) or "manual_input",
                    safe_text(industry),
                    safe_text(role),
                    overall_score,
                    shortlist_prediction,
                    report_json,
                    now_utc_iso(),
                ),
            )
            report_id = inserted_row_id(connection, cursor)
            connection.commit()
            return report_id
        except Exception:
            connection.rollback()
            logger.exception("Failed to save analysis report for user %s", user_id)
            return None
        finally:
            connection.close()


def collect_analysis_reports_for_user(connection: AuthDBConnection, user_id: int, limit: int) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT id, user_id, source, industry, role, overall_score, shortlist_prediction, created_at
        FROM analysis_reports
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT ?
        """,
        (user_id, limit),
    ).fetchall()
    return [serialize_analysis_report_row(row) for row in rows]


def fetch_analysis_report_for_user(connection: AuthDBConnection, user_id: int, report_id: int) -> Any:
    return connection.execute(
        """
        SELECT id, user_id, source, industry, role, overall_score, shortlist_prediction, report_json, created_at
        FROM analysis_reports
        WHERE id = ? AND user_id = ?
        LIMIT 1
        """,
        (report_id, user_id),
    ).fetchone()


def normalize_chat_message_body(message: str) -> str:
    raw = safe_text(message).replace("\r\n", "\n").replace("\r", "\n")
    cleaned_lines = [line.strip() for line in raw.split("\n")]
    cleaned = "\n".join(line for line in cleaned_lines if line).strip()
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    if len(cleaned) > 1800:
        cleaned = cleaned[:1800].rstrip()
    return cleaned


def serialize_chat_message_row(row: Any) -> dict[str, Any]:
    sender_role = safe_text(row["sender_role"]).lower()
    return {
        "id": int(row["id"]),
        "user_id": int(row["user_id"]),
        "sender_role": sender_role,
        "message": safe_text(row["message"]),
        "read_by_user": bool(int(row["read_by_user"] or 0)),
        "read_by_admin": bool(int(row["read_by_admin"] or 0)),
        "created_at": safe_text(row["created_at"]),
    }


def collect_chat_messages_for_user(connection: AuthDBConnection, user_id: int, limit: int | None = 200) -> list[dict[str, Any]]:
    query = """
        SELECT id, user_id, sender_role, message, read_by_user, read_by_admin, created_at
        FROM user_chat_messages
        WHERE user_id = ?
        ORDER BY id DESC
    """
    params: tuple[Any, ...] = (int(user_id),)
    if limit is not None:
        query += "\nLIMIT ?"
        params = (int(user_id), int(limit))
    rows = connection.execute(query, params).fetchall()
    messages = [serialize_chat_message_row(row) for row in rows]
    messages.reverse()
    return messages


def insert_chat_message(
    connection: AuthDBConnection,
    user_id: int,
    sender_role: str,
    message: str,
    read_by_user: bool,
    read_by_admin: bool,
) -> dict[str, Any]:
    cursor = connection.cursor()
    cursor.execute(
        """
        INSERT INTO user_chat_messages (user_id, sender_role, message, read_by_user, read_by_admin, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            int(user_id),
            safe_text(sender_role).lower(),
            message,
            1 if read_by_user else 0,
            1 if read_by_admin else 0,
            now_utc_iso(),
        ),
    )
    message_id = inserted_row_id(connection, cursor)
    row = connection.execute(
        """
        SELECT id, user_id, sender_role, message, read_by_user, read_by_admin, created_at
        FROM user_chat_messages
        WHERE id = ?
        LIMIT 1
        """,
        (message_id,),
    ).fetchone()
    if not row:
        raise RuntimeError("Unable to load inserted chat message.")
    return serialize_chat_message_row(row)


def collect_admin_chat_threads(
    connection: AuthDBConnection,
    q: str | None = None,
    limit: int | None = 120,
) -> list[dict[str, Any]]:
    search = safe_text(q).lower()
    filters: list[str] = []
    values: list[Any] = []
    if search:
        filters.append(
            "(lower(u.email) LIKE ? OR lower(u.full_name) LIKE ? OR lower(COALESCE(g.contact_email, '')) LIKE ? OR lower(COALESCE(g.contact_name, '')) LIKE ?)"
        )
        values.extend([f"%{search}%", f"%{search}%", f"%{search}%", f"%{search}%"])
    where_sql = f"WHERE {' AND '.join(filters)}" if filters else ""

    query = f"""
        SELECT
            u.id AS user_id,
            COALESCE(NULLIF(g.contact_name, ''), u.full_name) AS display_name,
            COALESCE(NULLIF(g.contact_email, ''), u.email) AS display_email,
            u.plan_tier,
            u.credits,
            stats.total_messages,
            stats.unread_by_admin,
            stats.unread_by_user,
            COALESCE(last_msg.sender_role, '') AS last_sender_role,
            COALESCE(last_msg.message, '') AS last_message,
            COALESCE(last_msg.created_at, '') AS last_created_at
        FROM users u
        LEFT JOIN guest_chat_profiles g ON g.user_id = u.id
        INNER JOIN (
            SELECT
                m.user_id,
                COUNT(*) AS total_messages,
                SUM(CASE WHEN m.sender_role = 'user' AND m.read_by_admin = 0 THEN 1 ELSE 0 END) AS unread_by_admin,
                SUM(CASE WHEN m.sender_role = 'admin' AND m.read_by_user = 0 THEN 1 ELSE 0 END) AS unread_by_user,
                MAX(m.id) AS last_message_id
            FROM user_chat_messages m
            GROUP BY m.user_id
        ) stats ON stats.user_id = u.id
        LEFT JOIN user_chat_messages last_msg ON last_msg.id = stats.last_message_id
        {where_sql}
        ORDER BY stats.last_message_id DESC
    """
    if limit is not None:
        query += "\nLIMIT ?"
        values.append(int(limit))
    rows = connection.execute(query, tuple(values)).fetchall()
    threads: list[dict[str, Any]] = []
    for row in rows:
        threads.append(
            {
                "user_id": int(row["user_id"]),
                "name": safe_text(row["display_name"]) or display_name_from_email(str(row["display_email"])),
                "email": safe_text(row["display_email"]),
                "plan": normalize_plan_tier(safe_text(row["plan_tier"])),
                "credits": int(row["credits"] or 0),
                "total_messages": int(row["total_messages"] or 0),
                "unread_by_admin": int(row["unread_by_admin"] or 0),
                "unread_by_user": int(row["unread_by_user"] or 0),
                "last_sender_role": safe_text(row["last_sender_role"]),
                "last_message": safe_text(row["last_message"]),
                "last_created_at": safe_text(row["last_created_at"]),
            }
        )
    return threads


def collect_admin_interview_simulator_users(
    connection: AuthDBConnection,
    limit: int = 5000,
) -> list[dict[str, Any]]:
    safe_limit = int(clamp_float(float(limit), 1, 50000))
    try:
        rows = connection.execute(
            """
            SELECT
                e.user_id,
                u.full_name,
                u.email,
                e.meta_json,
                e.created_at
            FROM analytics_events e
            LEFT JOIN users u ON u.id = e.user_id
            WHERE e.event_type = 'interview' AND e.event_name = 'interview_simulator_started'
            ORDER BY e.id DESC
            LIMIT ?
            """,
            (safe_limit,),
        ).fetchall()
    except Exception:
        logger.exception("Admin interview simulator users query failed.")
        return []

    aggregate: dict[str, dict[str, Any]] = {}
    for row in rows:
        meta = parse_meta_json(row["meta_json"])
        user_id_raw = row["user_id"] if row["user_id"] is not None else None
        user_id = int(user_id_raw) if user_id_raw is not None else None
        profile_name = safe_text(row["full_name"]).strip()
        email = safe_text(row["email"]).strip()
        candidate_name = safe_text(meta.get("candidate_name")).strip()
        role = safe_text(meta.get("role")).strip()
        industry = safe_text(meta.get("industry")).strip()
        created_at = safe_text(row["created_at"]).strip()
        guest_mode = bool(meta.get("guest_mode")) or user_id is None
        display_name = profile_name or candidate_name or (display_name_from_email(email) if email else "Guest user")
        aggregate_key = (
            f"user:{user_id}"
            if user_id is not None
            else f"guest:{normalize_token(display_name)}:{normalize_token(role)}:{normalize_token(industry)}"
        )

        existing = aggregate.get(aggregate_key)
        if not existing:
            aggregate[aggregate_key] = {
                "user_id": user_id,
                "name": display_name,
                "email": email,
                "guest_mode": guest_mode,
                "runs": 1,
                "last_run_at": created_at,
                "role": role,
                "industry": industry,
            }
            continue

        existing["runs"] = int(existing.get("runs") or 0) + 1
        if created_at and created_at > safe_text(existing.get("last_run_at")):
            existing["last_run_at"] = created_at
            if role:
                existing["role"] = role
            if industry:
                existing["industry"] = industry
        if not safe_text(existing.get("name")) and display_name:
            existing["name"] = display_name
        if not safe_text(existing.get("email")) and email:
            existing["email"] = email

    users = list(aggregate.values())
    users.sort(
        key=lambda item: (
            -int(item.get("runs") or 0),
            safe_text(item.get("last_run_at")),
            safe_text(item.get("name")).lower(),
        ),
    )
    return users


def collect_admin_analytics_summary(connection: sqlite3.Connection) -> dict[str, Any]:
    cutoff_24h = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    def scalar_int(query: str, params: tuple[Any, ...] = (), key: str = "count", default: int = 0) -> int:
        try:
            row = connection.execute(query, params).fetchone()
            if not row:
                return int(default)
            try:
                raw_value = row[key]
            except Exception:
                raw_value = row[0] if isinstance(row, (tuple, list)) and row else default
            return int(raw_value or 0)
        except Exception:
            logger.exception("Admin analytics query failed: %s", query.strip().split("\n")[0][:140])
            return int(default)

    def scalar_float(query: str, params: tuple[Any, ...] = (), key: str = "value", default: float = 0.0) -> float:
        try:
            row = connection.execute(query, params).fetchone()
            if not row:
                return float(default)
            try:
                raw_value = row[key]
            except Exception:
                raw_value = row[0] if isinstance(row, (tuple, list)) and row else default
            return float(raw_value or 0.0)
        except Exception:
            logger.exception("Admin analytics query failed: %s", query.strip().split("\n")[0][:140])
            return float(default)

    users_total = scalar_int("SELECT COUNT(*) AS count FROM users")
    real_users_total = scalar_int(
        "SELECT COUNT(*) AS count FROM users WHERE lower(email) NOT LIKE ?",
        (f"%{GUEST_SYSTEM_EMAIL_SUFFIX}",),
    )
    guest_users_total = max(0, users_total - real_users_total)
    feedback_total = scalar_int("SELECT COUNT(*) AS count FROM user_feedback")
    feedback_avg = round(scalar_float("SELECT COALESCE(AVG(rating), 0) AS value FROM user_feedback", key="value"), 2)
    signups_total = scalar_int(
        "SELECT COUNT(*) AS count FROM analytics_events WHERE event_type = 'auth' AND event_name = 'signup_success'"
    )
    logins_total = scalar_int(
        "SELECT COUNT(*) AS count FROM analytics_events WHERE event_type = 'auth' AND event_name = 'login_success'"
    )
    analyses_total = scalar_int("SELECT COUNT(*) AS count FROM credit_transactions WHERE action = 'analyze'")
    payments_total = scalar_int(
        "SELECT COUNT(*) AS count FROM credit_transactions WHERE action IN ('stripe_credit_pack', 'razorpay_credit_pack')"
    )
    credits_sold = scalar_int(
        "SELECT COALESCE(SUM(delta), 0) AS sold FROM credit_transactions WHERE action IN ('stripe_credit_pack', 'razorpay_credit_pack')",
        key="sold",
    )
    try:
        payment_rows = connection.execute(
            "SELECT meta_json FROM credit_transactions WHERE action IN ('stripe_credit_pack', 'razorpay_credit_pack')"
        ).fetchall()
    except Exception:
        logger.exception("Admin analytics payment meta query failed.")
        payment_rows = []
    roadmaps_total = scalar_int("SELECT COUNT(*) AS count FROM user_goal_roadmaps")
    reports_total = scalar_int("SELECT COUNT(*) AS count FROM analysis_reports")
    signups_24h = scalar_int(
        "SELECT COUNT(*) AS count FROM analytics_events WHERE event_type = 'auth' AND event_name = 'signup_success' AND created_at >= ?",
        (cutoff_24h,),
    )
    logins_24h = scalar_int(
        "SELECT COUNT(*) AS count FROM analytics_events WHERE event_type = 'auth' AND event_name = 'login_success' AND created_at >= ?",
        (cutoff_24h,),
    )
    analyses_24h = scalar_int(
        "SELECT COUNT(*) AS count FROM credit_transactions WHERE action = 'analyze' AND created_at >= ?",
        (cutoff_24h,),
    )
    failed_logins_24h = scalar_int(
        "SELECT COUNT(*) AS count FROM analytics_events WHERE event_type = 'auth' AND event_name LIKE 'login_failed%' AND created_at >= ?",
        (cutoff_24h,),
    )
    interview_simulator_runs_total = scalar_int(
        "SELECT COUNT(*) AS count FROM analytics_events WHERE event_type = 'interview' AND event_name = 'interview_simulator_started'"
    )
    interview_simulator_users = collect_admin_interview_simulator_users(connection, limit=5000)

    revenue_inr = 0
    for row in payment_rows:
        meta = parse_meta_json(row["meta_json"])
        revenue_inr += int(meta.get("amount_inr") or 0)

    try:
        started_at = datetime.fromisoformat(APP_STARTED_AT)
        uptime_minutes = int(max(0.0, (datetime.now(timezone.utc) - started_at).total_seconds()) // 60)
    except Exception:
        uptime_minutes = 0

    async_counts = {"queued": 0, "running": 0, "succeeded": 0, "failed": 0}
    with ASYNC_JOB_LOCK:
        for job in ASYNC_JOB_STORE.values():
            status = safe_text(job.get("status")) or "queued"
            if status not in async_counts:
                continue
            async_counts[status] += 1

    return {
        "users_total": users_total,
        "real_users_total": real_users_total,
        "guest_users_total": guest_users_total,
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
        "roadmaps_total": roadmaps_total,
        "reports_total": reports_total,
        "signups_24h": signups_24h,
        "logins_24h": logins_24h,
        "analyses_24h": analyses_24h,
        "failed_logins_24h": failed_logins_24h,
        "interview_simulator_runs_total": interview_simulator_runs_total,
        "interview_simulator_users_total": len(interview_simulator_users),
        "interview_simulator_users": interview_simulator_users,
        "backend_uptime_minutes": uptime_minutes,
        "async_jobs_queued": async_counts["queued"],
        "async_jobs_running": async_counts["running"],
        "async_jobs_succeeded": async_counts["succeeded"],
        "async_jobs_failed": async_counts["failed"],
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


def analysis_scalar_text(value: Any, max_len: int = 180) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (int, float)):
        numeric = float(value)
        if abs(numeric - round(numeric)) < 1e-6:
            return str(int(round(numeric)))
        return f"{numeric:.2f}".rstrip("0").rstrip(".")
    if isinstance(value, list):
        joined = ", ".join(analysis_scalar_text(item, 42) for item in value[:4] if analysis_scalar_text(item, 42))
        return safe_text(joined)[:max_len]
    if isinstance(value, dict):
        compact = []
        for key in list(value.keys())[:4]:
            label = safe_text(str(key)).replace("_", " ").strip().title()
            raw = analysis_scalar_text(value.get(key), 42)
            if label and raw:
                compact.append(f"{label}: {raw}")
        return safe_text(" | ".join(compact))[:max_len]
    return safe_text(str(value))[:max_len]


def analysis_list_items(value: Any, limit: int = 8, max_item_len: int = 180) -> list[str]:
    if isinstance(value, list):
        if any(isinstance(item, dict) for item in value):
            dict_lines = analysis_action_lines(value, limit=limit, max_item_len=max_item_len)
            if dict_lines:
                return dict_lines[:limit]

    items = normalize_string_list(value, limit=limit, max_item_len=max_item_len)
    if items:
        return items
    if isinstance(value, dict):
        result: list[str] = []
        for key in list(value.keys())[:limit]:
            label = safe_text(str(key)).replace("_", " ").strip().title()
            raw = analysis_scalar_text(value.get(key), max_len=max_item_len)
            if label and raw:
                result.append(f"{label}: {raw}")
        return result[:limit]
    text = analysis_scalar_text(value, max_len=max_item_len)
    return [text] if text else []


def analysis_dict_lines(value: Any, preferred_keys: list[str], limit: int = 8, max_item_len: int = 180) -> list[str]:
    if not isinstance(value, dict):
        return analysis_list_items(value, limit=limit, max_item_len=max_item_len)
    lines: list[str] = []
    used: set[str] = set()
    ordered_keys = [*preferred_keys, *[key for key in value.keys() if key not in preferred_keys]]
    for key in ordered_keys:
        if key in used:
            continue
        used.add(key)
        label = safe_text(str(key)).replace("_", " ").strip().title()
        raw_value = value.get(key)
        if isinstance(raw_value, list):
            nested = normalize_string_list(raw_value, limit=3, max_item_len=110)
            if nested:
                lines.append(f"{label}: {', '.join(nested)}")
        else:
            scalar = analysis_scalar_text(raw_value, max_len=max_item_len)
            if scalar:
                lines.append(f"{label}: {scalar}")
        if len(lines) >= limit:
            break
    return lines[:limit]


def analysis_action_lines(value: Any, limit: int = 5, max_item_len: int = 180) -> list[str]:
    if not isinstance(value, list):
        return analysis_list_items(value, limit=limit, max_item_len=max_item_len)
    lines: list[str] = []
    for item in value:
        if isinstance(item, dict):
            step = safe_text(str(item.get("step_label") or item.get("priority") or item.get("step") or "")).strip()
            title = safe_text(str(item.get("title") or item.get("focus") or "")).strip()
            action = safe_text(str(item.get("action") or item.get("task") or "")).strip()
            if step:
                if title:
                    line = f"{step}: {title}"
                elif action:
                    line = f"{step}: {action}"
                else:
                    line = step
                if title and action and normalize_search_text(title) != normalize_search_text(action):
                    line = f"{line} - {action}"
            else:
                line = " - ".join(part for part in [title, action] if part).strip(" -")
        else:
            line = safe_text(str(item)).strip()
        if not line:
            continue
        clipped = line[:max_item_len]
        if clipped not in lines:
            lines.append(clipped)
        if len(lines) >= limit:
            break
    return lines[:limit]


def render_interview_simulator_report_pdf_bytes(report_payload: dict[str, Any], report_row: Any | None = None) -> bytes:
    output = io.BytesIO()
    doc = SimpleDocTemplate(
        output,
        pagesize=A4,
        leftMargin=44,
        rightMargin=44,
        topMargin=42,
        bottomMargin=34,
        title="HireScore Interview Simulator Report",
        author="HireScore AI",
    )

    sample = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "simulator_title",
        parent=sample["Title"],
        fontName="Helvetica-Bold",
        fontSize=21,
        leading=25,
        textColor=colors.HexColor("#0D2D47"),
        spaceAfter=3,
    )
    subtitle_style = ParagraphStyle(
        "simulator_subtitle",
        parent=sample["Normal"],
        fontName="Helvetica",
        fontSize=9.6,
        leading=12.2,
        textColor=colors.HexColor("#4A6A80"),
        spaceAfter=12,
    )
    section_style = ParagraphStyle(
        "simulator_section",
        parent=sample["Heading3"],
        fontName="Helvetica-Bold",
        fontSize=11.5,
        leading=14,
        textColor=colors.HexColor("#145B87"),
        spaceBefore=9,
        spaceAfter=4,
    )
    body_style = ParagraphStyle(
        "simulator_body",
        parent=sample["Normal"],
        fontName="Helvetica",
        fontSize=10,
        leading=14,
        textColor=colors.HexColor("#1E3F56"),
        spaceAfter=3,
    )
    bullet_style = ParagraphStyle(
        "simulator_bullet",
        parent=sample["Normal"],
        fontName="Helvetica",
        fontSize=9.9,
        leading=13.2,
        textColor=colors.HexColor("#1E3F56"),
        leftIndent=14,
        bulletIndent=4,
        spaceAfter=2,
    )
    metric_label_style = ParagraphStyle(
        "simulator_metric_label",
        parent=sample["Normal"],
        fontName="Helvetica-Bold",
        fontSize=9.3,
        leading=12,
        textColor=colors.HexColor("#0E2A43"),
    )
    metric_value_style = ParagraphStyle(
        "simulator_metric_value",
        parent=sample["Normal"],
        fontName="Helvetica",
        fontSize=9.6,
        leading=12.2,
        textColor=colors.HexColor("#264B63"),
    )

    report_summary = report_payload.get("report") if isinstance(report_payload.get("report"), dict) else report_payload
    role = safe_text(str(report_payload.get("role") or (report_row["role"] if report_row else "")))
    industry = safe_text(str(report_payload.get("industry") or (report_row["industry"] if report_row else "")))
    candidate_name = safe_text(str(report_payload.get("candidate_name") or "Candidate"))
    interviewer_name = safe_text(str(report_payload.get("interviewer_name") or "Avery Bennett"))
    created_at = safe_text(
        str((report_payload.get("completed_at") or report_payload.get("created_at") or (report_row["created_at"] if report_row else "") or now_utc_iso()))
    )
    overall_score = int(clamp_float(float(report_summary.get("overall_score") or 0), 0.0, 100.0))
    readiness = safe_text(report_summary.get("readiness_label") or report_payload.get("readiness_label") or "medium").replace("_", " ").title()
    screening_decision = safe_text(report_summary.get("screening_decision") or report_payload.get("screening_decision")).strip().lower()
    screening_decision_reason = safe_text(report_summary.get("screening_decision_reason") or report_payload.get("screening_decision_reason"))
    score_breakdown = report_summary.get("score_breakdown") if isinstance(report_summary.get("score_breakdown"), dict) else {}
    turns = report_payload.get("turns") if isinstance(report_payload.get("turns"), list) else []
    stage_summaries = report_summary.get("stage_summaries") if isinstance(report_summary.get("stage_summaries"), list) else []

    story: list[Any] = []
    story.append(Paragraph("HireScore Interview Simulator Report", title_style))
    subtitle = (
        f"Candidate: {html.escape(candidate_name or 'Candidate')}  |  "
        f"Role: {html.escape(role or 'General')}  |  "
        f"Generated: {html.escape(created_at[:19].replace('T', ' '))}"
    )
    story.append(Paragraph(subtitle, subtitle_style))

    metrics_rows = [
        ("Overall Score", f"{overall_score}%"),
        ("Readiness", readiness or "Medium"),
        ("Round 1 Decision", "Shortlisted" if screening_decision == "shortlisted" else "Rejected" if screening_decision == "rejected" else "Pending"),
        ("Industry", industry or "General"),
        ("Interviewer", interviewer_name or "Avery Bennett"),
        ("Questions Answered", str(int(report_summary.get("turns_completed") or len(turns)))),
        ("Rounds Completed", str(int(report_summary.get("rounds_completed") or len(stage_summaries)))),
        ("Possible Rounds", str(int(report_summary.get("total_rounds") or len(INTERVIEW_SIMULATOR_STAGE_BLUEPRINTS)))),
    ]
    metrics_table = Table(
        [[Paragraph(html.escape(label), metric_label_style), Paragraph(html.escape(value), metric_value_style)] for label, value in metrics_rows],
        colWidths=[doc.width * 0.34, doc.width * 0.66],
    )
    metrics_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F5FAFE")),
                ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#BFD9EC")),
                ("INNERGRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#D5E6F3")),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    story.append(metrics_table)
    story.append(Spacer(1, 6))

    def add_section(title: str, items: list[str], bullet: bool = True) -> None:
        filtered = [safe_text(item)[:220] for item in items if safe_text(item)]
        if not filtered:
            return
        story.append(Paragraph(html.escape(title), section_style))
        story.append(HRFlowable(width="100%", color=colors.HexColor("#D5E6F3"), thickness=0.65, spaceBefore=0.6, spaceAfter=3))
        for item in filtered:
            if bullet:
                story.append(Paragraph(html.escape(item), bullet_style, bulletText="•"))
            else:
                story.append(Paragraph(html.escape(item), body_style))

    breakdown_lines = []
    for label, key in [
        ("Communication", "communication"),
        ("Clarity", "clarity"),
        ("Domain Depth", "domain_depth"),
        ("Confidence", "confidence"),
    ]:
        breakdown_lines.append(f"{label}: {int(clamp_float(float(score_breakdown.get(key) or 0), 0.0, 100.0))}%")
    add_section("Score Breakdown", breakdown_lines)
    if screening_decision or screening_decision_reason:
        add_section(
            "Screening Decision",
            [
                (
                    "Shortlisted for round 2."
                    if screening_decision == "shortlisted"
                    else "Rejected after screening."
                    if screening_decision == "rejected"
                    else "Screening decision pending."
                ),
                screening_decision_reason,
            ],
        )
    add_section("Strength Signals", analysis_list_items(report_summary.get("strength_signals"), limit=6, max_item_len=190))
    add_section("Improvement Signals", analysis_list_items(report_summary.get("improvement_signals"), limit=6, max_item_len=190))
    add_section("Next Steps", analysis_list_items(report_summary.get("next_steps"), limit=6, max_item_len=200))
    if stage_summaries:
        stage_lines = []
        for item in stage_summaries[:4]:
            label = safe_text(item.get("stage_label")) or "Round"
            round_number = int(item.get("stage_number") or 0)
            questions_in_round = int(item.get("question_count") or 0)
            average_score = int(clamp_float(float(item.get("average_score") or 0), 0.0, 100.0))
            stage_lines.append(f"Round {round_number} - {label}: {questions_in_round} question(s), average {average_score}%")
        add_section("Round Summary", stage_lines)

    opening_remark = safe_text(report_payload.get("opening_remark"))
    closing_remark = safe_text(report_payload.get("closing_remark"))
    if opening_remark:
        add_section("Opening", [opening_remark], bullet=False)
    if closing_remark:
        add_section("Closing", [closing_remark], bullet=False)

    if turns:
        story.append(Paragraph("Round Feedback", section_style))
        story.append(HRFlowable(width="100%", color=colors.HexColor("#D5E6F3"), thickness=0.65, spaceBefore=0.6, spaceAfter=4))
        for turn in turns[:10]:
            round_number = int(turn.get("round_number") or 0)
            stage_label = safe_text(turn.get("stage_label")) or f"Round {round_number}"
            question_number_in_stage = int(turn.get("question_number_in_stage") or 0)
            overall = int(clamp_float(float(((turn.get("scores") or {}).get("overall") or 0)), 0.0, 100.0))
            answer_time = int(turn.get("response_time_seconds") or 0)
            question = safe_text(turn.get("question"))[:220]
            summary = safe_text(turn.get("feedback_summary"))[:220]
            question_suffix = f" | Question {question_number_in_stage}" if question_number_in_stage > 0 else ""
            header = f"Round {round_number} - {stage_label}{question_suffix} | Score {overall}% | Answer Time {answer_time}s"
            story.append(Paragraph(html.escape(header), metric_label_style))
            if question:
                story.append(Paragraph(html.escape(f"Question: {question}"), body_style))
            if summary:
                story.append(Paragraph(html.escape(f"Feedback: {summary}"), body_style))
            strengths = normalize_string_list(turn.get("strengths"), limit=3, max_item_len=140)
            improvements = normalize_string_list(turn.get("improvements"), limit=3, max_item_len=140)
            if strengths:
                story.append(Paragraph(html.escape(f"Strengths: {', '.join(strengths)}"), body_style))
            if improvements:
                story.append(Paragraph(html.escape(f"Improve: {', '.join(improvements)}"), body_style))
            story.append(Spacer(1, 4))

    doc.build(story)
    return output.getvalue()


def render_analysis_report_pdf_bytes(report_payload: dict[str, Any], report_row: Any | None = None) -> bytes:
    output = io.BytesIO()
    doc = SimpleDocTemplate(
        output,
        pagesize=A4,
        leftMargin=44,
        rightMargin=44,
        topMargin=42,
        bottomMargin=34,
        title="HireScore Analysis Report",
        author="HireScore AI",
    )

    sample = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "analysis_title",
        parent=sample["Title"],
        fontName="Helvetica-Bold",
        fontSize=21,
        leading=25,
        textColor=colors.HexColor("#0D2D47"),
        spaceAfter=3,
    )
    subtitle_style = ParagraphStyle(
        "analysis_subtitle",
        parent=sample["Normal"],
        fontName="Helvetica",
        fontSize=9.6,
        leading=12.2,
        textColor=colors.HexColor("#4A6A80"),
        spaceAfter=12,
    )
    section_style = ParagraphStyle(
        "analysis_section",
        parent=sample["Heading3"],
        fontName="Helvetica-Bold",
        fontSize=11.5,
        leading=14,
        textColor=colors.HexColor("#145B87"),
        spaceBefore=9,
        spaceAfter=4,
    )
    body_style = ParagraphStyle(
        "analysis_body",
        parent=sample["Normal"],
        fontName="Helvetica",
        fontSize=10,
        leading=14,
        textColor=colors.HexColor("#1E3F56"),
        spaceAfter=3,
    )
    bullet_style = ParagraphStyle(
        "analysis_bullet",
        parent=sample["Normal"],
        fontName="Helvetica",
        fontSize=9.9,
        leading=13.2,
        textColor=colors.HexColor("#1E3F56"),
        leftIndent=14,
        bulletIndent=4,
        spaceAfter=2,
    )
    metric_label_style = ParagraphStyle(
        "analysis_metric_label",
        parent=sample["Normal"],
        fontName="Helvetica-Bold",
        fontSize=9.3,
        leading=12,
        textColor=colors.HexColor("#0E2A43"),
    )
    metric_value_style = ParagraphStyle(
        "analysis_metric_value",
        parent=sample["Normal"],
        fontName="Helvetica",
        fontSize=9.6,
        leading=12.2,
        textColor=colors.HexColor("#264B63"),
    )

    role = safe_text(str(report_payload.get("role") or (report_row["role"] if report_row else "")))
    industry = safe_text(str(report_payload.get("industry") or (report_row["industry"] if report_row else "")))
    created_at = safe_text(str((report_row["created_at"] if report_row else "") or report_payload.get("created_at") or now_utc_iso()))
    shortlist = safe_text(str(report_payload.get("shortlist_prediction", "")))
    source = safe_text(str(report_payload.get("source", ""))) or (safe_text(str(report_row["source"])) if report_row else "manual_input")
    overall_score = clamp_float(safe_float(report_payload.get("overall_score"), 0), 0.0, 100.0)
    confidence = clamp_float(safe_float(report_payload.get("confidence"), 0), 0.0, 100.0)
    skill_match = clamp_float(safe_float(report_payload.get("skill_match"), 0), 0.0, 100.0)
    ats_friendliness = clamp_float(safe_float(report_payload.get("ats_friendliness"), 0), 0.0, 100.0)

    story: list[Any] = []
    story.append(Paragraph("HireScore Analysis Report", title_style))
    subtitle = (
        f"Role: {html.escape(role or 'General')}  |  "
        f"Industry: {html.escape(industry or 'General')}  |  "
        f"Generated: {html.escape(created_at[:19].replace('T', ' '))}"
    )
    story.append(Paragraph(subtitle, subtitle_style))

    metrics_rows = [
        ("Overall Score", f"{int(round(overall_score))}%"),
        ("Skill Match", f"{int(round(skill_match))}%"),
        ("ATS Friendliness", f"{int(round(ats_friendliness))}%"),
        ("Confidence", f"{int(round(confidence))}%"),
        ("Shortlist Prediction", shortlist or "Not available"),
        ("Source", source.replace("_", " ").title()),
    ]
    metrics_table = Table(
        [[Paragraph(html.escape(label), metric_label_style), Paragraph(html.escape(value), metric_value_style)] for label, value in metrics_rows],
        colWidths=[doc.width * 0.34, doc.width * 0.66],
    )
    metrics_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F5FAFE")),
                ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#BFD9EC")),
                ("INNERGRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#D5E6F3")),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    story.append(metrics_table)
    story.append(Spacer(1, 6))

    def add_section(title: str, items: list[str], bullet: bool = True) -> None:
        filtered = [safe_text(item)[:200] for item in items if safe_text(item)]
        if not filtered:
            return
        story.append(Paragraph(html.escape(title), section_style))
        story.append(HRFlowable(width="100%", color=colors.HexColor("#D5E6F3"), thickness=0.65, spaceBefore=0.6, spaceAfter=3))
        for item in filtered:
            if bullet:
                story.append(Paragraph(html.escape(item), bullet_style, bulletText="•"))
            else:
                story.append(Paragraph(html.escape(item), body_style))

    semantic_summary = safe_text(str(report_payload.get("semantic_summary", "")))
    if semantic_summary:
        add_section("Summary", [semantic_summary], bullet=False)

    add_section("Why This Score", analysis_list_items(report_payload.get("prediction_reasoning"), limit=6, max_item_len=190))
    add_section("Priority Actions", analysis_list_items(report_payload.get("quick_wins"), limit=7, max_item_len=180))
    add_section("Critical Missing Skills", analysis_list_items(report_payload.get("critical_missing_skills"), limit=10, max_item_len=80))
    add_section("Strength Signals", analysis_list_items(report_payload.get("matched_core_skills") or report_payload.get("matched_keywords"), limit=10, max_item_len=80))

    strategy_payload = report_payload.get("ninety_plus_strategy")
    strategy_lines = analysis_dict_lines(
        strategy_payload,
        preferred_keys=[
            "target_score",
            "current_score",
            "gap_to_90",
            "focus",
            "timeline",
            "projected_score_after_execution",
            "execution_window_weeks",
            "week_plan",
            "risk",
            "plan_status",
        ],
        limit=8,
        max_item_len=200,
    )
    if isinstance(strategy_payload, dict):
        strategy_lines.extend(analysis_action_lines(strategy_payload.get("actions"), limit=4, max_item_len=200))
        strategy_lines = strategy_lines[:12]
    add_section("90+ Strategy", strategy_lines)

    salary_lines = analysis_dict_lines(
        report_payload.get("salary_insight"),
        preferred_keys=["trajectory", "salary_band", "positioning", "levers", "next_step"],
        limit=7,
        max_item_len=190,
    )
    add_section("Salary Insight", salary_lines)

    market_lines = analysis_dict_lines(
        report_payload.get("hiring_market_insights"),
        preferred_keys=["market_signal", "timing", "hiring_note", "layoff_note", "advantage_window"],
        limit=7,
        max_item_len=190,
    )
    add_section("Hiring Market", market_lines)

    callback_lines = analysis_dict_lines(
        report_payload.get("callback_forecast"),
        preferred_keys=["expected_calls", "confidence_band", "max_likely_calls", "next_focus"],
        limit=6,
        max_item_len=170,
    )
    add_section("Callback Forecast", callback_lines)

    story.append(Spacer(1, 8))
    story.append(
        Paragraph(
            "Generated by HireScore AI. This report is advisory and should be used with role-specific judgment.",
            subtitle_style,
        )
    )

    doc.build(story)
    output.seek(0)
    return output.getvalue()


@app.post("/admin/auth/login")
def admin_auth_login(data: AdminLoginRequest) -> dict[str, Any]:
    if not ADMIN_LOGIN_ID or not ADMIN_PASSWORD:
        raise HTTPException(status_code=503, detail="Admin login is not configured.")
    login_id = safe_text(data.login_id)
    password = safe_text(data.password)
    if not login_id or not password:
        raise HTTPException(status_code=400, detail="Enter admin login id and password.")
    if not hmac.compare_digest(login_id, ADMIN_LOGIN_ID) or not hmac.compare_digest(password, ADMIN_PASSWORD):
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


@app.get("/admin/runtime-settings")
def admin_runtime_settings(request: Request) -> dict[str, Any]:
    require_admin_access(request)
    return {
        "runtime_settings": {
            "public_feature_access_enabled": public_feature_access_enabled(),
        }
    }


@app.post("/admin/runtime-settings")
def admin_update_runtime_settings(data: AdminRuntimeSettingsUpdateRequest, request: Request) -> dict[str, Any]:
    require_admin_access(request)

    updated = False
    if data.public_feature_access_enabled is not None:
        set_runtime_setting_value(PUBLIC_ACCESS_RUNTIME_SETTING_KEY, bool(data.public_feature_access_enabled))
        updated = True

    settings_payload = {
        "public_feature_access_enabled": public_feature_access_enabled(),
    }
    if updated:
        admin_actor = admin_actor_from_request(request)
        log_analytics_event(
            "admin",
            "runtime_settings_updated",
            meta={
                "admin_identifier": admin_actor["identifier"],
                "admin_auth_mode": admin_actor["auth_mode"],
                **settings_payload,
            },
        )
    return {
        "runtime_settings": settings_payload,
        "updated": updated,
    }


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


@app.post("/admin/users/{user_id}/impersonate")
def admin_impersonate_user(user_id: int, request: Request, data: AdminImpersonateRequest | None = None) -> dict[str, Any]:
    require_admin_access(request)
    if user_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid user id.")

    user = fetch_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    reason = safe_text(data.reason) if data else ""
    admin_actor = admin_actor_from_request(request)
    ttl_minutes = ADMIN_IMPERSONATION_TOKEN_TTL_MINUTES
    auth_token = create_auth_token(
        int(user["id"]),
        str(user["email"]),
        ttl_seconds=ttl_minutes * 60,
    )

    log_analytics_event(
        "admin",
        "user_impersonation_started",
        user_id=int(user["id"]),
        meta={
            "admin_identifier": admin_actor["identifier"],
            "admin_auth_mode": admin_actor["auth_mode"],
            "reason": reason or "admin_support",
            "token_ttl_minutes": ttl_minutes,
        },
    )

    return {
        "auth_token": auth_token,
        "expires_in_minutes": ttl_minutes,
        "user": {
            "id": int(user["id"]),
            "name": safe_text(user["full_name"]) or display_name_from_email(str(user["email"])),
            "email": str(user["email"]),
            "plan": normalize_plan_tier(str(user["plan_tier"])),
        },
    }


@app.get("/admin/chats")
def admin_chats(request: Request, q: str | None = None, limit: int = 120) -> dict[str, Any]:
    require_admin_access(request)
    safe_limit = int(clamp_float(float(limit), 1, 400))
    connection = auth_db_connection()
    try:
        threads = collect_admin_chat_threads(connection, q=q, limit=safe_limit)
    finally:
        connection.close()
    return {"threads": threads, "limit": safe_limit}


@app.get("/admin/chats/{user_id}")
def admin_chat_messages(request: Request, user_id: int, limit: int = 200) -> dict[str, Any]:
    require_admin_access(request)
    if user_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid user id.")
    safe_limit = int(clamp_float(float(limit), 1, 500))

    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            user = cursor.execute(
                """
                SELECT
                    u.id,
                    COALESCE(NULLIF(g.contact_name, ''), u.full_name) AS full_name,
                    COALESCE(NULLIF(g.contact_email, ''), u.email) AS email,
                    u.plan_tier,
                    u.credits
                FROM users u
                LEFT JOIN guest_chat_profiles g ON g.user_id = u.id
                WHERE u.id = ?
                LIMIT 1
                """,
                (user_id,),
            ).fetchone()
            if not user:
                connection.rollback()
                raise HTTPException(status_code=404, detail="User not found.")
            messages = collect_chat_messages_for_user(connection, user_id=user_id, limit=safe_limit)
            cursor.execute(
                """
                UPDATE user_chat_messages
                SET read_by_admin = 1
                WHERE user_id = ? AND sender_role = 'user' AND read_by_admin = 0
                """,
                (user_id,),
            )
            connection.commit()
        finally:
            connection.close()

    return {
        "user": {
            "id": int(user["id"]),
            "name": safe_text(user["full_name"]) or display_name_from_email(str(user["email"])),
            "email": safe_text(user["email"]),
            "plan": normalize_plan_tier(safe_text(user["plan_tier"])),
            "credits": int(user["credits"] or 0),
        },
        "messages": messages,
    }


@app.post("/admin/chats/{user_id}/reply")
def admin_chat_reply(request: Request, user_id: int, data: AdminChatReplyRequest) -> dict[str, Any]:
    require_admin_access(request)
    if user_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid user id.")
    message = normalize_chat_message_body(data.message)
    if len(message) < 2:
        raise HTTPException(status_code=400, detail="Please enter a longer reply.")

    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            user = cursor.execute(
                "SELECT id FROM users WHERE id = ? LIMIT 1",
                (user_id,),
            ).fetchone()
            if not user:
                connection.rollback()
                raise HTTPException(status_code=404, detail="User not found.")
            saved = insert_chat_message(
                connection=connection,
                user_id=user_id,
                sender_role="admin",
                message=message,
                read_by_user=False,
                read_by_admin=True,
            )
            connection.commit()
        finally:
            connection.close()

    log_analytics_event("admin_chat", "admin_reply_sent", user_id=user_id, meta={"chars": len(message)})
    return {"message": saved}


@app.delete("/admin/chats/{user_id}/messages/{message_id}")
def admin_chat_delete_message(request: Request, user_id: int, message_id: int) -> dict[str, Any]:
    require_admin_access(request)
    if user_id <= 0 or message_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid user id or message id.")

    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            user = cursor.execute("SELECT id FROM users WHERE id = ? LIMIT 1", (user_id,)).fetchone()
            if not user:
                connection.rollback()
                raise HTTPException(status_code=404, detail="User not found.")

            message_row = cursor.execute(
                """
                SELECT id, sender_role
                FROM user_chat_messages
                WHERE id = ? AND user_id = ?
                LIMIT 1
                """,
                (message_id, user_id),
            ).fetchone()
            if not message_row:
                connection.rollback()
                raise HTTPException(status_code=404, detail="Chat message not found.")

            cursor.execute("DELETE FROM user_chat_messages WHERE id = ? AND user_id = ?", (message_id, user_id))
            connection.commit()
        finally:
            connection.close()

    log_analytics_event(
        "admin_chat",
        "message_deleted",
        user_id=user_id,
        meta={"message_id": message_id, "sender_role": safe_text(message_row["sender_role"])},
    )
    return {"deleted": True, "user_id": user_id, "message_id": message_id}


@app.delete("/admin/chats/{user_id}")
def admin_chat_clear_thread(request: Request, user_id: int) -> dict[str, Any]:
    require_admin_access(request)
    if user_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid user id.")

    with AUTH_DB_LOCK:
        connection = auth_db_connection()
        try:
            cursor = connection.cursor()
            begin_write_transaction(cursor)
            user = cursor.execute("SELECT id FROM users WHERE id = ? LIMIT 1", (user_id,)).fetchone()
            if not user:
                connection.rollback()
                raise HTTPException(status_code=404, detail="User not found.")

            cursor.execute("DELETE FROM user_chat_messages WHERE user_id = ?", (user_id,))
            deleted_count = int(max(0, cursor.rowcount))
            connection.commit()
        finally:
            connection.close()

    log_analytics_event("admin_chat", "thread_cleared", user_id=user_id, meta={"deleted_messages": deleted_count})
    return {"deleted": True, "user_id": user_id, "deleted_messages": deleted_count}


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
            cursor.execute("DELETE FROM user_chat_messages WHERE user_id = ?", (user_id,))
            cursor.execute("DELETE FROM analysis_reports WHERE user_id = ?", (user_id,))
            cursor.execute("DELETE FROM user_goal_roadmaps WHERE user_id = ?", (user_id,))
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
            "chat_threads": collect_admin_chat_threads(connection, q=q, limit=None),
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
    debit = debit_credits(
        int(user["id"]),
        "analyze",
        CREDIT_COSTS["analyze"],
        meta={"route": "/analyze", "role": safe_text(data.role), "industry": safe_text(data.industry)},
    )

    try:
        skills_text = safe_text(data.skills or data.description)
        analysis = analyze_profile_hybrid(
            data.industry,
            data.role,
            skills_text,
            experience_years=data.experience_years,
            age_years=data.age_years,
            applications_count=data.applications_count,
            salary_boost_toggles=data.salary_boost_toggles,
            source="manual_input",
        )
        analysis["wallet"] = debit["wallet"]
        analysis["credit_transaction_id"] = debit["transaction_id"]
        analysis["feedback_required"] = feedback_required_for_user(int(user["id"]))
        report_id = save_analysis_report(
            user_id=int(user["id"]),
            source="manual_input",
            industry=safe_text(data.industry),
            role=safe_text(data.role),
            report_payload=analysis,
        )
        if report_id is not None:
            analysis["report_id"] = report_id
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
    age_years: float | None = Form(None),
    applications_count: int | None = Form(None),
    salary_boost_toggles: str = Form(""),
    auth_token: str | None = Form(None),
) -> dict[str, Any]:
    user = require_authenticated_user(request, auth_token)
    debit = debit_credits(
        int(user["id"]),
        "analyze",
        CREDIT_COSTS["analyze"],
        meta={"route": "/analyze-resume-file", "role": safe_text(role), "industry": safe_text(industry)},
    )

    try:
        contents = await file.read()
        if not contents:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")
        if len(contents) > 12 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Resume file is too large. Upload a file smaller than 12 MB.")
        extracted_text = extract_resume_text_for_analysis(file.filename or "", file.content_type, contents)
        if not extracted_text:
            raise HTTPException(status_code=400, detail="No readable text found in the uploaded file.")

        toggle_ids = [token.strip() for token in salary_boost_toggles.split(",") if token.strip()]
        analysis = analyze_profile_hybrid(
            industry,
            role,
            extracted_text,
            experience_years=experience_years,
            age_years=age_years,
            applications_count=applications_count,
            salary_boost_toggles=toggle_ids,
            source="resume_upload",
        )
        analysis["wallet"] = debit["wallet"]
        analysis["credit_transaction_id"] = debit["transaction_id"]
        analysis["extracted_chars"] = len(extracted_text)
        analysis["feedback_required"] = feedback_required_for_user(int(user["id"]))
        report_id = save_analysis_report(
            user_id=int(user["id"]),
            source="resume_upload",
            industry=safe_text(industry),
            role=safe_text(role),
            report_payload=analysis,
        )
        if report_id is not None:
            analysis["report_id"] = report_id
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
    debit = debit_credits(
        int(user["id"]),
        "analyze",
        CREDIT_COSTS["analyze"],
        meta={"route": "/suggest", "role": safe_text(data.role), "industry": safe_text(data.industry)},
    )

    skills_text = safe_text(data.skills or data.description)
    analysis = analyze_profile_hybrid(
        data.industry,
        data.role,
        skills_text,
        experience_years=data.experience_years,
        age_years=data.age_years,
        applications_count=data.applications_count,
        salary_boost_toggles=data.salary_boost_toggles,
        source="suggest",
    )

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


@app.get("/jobs/{job_id}")
def async_job_status(job_id: str, request: Request, auth_token: str | None = None) -> dict[str, Any]:
    user = require_authenticated_user(request, auth_token)
    job = get_async_job_for_user(job_id, int(user["id"]))
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return {"job": serialize_async_job_payload(job)}


@app.get("/jobs/{job_id}/download")
def async_job_download(job_id: str, request: Request, auth_token: str | None = None) -> StreamingResponse:
    user = require_authenticated_user(request, auth_token)
    job = get_async_job_for_user(job_id, int(user["id"]))
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    if safe_text(job.get("status")) != "succeeded":
        raise HTTPException(status_code=409, detail="Job is not completed yet.")

    result = job.get("result")
    if not isinstance(result, dict):
        raise HTTPException(status_code=400, detail="Job result is unavailable.")

    encoded = safe_text(result.get("pdf_base64"))
    if not encoded:
        raise HTTPException(status_code=400, detail="This job has no downloadable output.")
    try:
        payload_bytes = base64.b64decode(encoded)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Unable to decode job output.") from exc

    safe_file_name = safe_text(result.get("file_name")) or "resume.pdf"
    return StreamingResponse(
        io.BytesIO(payload_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_file_name}"'},
    )


def build_resume_payload_for_user(user_id: int, data: ResumeBuildRequest, route_label: str = "/build-resume") -> dict[str, Any]:
    require_studio_access(user_id)
    debit = debit_credits(
        user_id,
        "ai_resume_generation",
        CREDIT_COSTS["ai_resume_generation"],
        meta={"route": safe_text(route_label) or "/build-resume", "role": safe_text(data.role), "industry": safe_text(data.industry)},
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
            user_id,
            "refund_ai_resume_generation",
            CREDIT_COSTS["ai_resume_generation"],
            meta={"reason": ai_error, "route": safe_text(route_label) or "/build-resume"},
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


def export_resume_pdf_job_payload_for_user(
    user_id: int,
    data: ResumeExportRequest,
    route_label: str = "/export-resume-pdf/async",
) -> dict[str, Any]:
    require_studio_access(user_id)
    resume_text = safe_text(data.resume_text)
    if not resume_text:
        raise HTTPException(status_code=400, detail="Resume text is required for PDF export.")

    template_name = canonical_resume_template_name(data.template)
    debit = debit_credits(
        user_id,
        "template_pdf_download",
        CREDIT_COSTS["template_pdf_download"],
        meta={"route": safe_text(route_label) or "/export-resume-pdf/async", "template": template_name},
    )

    try:
        pdf_bytes = render_resume_pdf_bytes(data.name or "Candidate", template_name, resume_text)
    except Exception as exc:
        credit_credits(
            user_id,
            "refund_template_pdf_download",
            CREDIT_COSTS["template_pdf_download"],
            meta={"reason": "pdf_render_failed", "route": safe_text(route_label) or "/export-resume-pdf/async"},
        )
        raise HTTPException(status_code=500, detail="Unable to generate PDF right now.") from exc

    safe_name = sanitize_download_name(data.name)
    file_name = f"{safe_name}-{ATS_STANDARD_RESUME_TEMPLATE_FILE_SUFFIX}.pdf"
    return {
        "file_name": file_name,
        "media_type": "application/pdf",
        "pdf_base64": base64.b64encode(pdf_bytes).decode("ascii"),
        "wallet": debit["wallet"],
        "credit_transaction_id": debit["transaction_id"],
    }


@app.post("/build-resume")
def build_resume(data: ResumeBuildRequest, request: Request) -> dict[str, Any]:
    user = require_authenticated_user(request, data.auth_token)
    user_id = int(user["id"])
    return build_resume_payload_for_user(user_id, data, route_label="/build-resume")


@app.post("/build-resume/async")
def build_resume_async(data: BuildResumeAsyncRequest, request: Request) -> dict[str, Any]:
    user = require_authenticated_user(request, data.auth_token)
    user_id = int(user["id"])
    require_studio_access(user_id)
    payload_dict = data.dict() if hasattr(data, "dict") else data.model_dump()
    payload_dict.pop("async_mode", None)
    job_request = ResumeBuildRequest(**payload_dict)
    job = enqueue_async_job(
        user_id,
        "build_resume",
        lambda: build_resume_payload_for_user(user_id, job_request, route_label="/build-resume/async"),
    )
    log_analytics_event("studio", "build_resume_async_queued", user_id=user_id, meta={"job_id": safe_text(job.get("id"))})
    return {"job": serialize_async_job_payload(job)}


@app.post("/improvise-resume")
def improvise_resume(data: ResumeImproviseRequest, request: Request) -> dict[str, Any]:
    user = require_authenticated_user(request, data.auth_token)
    user_id = int(user["id"])
    require_studio_access(user_id)
    debit = debit_credits(
        user_id,
        "ai_resume_generation",
        CREDIT_COSTS["ai_resume_generation"],
        meta={"route": "/improvise-resume", "role": safe_text(data.role), "industry": safe_text(data.industry)},
    )
    payload = improvise_resume_text(data)
    ai_error = payload.pop("ai_error", None)
    effective_wallet = debit["wallet"]
    if not payload.get("ai_generated") and ai_error:
        refund = credit_credits(
            user_id,
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
    user_id = int(user["id"])
    require_studio_access(user_id)
    debit = debit_credits(
        user_id,
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
                user_id,
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
            user_id,
            "refund_ai_resume_generation",
            CREDIT_COSTS["ai_resume_generation"],
            meta={"reason": "polish_failed"},
        )
        raise
    except Exception as exc:
        credit_credits(
            user_id,
            "refund_ai_resume_generation",
            CREDIT_COSTS["ai_resume_generation"],
            meta={"reason": "polish_failed_unhandled"},
        )
        raise HTTPException(status_code=400, detail="Unable to process this PDF file.") from exc


@app.post("/export-resume-pdf")
def export_resume_pdf(data: ResumeExportRequest, request: Request) -> StreamingResponse:
    user = require_authenticated_user(request, data.auth_token)
    user_id = int(user["id"])
    require_studio_access(user_id)
    resume_text = safe_text(data.resume_text)
    if not resume_text:
        raise HTTPException(status_code=400, detail="Resume text is required for PDF export.")

    template_name = canonical_resume_template_name(data.template)
    debit = debit_credits(
        user_id,
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
        "Content-Disposition": f'attachment; filename="{safe_name}-{ATS_STANDARD_RESUME_TEMPLATE_FILE_SUFFIX}.pdf"',
        "X-HireScore-Credits-Remaining": str(debit["wallet"]["credits"]),
    }
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf", headers=headers)


@app.post("/export-resume-pdf/async")
def export_resume_pdf_async(data: ExportResumePdfAsyncRequest, request: Request) -> dict[str, Any]:
    user = require_authenticated_user(request, data.auth_token)
    user_id = int(user["id"])
    require_studio_access(user_id)
    payload_dict = data.dict() if hasattr(data, "dict") else data.model_dump()
    payload_dict.pop("async_mode", None)
    job_request = ResumeExportRequest(**payload_dict)
    job = enqueue_async_job(
        user_id,
        "export_resume_pdf",
        lambda: export_resume_pdf_job_payload_for_user(user_id, job_request, route_label="/export-resume-pdf/async"),
    )
    log_analytics_event("studio", "export_resume_pdf_async_queued", user_id=user_id, meta={"job_id": safe_text(job.get("id"))})
    return {"job": serialize_async_job_payload(job)}
