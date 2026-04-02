"""
Configuration module for Executive Summary Report.

Contains thresholds, weights, and settings for health scoring and risk detection.
"""

import os
from pathlib import Path

# =============================================================================
# Path Configuration
# =============================================================================

SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
DATA_DIR = PROJECT_DIR / "data"
OUTPUT_DIR = PROJECT_DIR / "output"

OUTPUT_DIR.mkdir(exist_ok=True)

# Data files
DATA_FILE = DATA_DIR / "Incidents-exported.xlsx"
INCIDENTS_FILE = DATA_DIR / "Incidents-exported.xlsx"
CHANGES_FILE = DATA_DIR / "Changes-exported.xlsx"
REQUESTS_FILE = DATA_DIR / "Requests-exported.xlsx"
PROBLEMS_FILE = DATA_DIR / "Problems-exported.xlsx"

# =============================================================================
# API Configuration
# =============================================================================

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.deepseek.com/v1")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "deepseek-chat")

# =============================================================================
# Health Score Weights (Total = 100%)
# Updated for comprehensive 4-process analysis
# =============================================================================

HEALTH_SCORE_WEIGHTS = {
    # Incident Management (50%)
    "sla_rate": 0.25,
    "mttr": 0.15,
    "p1_p2_trend": 0.10,
    # Change Management (20%)
    "change_success_rate": 0.15,
    "change_incident_rate": 0.05,
    # Request Management (20%)
    "request_sla_rate": 0.10,
    "request_csat": 0.10,
    # Problem Management (10%)
    "problem_closure_rate": 0.05,
    "backlog_rate": 0.05
}

# =============================================================================
# SLA Score Thresholds
# =============================================================================

SLA_SCORE_THRESHOLDS = [
    (0.95, 100),  # ≥95% = 100 points
    (0.90, 80),   # ≥90% = 80 points
    (0.80, 60),   # ≥80% = 60 points
    (0.70, 40),   # ≥70% = 40 points
    (0.00, 0),    # <70% = 0 points
]

# =============================================================================
# MTTR Score Thresholds (in hours)
# =============================================================================

MTTR_SCORE_THRESHOLDS = [
    (12, 100),    # <12h = 100 points
    (24, 80),     # <24h = 80 points
    (48, 60),     # <48h = 60 points
    (72, 40),     # <72h = 40 points
    (float('inf'), 0),  # ≥72h = 0 points
]

# =============================================================================
# P1/P2 Trend Score
# =============================================================================

P1P2_TREND_SCORE = {
    "decreased": 100,
    "stable": 70,       # ±10%
    "increased_mild": 40,  # <30%
    "increased_severe": 0   # ≥30%
}

P1P2_STABLE_THRESHOLD = 0.10  # ±10% considered stable
P1P2_MILD_INCREASE_THRESHOLD = 0.30  # <30% increase

# =============================================================================
# Backlog Score Thresholds (ratio to daily average)
# =============================================================================

BACKLOG_SCORE_THRESHOLDS = [
    (1.0, 100),   # <1x daily average = 100 points
    (1.5, 70),    # <1.5x = 70 points
    (2.0, 40),    # <2x = 40 points
    (float('inf'), 0),  # ≥2x = 0 points
]

# =============================================================================
# Change Management Score Thresholds
# =============================================================================

CHANGE_SUCCESS_THRESHOLDS = [
    (0.95, 100),  # ≥95% = 100 points
    (0.90, 80),   # ≥90% = 80 points
    (0.85, 60),   # ≥85% = 60 points
    (0.80, 40),   # ≥80% = 40 points
    (0.00, 0),    # <80% = 0 points
]

CHANGE_INCIDENT_THRESHOLDS = [
    (0.02, 100),  # <2% = 100 points
    (0.05, 80),   # <5% = 80 points
    (0.10, 50),   # <10% = 50 points
    (0.15, 25),   # <15% = 25 points
    (1.00, 0),    # ≥15% = 0 points
]

EMERGENCY_CHANGE_THRESHOLDS = [
    (0.10, 100),  # <10% = 100 points
    (0.15, 70),   # <15% = 70 points
    (0.20, 40),   # <20% = 40 points
    (1.00, 0),    # ≥20% = 0 points
]

# =============================================================================
# Request Management Score Thresholds
# =============================================================================

