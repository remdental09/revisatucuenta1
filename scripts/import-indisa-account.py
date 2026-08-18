import argparse
import importlib.util
import json
import re
from pathlib import Path

import pdfplumber


ROW_CODE = re.compile(r"^(?:\d{8}|\d{2}-\d{2}-\d{3}-\d{2})$")
MONEY = re.compile(r"^-?[0-9.]+$")
EXCLUDED_HEADINGS = {"CONVENCIONAL", "CÓDIGO DESCRIPCIÓN CÓD. FON. FECHA CANT. V. UNIT. TOTAL REC"}


def load_shared_importer():
    path = Path(__file__).with_name("import-alemana-account.py")
    spec = importlib.util.spec_from_file_location("alemana_importer", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def amount(value: str) -> int:
    return int(value.replace(".", ""))


def extract_rows(pdf_path: Path, shared):
    rows = []
    section = "SIN SECCION"
    with pdfplumber.open(pdf_path) as pdf:
        for page_number, page in enumerate(pdf.pages, 1):
            for line in shared.lines_from_words(page.extract_words(x_tolerance=1, y_tolerance=2)):
                texts = [word["text"] for word in line]
                if not texts or line[0]["top"] < 215:
                    continue
                if ROW_CODE.fullmatch(texts[0]):
                    quantity = next((word for word in line if 285 <= word["x0"] < 310 and re.fullmatch(r"-?\d+", word["text"])), None)
                    unit = next((word for word in line if 310 <= word["x0"] < 500 and MONEY.fullmatch(word["text"])), None)
                    total = next((word for word in line if 500 <= word["x0"] < 560 and MONEY.fullmatch(word["text"])), None)
                    if quantity is None or unit is None or total is None:
                        raise ValueError(f"Could not parse row on page {page_number}: {' '.join(texts)}")
                    description = " ".join(
                        word["text"] for word in line[1:]
                        if 70 <= word["x0"] < 235
                        and not ROW_CODE.fullmatch(word["text"])
                        and not re.fullmatch(r"\d{2}-\d{2}-\d{4}", word["text"])
                    ).strip()
                    description = re.sub(r"\d{2}-\d{2}-\d{4}", "", description).strip()
                    fonasa = next(
                        (word["text"].replace("-", "") for word in line[1:]
                         if 175 <= word["x0"] < 235 and re.fullmatch(r"\d{2}-\d{2}-\d{3}-\d{2}", word["text"])),
                        None,
                    )
                    rows.append({
                        "code": texts[0], "fonasaCode": fonasa, "description": description,
                        "quantity": int(quantity["text"]), "unit": amount(unit["text"]),
                        "total": amount(total["text"]), "section": section, "page": page_number,
                    })
                    continue
                heading = " ".join(texts).strip()
                normalized_heading = heading.upper().replace("�", "Ó")
                if (
                    texts[0][0].isalpha() and ":" not in heading and " ROL " not in heading
                    and normalized_heading not in EXCLUDED_HEADINGS
                    and not heading.startswith("TOTAL GENERAL")
                ):
                    section = heading
    return rows


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
    shared = load_shared_importer()
    rows = extract_rows(args.pdf, shared)
    extracted_total = sum(row["total"] for row in rows)
    if extracted_total != args.expected_total:
        raise SystemExit(f"Reconciliation failed: extracted {extracted_total}, expected {args.expected_total}")
    corpus = json.loads(args.corpus.read_text(encoding="utf-8"))
    added, updated = shared.merge_case(corpus, rows, args)
    result = {
        "rows": len(rows), "newPatterns": added, "updatedPatterns": updated,
        "extractedTotal": extracted_total, "caseCount": corpus["caseCount"],
        "observationCount": corpus["observationCount"], "patternCount": corpus["patternCount"],
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if args.write:
        args.corpus.write_text(json.dumps(corpus, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
