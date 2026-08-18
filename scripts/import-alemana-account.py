import argparse
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

import pdfplumber


CODE = re.compile(r"^(\d{5,9})(.*)$")
DATE = re.compile(r"^\d{2}/\d{2}/\d{4}$")
QUANTITY = re.compile(r"^-?\d+,\d{3}$")
MONEY = re.compile(r"^-?[0-9.]+$")


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFD", value)
    value = "".join(char for char in value if unicodedata.category(char) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def amount(value: str) -> int:
    return int(value.replace(".", ""))


def lines_from_words(words):
    lines = []
    for word in sorted(words, key=lambda item: (item["top"], item["x0"])):
        line = next((line for line in reversed(lines) if abs(line[0]["top"] - word["top"]) <= 2.0), None)
        if line is None:
            line = []
            lines.append(line)
        line.append(word)
    return [sorted(line, key=lambda item: item["x0"]) for line in lines]


def extract_rows(pdf_path: Path):
    rows = []
    section = "SIN SECCION"
    with pdfplumber.open(pdf_path) as pdf:
        for page_number, page in enumerate(pdf.pages, 1):
            for line in lines_from_words(page.extract_words(x_tolerance=1, y_tolerance=2)):
                texts = [word["text"] for word in line]
                if not texts:
                    continue

                if re.fullmatch(r"\d{4}", texts[0]) and not any(DATE.fullmatch(text) for text in texts):
                    heading = " ".join(texts[1:])
                    if heading and "P�gina" not in heading:
                        section = heading
                    continue

                code_match = CODE.match(texts[0])
                if not code_match or not any(DATE.fullmatch(text) for text in texts):
                    continue
                quantity_word = next((word for word in line if QUANTITY.fullmatch(word["text"])), None)
                def cell_text(left, right):
                    chars = [
                        char for char in page.chars
                        if abs(char["top"] - line[0]["top"]) <= 2.0
                        and left <= char["x0"] < right
                    ]
                    return "".join(char["text"] for char in sorted(chars, key=lambda char: char["x0"]))

                price_text = cell_text(421, 462)
                total_text = cell_text(714.9, 752)
                if quantity_word is None or not MONEY.fullmatch(price_text) or not MONEY.fullmatch(total_text):
                    raise ValueError(
                        f"Could not parse monetary columns on page {page_number}: {' '.join(texts)}"
                    )

                date_word = next(word for word in line if DATE.fullmatch(word["text"]))
                description_parts = []
                attached = code_match.group(2)
                if attached:
                    description_parts.append(attached)
                description_parts.extend(
                    word["text"] for word in line[1:]
                    if word["x0"] < date_word["x0"] and word is not date_word
                )
                description = " ".join(description_parts).strip()
                code = code_match.group(1)
                fonasa_word = next(
                    (word for word in line if date_word["x1"] < word["x0"] < 240 and re.fullmatch(r"\d{7}", word["text"])),
                    None,
                )
                rows.append({
                    "code": code,
                    "fonasaCode": fonasa_word["text"] if fonasa_word else None,
                    "description": description,
                    "quantity": float(quantity_word["text"].replace(",", ".")),
                    "unit": amount(price_text),
                    "total": amount(total_text),
                    "section": section,
                    "page": page_number,
                })
    return rows


def merge_case(corpus, rows, args):
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
    updated_pattern_count = 0
    for (_, code), observations in grouped.items():
        description = observations[0]["description"]
        incoming = {
            "description": description,
            "normalizedDescription": normalize(description),
            "aliases": [description],
            "codes": [code],
            "fonasaCodes": sorted({item["fonasaCode"] for item in observations if item["fonasaCode"]}),
            "providers": [args.provider],
            "sections": sorted({item["section"] for item in observations}),
            "caseKeys": [args.case_key],
            "observationCount": len(observations),
            "zeroValueCount": sum(item["total"] == 0 for item in observations),
            "refundCount": sum(item["total"] < 0 or item["quantity"] < 0 for item in observations),
            "unitPriceMin": min(item["unit"] for item in observations),
            "unitPriceMax": max(item["unit"] for item in observations),
            "totalMin": min(item["total"] for item in observations),
            "totalMax": max(item["total"] for item in observations),
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
        updated_pattern_count += 1
        for key in ("aliases", "codes", "fonasaCodes", "providers", "sections", "caseKeys"):
            pattern[key] = sorted(set(pattern[key]) | set(incoming[key]))
        pattern["observationCount"] += incoming["observationCount"]
        pattern["zeroValueCount"] += incoming["zeroValueCount"]
        pattern["refundCount"] += incoming["refundCount"]
        for key in ("unitPriceMin", "totalMin"):
            pattern[key] = min(value for value in (pattern[key], incoming[key]) if value is not None)
        for key in ("unitPriceMax", "totalMax"):
            pattern[key] = max(value for value in (pattern[key], incoming[key]) if value is not None)

    corpus["cases"].append({
        "caseKey": args.case_key,
        "provider": args.provider,
        "episodeClass": args.episode_class,
        "sourceLineCount": len(rows),
        "coverage": "source_total_reconciled",
        "coverageNote": "Los renglones extraídos concilian con los totales documentales de las empresas emisoras.",
        "observedLineCount": len(rows),
    })
    corpus["patterns"].sort(key=lambda pattern: pattern["normalizedDescription"])
    corpus["caseCount"] = len(corpus["cases"])
    corpus["observationCount"] = sum(case["observedLineCount"] for case in corpus["cases"])
    corpus["patternCount"] = len(corpus["patterns"])
    return added_pattern_count, updated_pattern_count


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--case-key", required=True)
    parser.add_argument("--provider", required=True)
    parser.add_argument("--episode-class", required=True)
    parser.add_argument("--expected-total", type=int, required=True)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()

    rows = extract_rows(args.pdf)
    extracted_total = sum(row["total"] for row in rows)
    if extracted_total != args.expected_total:
        raise SystemExit(f"Reconciliation failed: extracted {extracted_total}, expected {args.expected_total}")
    corpus = json.loads(args.corpus.read_text(encoding="utf-8"))
    added, updated = merge_case(corpus, rows, args)
    result = {
        "rows": len(rows), "newPatterns": added, "updatedPatterns": updated,
        "extractedTotal": extracted_total,
        "caseCount": corpus["caseCount"], "observationCount": corpus["observationCount"],
        "patternCount": corpus["patternCount"],
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if args.write:
        args.corpus.write_text(json.dumps(corpus, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