REQUEST_SLA_THRESHOLDS = [
    (0.95, 100),  # ≥95% = 100 points
    (0.90, 80),   # ≥90% = 80 points
    (0.80, 60),   # ≥80% = 60 points
    (0.70, 40),   # ≥70% = 40 points
    (0.00, 0),    # <70% = 0 points
]

CSAT_THRESHOLDS = [
    (4.5, 100),   # ≥4.5/5 = 100 points
    (4.0, 80),    # ≥4.0/5 = 80 points
    (3.5, 60),    # ≥3.5/5 = 60 points
    (3.0, 40),    # ≥3.0/5 = 40 points
    (0.0, 0),     # <3.0/5 = 0 points
]

# =============================================================================
# Problem Management Score Thresholds
# =============================================================================

PROBLEM_CLOSURE_THRESHOLDS = [
    (0.80, 100),  # ≥80% = 100 points
    (0.60, 70),   # ≥60% = 70 points
    (0.40, 40),   # ≥40% = 40 points
    (0.00, 0),    # <40% = 0 points
]

RCA_COMPLETION_THRESHOLDS = [
    (0.90, 100),  # ≥90% = 100 points
    (0.80, 80),   # ≥80% = 80 points
    (0.70, 60),   # ≥70% = 60 points
    (0.60, 40),   # ≥60% = 40 points
    (0.00, 0),    # <60% = 0 points
]

# =============================================================================
# Health Score Grades
# =============================================================================

HEALTH_GRADES = [
    (90, "Excellent", "🟢"),
    (80, "Good", "🟡"),
    (70, "Needs Improvement", "🟠"),
    (0, "At Risk", "🔴"),
]

# =============================================================================
# Risk Radar Rules
# =============================================================================

RISK_RULES = [
    {"id": "R001", "name": "SLA Critical", "priority": "Critical", "check": "sla_rate < 0.80"},
    {"id": "R002", "name": "SLA Declining", "priority": "Critical", "check": "sla_drop > 0.10"},
    {"id": "R003", "name": "P1 Surge", "priority": "Critical", "check": "p1_increase > 0.50"},
    {"id": "R004", "name": "MTTR Spike", "priority": "Warning", "check": "category_mttr > 48"},
    {"id": "R005", "name": "Expert Bottleneck", "priority": "Warning", "check": "expert_backlog > 10"},
    {"id": "R006", "name": "Single Point", "priority": "Attention", "check": "single_point_category"},
    {"id": "R007", "name": "Trend Decline", "priority": "Attention", "check": "consecutive_decline >= 3"},
]

# =============================================================================
# Period Comparison Configuration
# =============================================================================

# Minimum days for each comparison type
MIN_DAYS_FOR_WOW = 14   # At least 2 weeks for week-over-week
MIN_DAYS_FOR_MOM = 60   # At least 2 months for month-over-month

# Trend granularity
TREND_GRANULARITY_MONTHLY_MIN_DAYS = 60  # ≥60 days use monthly
TREND_GRANULARITY_WEEKLY_MIN_DAYS = 14   # ≥14 days use weekly

# =============================================================================
# Default SLA (in hours)
# =============================================================================

DEFAULT_SLA = {
    "P1": 4,
    "P2": 8,
    "P3": 24,
    "P4": 72
}

# =============================================================================
# Excluded Resolvers
# =============================================================================

EXCLUDED_RESOLVERS = ["Unassigned", "System", "Auto", ""]

# =============================================================================
# PPTX Dark Theme Colors
# =============================================================================

PPTX_COLORS = {
    "background": "#1E1E2E",
    "card_bg": "#2D2D3D",
    "primary": "#4A90D9",
    "secondary": "#6C7A89",
    "success": "#28A745",
    "warning": "#FFC107",
    "danger": "#DC3545",
    "text_primary": "#FFFFFF",
    "text_secondary": "#A0A0A0",
}

# Chart colors
COLORS = {
    "primary": "#4A90D9",
    "secondary": "#6C7A89",
    "success": "#28A745",
    "warning": "#FFC107",
    "danger": "#DC3545",
    "info": "#17A2B8",
    "light": "#F8F9FA",
    "dark": "#1E1E2E",
}

# =============================================================================
# Chart Configuration
# =============================================================================

CHART_FIGSIZE = (10, 6)
CHART_DPI = 150
SPARKLINE_FIGSIZE = (3, 1)
