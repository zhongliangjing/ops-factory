"""
Utility functions for Executive Summary Report.
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, List, Tuple, Dict


def load_excel_data(file_path: Path) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """Load incident data and SLA criteria from Excel file."""
    sla_df = pd.read_excel(file_path, sheet_name="SLA_Criteria")
    data_df = pd.read_excel(file_path, sheet_name="Data")
    return data_df, sla_df


def clean_data(df: pd.DataFrame, excluded_resolvers: List[str]) -> pd.DataFrame:
    """Clean and preprocess incident data."""
    df = df.copy()
    
    # Remove excluded resolvers
    df = df[~df["Resolver"].isin(excluded_resolvers)]
    df = df[df["Resolver"].notna()]
    df = df[df["Resolver"].str.strip() != ""]
    
    # Remove invalid resolution times
    if "Resolution Time(m)" in df.columns:
        df = df[df["Resolution Time(m)"] >= 0]
    
    # Convert date columns
    date_columns = ["Begin Date", "Resolution Date", "End Date"]
    for col in date_columns:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors="coerce")
    
    # Add computed columns
    if "Resolution Time(m)" in df.columns:
        df["Resolution_Hours"] = df["Resolution Time(m)"] / 60
    
    return df


def get_date_range(df: pd.DataFrame, date_column: str = "Begin Date") -> Tuple[datetime, datetime]:
    """Get the date range from a DataFrame."""
    if date_column not in df.columns:
        return datetime.now(), datetime.now()
    
    dates = df[date_column].dropna()
    if len(dates) == 0:
        return datetime.now(), datetime.now()
    
    return dates.min().to_pydatetime(), dates.max().to_pydatetime()


def get_data_span_days(df: pd.DataFrame, date_column: str = "Begin Date") -> int:
    """Get the number of days in the data span."""
    start, end = get_date_range(df, date_column)
    return (end - start).days


def filter_by_period(
    df: pd.DataFrame,
    start_date: datetime,
    end_date: datetime,
    date_column: str = "Begin Date"
) -> pd.DataFrame:
    """Filter DataFrame by date range."""
    if date_column not in df.columns:
        return df
    
    mask = (df[date_column] >= start_date) & (df[date_column] <= end_date)
    return df[mask]


def get_week_boundaries(reference_date: datetime) -> Tuple[datetime, datetime]:
    """Get the start and end of the week containing reference_date."""
    # Week starts on Monday
    start = reference_date - timedelta(days=reference_date.weekday())
    start = start.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=6, hours=23, minutes=59, seconds=59)
    return start, end


def get_month_boundaries(reference_date: datetime) -> Tuple[datetime, datetime]:
    """Get the start and end of the month containing reference_date."""
    start = reference_date.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    # Get last day of month
    if start.month == 12:
        next_month = start.replace(year=start.year + 1, month=1)
    else:
        next_month = start.replace(month=start.month + 1)
    end = next_month - timedelta(seconds=1)
    return start, end


def safe_divide(numerator: float, denominator: float, default: float = 0.0) -> float:
    """Safely divide two numbers."""
    if denominator == 0 or pd.isna(denominator) or pd.isna(numerator):
        return default
    return numerator / denominator


def calculate_percentage_change(current: float, previous: float) -> Tuple[float, str]:
    """Calculate percentage change and trend indicator."""
    if previous == 0:
        if current == 0:
            return 0.0, "→"
        return float('inf'), "↑"
    
    change = (current - previous) / previous
    
    if change > 0.05:
        indicator = "↑"
    elif change < -0.05:
        indicator = "↓"
    else:
        indicator = "→"
    
    return change, indicator


def format_percentage(value: float, decimal_places: int = 1) -> str:
    """Format value as percentage string."""
    if pd.isna(value):
        return "N/A"
    return f"{value * 100:.{decimal_places}f}%"


def format_duration(hours: float) -> str:
    """Format duration in hours to human-readable string."""
    if pd.isna(hours) or hours < 0:
        return "N/A"
    
    if hours >= 24:
        days = int(hours // 24)
        remaining_hours = hours % 24
        return f"{days}d {remaining_hours:.1f}h"
    else:
        return f"{hours:.1f}h"


def rgb_to_hex(r: int, g: int, b: int) -> str:
    """Convert RGB to hex color."""
    return f"#{r:02x}{g:02x}{b:02x}"


def hex_to_rgb(hex_color: str) -> Tuple[int, int, int]:
    """Convert hex color to RGB tuple."""
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
