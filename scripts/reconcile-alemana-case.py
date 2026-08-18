import argparse
import importlib.util
import json
from collections import defaultdict
from pathlib import Path


def load_importer():
    path = Path(__file__).with_name("import-alemana-account.py")
    spec = importlib.util.spec_from_file_location("alemana_importer", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--case-key", required=True)
    parser.add_argument("--expected-total", type=int, required=True)
    parser.add_argument("--expected-lines", type=int, required=True)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()

    importer = load_importer()
    rows = importer.extract_rows(args.pdf)
    if len(rows) != args.expected_lines or sum(row["total"] for row in rows) != args.expected_total:
        raise SystemExit("Source reconciliation failed")

    corpus = json.loads(args.corpus.read_text(encoding="utf-8"))
    case = next((item for item in corpus["cases"] if item["caseKey"] == args.case_key), None)
    if case is None:
        raise SystemExit(f"Case not found: {args.case_key}")

    linked_patterns = [pattern for pattern in corpus["patterns"] if args.case_key in pattern["caseKeys"]]
    missing = []
    for row in rows:
        represented = any(
            row["code"] in pattern["codes"]
            and pattern["unitPriceMin"] <= row["unit"] <= pattern["unitPriceMax"]
            and pattern["totalMin"] <= row["total"] <= pattern["totalMax"]
            for pattern in linked_patterns
            if pattern["unitPriceMin"] is not None and pattern["totalMin"] is not None
        )
        if not represented:
            missing.append(row)

    expected_missing = args.expected_lines - case["observedLineCount"]
    if len(missing) != expected_missing:
        raise SystemExit(f"Expected {expected_missing} missing rows, found {len(missing)}")

    by_description = {pattern["normalizedDescription"]: pattern for pattern in corpus["patterns"]}
    by_code = {code: pattern for pattern in corpus["patterns"] for code in pattern["codes"]}
    grouped = defaultdict(list)
    for row in missing:
        grouped[(importer.normalize(row["description"]), row["code"])].append(row)

    added = 0
    updated = 0
    for (normalized, code), observations in grouped.items():
        description = observations[0]["description"]
        pattern = by_description.get(normalized) or by_code.get(code)
        if pattern is None:
            pattern = {
                "description": description,
                "normalizedDescription": normalized,
                "aliases": [description],
                "codes": [code],
                "fonasaCodes": sorted({row["fonasaCode"] for row in observations if row["fonasaCode"]}),
                "providers": [case["provider"]],
                "sections": sorted({row["section"] for row in observations}),
                "caseKeys": [args.case_key],
                "observationCount": len(observations),
                "zeroValueCount": sum(row["total"] == 0 for row in observations),
                "refundCount": sum(row["total"] < 0 or row["quantity"] < 0 for row in observations),
                "unitPriceMin": min(row["unit"] for row in observations),
                "unitPriceMax": max(row["unit"] for row in observations),
                "totalMin": min(row["total"] for row in observations),
                "totalMax": max(row["total"] for row in observations),
            }
            corpus["patterns"].append(pattern)
            added += 1
            continue
        pattern["aliases"] = sorted(set(pattern["aliases"]) | {description})
        pattern["fonasaCodes"] = sorted(set(pattern["fonasaCodes"]) | {row["fonasaCode"] for row in observations if row["fonasaCode"]})
        pattern["sections"] = sorted(set(pattern["sections"]) | {row["section"] for row in observations})
        pattern["observationCount"] += len(observations)
        pattern["zeroValueCount"] += sum(row["total"] == 0 for row in observations)
        pattern["refundCount"] += sum(row["total"] < 0 or row["quantity"] < 0 for row in observations)
        pattern["unitPriceMin"] = min(pattern["unitPriceMin"], *(row["unit"] for row in observations))
        pattern["unitPriceMax"] = max(pattern["unitPriceMax"], *(row["unit"] for row in observations))
        pattern["totalMin"] = min(pattern["totalMin"], *(row["total"] for row in observations))
        pattern["totalMax"] = max(pattern["totalMax"], *(row["total"] for row in observations))
        updated += 1

    case["sourceLineCount"] = args.expected_lines
    case["observedLineCount"] = args.expected_lines
    case["coverage"] = "source_total_reconciled"
    case["coverageNote"] = "Los 111 renglones extraídos concilian con los totales documentales de las empresas emisoras."
    corpus["observationCount"] = sum(item["observedLineCount"] for item in corpus["cases"])
    corpus["patternCount"] = len(corpus["patterns"])
    corpus["patterns"].sort(key=lambda pattern: pattern["normalizedDescription"])

    print(json.dumps({
        "missingRows": missing,
        "addedPatterns": added,
        "updatedPatterns": updated,
        "caseObservations": case["observedLineCount"],
        "corpusObservations": corpus["observationCount"],
        "corpusPatterns": corpus["patternCount"],
    }, ensure_ascii=False, indent=2))
    if args.write:
        args.corpus.write_text(json.dumps(corpus, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
