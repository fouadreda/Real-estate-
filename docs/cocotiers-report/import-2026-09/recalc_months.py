#!/usr/bin/env python3
"""
Adapt dataset.json to the month-based Paid Until model:
  - every rent/arrears payment gets whole `monthsCovered` (months of its period not already covered by an
    earlier payment of the same lease; period-less payments are converted from their amount),
  - ledgerStartDate is re-decided: Paid Until = the LATER of the register's next-payment date and the date the
    statements pay rent up to (register ignored when it is > 6.5 months beyond the statements).
Reads and rewrites dataset.json in place (a copy is kept as dataset.before-months.json).
"""
import json, re, sys, shutil, calendar, datetime as dt, unicodedata
import xlrd

D = dt.date
DATASET = sys.argv[1]
REGISTER = "/Users/fouad/Downloads/rapport cocotier modifié 2026.docx2.xls"
TODAY = D(2026, 10, 6)

def norm(s):
    s = "".join(c for c in unicodedata.normalize("NFD", str(s or "")) if unicodedata.category(c) != "Mn").upper()
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9 ]+", " ", s)).strip()

def add_months(d, n):
    y = d.year + (d.month - 1 + n) // 12
    m = (d.month - 1 + n) % 12 + 1
    return D(y, m, min(d.day, calendar.monthrange(y, m)[1]))

def months_between(a, b):
    return (b.year - a.year) * 12 + (b.month - a.month) + (b.day - a.day) / 30.0

def mkdate(d, m, y):
    try:
        return D(y, m, min(d, calendar.monthrange(y, m)[1]))
    except Exception:
        return None

def iso(d):
    return d.isoformat() if d else None

def parse_iso(s):
    return D.fromisoformat(s) if s else None

