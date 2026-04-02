"""
Comprehensive Analyzer for Customer Quality Report.

Integrates all 4 ITIL processes: Incidents, Changes, Requests, Problems.
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple, Any
from pathlib import Path

from config import (
    INCIDENTS_FILE, CHANGES_FILE, REQUESTS_FILE, PROBLEMS_FILE,
    EXCLUDED_RESOLVERS,
    HEALTH_SCORE_WEIGHTS,
    SLA_SCORE_THRESHOLDS, MTTR_SCORE_THRESHOLDS, BACKLOG_SCORE_THRESHOLDS,
    CHANGE_SUCCESS_THRESHOLDS, CHANGE_INCIDENT_THRESHOLDS, EMERGENCY_CHANGE_THRESHOLDS,
    REQUEST_SLA_THRESHOLDS, CSAT_THRESHOLDS,
    PROBLEM_CLOSURE_THRESHOLDS, RCA_COMPLETION_THRESHOLDS,
    P1P2_TREND_SCORE, P1P2_STABLE_THRESHOLD, P1P2_MILD_INCREASE_THRESHOLD,
    HEALTH_GRADES, DEFAULT_SLA,
    MIN_DAYS_FOR_WOW, MIN_DAYS_FOR_MOM,
    TREND_GRANULARITY_MONTHLY_MIN_DAYS, TREND_GRANULARITY_WEEKLY_MIN_DAYS
)
from utils import (
    load_excel_data, clean_data, get_date_range, get_data_span_days,
    filter_by_period, get_week_boundaries, get_month_boundaries,
    safe_divide, calculate_percentage_change
)


# =============================================================================
# Data Classes
# =============================================================================

@dataclass
class KPIMetric:
    """Single KPI metric with comparison."""
    name: str
    current_value: float
    previous_value: Optional[float] = None
    change: Optional[float] = None
    trend: str = "→"
    unit: str = ""
    score: float = 0.0
    status: str = "normal"  # normal, warning, danger
    category: str = "incident"  # incident, change, request, problem


@dataclass
class RiskItem:
    """Risk item identified by the radar."""
    id: str
    priority: str  # Critical, Warning, Attention
    message: str
    impact: str
    category: Optional[str] = None
    process: str = "incident"  # incident, change, request, problem
    value: Optional[float] = None


@dataclass
class TrendPoint:
    """Single point in trend data."""
    period: str
    value: float
    label: str = ""


@dataclass
class TrendData:
    """Trend data for charts."""
    metric: str
    points: List[TrendPoint] = field(default_factory=list)
    direction: str = "stable"
    granularity: str = "monthly"


@dataclass
class MajorIncident:
    """Major incident summary."""
    order_number: str
    name: str
    priority: str
    status: str
    begin_date: datetime
    resolution_time: Optional[float] = None


@dataclass
class ChangeRecord:
    """Change record for display."""
    change_number: str
    title: str
    change_type: str
    status: str
    success: bool
    incident_caused: bool


@dataclass
class ProblemRecord:
    """Problem record for display."""
    problem_number: str
    title: str
    status: str
    known_error: bool
    related_incidents: int
    root_cause: str


@dataclass
class ActionItem:
    """Recommended action."""
    priority: str  # URGENT, HIGH, MEDIUM
    action: str
    expected_impact: str
    process: str = "incident"


@dataclass
class PeriodComparison:
    """Period-over-period comparison data."""
    current_start: datetime
    current_end: datetime
    previous_start: Optional[datetime] = None
    previous_end: Optional[datetime] = None
    comparison_type: str = "none"
    has_comparison: bool = False


@dataclass
class ProcessSummary:
    """Summary for a single ITIL process."""
    name: str
    total_count: int
    kpis: Dict[str, KPIMetric] = field(default_factory=dict)
    risks: List[RiskItem] = field(default_factory=list)
    trends: Dict[str, TrendData] = field(default_factory=dict)
    highlights: List[str] = field(default_factory=list)


@dataclass
class SLABreakdown:
    """SLA breakdown by priority."""
    priority: str
    total: int
    compliant: int
    rate: float
    target: float


@dataclass
class ComprehensiveResult:
    """Complete analysis result for all processes."""
    # Date range
    start_date: str
    end_date: str
    data_span_days: int

    # Health Score
    health_score: float
    health_grade: str
    health_emoji: str

    # Process Summaries
    incident_summary: ProcessSummary = None
    change_summary: ProcessSummary = None
    request_summary: ProcessSummary = None
    problem_summary: ProcessSummary = None

    # Combined KPIs (for dashboard)
    kpis: Dict[str, KPIMetric] = field(default_factory=dict)

    # Comparisons
    wow_comparison: Optional[PeriodComparison] = None
    mom_comparison: Optional[PeriodComparison] = None
    can_compare_wow: bool = False
    can_compare_mom: bool = False

    # Risks (combined and sorted)
    risks: List[RiskItem] = field(default_factory=list)
    top_risks: List[RiskItem] = field(default_factory=list)

    # Trends
    trends: Dict[str, TrendData] = field(default_factory=dict)
    trend_granularity: str = "monthly"

    # Major Items
    major_incidents: List[MajorIncident] = field(default_factory=list)
    failed_changes: List[ChangeRecord] = field(default_factory=list)
    open_problems: List[ProblemRecord] = field(default_factory=list)

    # SLA Breakdown
    sla_breakdown: List[SLABreakdown] = field(default_factory=list)

    # Actions
    actions: List[ActionItem] = field(default_factory=list)

    # Raw counts
    total_incidents: int = 0
    total_changes: int = 0
    total_requests: int = 0
    total_problems: int = 0


# =============================================================================
# Comprehensive Analyzer
# =============================================================================

class ComprehensiveAnalyzer:
    """
    Analyzer for comprehensive customer quality report.
    Integrates Incidents, Changes, Requests, and Problems data.
    """

    def __init__(
        self,
        incidents_file: Path = None,
        changes_file: Path = None,
        requests_file: Path = None,
        problems_file: Path = None
    ):
        """Initialize analyzer with data files."""
        self.incidents_file = incidents_file or INCIDENTS_FILE
        self.changes_file = changes_file or CHANGES_FILE
        self.requests_file = requests_file or REQUESTS_FILE
        self.problems_file = problems_file or PROBLEMS_FILE

        # DataFrames
        self.incidents_df = None
        self.changes_df = None
        self.requests_df = None
        self.problems_df = None
        self.sla_df = None
        self.sla_map = {}

    def analyze(self) -> ComprehensiveResult:
        """Run complete analysis across all processes."""
        # Load all data
        self._load_all_data()

        # Get date range from incidents (primary source)
        start_date, end_date = get_date_range(self.incidents_df)
        data_span_days = get_data_span_days(self.incidents_df)

        # Determine comparison capabilities
        can_compare_wow = data_span_days >= MIN_DAYS_FOR_WOW
        can_compare_mom = data_span_days >= MIN_DAYS_FOR_MOM

        # Determine trend granularity
        if data_span_days >= TREND_GRANULARITY_MONTHLY_MIN_DAYS:
            trend_granularity = "monthly"
        elif data_span_days >= TREND_GRANULARITY_WEEKLY_MIN_DAYS:
            trend_granularity = "weekly"
        else:
            trend_granularity = "daily"

        # Analyze each process
        incident_summary = self._analyze_incidents(end_date, can_compare_wow, can_compare_mom)
        change_summary = self._analyze_changes()
        request_summary = self._analyze_requests()
        problem_summary = self._analyze_problems()

        # Combine KPIs
        kpis = self._combine_kpis(incident_summary, change_summary, request_summary, problem_summary)

        # Calculate health score
        health_score, health_grade, health_emoji = self._calculate_health_score(kpis)

        # Combine and sort risks
        all_risks = (
            incident_summary.risks +
            change_summary.risks +
            request_summary.risks +
            problem_summary.risks
        )
        all_risks = sorted(all_risks, key=lambda x: self._risk_priority_order(x.priority))
        top_risks = all_risks[:5]

        # Get period comparisons
        wow_comparison = self._get_wow_comparison(end_date) if can_compare_wow else None
        mom_comparison = self._get_mom_comparison(end_date) if can_compare_mom else None

        # Calculate combined trends
        trends = self._calculate_combined_trends(trend_granularity)

        # Get major items
        major_incidents = self._get_major_incidents()
        failed_changes = self._get_failed_changes()
        open_problems = self._get_open_problems()

        # Get SLA breakdown
        sla_breakdown = self._get_sla_breakdown()

        # Generate actions
        actions = self._generate_actions(all_risks, kpis)

        return ComprehensiveResult(
            start_date=start_date.strftime("%Y-%m-%d"),
            end_date=end_date.strftime("%Y-%m-%d"),
            data_span_days=data_span_days,
            health_score=health_score,
            health_grade=health_grade,
            health_emoji=health_emoji,
            incident_summary=incident_summary,
            change_summary=change_summary,
            request_summary=request_summary,
            problem_summary=problem_summary,
            kpis=kpis,
            wow_comparison=wow_comparison,
            mom_comparison=mom_comparison,
            can_compare_wow=can_compare_wow,
            can_compare_mom=can_compare_mom,
            risks=all_risks,
            top_risks=top_risks,
            trends=trends,
            trend_granularity=trend_granularity,
            major_incidents=major_incidents,
            failed_changes=failed_changes,
            open_problems=open_problems,
            sla_breakdown=sla_breakdown,
            actions=actions,
            total_incidents=len(self.incidents_df),
            total_changes=len(self.changes_df) if self.changes_df is not None else 0,
            total_requests=len(self.requests_df) if self.requests_df is not None else 0,
            total_problems=len(self.problems_df) if self.problems_df is not None else 0
        )

    # =========================================================================
    # Data Loading
    # =========================================================================

    def _load_all_data(self) -> None:
        """Load all data files."""
        # Incidents (required)
        self.incidents_df, self.sla_df = load_excel_data(self.incidents_file)
        self.incidents_df = clean_data(self.incidents_df, EXCLUDED_RESOLVERS)

        # Build SLA map — store as dict with both response and resolution
        self.sla_map = DEFAULT_SLA.copy()
        for _, row in self.sla_df.iterrows():
            resolution_col = None
            response_col = None
            for col_name in ["Resolution （hours）", "Resolution (hours)"]:
                if col_name in row.index:
                    resolution_col = col_name
                    break
            for col_name in ["Response （minutes）", "Response (minutes)"]:
                if col_name in row.index:
                    response_col = col_name
                    break
            priority = row["Priority"]
            if resolution_col or response_col:
                res_hours = row[resolution_col] if resolution_col else 24
                resp_min = row[response_col] if response_col else None
                self.sla_map[priority] = {
                    "resolution_hours": float(res_hours),
                    "response_minutes": float(resp_min) if resp_min is not None else None,
                }

        # Changes (optional)
        if self.changes_file.exists():
            self.changes_df = pd.read_excel(self.changes_file, sheet_name="Data")
            self._clean_changes_data()

        # Requests (optional)
        if self.requests_file.exists():
            self.requests_df = pd.read_excel(self.requests_file, sheet_name="Data")
            self._clean_requests_data()

        # Problems (optional)
        if self.problems_file.exists():
            self.problems_df = pd.read_excel(self.problems_file, sheet_name="Data")
            self._clean_problems_data()

    def _clean_changes_data(self) -> None:
        """Clean and prepare changes data."""
        if self.changes_df is None:
            return

        # Parse dates
        for col in ["Requested Date", "Planned Start", "Planned End", "Actual Start", "Actual End"]:
            if col in self.changes_df.columns:
                self.changes_df[col] = pd.to_datetime(self.changes_df[col], errors='coerce')

    def _clean_requests_data(self) -> None:
        """Clean and prepare requests data."""
        if self.requests_df is None:
            return

        # Parse dates
        for col in ["Requested Date", "Due Date", "Fulfilled Date"]:
            if col in self.requests_df.columns:
                self.requests_df[col] = pd.to_datetime(self.requests_df[col], errors='coerce')

    def _clean_problems_data(self) -> None:
        """Clean and prepare problems data."""
        if self.problems_df is None:
            return

        # Parse dates
        for col in ["Logged Date", "Target Resolution", "Resolution Date"]:
            if col in self.problems_df.columns:
                self.problems_df[col] = pd.to_datetime(self.problems_df[col], errors='coerce')

    # =========================================================================
    # Incident Analysis
    # =========================================================================

    def _analyze_incidents(
        self,
        reference_date: datetime,
        can_compare_wow: bool,
        can_compare_mom: bool
    ) -> ProcessSummary:
        """Analyze incident management metrics."""
        kpis = {}
        risks = []

        # SLA Rate
        sla_rate = self._calculate_sla_rate(self.incidents_df)
        sla_score = self._score_threshold(sla_rate, SLA_SCORE_THRESHOLDS)
        sla_status = "danger" if sla_rate < 0.80 else "warning" if sla_rate < 0.90 else "normal"

        kpis["sla_rate"] = KPIMetric(
            name="SLA Compliance",
            current_value=sla_rate,
            unit="%",
            score=sla_score,
            status=sla_status,
            category="incident"
        )

        # Average MTTR
        avg_mttr = self._calculate_avg_mttr(self.incidents_df)
        mttr_score = self._score_threshold_reverse(avg_mttr, MTTR_SCORE_THRESHOLDS)
        mttr_status = "danger" if avg_mttr > 48 else "warning" if avg_mttr > 24 else "normal"

        kpis["avg_mttr"] = KPIMetric(
            name="Avg MTTR",
            current_value=avg_mttr,
            unit="h",
            score=mttr_score,
            status=mttr_status,
            category="incident"
        )

        # P1/P2 Count
        p1_p2_count = len(self.incidents_df[self.incidents_df["Priority"].isin(["P1", "P2"])])

        kpis["p1_p2_count"] = KPIMetric(
            name="P1/P2 Incidents",
            current_value=p1_p2_count,
            unit="",
            score=70,
            status="normal",
            category="incident"
        )

        # Total Tickets
        kpis["total_tickets"] = KPIMetric(
            name="Total Incidents",
            current_value=len(self.incidents_df),
            unit="",
            score=100,
            status="normal",
            category="incident"
        )

        # Backlog
        backlog = len(self.incidents_df[self.incidents_df["Order Status"].isin(["Open", "Pending", "In Progress"])])
        daily_avg = len(self.incidents_df) / max(self.incidents_df["Begin Date"].dt.date.nunique(), 1)
        backlog_ratio = safe_divide(backlog, daily_avg)
        backlog_score = self._score_threshold_reverse(backlog_ratio, BACKLOG_SCORE_THRESHOLDS)

        kpis["backlog"] = KPIMetric(
            name="Backlog",
            current_value=backlog,
            unit="",
            score=backlog_score,
            status="danger" if backlog_ratio > 2 else "warning" if backlog_ratio > 1.5 else "normal",
            category="incident"
        )

        # Add comparisons
        if can_compare_wow:
            self._add_incident_wow_comparison(kpis, reference_date)
        if can_compare_mom:
            self._add_incident_mom_comparison(kpis, reference_date)

        # Detect risks
        risks = self._detect_incident_risks(kpis)

        # Highlights
        highlights = []
        if sla_rate < 0.80:
            highlights.append(f"SLA compliance critical at {sla_rate:.1%}")
        if avg_mttr > 24:
            highlights.append(f"Average resolution time is {avg_mttr:.1f} hours")

        return ProcessSummary(
            name="Incident Management",
            total_count=len(self.incidents_df),
            kpis=kpis,
            risks=risks,
            highlights=highlights
        )

    def _calculate_sla_rate(self, df: pd.DataFrame) -> float:
        """Calculate SLA compliance rate."""
        if len(df) == 0:
            return 0.0

        compliant = 0
        total = 0

        for _, row in df.iterrows():
            priority = row.get("Priority", "P3")
            resolution_time = row.get("Resolution Time(m)", 0)

            if pd.isna(resolution_time):
                continue

            total += 1
            sla_val = self.sla_map.get(priority, 24)
            if isinstance(sla_val, dict):
                sla_minutes = sla_val.get("resolution_hours", 24) * 60
            else:
                sla_minutes = float(sla_val) * 60

            if resolution_time <= sla_minutes:
                compliant += 1

        return safe_divide(compliant, total)

    def _calculate_avg_mttr(self, df: pd.DataFrame) -> float:
        """Calculate average MTTR in hours."""
        if "Resolution Time(m)" not in df.columns:
            return 0.0

        valid_times = df["Resolution Time(m)"].dropna()
        if len(valid_times) == 0:
            return 0.0

        return valid_times.mean() / 60

    def _add_incident_wow_comparison(self, kpis: Dict[str, KPIMetric], reference_date: datetime) -> None:
        """Add week-over-week comparison for incidents."""
        comp = self._get_wow_comparison(reference_date)

        current_df = filter_by_period(self.incidents_df, comp.current_start, comp.current_end)
        previous_df = filter_by_period(self.incidents_df, comp.previous_start, comp.previous_end)

        if len(previous_df) == 0:
            return

        # Update SLA
        prev_sla = self._calculate_sla_rate(previous_df)
        kpis["sla_rate"].previous_value = prev_sla
        change, trend = calculate_percentage_change(kpis["sla_rate"].current_value, prev_sla)
        kpis["sla_rate"].change = change
        kpis["sla_rate"].trend = trend

    def _add_incident_mom_comparison(self, kpis: Dict[str, KPIMetric], reference_date: datetime) -> None:
        """Add month-over-month comparison for incidents."""
        comp = self._get_mom_comparison(reference_date)

        current_df = filter_by_period(self.incidents_df, comp.current_start, comp.current_end)
        previous_df = filter_by_period(self.incidents_df, comp.previous_start, comp.previous_end)

        if len(previous_df) == 0:
            return

        # Update MTTR
        prev_mttr = self._calculate_avg_mttr(previous_df)
        if kpis["avg_mttr"].previous_value is None:
            kpis["avg_mttr"].previous_value = prev_mttr
            change, trend = calculate_percentage_change(kpis["avg_mttr"].current_value, prev_mttr)
            kpis["avg_mttr"].change = change
            kpis["avg_mttr"].trend = trend

        # Update P1/P2
        prev_p1p2 = len(previous_df[previous_df["Priority"].isin(["P1", "P2"])])
        curr_p1p2 = len(current_df[current_df["Priority"].isin(["P1", "P2"])])

        kpis["p1_p2_count"].previous_value = prev_p1p2
        change, trend = calculate_percentage_change(curr_p1p2, prev_p1p2)
        kpis["p1_p2_count"].change = change
        kpis["p1_p2_count"].trend = trend

    def _detect_incident_risks(self, kpis: Dict[str, KPIMetric]) -> List[RiskItem]:
        """Detect incident-related risks."""
        risks = []

        # R001: SLA Critical
        sla = kpis.get("sla_rate")
        if sla and sla.current_value < 0.80:
            risks.append(RiskItem(
                id="R001",
                priority="Critical",
                message=f"Incident SLA compliance at {sla.current_value:.1%}",
                impact="Customer SLO commitments at risk",
                process="incident"
            ))

        # R002: MTTR Spike per category
        category_mttr = self.incidents_df.groupby("Category")["Resolution Time(m)"].mean() / 60
        for category, mttr in category_mttr.items():
            if mttr > 48:
                risks.append(RiskItem(
                    id="R002",
                    priority="Warning",
                    message=f"Category '{category}' MTTR is {mttr:.1f}h",
                    impact="Extended resolution times affecting service levels",
                    category=category,
                    process="incident",
                    value=mttr
                ))

        return risks

    # =========================================================================
    # Change Analysis
    # =========================================================================

    def _analyze_changes(self) -> ProcessSummary:
        """Analyze change management metrics."""
        kpis = {}
        risks = []
        highlights = []

        if self.changes_df is None or len(self.changes_df) == 0:
            return ProcessSummary(
                name="Change Management",
                total_count=0,
                kpis=kpis,
                risks=risks,
                highlights=["No change data available"]
            )

        total_changes = len(self.changes_df)

        # Change Success Rate
        successful = len(self.changes_df[self.changes_df["Success"] == "Yes"])
        success_rate = safe_divide(successful, total_changes)
        success_score = self._score_threshold(success_rate, CHANGE_SUCCESS_THRESHOLDS)

        kpis["change_success_rate"] = KPIMetric(
            name="Change Success Rate",
            current_value=success_rate,
            unit="%",
            score=success_score,
            status="danger" if success_rate < 0.85 else "warning" if success_rate < 0.90 else "normal",
            category="change"
        )

        # Emergency Change Ratio
        emergency_count = len(self.changes_df[self.changes_df["Change Type"] == "Emergency"])
        emergency_ratio = safe_divide(emergency_count, total_changes)
        emergency_score = self._score_threshold_reverse(emergency_ratio, EMERGENCY_CHANGE_THRESHOLDS)

        kpis["emergency_ratio"] = KPIMetric(
            name="Emergency Changes",
            current_value=emergency_ratio,
            unit="%",
            score=emergency_score,
            status="danger" if emergency_ratio > 0.20 else "warning" if emergency_ratio > 0.15 else "normal",
            category="change"
        )

        # Change-Induced Incidents
        incident_caused = len(self.changes_df[self.changes_df["Incident Caused"] == "Yes"])
        incident_rate = safe_divide(incident_caused, total_changes)
        incident_score = self._score_threshold_reverse(incident_rate, CHANGE_INCIDENT_THRESHOLDS)

        kpis["change_incident_rate"] = KPIMetric(
            name="Change-Induced Incidents",
            current_value=incident_rate,
            unit="%",
            score=incident_score,
            status="danger" if incident_rate > 0.10 else "warning" if incident_rate > 0.05 else "normal",
            category="change"
        )

        # Total Changes
        kpis["total_changes"] = KPIMetric(
            name="Total Changes",
            current_value=total_changes,
            unit="",
            score=100,
            status="normal",
            category="change"
        )

        # Detect risks
        if success_rate < 0.90:
            risks.append(RiskItem(
                id="R003",
                priority="Warning",
                message=f"Change success rate at {success_rate:.1%}",
                impact="Failed changes may cause service disruptions",
                process="change",
                value=success_rate
            ))

        if emergency_ratio > 0.15:
            risks.append(RiskItem(
                id="R004",
                priority="Warning",
                message=f"Emergency change ratio at {emergency_ratio:.1%}",
                impact="High emergency changes indicate planning gaps",
                process="change",
                value=emergency_ratio
            ))

        if incident_rate > 0.05:
            risks.append(RiskItem(
                id="R005",
                priority="Critical",
                message=f"{incident_caused} changes caused incidents ({incident_rate:.1%})",
                impact="Changes are causing service incidents",
                process="change",
                value=incident_rate
            ))

        # Highlights
        if success_rate >= 0.95:
            highlights.append(f"Excellent change success rate: {success_rate:.1%}")
        if incident_caused > 0:
            highlights.append(f"{incident_caused} changes caused incidents")

        return ProcessSummary(
            name="Change Management",
            total_count=total_changes,
            kpis=kpis,
            risks=risks,
            highlights=highlights
        )

    # =========================================================================
    # Request Analysis
    # =========================================================================

    def _analyze_requests(self) -> ProcessSummary:
        """Analyze service request metrics."""
        kpis = {}
        risks = []
        highlights = []

        if self.requests_df is None or len(self.requests_df) == 0:
            return ProcessSummary(
                name="Service Requests",
                total_count=0,
                kpis=kpis,
                risks=risks,
                highlights=["No request data available"]
            )

        total_requests = len(self.requests_df)

        # Fulfillment Rate
        fulfilled = len(self.requests_df[self.requests_df["Status"] == "Fulfilled"])
        fulfillment_rate = safe_divide(fulfilled, total_requests)

        kpis["fulfillment_rate"] = KPIMetric(
            name="Fulfillment Rate",
            current_value=fulfillment_rate,
            unit="%",
            score=self._score_threshold(fulfillment_rate, REQUEST_SLA_THRESHOLDS),
            status="danger" if fulfillment_rate < 0.70 else "warning" if fulfillment_rate < 0.85 else "normal",
            category="request"
        )

        # Request SLA Compliance
        fulfilled_df = self.requests_df[self.requests_df["Status"] == "Fulfilled"]
        if len(fulfilled_df) > 0:
            sla_met = len(fulfilled_df[fulfilled_df["SLA Met"] == "Yes"])
            request_sla_rate = safe_divide(sla_met, len(fulfilled_df))
        else:
            request_sla_rate = 0.0

        kpis["request_sla_rate"] = KPIMetric(
            name="Request SLA",
            current_value=request_sla_rate,
            unit="%",
            score=self._score_threshold(request_sla_rate, REQUEST_SLA_THRESHOLDS),
            status="danger" if request_sla_rate < 0.70 else "warning" if request_sla_rate < 0.85 else "normal",
            category="request"
        )

        # Average Fulfillment Time
        if "Fulfillment Time(h)" in fulfilled_df.columns:
            avg_fulfillment = fulfilled_df["Fulfillment Time(h)"].dropna().mean()
            avg_fulfillment = avg_fulfillment if not pd.isna(avg_fulfillment) else 0
        else:
            avg_fulfillment = 0

        kpis["avg_fulfillment_time"] = KPIMetric(
            name="Avg Fulfillment Time",
            current_value=avg_fulfillment,
            unit="h",
            score=80,
            status="normal",
            category="request"
        )

        # CSAT Score
        if "Satisfaction Score" in fulfilled_df.columns:
            csat_scores = fulfilled_df["Satisfaction Score"].dropna()
            avg_csat = csat_scores.mean() if len(csat_scores) > 0 else 0
        else:
            avg_csat = 0

        csat_score = self._score_threshold(avg_csat / 5 if avg_csat > 0 else 0, CSAT_THRESHOLDS)

        kpis["request_csat"] = KPIMetric(
            name="CSAT Score",
            current_value=avg_csat,
            unit="/5",
            score=csat_score,
            status="danger" if avg_csat < 3.0 else "warning" if avg_csat < 3.5 else "normal",
            category="request"
        )

        # Total Requests
        kpis["total_requests"] = KPIMetric(
            name="Total Requests",
            current_value=total_requests,
            unit="",
            score=100,
            status="normal",
            category="request"
        )

        # Detect risks
        if request_sla_rate < 0.80:
            risks.append(RiskItem(
                id="R006",
                priority="Warning",
                message=f"Request SLA compliance at {request_sla_rate:.1%}",
                impact="Service request fulfillment delays",
                process="request",
                value=request_sla_rate
            ))

        if avg_csat < 3.5:
            risks.append(RiskItem(
                id="R007",
                priority="Warning",
                message=f"Customer satisfaction score is {avg_csat:.2f}/5",
                impact="Low satisfaction indicates service quality issues",
                process="request",
                value=avg_csat
            ))

        # Highlights
        if avg_csat >= 4.0:
            highlights.append(f"Good customer satisfaction: {avg_csat:.2f}/5")
        if request_sla_rate >= 0.90:
            highlights.append(f"Strong request SLA compliance: {request_sla_rate:.1%}")

        return ProcessSummary(
            name="Service Requests",
            total_count=total_requests,
            kpis=kpis,
            risks=risks,
            highlights=highlights
        )

    # =========================================================================
    # Problem Analysis
    # =========================================================================

    def _analyze_problems(self) -> ProcessSummary:
        """Analyze problem management metrics."""
        kpis = {}
        risks = []
        highlights = []

        if self.problems_df is None or len(self.problems_df) == 0:
            return ProcessSummary(
                name="Problem Management",
                total_count=0,
                kpis=kpis,
                risks=risks,
                highlights=["No problem data available"]
            )

        total_problems = len(self.problems_df)

        # Resolution Rate
        resolved = len(self.problems_df[self.problems_df["Status"].isin(["Resolved", "Closed"])])
        resolution_rate = safe_divide(resolved, total_problems)
        resolution_score = self._score_threshold(resolution_rate, PROBLEM_CLOSURE_THRESHOLDS)

        kpis["problem_closure_rate"] = KPIMetric(
            name="Problem Closure Rate",
            current_value=resolution_rate,
            unit="%",
            score=resolution_score,
            status="danger" if resolution_rate < 0.40 else "warning" if resolution_rate < 0.60 else "normal",
            category="problem"
        )

        # RCA Completion Rate
        has_rca = len(self.problems_df[self.problems_df["Root Cause"].notna() & (self.problems_df["Root Cause"] != "")])
        rca_rate = safe_divide(has_rca, total_problems)
        rca_score = self._score_threshold(rca_rate, RCA_COMPLETION_THRESHOLDS)

        kpis["rca_rate"] = KPIMetric(
            name="RCA Completion",
            current_value=rca_rate,
            unit="%",
            score=rca_score,
            status="danger" if rca_rate < 0.60 else "warning" if rca_rate < 0.80 else "normal",
            category="problem"
        )

        # Known Error Count
        known_errors = len(self.problems_df[self.problems_df["Known Error"] == "Yes"])

        kpis["known_errors"] = KPIMetric(
            name="Known Errors",
            current_value=known_errors,
            unit="",
            score=80,
            status="normal",
            category="problem"
        )

        # Open Problems
        open_problems = len(self.problems_df[~self.problems_df["Status"].isin(["Resolved", "Closed"])])

        kpis["open_problems"] = KPIMetric(
            name="Open Problems",
            current_value=open_problems,
            unit="",
            score=100,
            status="warning" if open_problems > 10 else "normal",
            category="problem"
        )

        # Total Related Incidents
        total_related_incidents = self.problems_df["Related Incidents"].sum()
        avg_related = safe_divide(total_related_incidents, total_problems)

        kpis["avg_related_incidents"] = KPIMetric(
            name="Avg Linked Incidents",
            current_value=avg_related,
            unit="",
            score=80,
            status="normal",
            category="problem"
        )

        # Detect risks
        if resolution_rate < 0.50:
            risks.append(RiskItem(
                id="R008",
                priority="Warning",
                message=f"Problem resolution rate at {resolution_rate:.1%}",
                impact="Unresolved problems may cause recurring incidents",
                process="problem",
                value=resolution_rate
            ))

        if rca_rate < 0.70:
            risks.append(RiskItem(
                id="R009",
                priority="Attention",
                message=f"Root cause analysis completion at {rca_rate:.1%}",
                impact="Lack of RCA may lead to repeat issues",
                process="problem",
                value=rca_rate
            ))

        # Highlights
        if known_errors > 0:
            highlights.append(f"{known_errors} known errors documented")
        if rca_rate >= 0.80:
            highlights.append(f"Good RCA completion rate: {rca_rate:.1%}")

        return ProcessSummary(
            name="Problem Management",
            total_count=total_problems,
            kpis=kpis,
            risks=risks,
            highlights=highlights
        )

    # =========================================================================
    # Combined Metrics
    # =========================================================================

    def _combine_kpis(
        self,
        incident_summary: ProcessSummary,
        change_summary: ProcessSummary,
        request_summary: ProcessSummary,
        problem_summary: ProcessSummary
    ) -> Dict[str, KPIMetric]:
        """Combine KPIs from all processes for dashboard."""
        kpis = {}

        # Select key KPIs for main dashboard
        key_incident_kpis = ["sla_rate", "avg_mttr", "p1_p2_count", "backlog"]
        key_change_kpis = ["change_success_rate", "change_incident_rate"]
        key_request_kpis = ["request_sla_rate", "request_csat", "fulfillment_rate"]
        key_problem_kpis = ["problem_closure_rate", "rca_rate"]

        for key in key_incident_kpis:
            if key in incident_summary.kpis:
                kpis[key] = incident_summary.kpis[key]

        for key in key_change_kpis:
            if key in change_summary.kpis:
                kpis[key] = change_summary.kpis[key]

        for key in key_request_kpis:
            if key in request_summary.kpis:
                kpis[key] = request_summary.kpis[key]

        for key in key_problem_kpis:
            if key in problem_summary.kpis:
                kpis[key] = problem_summary.kpis[key]

        return kpis

    def _calculate_health_score(self, kpis: Dict[str, KPIMetric]) -> Tuple[float, str, str]:
        """Calculate overall health score from all processes."""
        score = 0.0
        total_weight = 0.0

        weight_mapping = {
            "sla_rate": HEALTH_SCORE_WEIGHTS.get("sla_rate", 0.25),
            "avg_mttr": HEALTH_SCORE_WEIGHTS.get("mttr", 0.15),
            "p1_p2_count": HEALTH_SCORE_WEIGHTS.get("p1_p2_trend", 0.10),
            "change_success_rate": HEALTH_SCORE_WEIGHTS.get("change_success_rate", 0.15),
            "change_incident_rate": HEALTH_SCORE_WEIGHTS.get("change_incident_rate", 0.05),
            "request_sla_rate": HEALTH_SCORE_WEIGHTS.get("request_sla_rate", 0.10),
            "request_csat": HEALTH_SCORE_WEIGHTS.get("request_csat", 0.10),
            "problem_closure_rate": HEALTH_SCORE_WEIGHTS.get("problem_closure_rate", 0.05),
            "backlog": HEALTH_SCORE_WEIGHTS.get("backlog_rate", 0.05),
        }

        for key, weight in weight_mapping.items():
            if key in kpis:
                score += kpis[key].score * weight
                total_weight += weight

        # Normalize if not all KPIs present
        if total_weight > 0 and total_weight < 1.0:
            score = score / total_weight

        # Determine grade
        for threshold, grade, emoji in HEALTH_GRADES:
            if score >= threshold:
                return score, grade, emoji

        return score, HEALTH_GRADES[-1][1], HEALTH_GRADES[-1][2]

    # =========================================================================
    # Utility Methods
    # =========================================================================

    def _score_threshold(self, value: float, thresholds: list) -> float:
        """Score value against thresholds (higher is better)."""
        for threshold, score in thresholds:
            if value >= threshold:
                return score
        return 0

    def _score_threshold_reverse(self, value: float, thresholds: list) -> float:
        """Score value against thresholds (lower is better)."""
        for threshold, score in thresholds:
            if value < threshold:
                return score
        return 0

    def _risk_priority_order(self, priority: str) -> int:
        """Get priority order for sorting."""
        order = {"Critical": 0, "Warning": 1, "Attention": 2}
        return order.get(priority, 3)

    def _get_wow_comparison(self, reference_date: datetime) -> PeriodComparison:
        """Get week-over-week comparison periods."""
        current_start, current_end = get_week_boundaries(reference_date)
        previous_start, previous_end = get_week_boundaries(reference_date - timedelta(days=7))

        return PeriodComparison(
            current_start=current_start,
            current_end=current_end,
            previous_start=previous_start,
            previous_end=previous_end,
            comparison_type="wow",
            has_comparison=True
        )

    def _get_mom_comparison(self, reference_date: datetime) -> PeriodComparison:
        """Get month-over-month comparison periods."""
        current_start, current_end = get_month_boundaries(reference_date)
        prev_month_date = reference_date.replace(day=1) - timedelta(days=1)
        previous_start, previous_end = get_month_boundaries(prev_month_date)

        return PeriodComparison(
            current_start=current_start,
            current_end=current_end,
            previous_start=previous_start,
            previous_end=previous_end,
            comparison_type="mom",
            has_comparison=True
        )

    def _calculate_combined_trends(self, granularity: str) -> Dict[str, TrendData]:
        """Calculate trends for all processes."""
        trends = {}

        # Set period based on granularity
        if granularity == "monthly":
            self.incidents_df["Period"] = self.incidents_df["Begin Date"].dt.to_period("M")
        elif granularity == "weekly":
            self.incidents_df["Period"] = self.incidents_df["Begin Date"].dt.to_period("W")
        else:
            self.incidents_df["Period"] = self.incidents_df["Begin Date"].dt.to_period("D")

        periods = sorted(self.incidents_df["Period"].dropna().unique())[-12:]

        # Incident volume trend
        volume_points = []
        for period in periods:
            count = len(self.incidents_df[self.incidents_df["Period"] == period])
            volume_points.append(TrendPoint(period=str(period), value=count, label="Incidents"))

        trends["incident_volume"] = TrendData(
            metric="Incident Volume",
            points=volume_points,
            direction=self._get_trend_direction([p.value for p in volume_points]),
            granularity=granularity
        )

        # SLA trend
        sla_points = []
        for period in periods:
            period_df = self.incidents_df[self.incidents_df["Period"] == period]
            sla = self._calculate_sla_rate(period_df)
            sla_points.append(TrendPoint(period=str(period), value=sla * 100, label="SLA %"))

        trends["sla"] = TrendData(
            metric="SLA Rate",
            points=sla_points,
            direction=self._get_trend_direction([p.value for p in sla_points]),
            granularity=granularity
        )

        # MTTR trend
        mttr_points = []
        for period in periods:
            period_df = self.incidents_df[self.incidents_df["Period"] == period]
            mttr = self._calculate_avg_mttr(period_df)
            mttr_points.append(TrendPoint(period=str(period), value=mttr, label="MTTR (h)"))

        trends["mttr"] = TrendData(
            metric="Avg MTTR",
            points=mttr_points,
            direction=self._get_trend_direction([p.value for p in mttr_points], reverse=True),
            granularity=granularity
        )

        return trends

    def _get_trend_direction(self, values: List[float], reverse: bool = False) -> str:
        """Determine trend direction from values."""
        if len(values) < 2:
            return "stable"

        x = np.arange(len(values))
        y = np.array(values)

        if np.std(y) == 0:
            return "stable"

        slope = np.polyfit(x, y, 1)[0]
        normalized_slope = slope / np.mean(y) if np.mean(y) != 0 else 0

        threshold = 0.05

        if reverse:
            if normalized_slope < -threshold:
                return "improving"
            elif normalized_slope > threshold:
                return "declining"
        else:
            if normalized_slope > threshold:
                return "rising"
            elif normalized_slope < -threshold:
                return "declining"

        return "stable"

    def _get_major_incidents(self) -> List[MajorIncident]:
        """Get major P1/P2 incidents."""
        p1_p2_df = self.incidents_df[self.incidents_df["Priority"].isin(["P1", "P2"])].copy()

        if len(p1_p2_df) == 0:
            return []

        p1_p2_df["Priority_Order"] = p1_p2_df["Priority"].map({"P1": 0, "P2": 1})
        p1_p2_df = p1_p2_df.sort_values(["Priority_Order", "Begin Date"], ascending=[True, False])

        incidents = []
        for _, row in p1_p2_df.head(5).iterrows():
            incidents.append(MajorIncident(
                order_number=str(row.get("Order Number", "")),
                name=str(row.get("Order Name", ""))[:100],
                priority=str(row.get("Priority", "")),
                status=str(row.get("Order Status", "")),
                begin_date=row["Begin Date"],
                resolution_time=row.get("Resolution Time(m)")
            ))

        return incidents

    def _get_failed_changes(self) -> List[ChangeRecord]:
        """Get failed changes."""
        if self.changes_df is None:
            return []

        failed_df = self.changes_df[self.changes_df["Success"] == "No"].head(5)

        changes = []
        for _, row in failed_df.iterrows():
            changes.append(ChangeRecord(
                change_number=str(row.get("Change Number", "")),
                title=str(row.get("Change Title", ""))[:80],
                change_type=str(row.get("Change Type", "")),
                status=str(row.get("Status", "")),
                success=False,
                incident_caused=row.get("Incident Caused", "No") == "Yes"
            ))

        return changes

    def _get_open_problems(self) -> List[ProblemRecord]:
        """Get open problems."""
        if self.problems_df is None:
            return []

        open_df = self.problems_df[~self.problems_df["Status"].isin(["Resolved", "Closed"])].head(5)

        problems = []
        for _, row in open_df.iterrows():
            problems.append(ProblemRecord(
                problem_number=str(row.get("Problem Number", "")),
                title=str(row.get("Problem Title", ""))[:80],
                status=str(row.get("Status", "")),
                known_error=row.get("Known Error", "No") == "Yes",
                related_incidents=int(row.get("Related Incidents", 0)),
                root_cause=str(row.get("Root Cause", ""))[:50] if pd.notna(row.get("Root Cause")) else ""
            ))

        return problems

    def _get_sla_breakdown(self) -> List[SLABreakdown]:
        """Get SLA breakdown by priority."""
        breakdown = []

        for priority in ["P1", "P2", "P3", "P4"]:
            priority_df = self.incidents_df[self.incidents_df["Priority"] == priority]
            total = len(priority_df)

            if total == 0:
                continue

            compliant = 0
            sla_val = self.sla_map.get(priority, 24)
            if isinstance(sla_val, dict):
                sla_minutes = sla_val.get("resolution_hours", 24) * 60
            else:
                sla_minutes = float(sla_val) * 60

            for _, row in priority_df.iterrows():
                resolution_time = row.get("Resolution Time(m)", 0)
                if pd.notna(resolution_time) and resolution_time <= sla_minutes:
                    compliant += 1

            target_val = self.sla_map.get(priority, 24)
            if isinstance(target_val, dict):
                target_val = target_val.get("resolution_hours", 24)
            breakdown.append(SLABreakdown(
                priority=priority,
                total=total,
                compliant=compliant,
                rate=safe_divide(compliant, total),
                target=target_val
            ))

        return breakdown

    def _generate_actions(
        self,
        risks: List[RiskItem],
        kpis: Dict[str, KPIMetric]
    ) -> List[ActionItem]:
        """Generate action recommendations based on risks and KPIs."""
        actions = []

        # Incident actions
        sla = kpis.get("sla_rate")
        if sla and sla.current_value < 0.90:
            actions.append(ActionItem(
                priority="URGENT" if sla.current_value < 0.80 else "HIGH",
                action="Review and optimize incident SLA compliance processes",
                expected_impact="Improve SLA rate by 10-15%",
                process="incident"
            ))

        mttr = kpis.get("avg_mttr")
        if mttr and mttr.current_value > 24:
            actions.append(ActionItem(
                priority="HIGH" if mttr.current_value > 48 else "MEDIUM",
                action="Analyze and streamline incident resolution workflow",
                expected_impact="Reduce average MTTR by 20-30%",
                process="incident"
            ))

        # Change actions
        change_success = kpis.get("change_success_rate")
        if change_success and change_success.current_value < 0.90:
            actions.append(ActionItem(
                priority="HIGH",
                action="Strengthen change assessment and testing procedures",
                expected_impact="Improve change success rate to 95%+",
                process="change"
            ))

        change_incident = kpis.get("change_incident_rate")
        if change_incident and change_incident.current_value > 0.05:
            actions.append(ActionItem(
                priority="URGENT",
                action="Implement post-change validation and monitoring",
                expected_impact="Reduce change-induced incidents by 50%",
                process="change"
            ))

        # Request actions
        csat = kpis.get("request_csat")
        if csat and csat.current_value < 4.0:
            actions.append(ActionItem(
                priority="MEDIUM",
                action="Analyze customer feedback and improve service delivery",
                expected_impact="Improve CSAT to 4.0+",
                process="request"
            ))

        # Problem actions
        problem_closure = kpis.get("problem_closure_rate")
        if problem_closure and problem_closure.current_value < 0.60:
            actions.append(ActionItem(
                priority="MEDIUM",
                action="Accelerate problem investigation and resolution",
                expected_impact="Reduce recurring incidents",
                process="problem"
            ))

        rca = kpis.get("rca_rate")
        if rca and rca.current_value < 0.80:
            actions.append(ActionItem(
                priority="MEDIUM",
                action="Improve root cause analysis process and documentation",
                expected_impact="Prevent problem recurrence",
                process="problem"
            ))

        # Sort by priority
        priority_order = {"URGENT": 0, "HIGH": 1, "MEDIUM": 2}
        actions = sorted(actions, key=lambda x: priority_order.get(x.priority, 3))

        return actions[:5]  # Return top 5
