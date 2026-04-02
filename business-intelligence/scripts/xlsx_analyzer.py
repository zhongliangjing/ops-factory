"""
XLSX Detail Analyzer — granular per-sheet data computation.

Computes data that ComprehensiveResult doesn't provide:
- Priority breakdown with percentiles
- Category analysis with resolution stats
- Personnel efficiency and risk detection
- Time dimension analysis (day-of-week, hour-of-day, monthly trends)
- SLA violation details with root cause classification
- Cross-process correlations (Change->Incident, Problem->Incident)
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple

import numpy as np
import pandas as pd

from utils import safe_divide
from xlsx_theme import format_duration


# =============================================================================
# Dataclasses
# =============================================================================

@dataclass
class PriorityRow:
    priority: str
    count: int
    pct: float
    cum_pct: float
    avg_resolution_min: float
    median_resolution_min: float
    min_resolution_min: float
    max_resolution_min: float
    response_sla_rate: float
    resolution_sla_rate: float
    violation_count: int


@dataclass
class CategoryRow:
    category: str
    count: int
    pct: float
    cum_pct: float
    avg_resolution_min: float
    median_resolution_min: float
    min_resolution_min: float
    max_resolution_min: float
    std_resolution_min: float
    priority_dist: Dict[str, int]


@dataclass
class PersonnelRow:
    name: str
    count: int
    pct: float
    avg_resolution_min: float
    completion_rate: float
    response_sla_rate: float
    resolution_sla_rate: float
    rating: str
    specialty: str


@dataclass
class PersonnelPriorityRow:
    """Personnel breakdown with priority distribution."""
    name: str
    p1_count: int
    p2_count: int
    p3_count: int
    p4_count: int
    total: int
    high_priority_pct: float  # (P1+P2) / total


@dataclass
class WorkloadBucket:
    level: str
    count: int
    pct: float
    avg_events: float
    suggestion: str


@dataclass
class SkillCoverage:
    category: str
    handler_count: int
    primary_handler: str
    coverage_rate: float
    risk_level: str


@dataclass
class SLAViolation:
    order_number: str
    priority: str
    category: str
    violation_type: str
    overtime: str
    resolver: str
    status: str
    reason: str
    month: str = ""


@dataclass
class ViolationRootCause:
    cause: str
    count: int
    pct: float
    typical_case: str
    improvement: str


@dataclass
class MonthlyTrend:
    period: str
    incident_count: int = 0
    change_count: int = 0
    request_count: int = 0
    problem_count: int = 0
    completion_rate: float = 0.0
    avg_resolution_min: float = 0.0
    high_priority_pct: float = 0.0
    mom_change: str = "N/A"
    assessment: str = ""
    change_success_rate: float = 0.0


@dataclass
class DayOfWeekRow:
    day: str
    count: int
    pct: float
    avg_resolution_min: float
    high_priority_count: int
    assessment: str


@dataclass
class HourBucket:
    period: str
    hour_range: str
    count: int
    pct: float
    avg_resolution_min: float
    suggestion: str


@dataclass
class ChangeDetailRow:
    change_type: str
    count: int
    pct: float
    success_rate: float
    incident_rate: float
    avg_duration_hours: float


@dataclass
class ChangeCategoryRow:
    category: str
    count: int
    success_rate: float
    failure_count: int
    incident_count: int
    risk_level: str


@dataclass
class RequestTypeRow:
    request_type: str
    count: int
    pct: float
    completion_rate: float
    avg_fulfillment_hours: float
    csat: float


@dataclass
class CSATBucket:
    score: str
    label: str
    count: int
    pct: float
    cum_pct: float


@dataclass
class ProblemStatusRow:
    status: str
    count: int
    pct: float
    avg_age_days: float
    suggestion: str


@dataclass
class RootCauseCategoryRow:
    category: str
    count: int
    pct: float
    related_incidents: int
    permanent_fix_rate: float
    typical_problem: str


@dataclass
class CrossProcessLink:
    source_id: str
    source_type: str
    target_count: int
    target_ids: str
    impact: str


@dataclass
class ProcessHealthRow:
    process: str
    volume: int
    quality: float
    efficiency: float
    trend: str
    rating: str


@dataclass
class ActionPlanRow:
    seq: int
    priority: str
    action: str
    source_sheet: str
    source_process: str
    responsible: str
    expected_effect: str


# =============================================================================
# Helper utilities
# =============================================================================

def _bool_col(series: pd.Series) -> pd.Series:
    """Convert a boolean-ish column to actual bool."""
    return series.astype(str).str.strip().str.lower().isin(["yes", "true", "1"])


def _safe_col(df: pd.DataFrame, col: str) -> pd.Series:
    """Return column if exists, else Series of NaN."""
    if df is None or col not in df.columns:
        return pd.Series(dtype="float64")
    return df[col]


def _nonempty(df: Optional[pd.DataFrame]) -> bool:
    return df is not None and not df.empty


# =============================================================================
# Main Analyzer
# =============================================================================

class XlsxDetailAnalyzer:
    """Compute granular per-sheet data for the XLSX Comprehensive Report."""

    def __init__(
        self,
        incidents_df: Optional[pd.DataFrame],
        changes_df: Optional[pd.DataFrame],
        requests_df: Optional[pd.DataFrame],
        problems_df: Optional[pd.DataFrame],
        sla_map: Dict,
        result,
        language: str = "en",
    ):
        self.inc = incidents_df if incidents_df is not None else pd.DataFrame()
        self.chg = changes_df if changes_df is not None else pd.DataFrame()
        self.req = requests_df if requests_df is not None else pd.DataFrame()
        self.prb = problems_df if problems_df is not None else pd.DataFrame()
        self.sla_map = sla_map or {}
        self.result = result
        self.lang = language

    # -----------------------------------------------------------------
    # Sheet 2 — Incidents
    # -----------------------------------------------------------------

    def priority_breakdown(self) -> List[PriorityRow]:
        if not _nonempty(self.inc) or "Priority" not in self.inc.columns:
            return []
        df = self.inc
        total = len(df)
        rows: List[PriorityRow] = []
        cum = 0.0
        for priority, grp in df.groupby("Priority", sort=False):
            cnt = len(grp)
            pct = safe_divide(cnt, total)
            cum += pct
            rt = _safe_col(grp, "Resolution Time(m)")
            rt_valid = rt.dropna()

            # SLA rates — compute from Resolution Time(m) vs sla_map threshold
            resp_sla = 0.0
            res_sla = 0.0
            violation = 0

            sla_val = self.sla_map.get(str(priority))
            if sla_val is not None:
                if isinstance(sla_val, dict):
                    sla_minutes = sla_val.get("resolution_hours", 24) * 60
                else:
                    sla_minutes = float(sla_val) * 60

                if "Resolution Time(m)" in grp.columns:
                    rt_vals = grp["Resolution Time(m)"].dropna()
                    compliant_count = (rt_vals <= sla_minutes).sum()
                    res_sla = safe_divide(compliant_count, len(rt_vals))
                    violation = int((rt_vals > sla_minutes).sum())

                # Response SLA (if Response Time(m) exists and has non-zero values)
                if "Response Time(m)" in grp.columns:
                    resp_vals = grp["Response Time(m)"].dropna()
                    resp_vals = resp_vals[resp_vals > 0]  # skip zeros (no response tracking)
                    if len(resp_vals) > 0:
                        if isinstance(sla_val, dict):
                            resp_limit = sla_val.get("response_minutes")
                        else:
                            resp_limit = None
                        if resp_limit is not None:
                            resp_sla = safe_divide((resp_vals <= resp_limit).sum(), len(resp_vals))

            rows.append(PriorityRow(
                priority=str(priority),
                count=cnt,
                pct=pct,
                cum_pct=cum,
                avg_resolution_min=float(rt_valid.mean()) if len(rt_valid) else 0.0,
                median_resolution_min=float(rt_valid.median()) if len(rt_valid) else 0.0,
                min_resolution_min=float(rt_valid.min()) if len(rt_valid) else 0.0,
                max_resolution_min=float(rt_valid.max()) if len(rt_valid) else 0.0,
                response_sla_rate=resp_sla,
                resolution_sla_rate=res_sla,
                violation_count=violation,
            ))
        return rows

    def category_breakdown(self, top_n: int = 20) -> List[CategoryRow]:
        if not _nonempty(self.inc) or "Category" not in self.inc.columns:
            return []
        df = self.inc
        total = len(df)
        counts = df["Category"].value_counts().head(top_n)
        rows: List[CategoryRow] = []
        cum = 0.0
        for cat, cnt in counts.items():
            grp = df[df["Category"] == cat]
            pct = safe_divide(cnt, total)
            cum += pct
            rt = _safe_col(grp, "Resolution Time(m)").dropna()
            pdist: Dict[str, int] = {}
            if "Priority" in grp.columns:
                pdist = grp["Priority"].value_counts().to_dict()
                pdist = {str(k): int(v) for k, v in pdist.items()}
            rows.append(CategoryRow(
                category=str(cat),
                count=int(cnt),
                pct=pct,
                cum_pct=cum,
                avg_resolution_min=float(rt.mean()) if len(rt) else 0.0,
                median_resolution_min=float(rt.median()) if len(rt) else 0.0,
                min_resolution_min=float(rt.min()) if len(rt) else 0.0,
                max_resolution_min=float(rt.max()) if len(rt) else 0.0,
                std_resolution_min=float(rt.std()) if len(rt) > 1 else 0.0,
                priority_dist=pdist,
            ))
        return rows

    # -----------------------------------------------------------------
    # Sheet 3 — SLA
    # -----------------------------------------------------------------

    def sla_violations(self) -> List[SLAViolation]:
        if not _nonempty(self.inc):
            return []
        df = self.inc
        violations: List[SLAViolation] = []
        if "Resolution Time(m)" not in df.columns:
            return []
        # Find violations: Resolution Time(m) > SLA threshold
        for _, row in df.iterrows():
            priority = str(row.get("Priority", "P3"))
            rt = row.get("Resolution Time(m)", None)
            if rt is None or pd.isna(rt):
                continue
            sla_val = self.sla_map.get(priority)
            if sla_val is None:
                continue
            sla_minutes = float(sla_val) * 60 if not isinstance(sla_val, dict) else sla_val.get("resolution_hours", 24) * 60
            if rt <= sla_minutes:
                continue  # compliant, skip
            over = rt - sla_minutes
            overtime_str = format_duration(over, self.lang)
            reason = f"Resolution exceeded by {overtime_str}"

            # Extract month from incident date for heatmap
            month_str = ""
            for date_col in ["Begin Date", "begin_date", "Created Date"]:
                if date_col in row.index:
                    try:
                        dt = pd.to_datetime(row[date_col])
                        if pd.notna(dt):
                            month_str = dt.strftime("%Y-%m")
                    except Exception:
                        pass
                    break

            violations.append(SLAViolation(
                order_number=str(row.get("Order Number", "N/A")),
                priority=priority,
                category=str(row.get("Category", "N/A")),
                violation_type="Resolution",
                overtime=overtime_str,
                resolver=str(row.get("Resolver", "N/A")),
                status=str(row.get("Order Status", "N/A")),
                reason=reason,
                month=month_str,
            ))
        return violations

    def violation_root_causes(self, violations: List[SLAViolation]) -> List[ViolationRootCause]:
        if not violations:
            return []
        # Classify by simple heuristics
        cause_map: Dict[str, List[SLAViolation]] = {}
        for v in violations:
            cause = "Other"
            reason_lower = v.reason.lower()
            if "exceeded" in reason_lower:
                cause = "Resolution Time Exceeded"
            elif "response" in reason_lower:
                cause = "Response Time Exceeded"
            else:
                cause = "Process/Compliance Issue"
            cause_map.setdefault(cause, []).append(v)

        total = len(violations)
        rows: List[ViolationRootCause] = []
        improvements = {
            "Resolution Time Exceeded": "Optimize assignment and escalation processes",
            "Response Time Exceeded": "Improve initial response monitoring and alerts",
            "Process/Compliance Issue": "Review SLA compliance tracking and reporting",
            "Other": "Investigate individual cases for root cause",
        }
        for cause, vlist in sorted(cause_map.items(), key=lambda x: -len(x[1])):
            rows.append(ViolationRootCause(
                cause=cause,
                count=len(vlist),
                pct=safe_divide(len(vlist), total),
                typical_case=vlist[0].order_number if vlist else "N/A",
                improvement=improvements.get(cause, "Review and improve"),
            ))
        return rows

    # -----------------------------------------------------------------
    # Sheet 4 — Changes
    # -----------------------------------------------------------------

    def change_type_breakdown(self) -> List[ChangeDetailRow]:
        if not _nonempty(self.chg) or "Change Type" not in self.chg.columns:
            return []
        df = self.chg
        total = len(df)
        rows: List[ChangeDetailRow] = []
        for ctype, grp in df.groupby("Change Type", sort=False):
            cnt = len(grp)
            success = 0.0
            if "Success" in grp.columns:
                success = safe_divide(_bool_col(grp["Success"]).sum(), cnt)
            incident_rate = 0.0
            if "Incident Caused" in grp.columns:
                incident_rate = safe_divide(_bool_col(grp["Incident Caused"]).sum(), cnt)
            duration = 0.0
            if "Actual Start" in grp.columns and "Actual End" in grp.columns:
                starts = pd.to_datetime(grp["Actual Start"], errors="coerce")
                ends = pd.to_datetime(grp["Actual End"], errors="coerce")
                dur = (ends - starts).dt.total_seconds() / 3600
                dur_valid = dur.dropna()
                duration = float(dur_valid.mean()) if len(dur_valid) else 0.0
            rows.append(ChangeDetailRow(
                change_type=str(ctype),
                count=cnt,
                pct=safe_divide(cnt, total),
                success_rate=success,
                incident_rate=incident_rate,
                avg_duration_hours=duration,
            ))
        return rows

    def change_category_breakdown(self) -> List[ChangeCategoryRow]:
        if not _nonempty(self.chg) or "Category" not in self.chg.columns:
            return []
        df = self.chg
        rows: List[ChangeCategoryRow] = []
        for cat, grp in df.groupby("Category", sort=False):
            cnt = len(grp)
            success = 0.0
            fail = 0
            if "Success" in grp.columns:
                succ_mask = _bool_col(grp["Success"])
                success = safe_divide(succ_mask.sum(), cnt)
                fail = int((~succ_mask).sum())
            inc_cnt = 0
            if "Incident Caused" in grp.columns:
                inc_cnt = int(_bool_col(grp["Incident Caused"]).sum())
            risk = "Low"
            if safe_divide(fail, cnt) > 0.2 or safe_divide(inc_cnt, cnt) > 0.1:
                risk = "High"
            elif safe_divide(fail, cnt) > 0.1 or safe_divide(inc_cnt, cnt) > 0.05:
                risk = "Medium"
            rows.append(ChangeCategoryRow(
                category=str(cat),
                count=cnt,
                success_rate=success,
                failure_count=fail,
                incident_count=inc_cnt,
                risk_level=risk,
            ))
        return rows

    # -----------------------------------------------------------------
    # Sheet 5 — Requests
    # -----------------------------------------------------------------

    def request_type_breakdown(self) -> List[RequestTypeRow]:
        if not _nonempty(self.req) or "Request Type" not in self.req.columns:
            return []
        df = self.req
        total = len(df)
        rows: List[RequestTypeRow] = []
        for rtype, grp in df.groupby("Request Type", sort=False):
            cnt = len(grp)
            comp_rate = 0.0
            if "Status" in grp.columns:
                completed = grp["Status"].astype(str).str.strip().str.lower().isin(
                    ["completed", "fulfilled", "closed", "resolved"]
                )
                comp_rate = safe_divide(completed.sum(), cnt)
            avg_fulfill = 0.0
            if "Fulfillment Time(h)" in grp.columns:
                ft = grp["Fulfillment Time(h)"].dropna()
                avg_fulfill = float(ft.mean()) if len(ft) else 0.0
            csat = 0.0
            if "Satisfaction Score" in grp.columns:
                scores = pd.to_numeric(grp["Satisfaction Score"], errors="coerce").dropna()
                csat = float(scores.mean()) if len(scores) else 0.0
            rows.append(RequestTypeRow(
                request_type=str(rtype),
                count=cnt,
                pct=safe_divide(cnt, total),
                completion_rate=comp_rate,
                avg_fulfillment_hours=avg_fulfill,
                csat=csat,
            ))
        return rows

    def csat_distribution(self) -> List[CSATBucket]:
        if not _nonempty(self.req) or "Satisfaction Score" not in self.req.columns:
            return []
        scores = pd.to_numeric(self.req["Satisfaction Score"], errors="coerce").dropna()
        if len(scores) == 0:
            return []
        labels = {5: "Very Satisfied", 4: "Satisfied", 3: "Neutral", 2: "Dissatisfied", 1: "Very Dissatisfied"}
        total = len(scores)
        rows: List[CSATBucket] = []
        cum = 0.0
        for s in [5, 4, 3, 2, 1]:
            cnt = int((scores == s).sum())
            pct = safe_divide(cnt, total)
            cum += pct
            rows.append(CSATBucket(
                score=str(s),
                label=labels.get(s, str(s)),
                count=cnt,
                pct=pct,
                cum_pct=cum,
            ))
        return rows

    # -----------------------------------------------------------------
    # Sheet 6 — Problems
    # -----------------------------------------------------------------

    def problem_status_breakdown(self) -> List[ProblemStatusRow]:
        if not _nonempty(self.prb) or "Status" not in self.prb.columns:
            return []
        df = self.prb
        total = len(df)
        rows: List[ProblemStatusRow] = []
        suggestions = {
            "open": "Assign and begin investigation",
            "in progress": "Monitor progress and ensure timelines",
            "known error": "Prioritize permanent fix implementation",
            "resolved": "Verify fix effectiveness",
            "closed": "Archive and update knowledge base",
        }
        for status, grp in df.groupby("Status", sort=False):
            cnt = len(grp)
            avg_age = 0.0
            if "Logged Date" in grp.columns:
                logged = pd.to_datetime(grp["Logged Date"], errors="coerce")
                ages = (pd.Timestamp.now() - logged).dt.days
                ages_valid = ages.dropna()
                avg_age = float(ages_valid.mean()) if len(ages_valid) else 0.0
            status_lower = str(status).strip().lower()
            suggestion = suggestions.get(status_lower, "Review and update status")
            rows.append(ProblemStatusRow(
                status=str(status),
                count=cnt,
                pct=safe_divide(cnt, total),
                avg_age_days=avg_age,
                suggestion=suggestion,
            ))
        return rows

    def root_cause_category_breakdown(self) -> List[RootCauseCategoryRow]:
        if not _nonempty(self.prb) or "Root Cause Category" not in self.prb.columns:
            return []
        df = self.prb
        total = len(df)
        rows: List[RootCauseCategoryRow] = []
        for cat, grp in df.groupby("Root Cause Category", sort=False):
            cnt = len(grp)
            related = 0
            if "Related Incidents" in grp.columns:
                ri = grp["Related Incidents"].dropna().astype(str)
                for v in ri:
                    parts = [p.strip() for p in v.replace(";", ",").split(",") if p.strip()]
                    related += len(parts)
            fix_rate = 0.0
            if "Permanent Fix Implemented" in grp.columns:
                fix_rate = safe_divide(_bool_col(grp["Permanent Fix Implemented"]).sum(), cnt)
            typical = str(grp.iloc[0].get("Problem Title", "N/A")) if len(grp) else "N/A"
            rows.append(RootCauseCategoryRow(
                category=str(cat),
                count=cnt,
                pct=safe_divide(cnt, total),
                related_incidents=related,
                permanent_fix_rate=fix_rate,
                typical_problem=typical,
            ))
        return rows

    # -----------------------------------------------------------------
    # Sheet 7 — Cross-Process
    # -----------------------------------------------------------------

    def change_incident_links(self) -> List[CrossProcessLink]:
        if not _nonempty(self.chg):
            return []
        df = self.chg
        links: List[CrossProcessLink] = []
        if "Incident Caused" not in df.columns or "Related Incidents" not in df.columns:
            return []
        caused = df[_bool_col(df["Incident Caused"])]
        for _, row in caused.iterrows():
            ri = str(row.get("Related Incidents", ""))
            ids = [p.strip() for p in ri.replace(";", ",").split(",") if p.strip()]
            impact = "High" if len(ids) > 2 else ("Medium" if len(ids) > 0 else "Low")
            links.append(CrossProcessLink(
                source_id=str(row.get("Change Number", "N/A")),
                source_type="Change",
                target_count=len(ids),
                target_ids=", ".join(ids) if ids else "N/A",
                impact=impact,
            ))
        return links

    def problem_incident_links(self) -> List[CrossProcessLink]:
        if not _nonempty(self.prb):
            return []
        df = self.prb
        links: List[CrossProcessLink] = []
        if "Related Incidents" not in df.columns:
            return []
        for _, row in df.iterrows():
            ri = str(row.get("Related Incidents", ""))
            ids = [p.strip() for p in ri.replace(";", ",").split(",") if p.strip()]
            if not ids:
                continue
            impact = "High" if len(ids) > 3 else ("Medium" if len(ids) > 1 else "Low")
            links.append(CrossProcessLink(
                source_id=str(row.get("Problem Number", "N/A")),
                source_type="Problem",
                target_count=len(ids),
                target_ids=", ".join(ids),
                impact=impact,
            ))
        return links

    # -----------------------------------------------------------------
    # Sheet 8 — Personnel
    # -----------------------------------------------------------------

    def personnel_breakdown(self) -> List[PersonnelRow]:
        if not _nonempty(self.inc) or "Resolver" not in self.inc.columns:
            return []
        df = self.inc
        total = len(df)
        rows: List[PersonnelRow] = []
        for name, grp in df.groupby("Resolver", sort=False):
            cnt = len(grp)
            rt = _safe_col(grp, "Resolution Time(m)").dropna()
            avg_rt = float(rt.mean()) if len(rt) else 0.0

            # Completion rate
            comp = 0.0
            if "Order Status" in grp.columns:
                done = grp["Order Status"].astype(str).str.strip().str.lower().isin(
                    ["closed", "resolved", "completed"]
                )
                comp = safe_divide(done.sum(), cnt)

            # SLA rates
            resp_sla = 0.0
            res_sla = 0.0
            if "Resolution Time(m)" in grp.columns and "Priority" in grp.columns:
                res_ok = 0
                res_total = 0
                for _, r in grp.iterrows():
                    p = str(r.get("Priority", ""))
                    rt_val = r.get("Resolution Time(m)", None)
                    if pd.notna(rt_val) and p in self.sla_map:
                        sla_val = self.sla_map[p]
                        sla_min = float(sla_val) * 60 if not isinstance(sla_val, dict) else sla_val.get("resolution_hours", 24) * 60
                        res_total += 1
                        if rt_val <= sla_min:
                            res_ok += 1
                res_sla = safe_divide(res_ok, res_total)
            if "Response Time(m)" in grp.columns and "Priority" in grp.columns:
                resp_ok = 0
                resp_total = 0
                for _, r in grp.iterrows():
                    p = str(r.get("Priority", ""))
                    resp_t = r.get("Response Time(m)", None)
                    if pd.notna(resp_t) and p in self.sla_map:
                        sla_val = self.sla_map[p]
                        if isinstance(sla_val, dict):
                            lim = sla_val.get("response_minutes", None)
                        else:
                            lim = None  # sla_map stores resolution_hours, not response
                        if lim is not None:
                            resp_total += 1
                            if resp_t <= lim:
                                resp_ok += 1
                resp_sla = safe_divide(resp_ok, resp_total)

            # Rating
            overall = safe_divide(res_sla + comp, 2)
            if overall >= 0.95:
                rating = "Excellent" if self.lang == "en" else "优秀"
            elif overall >= 0.85:
                rating = "Good" if self.lang == "en" else "良好"
            elif overall >= 0.70:
                rating = "Fair" if self.lang == "en" else "一般"
            else:
                rating = "At Risk" if self.lang == "en" else "风险"

            # Specialty
            specialty = "General"
            if "Category" in grp.columns:
                top_cat = grp["Category"].value_counts()
                if len(top_cat) > 0:
                    specialty = str(top_cat.index[0])

            rows.append(PersonnelRow(
                name=str(name),
                count=cnt,
                pct=safe_divide(cnt, total),
                avg_resolution_min=avg_rt,
                completion_rate=comp,
                response_sla_rate=resp_sla,
                resolution_sla_rate=res_sla,
                rating=rating,
                specialty=specialty,
            ))
        return rows

    def personnel_priority_breakdown(self) -> List[PersonnelPriorityRow]:
        """Compute personnel breakdown with priority distribution."""
        if not _nonempty(self.inc) or "Resolver" not in self.inc.columns or "Priority" not in self.inc.columns:
            return []
        df = self.inc
        rows: List[PersonnelPriorityRow] = []

        for name, grp in df.groupby("Resolver", sort=False):
            priority_counts = grp["Priority"].value_counts().to_dict()
            p1 = int(priority_counts.get("P1", 0))
            p2 = int(priority_counts.get("P2", 0))
            p3 = int(priority_counts.get("P3", 0))
            p4 = int(priority_counts.get("P4", 0))
            total = len(grp)
            high_pct = safe_divide(p1 + p2, total)

            rows.append(PersonnelPriorityRow(
                name=str(name),
                p1_count=p1,
                p2_count=p2,
                p3_count=p3,
                p4_count=p4,
                total=total,
                high_priority_pct=high_pct,
            ))

        # Sort by total count descending
        rows.sort(key=lambda x: x.total, reverse=True)
        return rows

    def workload_distribution(self, personnel: List[PersonnelRow]) -> List[WorkloadBucket]:
        if not personnel:
            return []
        counts = [p.count for p in personnel]
        avg = np.mean(counts)
        std = np.std(counts) if len(counts) > 1 else 0

        buckets: Dict[str, List[int]] = {"Light": [], "Normal": [], "Heavy": [], "Overloaded": []}
        for c in counts:
            if c > avg + 1.5 * std:
                buckets["Overloaded"].append(c)
            elif c > avg + 0.5 * std:
                buckets["Heavy"].append(c)
            elif c < avg - 0.5 * std:
                buckets["Light"].append(c)
            else:
                buckets["Normal"].append(c)

        total = len(counts)
        suggestions = {
            "Light": "Consider additional assignments or cross-training",
            "Normal": "Maintain current workload level",
            "Heavy": "Monitor for burnout and consider redistribution",
            "Overloaded": "Immediate workload redistribution needed",
        }
        rows: List[WorkloadBucket] = []
        for level in ["Light", "Normal", "Heavy", "Overloaded"]:
            clist = buckets[level]
            if not clist:
                continue
            rows.append(WorkloadBucket(
                level=level,
                count=len(clist),
                pct=safe_divide(len(clist), total),
                avg_events=float(np.mean(clist)),
                suggestion=suggestions[level],
            ))
        return rows

    def skill_coverage(self) -> List[SkillCoverage]:
        if not _nonempty(self.inc) or "Category" not in self.inc.columns or "Resolver" not in self.inc.columns:
            return []
        df = self.inc
        rows: List[SkillCoverage] = []
        total_resolvers = df["Resolver"].nunique()
        for cat, grp in df.groupby("Category", sort=False):
            handlers = grp["Resolver"].nunique()
            primary = str(grp["Resolver"].value_counts().index[0]) if len(grp) > 0 else "N/A"
            coverage = safe_divide(handlers, total_resolvers)
            if handlers <= 1:
                risk = "High"
            elif handlers <= 2:
                risk = "Medium"
            else:
                risk = "Low"
            rows.append(SkillCoverage(
                category=str(cat),
                handler_count=handlers,
                primary_handler=primary,
                coverage_rate=coverage,
                risk_level=risk,
            ))
        return rows

    # -----------------------------------------------------------------
    # Sheet 9 — Time Dimension
    # -----------------------------------------------------------------

    def monthly_trends(self) -> List[MonthlyTrend]:
        rows: List[MonthlyTrend] = []
        # Collect all periods
        periods: Dict[str, MonthlyTrend] = {}

        def _add_counts(df: pd.DataFrame, date_col: str, attr: str):
            if not _nonempty(df) or date_col not in df.columns:
                return
            dates = pd.to_datetime(df[date_col], errors="coerce").dropna()
            for d in dates:
                key = d.strftime("%Y-%m")
                if key not in periods:
                    periods[key] = MonthlyTrend(period=key)
                setattr(periods[key], attr, getattr(periods[key], attr) + 1)

        _add_counts(self.inc, "Begin Date", "incident_count")
        _add_counts(self.chg, "Requested Date", "change_count")
        _add_counts(self.req, "Requested Date", "request_count")
        _add_counts(self.prb, "Logged Date", "problem_count")

        # Compute per-period metrics for incidents
        if _nonempty(self.inc) and "Begin Date" in self.inc.columns:
            df = self.inc.copy()
            df["_month"] = pd.to_datetime(df["Begin Date"], errors="coerce").dt.strftime("%Y-%m")
            for month, grp in df.groupby("_month", sort=False):
                if month in periods:
                    if "Resolution Time(m)" in grp.columns:
                        rt = grp["Resolution Time(m)"].dropna()
                        periods[month].avg_resolution_min = float(rt.mean()) if len(rt) else 0.0
                    if "Resolution Time(m)" in grp.columns:
                        compliant = 0
                        total_with_rt = 0
                        for _, r in grp.iterrows():
                            p = str(r.get("Priority", "P3"))
                            rt_val = r.get("Resolution Time(m)")
                            if pd.notna(rt_val):
                                total_with_rt += 1
                                sla_v = self.sla_map.get(p)
                                if sla_v is not None:
                                    sla_min = float(sla_v) * 60 if not isinstance(sla_v, dict) else sla_v.get("resolution_hours", 24) * 60
                                    if rt_val <= sla_min:
                                        compliant += 1
                        periods[month].completion_rate = safe_divide(compliant, total_with_rt)
                    if "Priority" in grp.columns:
                        hp = grp["Priority"].astype(str).str.strip().str.upper().isin(["P1", "P2", "1", "2", "HIGH", "CRITICAL"])
                        periods[month].high_priority_pct = safe_divide(hp.sum(), len(grp))

        # Compute change success rate per month
        if _nonempty(self.chg) and "Requested Date" in self.chg.columns and "Success" in self.chg.columns:
            df_chg = self.chg.copy()
            df_chg["_month"] = pd.to_datetime(df_chg["Requested Date"], errors="coerce").dt.strftime("%Y-%m")
            for month, grp in df_chg.groupby("_month", sort=False):
                if month in periods:
                    success = _bool_col(grp["Success"]).sum()
                    periods[month].change_success_rate = safe_divide(success, len(grp))

        sorted_keys = sorted(periods.keys())
        prev_inc = None
        for key in sorted_keys:
            t = periods[key]
            if prev_inc is not None and prev_inc > 0:
                change_pct = safe_divide(t.incident_count - prev_inc, prev_inc)
                if change_pct > 0.05:
                    t.mom_change = f"+{change_pct:.1%}"
                    t.assessment = "Increasing"
                elif change_pct < -0.05:
                    t.mom_change = f"{change_pct:.1%}"
                    t.assessment = "Improving"
                else:
                    t.mom_change = f"{change_pct:.1%}"
                    t.assessment = "Stable"
            prev_inc = t.incident_count
            rows.append(t)
        return rows

    def day_of_week_analysis(self) -> List[DayOfWeekRow]:
        if not _nonempty(self.inc) or "Begin Date" not in self.inc.columns:
            return []
        df = self.inc.copy()
        df["_dow"] = pd.to_datetime(df["Begin Date"], errors="coerce").dt.dayofweek
        day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        total = len(df)
        rows: List[DayOfWeekRow] = []
        for dow in range(7):
            grp = df[df["_dow"] == dow]
            cnt = len(grp)
            rt = _safe_col(grp, "Resolution Time(m)").dropna()
            avg_rt = float(rt.mean()) if len(rt) else 0.0
            hp = 0
            if "Priority" in grp.columns:
                hp = int(grp["Priority"].astype(str).str.strip().str.upper().isin(
                    ["P1", "P2", "1", "2", "HIGH", "CRITICAL"]
                ).sum())
            avg_daily = safe_divide(cnt, max(1, total / 7))
            if avg_daily > 1.3:
                assessment = "Peak day"
            elif avg_daily < 0.7:
                assessment = "Low volume"
            else:
                assessment = "Normal"
            rows.append(DayOfWeekRow(
                day=day_names[dow],
                count=cnt,
                pct=safe_divide(cnt, total),
                avg_resolution_min=avg_rt,
                high_priority_count=hp,
                assessment=assessment,
            ))
        return rows

    def hour_of_day_analysis(self) -> List[HourBucket]:
        if not _nonempty(self.inc) or "Begin Date" not in self.inc.columns:
            return []
        df = self.inc.copy()
        df["_hour"] = pd.to_datetime(df["Begin Date"], errors="coerce").dt.hour
        total = len(df)

        buckets = [
            ("Early Morning", "00:00-05:59", range(0, 6)),
            ("Morning", "06:00-11:59", range(6, 12)),
            ("Afternoon", "12:00-17:59", range(12, 18)),
            ("Evening", "18:00-23:59", range(18, 24)),
        ]
        suggestions = {
            "Early Morning": "Consider on-call staffing adjustments",
            "Morning": "Ensure full team availability",
            "Afternoon": "Monitor post-lunch productivity",
            "Evening": "Evaluate after-hours support needs",
        }
        rows: List[HourBucket] = []
        for period, hr_range, hours in buckets:
            grp = df[df["_hour"].isin(hours)]
            cnt = len(grp)
            rt = _safe_col(grp, "Resolution Time(m)").dropna()
            avg_rt = float(rt.mean()) if len(rt) else 0.0
            rows.append(HourBucket(
                period=period,
                hour_range=hr_range,
                count=cnt,
                pct=safe_divide(cnt, total),
                avg_resolution_min=avg_rt,
                suggestion=suggestions[period],
            ))
        return rows