def serial(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f < 30000 or f > 60000:
        return None
    return D(1899, 12, 30) + dt.timedelta(days=int(f))

# ------------------------------------------------------------------ register: next payment per unit/tenant
SHEETS = {"assigame": "SITUATION IMMEUBLE ASSIGAME", "jp2": "SITUATION IMMEUBLE JEAN PAUL II", "paix": "SITUATION IMMEUBLE LA PAIX",
          "villas": "VILLA", "entrepots": "ENTREPOT", "showrooms": "SHOW ROOM+BOUTIQUE AKODESSEWA"}
FLOOR = re.compile(r"^(RDC|R\+\d)$", re.I)
ALIAS_OCC = {"AFRIQUE CENTURY": "INTERPARCK"}

def load_register():
    wb = xlrd.open_workbook(REGISTER)
    out = {}  # bkey -> list of (code_norm, occupant_norm, next_date)
    for bkey, sheet in SHEETS.items():
        s = wb.sheet_by_name(sheet)
        hdr = next(r for r in range(s.nrows) if "LOCAL OCCUPE" in str(s.cell_value(r, 0)).upper())
        cols = {}
        for c in range(s.ncols):
            h = re.sub(r"\s+", " ", str(s.cell_value(hdr, c))).strip().upper()
            if h.startswith("LOCAL"): cols["code"] = c
            elif h.startswith("OCCUPANT"): cols["occ"] = c
            elif "PROCHAIN PAYEMENT" in h: cols["next"] = c
        rows = []
        for r in range(hdr + 1, s.nrows):
            code = re.sub(r"\s+", " ", str(s.cell_value(r, cols["code"]))).strip()
            if not code:
                continue
            rest = [str(s.cell_value(r, c)).strip() for c in range(1, s.ncols)]
            if FLOOR.match(code) and not any(rest):
                continue
            rows.append((norm(code), norm(s.cell_value(r, cols["occ"])), serial(s.cell_value(r, cols["next"]))))
        out[bkey] = rows
    return out

# ------------------------------------------------------------------ main
shutil.copyfile(DATASET, DATASET.replace(".json", ".before-months.json"))
data = json.load(open(DATASET))
units = {u["uid"]: u for u in data["units"]}
register = load_register()

def register_next(lease):
    u = units[lease["uid"]]
    b = u["building"]
    code = norm(u["unitCode"])
    tn = norm(lease["tenantName"])
    cands = [(o, n) for (c, o, n) in register[b] if c == code]
    if len(cands) == 1:
        return cands[0][1]
    occ_key = norm(ALIAS_OCC.get(lease["tenantName"], lease["tenantName"]))
    for o, n in cands:
        if occ_key and (occ_key in o or o in occ_key):
            return n
    return None

b8_next = None
for l in data["leases"]:
    u = units[l["uid"]]
    if u["building"] == "paix" and norm(u["unitCode"]) == "B8":
        b8_next = register_next(l)

def period_of(p, months):
    """Start of the covered period from the statement wording. When the printed dates contradict the stated
    number of months (typos like 'du 01/06/2025 au 30/11/2026'), pick whichever reading starts nearest the payment."""
    dates = [mkdate(int(a), int(b), int(c)) for a, b, c in re.findall(r"(\d{1,2})/(\d{1,2})/(\d{4})", p["notes"])]
    dates = [x for x in dates if x]
    if len(dates) < 2 or not months:
        return None
    s0, e0 = dates[0], dates[1]
    span = round(months_between(s0, e0 + dt.timedelta(days=1)))
    if span == months and e0 >= s0:
        return s0
    ref = parse_iso(p["date"])
    c1 = s0
    c2 = add_months(e0 + dt.timedelta(days=1), -months)
    return min([c1, c2], key=lambda c: abs(months_between(c, ref)))

report = []
for l in data["leases"]:
    u = units[l["uid"]]
    if u.get("pseudo") or u["unitCode"] == "Charges collectées":
        continue
    rent = l["rent"] or 0
    pays = [p for p in l["payments"] if p["kind"] in ("RENT", "ARREARS")]
    start = parse_iso(l["startDate"])
    nxt = register_next(l)
    if u["building"] == "paix" and norm(u["unitCode"]) == "2 STUDIOS RDC":
        nxt = b8_next

    dated, undated = [], []
    for p in pays:
        s = period_of(p, p.get("monthsCovered"))
        months = p.get("monthsCovered")
        if s is not None and months:
            dated.append((s, months, p))
        else:
            undated.append(p)
    dated.sort(key=lambda x: (x[0], x[2]["date"]))

    # months not already covered by an earlier payment of the same lease
    union_end = None
    for s, months, p in dated:
        e = add_months(s, months) - dt.timedelta(days=1)
        if union_end is None or s > union_end:
            add = months
            union_end = e
        elif e > union_end:
            add = max(0, round(months_between(union_end + dt.timedelta(days=1), e + dt.timedelta(days=1))))
            union_end = e
        else:
            add = 0
        p["monthsCovered"] = int(add)
    # payments without a stated period: convert the pooled amount, oldest first
    cum_prev = 0
    cum = 0.0
    for p in sorted(undated, key=lambda x: x["date"]):
        cum += p["amount"]
        cur = int((cum + 100) // rent) if rent else 0
        p["monthsCovered"] = max(0, cur - cum_prev)
        cum_prev = cur
    for p in l["payments"]:
        if p["kind"] not in ("RENT", "ARREARS"):
            p["monthsCovered"] = None

    # ----- ledger start decision (later of register and statements)
    status = l["status"]
    lcov = min((s for s, _, _ in dated), default=None)
    recent_start = start is not None and start >= D(2025, 10, 1)
    baseline = lcov or (start if recent_start and pays else None) or nxt or (min((parse_iso(p["date"]) for p in pays), default=None))
    if baseline and start and baseline < start:
        baseline = start
    new_ledger = parse_iso(l["ledgerStartDate"])
    note = ""
    if status == "ACTIVE" and baseline and rent and pays and nxt:
        implied = add_months(baseline, sum(p["monthsCovered"] or 0 for p in pays))
        gap = months_between(implied, nxt)
        if 0.9 <= gap <= 6.5:
            baseline = max(nxt, baseline); note = "register"
        else:
            note = "statements"
    elif status == "ACTIVE" and not pays and nxt:
        baseline = max(nxt, start) if start else nxt
        note = "register-only"
    if status != "PENDING" and u["unitCode"] != "ENTREPOT CACAVELI":
        new_ledger = baseline if (baseline and start and baseline > start) else None
    if status == "PENDING":
        new_ledger = None
    old = l["ledgerStartDate"]
    l["ledgerStartDate"] = iso(new_ledger)
    if old != l["ledgerStartDate"]:
        report.append((u["building"], u["unitCode"], l["tenantName"], old, l["ledgerStartDate"], note))

json.dump(data, open(DATASET, "w"), ensure_ascii=False, indent=1)
print("leases:", len(data["leases"]), "| ledger start changed on", len(report))
for r in report:
    print("  ", " | ".join(str(x) for x in r))
