import argparse
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

import pdfplumber


ROW = re.compile(
    r"^(?P<code>[0-9]{8}|[0-9]{2}-[0-9]{2}-[0-9]{3}-[0-9]{2})\s+"
    r"(?P<description>.*?)\s+\d{2}/\d{2}/\d{4}\s+"
    r"(?P<quantity>\d+)\s+(?P<unit>[0-9.]+)\s+"
    r"[0-9.]+\s+[0-9.]+\s+[0-9.]+\s+(?P<total>[0-9.]+)(?:\s+\*)?$"
)

SECTION_TOTAL = re.compile(r"^(?P<section>[A-ZÁÉÍÓÚÜÑ /]+?)\s+[0-9.]+$")
IGNORED_SECTIONS = {"TOTAL POR CONSUMO", "TOTAL GENERA"}


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFD", value)
    value = "".join(char for char in value if unicodedata.category(char) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def amount(value: str) -> int:
    return int(value.replace(".", ""))


def extract_rows(pdf_path: Path, first_page: int, last_page: int):
    rows = []
    section = "SIN SECCION"
    with pdfplumber.open(pdf_path) as pdf:
        for page_number in range(first_page, last_page + 1):
            text = pdf.pages[page_number - 1].extract_text(x_tolerance=2, y_tolerance=2) or ""
            for raw_line in text.splitlines():
                line = raw_line.strip()
                match = ROW.match(line)
                if match:
                    code = match.group("code")
                    rows.append({
                        "code": code,
                        "fonasaCode": code.replace("-", "") if "-" in code else None,
                        "description": match.group("description").strip(),
                        "quantity": int(match.group("quantity")),
                        "unit": amount(match.group("unit")),
                        "total": amount(match.group("total")),
                        "section": section,
                    })
                    continue
                section_match = SECTION_TOTAL.match(line)
                if section_match:
                    candidate = section_match.group("section").strip()
                    if candidate not in IGNORED_SECTIONS:
                        section = candidate
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--first-page", type=int, required=True)
    parser.add_argument("--last-page", type=int, required=True)
    parser.add_argument("--case-key", required=True)
    parser.add_argument("--provider", required=True)
    parser.add_argument("--episode-class", required=True)
    parser.add_argument("--expected-total", type=int, required=True)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()

    rows = extract_rows(args.pdf, args.first_page, args.last_page)
    extracted_total = sum(row["total"] for row in rows)
    if extracted_total != args.expected_total:
        raise SystemExit(
            f"Reconciliation failed: extracted {extracted_total}, expected {args.expected_total}"
        )

    corpus = json.loads(args.corpus.read_text(encoding="utf-8"))
    if any(case["caseKey"] == args.case_key for case in corpus["cases"]):
        raise SystemExit(f"Case already exists: {args.case_key}")

    grouped = defaultdict(list)
    for row in rows:
        grouped[(normalize(row["description"]), row["code"])].append(row)

    patterns_by_description = {
        pattern["normalizedDescription"]: pattern for pattern in corpus["patterns"]
    }
    patterns_by_code = {
        code: pattern for pattern in corpus["patterns"] for code in pattern["codes"]
    }
    added_pattern_count = 0
    for (_, code), observations in grouped.items():
        description = observations[0]["description"]
        unit_prices = [item["unit"] for item in observations]
        totals = [item["total"] for item in observations]
        fonasa_codes = sorted({item["fonasaCode"] for item in observations if item["fonasaCode"]})
        incoming = {
            "description": description,
            "normalizedDescription": normalize(description),
            "aliases": [description],
            "codes": [code],
            "fonasaCodes": fonasa_codes,
            "providers": [args.provider],
            "sections": sorted({item["section"] for item in observations}),
            "caseKeys": [args.case_key],
            "observationCount": len(observations),
            "zeroValueCount": sum(item["total"] == 0 for item in observations),
            "refundCount": sum(item["total"] < 0 for item in observations),
            "unitPriceMin": min(unit_prices),
            "unitPriceMax": max(unit_prices),
            "totalMin": min(totals),
            "totalMax": max(totals),
        }
        pattern = patterns_by_description.get(incoming["normalizedDescription"])
        if pattern is None:
            pattern = patterns_by_code.get(code)
        if pattern is None:
            corpus["patterns"].append(incoming)
            patterns_by_description[incoming["normalizedDescription"]] = incoming
            patterns_by_code[code] = incoming
            added_pattern_count += 1
            continue

        for key in ("aliases", "codes", "fonasaCodes", "providers", "sections", "caseKeys"):
            pattern[key] = sorted(set(pattern[key]) | set(incoming[key]))
        pattern["observationCount"] += incoming["observationCount"]
        pattern["zeroValueCount"] += incoming["zeroValueCount"]
        pattern["refundCount"] += incoming["refundCount"]
        for key in ("unitPriceMin", "totalMin"):
            values = [value for value in (pattern[key], incoming[key]) if value is not None]
            pattern[key] = min(values) if values else None
        for key in ("unitPriceMax", "totalMax"):
            values = [value for value in (pattern[key], incoming[key]) if value is not None]
            pattern[key] = max(values) if values else None

    corpus["cases"].append({
        "caseKey": args.case_key,
        "provider": args.provider,
        "episodeClass": args.episode_class,
        "sourceLineCount": len(rows),
        "coverage": "source_total_reconciled",
        "coverageNote": (
            "Los renglones detallados extraídos de la cuenta clínica concilian con el total documental."
        ),
        "observedLineCount": len(rows),
    })
    corpus["patterns"].sort(key=lambda pattern: pattern["normalizedDescription"])
    corpus["caseCount"] = len(corpus["cases"])
    corpus["observationCount"] = sum(case["observedLineCount"] for case in corpus["cases"])
    corpus["patternCount"] = len(corpus["patterns"])

    print(json.dumps({
        "rows": len(rows),
        "newPatterns": added_pattern_count,
        "extractedTotal": extracted_total,
        "caseCount": corpus["caseCount"],
        "observationCount": corpus["observationCount"],
        "patternCount": corpus["patternCount"],
    }, ensure_ascii=False, indent=2))
    if args.write:
        args.corpus.write_text(
            json.dumps(corpus, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )


if __name__ == "__main__":
    main()
