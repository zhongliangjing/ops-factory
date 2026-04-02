#!/usr/bin/env python3
"""
Customer Quality Report Generator - Comprehensive Version.

Integrates all 4 ITIL processes: Incidents, Changes, Requests, Problems.
Outputs a 10-sheet XLSX workbook with native Excel charts and AI insights.

Usage:
    python generate_report.py                    # Generate both EN and ZH
    python generate_report.py --language en      # Generate EN only
    python generate_report.py --language zh      # Generate ZH only
    python generate_report.py --no-ai            # Skip AI insight generation
"""

import argparse
import sys
from pathlib import Path

# Add script directory to path
SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))

# Load environment variables
from dotenv import load_dotenv
env_path = SCRIPT_DIR.parent / ".env"
if env_path.exists():
    load_dotenv(env_path)

from config import INCIDENTS_FILE, CHANGES_FILE, REQUESTS_FILE, PROBLEMS_FILE
from analyzer import ComprehensiveAnalyzer
from insight_generator import InsightGenerator
from xlsx_builder import XlsxBuilder


def print_banner(languages: list, chart_engine: str = "native") -> None:
    """Print startup banner."""
    print("\n" + "=" * 70)
    print("  📊 Customer Quality Report Generator (Comprehensive)")
    print("     客户质量报告生成器（综合版）")
    print("=" * 70)
    lang_str = " & ".join([("Chinese" if l == "zh" else "English") for l in languages])
    print(f"  🌐 Languages: {lang_str}")
    print(f"  📊 Chart Engine: {chart_engine}")


def check_data_files() -> dict:
    """Check which data files exist."""
    files = {
        "incidents": INCIDENTS_FILE,
        "changes": CHANGES_FILE,
        "requests": REQUESTS_FILE,
        "problems": PROBLEMS_FILE
    }

    status = {}
    for name, path in files.items():
        status[name] = {"path": path, "exists": path.exists()}

    return status


def generate_xlsx(analyzer, result, insights: dict, language: str,
                  chart_engine: str = "native") -> Path:
    """Generate XLSX report for a given language. Returns output path."""
    xlsx_builder = XlsxBuilder(
        result=result,
        incidents_df=analyzer.incidents_df,
        changes_df=analyzer.changes_df,
        requests_df=analyzer.requests_df,
        problems_df=analyzer.problems_df,
        sla_map=analyzer.sla_map,
        insights=insights,
        language=language,
        chart_engine=chart_engine,
    )
    return xlsx_builder.save()


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Generate Comprehensive Customer Quality Report (XLSX)"
    )
    parser.add_argument(
        "--language", "-l",
        choices=["en", "zh", "both"],
        default="both",
        help="Output language (en=English, zh=Chinese, both=Both)"
    )
    parser.add_argument(
        "--no-ai",
        action="store_true",
        help="Skip AI insight generation"
    )
    parser.add_argument(
        "--chart-engine",
        choices=["native", "matplotlib"],
        default="native",
        help="Chart engine: native (Excel built-in) or matplotlib (PNG images)"
    )

    args = parser.parse_args()

    # Determine languages to generate
    if args.language == "both":
        languages = ["en", "zh"]
    else:
        languages = [args.language]

    print_banner(languages, args.chart_engine)

    # Check data files
    print("\n  📁 Data Files:")
    file_status = check_data_files()

    for name, info in file_status.items():
        status = "✓" if info["exists"] else "✗"
        print(f"    {status} {name.capitalize()}: {info['path'].name}")

    # Check required file
    if not file_status["incidents"]["exists"]:
        print(f"\n  ❌ Error: Required file not found: {INCIDENTS_FILE}")
        sys.exit(1)

    print()

    try:
        # Step 1: Analyze all data (language-independent)
        print("  ▶ Analyzing data across all processes...")
        analyzer = ComprehensiveAnalyzer(
            incidents_file=INCIDENTS_FILE,
            changes_file=CHANGES_FILE if file_status["changes"]["exists"] else None,
            requests_file=REQUESTS_FILE if file_status["requests"]["exists"] else None,
            problems_file=PROBLEMS_FILE if file_status["problems"]["exists"] else None
        )
        result = analyzer.analyze()

        print(f"    ✓ Analysis complete")
        print(f"    ✓ Date range: {result.start_date} to {result.end_date}")
        print(f"    ✓ Data span: {result.data_span_days} days")
        print(f"    ✓ Health Score: {result.health_score:.0f}/100 ({result.health_grade})")
        print()

        # Process summary
        print("    📊 Process Summary:")
        print(f"       • Incidents: {result.total_incidents}")
        print(f"       • Changes: {result.total_changes}")
        print(f"       • Requests: {result.total_requests}")
        print(f"       • Problems: {result.total_problems}")
        print()

        # Step 2: Generate reports for each language
        all_output_paths = {}

        for language in languages:
            lang_label = "ZH" if language == "zh" else "EN"

            # AI Insights (language-dependent)
            insights = {}
            if not args.no_ai:
                print(f"\n  [{lang_label}] Generating AI insights...")
                try:
                    insight_gen = InsightGenerator(language)
                    insights = insight_gen.generate_all_insights(result)
                    print(f"    ✓ Generated {len(insights)} insights")
                    insight_gen.print_cache_stats()
                except Exception as e:
                    print(f"    ⚠ AI insights skipped: {e}")
            else:
                if language == languages[0]:
                    print("\n  ▶ Skipping AI insights (--no-ai)")

            # Generate XLSX
            print(f"\n  [{lang_label}] Building XLSX report...")
            xlsx_path = generate_xlsx(analyzer, result, insights, language,
                                      args.chart_engine)
            all_output_paths[f"xlsx_{lang_label}"] = xlsx_path
            print(f"    ✓ XLSX: {Path(xlsx_path).name}")

        # Summary
        print()
        print("=" * 70)
        print("  ✅ All reports generated successfully!")
        print("=" * 70)
        print()
        print("  📄 Output files:")
        for key, path in sorted(all_output_paths.items()):
            print(f"    • {path}")

        # Key Findings Summary
        print()
        print("  📈 Key Findings:")
        print(f"    • Health Score: {result.health_score:.0f}/100 ({result.health_grade})")

        if result.incident_summary and result.incident_summary.kpis:
            sla = result.incident_summary.kpis.get("sla_rate")
            if sla:
                print(f"    • Incident SLA: {sla.current_value:.1%}")

        if result.change_summary and result.change_summary.kpis:
            success = result.change_summary.kpis.get("change_success_rate")
            if success:
                print(f"    • Change Success: {success.current_value:.1%}")

        if result.request_summary and result.request_summary.kpis:
            csat = result.request_summary.kpis.get("request_csat")
            if csat:
                print(f"    • Request CSAT: {csat.current_value:.2f}/5")

        if result.problem_summary and result.problem_summary.kpis:
            closure = result.problem_summary.kpis.get("problem_closure_rate")
            if closure:
                print(f"    • Problem Closure: {closure.current_value:.1%}")

        print(f"    • Top Risks: {len(result.top_risks)}")
        print(f"    • Recommended Actions: {len(result.actions)}")

        if result.can_compare_wow:
            print(f"    • Week-over-Week: Available")
        if result.can_compare_mom:
            print(f"    • Month-over-Month: Available")

        print()
        print("=" * 70)

    except Exception as e:
        print(f"\n  ❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
