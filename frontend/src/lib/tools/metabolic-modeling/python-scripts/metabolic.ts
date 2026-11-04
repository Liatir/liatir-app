/**
 * Offline COBRApy adapter for Metabolic Modeling.
 *
 * The preflight reads the model with the Python standard library only. A real run denies network
 * sockets, keeps COBRApy's cache out of the user's home, solves with HiGHS and, when asked, confirms
 * every reported value with GLPK and refuses the result if the two solvers disagree.
 */
export const METABOLIC_MODELING_SCRIPT = String.raw`
"""Offline constraint-based metabolic modeling with COBRApy.

Every action reads one JSON payload on stdin and prints one JSON result as its last stdout line. The
preflight reads the model file with the Python standard library only, so a request is sized before
COBRApy loads. Network sockets are denied before any scientific import: COBRApy's model download
path is never reachable. HiGHS solves every problem; GLPK, a separate solver, can confirm it.
"""
import csv
import gzip
import hashlib
import io
import json
import math
import os
import pathlib
import socket
import sys
import tempfile
import time
import xml.etree.ElementTree as ElementTree

COBRA_VERSION = "0.32.1"
OPTLANG_VERSION = "1.9.1"
HIGHS_VERSION = "1.15.1"
RUNTIME_ID = "metabolic-modeling-cobrapy-0-32-1"
MAX_MODEL_BYTES = 256 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024
MAX_REACTIONS = 100_000
MAX_CHANGES = 1_000
# A flux bound beyond this is not a physiological limit but a stand-in for "unbounded".
MAX_ABS_BOUND = 1_000_000.0
ANALYSES = ("fba", "fva", "gene-deletion", "reaction-deletion")
# The default solver and the independent one that may confirm it.
PRIMARY_SOLVER = "hybrid"
CROSS_CHECK_SOLVER = "glpk"
# Settles a disagreement between the two; exact, and slow enough to spend only on disputed values.
EXACT_SOLVER = "glpk_exact"
MAX_EXACT_ADJUDICATIONS = 200
# Two solvers agree when they differ by no more than this, relative to the value or to one.
CROSS_CHECK_TOLERANCE = 1e-6
# Below the solvers' feasibility tolerance (1e-7) by two orders: a reported value this small is zero.
NUMERICAL_ZERO = 1e-9
# COBRApy's own rule (find_essential_genes): essential below 1% of the unperturbed optimum.
ESSENTIAL_FRACTION = 0.01
SCIENTIFIC_NOTICE = (
    "Flux balance analysis predicts steady-state fluxes that optimize the chosen objective under the "
    "model's stoichiometry and bounds. A predicted growth rate or flux is a property of the model and its "
    "assumptions, not a measurement; an essential gene in the model is a hypothesis about the organism."
)


def fail(message):
    raise ValueError(message)


def log(message):
    print(message, file=sys.stderr, flush=True)


def deny_network():
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex

    def blocked(*_args, **_kwargs):
        raise RuntimeError("Network access is disabled for this local metabolic modeling run.")

    def blocked_connect(sock, address):
        if sock.family == socket.AF_UNIX:
            return original_connect(sock, address)
        return blocked()

    def blocked_connect_ex(sock, address):
        if sock.family == socket.AF_UNIX:
            return original_connect_ex(sock, address)
        return blocked()

    socket.socket.connect = blocked_connect
    socket.socket.connect_ex = blocked_connect_ex
    socket.create_connection = blocked
    socket.getaddrinfo = blocked
    socket.gethostbyname = blocked
    socket.gethostbyname_ex = blocked
    socket.gethostbyaddr = blocked


def finite_number(value, label, minimum=None, maximum=None):
    if isinstance(value, bool):
        fail("%s must be a number." % label)
    try:
        number = float(value)
    except (TypeError, ValueError):
        fail("%s must be a number." % label)
    if not math.isfinite(number):
        fail("%s must be finite." % label)
    if minimum is not None and number < minimum:
        fail("%s must be at least %s." % (label, minimum))
    if maximum is not None and number > maximum:
        fail("%s must be at most %s." % (label, maximum))
    return number


def checked_file(raw_path, label, max_bytes, extensions):
    path = pathlib.Path(str(raw_path or "")).expanduser().resolve()
    if not path.is_file():
        fail("%s does not exist: %s" % (label, path.name or raw_path))
    if not any(path.name.lower().endswith(extension) for extension in extensions):
        fail("%s must use one of these formats: %s." % (label, ", ".join(extensions)))
    size = path.stat().st_size
    if size < 1:
        fail("%s is empty." % label)
    if size > max_bytes:
        fail("%s exceeds the %s-byte limit." % (label, max_bytes))
    return path, size


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json_atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, indent=2, sort_keys=True, allow_nan=False)
            handle.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def write_csv(path, header, rows):
    with open(path, "w", encoding="utf-8", newline="") as handle:
        table = csv.writer(handle)
        table.writerow(header)
        table.writerows(rows)


def output_directory(payload):
    raw = str(payload.get("outputDir") or "").strip()
    if not raw:
        fail("An output directory is required.")
    path = pathlib.Path(raw).expanduser().resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def require_measured_envelope(payload, metrics):
    if payload.get("measurementMode") is True:
        return
    estimate = payload.get("hardwareEstimate")
    if not isinstance(estimate, dict) or estimate.get("accepted") is not True:
        fail("A measured hardware preflight must accept this input before COBRApy is loaded.")
    for key in ("workloadId", "tokenCount", "atomCount", "stepCount", "outputItemCount"):
        if estimate.get(key) != metrics.get(key):
            fail("Hardware preflight no longer matches the selected input (%s)." % key)
    if not str(estimate.get("evidenceRecord") or "").strip():
        fail("Hardware preflight has no retained evidence record.")


# ── stdlib-only model inspection ────────────────────────────────────────────

MODEL_EXTENSIONS = (".xml", ".sbml", ".xml.gz", ".sbml.gz", ".json")


def model_bytes(path):
    """The model file's bytes, decompressed and bounded."""
    if path.name.lower().endswith(".gz"):
        try:
            with gzip.open(path, "rb") as handle:
                data = handle.read(MAX_UNCOMPRESSED_BYTES + 1)
        except (OSError, EOFError) as error:
            fail("The compressed model file is damaged: %s" % error)
        if len(data) > MAX_UNCOMPRESSED_BYTES:
            fail("The decompressed model exceeds the %s-byte limit." % MAX_UNCOMPRESSED_BYTES)
        return data
    return path.read_bytes()


FBC_V2 = "{http://www.sbml.org/sbml/level3/version1/fbc/version2}"


def cobra_identifier(sid, prefix):
    """The identifier COBRApy 0.32 gives an SBML id: its R_ or G_ prefix clipped, dots unescaped."""
    sid = (sid or "").replace("__SBML_DOT__", ".")
    return sid[len(prefix):] if sid.startswith(prefix) else sid


def sbml_summary(data):
    # Entity declarations can expand without bound or reach outside the file; SBML never needs them.
    if b"<!DOCTYPE" in data[:4096].upper() or b"<!ENTITY" in data.upper():
        fail("The SBML file declares a document type or entities; export it again without them.")
    counts = {"reaction": 0, "species": 0, "geneProduct": 0, "fluxObjective": 0}
    reaction_ids = set()
    gene_ids = set()
    level = None
    try:
        for _, element in ElementTree.iterparse(io.BytesIO(data), events=("start",)):
            name = element.tag.rsplit("}", 1)[-1]
            if name == "sbml":
                level = element.get("level")
            if name in counts:
                counts[name] += 1
                if name == "reaction":
                    reaction_ids.add(cobra_identifier(element.get("id"), "R_"))
                elif name == "geneProduct":
                    gene_ids.add(cobra_identifier(element.get(FBC_V2 + "id") or element.get("id"), "G_"))
    except ElementTree.ParseError as error:
        fail("The SBML file is not well-formed XML: %s" % error)
    if level is None:
        fail("The file is not an SBML document.")
    return {"format": "sbml", "sbmlLevel": level, "reactions": counts["reaction"], "metabolites": counts["species"],
            "genes": counts["geneProduct"], "hasObjective": counts["fluxObjective"] > 0,
            "reactionIds": reaction_ids, "geneIds": {gene for gene in gene_ids if gene}}


def json_summary(data):
    try:
        model = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        fail("The JSON model is not valid UTF-8 JSON: %s" % error)
    if not isinstance(model, dict) or not isinstance(model.get("reactions"), list) \
            or not isinstance(model.get("metabolites"), list):
        fail("The JSON file is not a COBRA model (it needs reactions and metabolites lists).")
    reactions = [item for item in model["reactions"] if isinstance(item, dict)]
    genes = [item for item in model.get("genes") or [] if isinstance(item, dict)]
    return {"format": "cobra-json", "reactions": len(reactions), "metabolites": len(model["metabolites"]),
            "genes": len(genes), "hasObjective": any(item.get("objective_coefficient") for item in reactions),
            "reactionIds": {str(item.get("id")) for item in reactions},
            "geneIds": {str(item.get("id")) for item in genes}}


def model_summary(path):
    data = model_bytes(path)
    summary = json_summary(data) if path.name.lower().endswith(".json") else sbml_summary(data)
    if summary["reactions"] < 1:
        fail("The model contains no reactions.")
    if summary["reactions"] > MAX_REACTIONS:
        fail("The model exceeds the %s-reaction limit." % MAX_REACTIONS)
    return summary


def text_list(value, label):
    if value in (None, ""):
        return []
    items = value if isinstance(value, list) else str(value).split(",")
    cleaned = sorted({str(item).strip() for item in items if str(item).strip()})
    if len(cleaned) > MAX_CHANGES:
        fail("%s lists more than %d entries." % (label, MAX_CHANGES))
    return cleaned


def analysis_options(payload, summary):
    raw = payload.get("metabolic") or {}
    analysis = raw.get("analysis", "fba")
    if analysis not in ANALYSES:
        fail("The analysis must be one of: %s." % ", ".join(ANALYSES))
    objective = str(raw.get("objective") or "").strip()
    if objective and objective not in summary["reactionIds"]:
        fail("The objective reaction %s is not in the model." % objective)
    if not objective and not summary["hasObjective"]:
        fail("The model defines no objective; choose the reaction to optimize.")
    direction = raw.get("direction", "max")
    if direction not in ("max", "min"):
        fail("The objective direction must be max or min.")
    bounds = []
    for index, change in enumerate(raw.get("bounds") or []):
        if not isinstance(change, dict):
            fail("Bound change %d is not an object." % (index + 1))
        reaction = str(change.get("reaction") or "").strip()
        if reaction not in summary["reactionIds"]:
            fail("Bound change %d names %s, which is not a reaction in the model." % (index + 1, reaction or "nothing"))
        lower = finite_number(change.get("lower"), "Lower bound of %s" % reaction, -MAX_ABS_BOUND, MAX_ABS_BOUND)
        upper = finite_number(change.get("upper"), "Upper bound of %s" % reaction, -MAX_ABS_BOUND, MAX_ABS_BOUND)
        if lower > upper:
            fail("The lower bound of %s exceeds its upper bound." % reaction)
        bounds.append({"reaction": reaction, "lower": lower, "upper": upper})
    if len(bounds) > MAX_CHANGES or len({item["reaction"] for item in bounds}) != len(bounds):
        fail("Each reaction may have its bounds changed once, and at most %d reactions." % MAX_CHANGES)
    knockouts = text_list(raw.get("knockouts"), "Gene knockouts")
    unknown = [gene for gene in knockouts if gene not in summary["geneIds"]]
    if unknown:
        fail("These genes are not in the model: %s." % ", ".join(unknown[:10]))
    fraction = finite_number(raw.get("fractionOfOptimum", 1.0), "Fraction of optimum", 0.0, 1.0)
    return {"analysis": analysis, "objective": objective or None, "direction": direction, "bounds": bounds,
            "knockouts": knockouts, "fractionOfOptimum": fraction, "pfba": raw.get("pfba") is True,
            "crossCheck": raw.get("crossCheck", True) is not False}


def preflight_metabolic(payload):
    path, size = checked_file(payload.get("model"), "Metabolic model", MAX_MODEL_BYTES, MODEL_EXTENSIONS)
    summary = model_summary(path)
    options = analysis_options(payload, summary)
    reactions, genes = summary["reactions"], summary["genes"]
    if options["analysis"] == "gene-deletion" and genes < 1:
        fail("The model lists no gene products to delete; export it as SBML Level 3 with the FBC package "
             "or as COBRA JSON.")
    # One linear program per optimum, two per variability range, one per deletion, plus the reference.
    problems = {"fba": 1 + options["pfba"], "fva": 1 + 2 * reactions, "gene-deletion": 1 + genes,
                "reaction-deletion": 1 + reactions}[options["analysis"]]
    rows = {"fba": reactions, "fva": reactions, "gene-deletion": genes, "reaction-deletion": reactions}[options["analysis"]]
    public = {key: value for key, value in summary.items() if key not in ("reactionIds", "geneIds")}
    return {
        "schemaVersion": 1,
        "kind": "liatir.metabolic-modeling-preflight",
        "action": "analyze-metabolic",
        "workloadId": "cobra:%s" % options["analysis"],
        "tokenCount": 2 if options["crossCheck"] else 1,
        "atomCount": reactions,
        "stepCount": problems,
        "outputItemCount": rows,
        "model": public,
        "options": options,
        "inputBytes": size,
        "networkAccess": False,
    }


# ── COBRApy ─────────────────────────────────────────────────────────────────

def versions():
    import importlib.metadata
    found = {name: importlib.metadata.version(name) for name in ("cobra", "optlang", "highspy", "swiglpk")}
    for name, expected in (("cobra", COBRA_VERSION), ("optlang", OPTLANG_VERSION), ("highspy", HIGHS_VERSION)):
        if found[name] != expected:
            fail("Installed %s %s is not the reviewed %s." % (name, found[name], expected))
    return found


def load_model(cobra, path, metrics):
    name = path.name.lower()
    try:
        model = cobra.io.load_json_model(str(path)) if name.endswith(".json") else cobra.io.read_sbml_model(str(path))
    except Exception as error:  # COBRApy raises several unrelated types for an unreadable model.
        fail("COBRApy could not read the model: %s" % error)
    expected = metrics["model"]
    if len(model.reactions) != expected["reactions"] or len(model.genes) != expected["genes"]:
        fail("COBRApy read %d reactions and %d genes where the file declares %d and %d."
             % (len(model.reactions), len(model.genes), expected["reactions"], expected["genes"]))
    return model


def configure(model, options, solver):
    """Applies the request to a fresh copy of the model for one solver."""
    configured = model.copy()
    configured.solver = solver
    for change in options["bounds"]:
        configured.reactions.get_by_id(change["reaction"]).bounds = (change["lower"], change["upper"])
    for gene in options["knockouts"]:
        configured.genes.get_by_id(gene).knock_out()
    if options["objective"]:
        configured.objective = options["objective"]
    configured.objective_direction = options["direction"]
    return configured


def optimum(model):
    solution = model.optimize()
    if solution.status != "optimal":
        fail("The model has no optimal flux distribution under these bounds and knockouts (solver status: %s)."
             % solution.status)
    if not math.isfinite(solution.objective_value):
        fail("The objective is unbounded; bound the reactions that feed it.")
    return solution


def run_analysis(cobra, model, options):
    """Every number the analysis reports, for one solver."""
    flux_analysis = cobra.flux_analysis
    solution = optimum(model)
    reference = float(solution.objective_value)
    result = {"objective": reference, "fluxes": {reaction.id: float(solution.fluxes[reaction.id]) for reaction in model.reactions}}
    if options["analysis"] == "fba" and options["pfba"]:
        parsimonious = flux_analysis.pfba(model)
        result["fluxes"] = {reaction.id: float(parsimonious.fluxes[reaction.id]) for reaction in model.reactions}
        result["totalFlux"] = float(sum(abs(value) for value in result["fluxes"].values()))
    elif options["analysis"] == "fva":
        table = flux_analysis.flux_variability_analysis(model, fraction_of_optimum=options["fractionOfOptimum"],
                                                        processes=1)
        result["ranges"] = {reaction: (float(row["minimum"]), float(row["maximum"])) for reaction, row in table.iterrows()}
    elif options["analysis"] in ("gene-deletion", "reaction-deletion"):
        gene = options["analysis"] == "gene-deletion"
        table = (flux_analysis.single_gene_deletion if gene else flux_analysis.single_reaction_deletion)(model, processes=1)
        result["deletions"] = {next(iter(ids)): (float(growth) if growth == growth else None, str(status))
                               for ids, growth, status in zip(table["ids"], table["growth"], table["status"])}
    return result


def agree(left, right):
    if left is None or right is None:
        return left is None and right is None
    return abs(left - right) <= CROSS_CHECK_TOLERANCE * max(1.0, abs(left), abs(right))


def exact_value(cobra, model, options, kind, key):
    """One reported value solved again in exact rational arithmetic (GLPK's exact simplex)."""
    flux_analysis = cobra.flux_analysis
    if kind == "objective":
        return model.slim_optimize(error_value=None)
    if kind in ("minimum", "maximum"):
        table = flux_analysis.flux_variability_analysis(model, reaction_list=[key],
                                                        fraction_of_optimum=options["fractionOfOptimum"], processes=1)
        return float(table.loc[key, kind])
    if kind == "deletion":
        delete = flux_analysis.single_gene_deletion if options["analysis"] == "gene-deletion" else flux_analysis.single_reaction_deletion
        table = delete(model, [key], processes=1)
        growth, status = table["growth"].iloc[0], str(table["status"].iloc[0])
        return float(growth) if status == "optimal" and growth == growth else None
    return float(flux_analysis.pfba(model).fluxes.abs().sum())


def cross_check(cobra, base, options, primary, confirming):
    """Every reported value from HiGHS held to GLPK, and any disagreement settled in exact arithmetic.

    Two floating-point solvers can disagree where a problem is degenerate: at 100 % of the optimum on
    iJO1366, GLPK's tolerance let OPHHX3 carry 2.2e-4 where the exact optimum allows none. The exact
    rational solver is too slow for a whole analysis but not for the few values in dispute, so it
    decides those; a result it does not confirm is refused.
    """
    pairs = [("objective", None, primary["objective"], confirming["objective"])]
    for key, (low, high) in primary.get("ranges", {}).items():
        pairs += [("minimum", key, low, confirming["ranges"][key][0]), ("maximum", key, high, confirming["ranges"][key][1])]
    for key, (growth, status) in primary.get("deletions", {}).items():
        other_growth, other_status = confirming["deletions"][key]
        # An infeasible deletion has no objective; one solver's None against the other's number is a dispute.
        pairs.append(("deletion", key, growth if status == "optimal" else None,
                      other_growth if other_status == "optimal" else None))
    if "totalFlux" in primary:
        pairs.append(("total flux", None, primary["totalFlux"], confirming["totalFlux"]))
    disputed = [pair for pair in pairs if not agree(pair[2], pair[3])]
    if len(disputed) > MAX_EXACT_ADJUDICATIONS:
        fail("HiGHS and GLPK disagree on %d values, more than exact arithmetic can settle here; the result is not "
             "reported." % len(disputed))
    settled = []
    if disputed:
        exact = configure(base, options, EXACT_SOLVER)
        for kind, key, left, right in disputed:
            label = " ".join(part for part in (key, kind) if part)
            truth = exact_value(cobra, exact, options, kind, key)
            if not agree(left, truth):
                fail("HiGHS (%r) and GLPK (%r) disagree on %s, and exact arithmetic (%r) does not confirm HiGHS; the "
                     "result is not reported." % (left, right, label, truth))
            settled.append({"value": label, "highs": left, "glpk": right, "exact": truth})
    worst = max((abs(left - right) for _, _, left, right in pairs
                 if left is not None and right is not None and agree(left, right)), default=0.0)
    return {"solver": "GLPK", "values": len(pairs), "maxAbsoluteDifference": worst, "tolerance": CROSS_CHECK_TOLERANCE,
            "settledByExactArithmetic": settled}


def number(value):
    """A reported flux: nine significant digits, and zero below the solver's precision.

    HiGHS returns the same vertex on every run but its last bits vary by about 1e-14 between runs, so a
    value of order 1e-14 is round-off around zero, not a flux.
    """
    return "0" if abs(value) < NUMERICAL_ZERO else "%.9g" % value


def bar_plot(labels, values, title, axis):
    return {"data": [{"type": "bar", "orientation": "h", "x": values, "y": labels}],
            "layout": {"title": title, "xaxis": {"title": axis}, "yaxis": {"automargin": True}}}


def analyze_metabolic(payload, output_dir, metrics):
    import cobra

    started = time.time()
    found_versions = versions()
    options = metrics["options"]
    path, _ = checked_file(payload.get("model"), "Metabolic model", MAX_MODEL_BYTES, MODEL_EXTENSIONS)
    base = load_model(cobra, path, metrics)
    model = configure(base, options, PRIMARY_SOLVER)
    primary = run_analysis(cobra, model, options)
    confirmation = None
    if options["crossCheck"]:
        confirmation = cross_check(cobra, base, options, primary,
                                   run_analysis(cobra, configure(base, options, CROSS_CHECK_SOLVER), options))

    paths = {}
    reactions = {reaction.id: reaction for reaction in model.reactions}
    flux_path = output_dir / "fluxes.csv"
    write_csv(flux_path, ["Reaction", "Name", "Subsystem", "Flux", "Lower bound", "Upper bound"],
              [[rid, reactions[rid].name, reactions[rid].subsystem, number(flux), number(reactions[rid].lower_bound),
                number(reactions[rid].upper_bound)] for rid, flux in primary["fluxes"].items()])
    paths["fluxesCsv"] = str(flux_path)
    exchanges = sorted(((rid, flux) for rid, flux in primary["fluxes"].items()
                        if reactions[rid] in model.exchanges and abs(flux) > 1e-9), key=lambda item: item[1])
    summary_extra = {}
    if options["analysis"] == "fva":
        ranges = primary["ranges"]
        fva_path = output_dir / "flux-variability.csv"
        write_csv(fva_path, ["Reaction", "Name", "Minimum", "Maximum"],
                  [[rid, reactions[rid].name, number(low), number(high)] for rid, (low, high) in ranges.items()])
        paths["variabilityCsv"] = str(fva_path)
        widest = sorted(ranges.items(), key=lambda item: item[1][0] - item[1][1])[:40]
        plot = {"data": [{"type": "bar", "orientation": "h", "base": [low for _, (low, _) in reversed(widest)],
                          "x": [high - low for _, (low, high) in reversed(widest)],
                          "y": [rid for rid, _ in reversed(widest)]}],
                "layout": {"title": "Widest flux ranges", "xaxis": {"title": "Flux (mmol/gDW/h)"},
                           "yaxis": {"automargin": True}}}
        summary_extra["variability"] = {"reactions": len(ranges), "fractionOfOptimum": options["fractionOfOptimum"],
                                        "blocked": sum(1 for low, high in ranges.values() if abs(low) < 1e-9 and abs(high) < 1e-9),
                                        "fixed": sum(1 for low, high in ranges.values() if abs(high - low) < 1e-9)}
    elif options["analysis"] in ("gene-deletion", "reaction-deletion"):
        threshold = ESSENTIAL_FRACTION * abs(primary["objective"])
        rows = []
        essential = []
        for key, (growth, status) in sorted(primary["deletions"].items()):
            is_essential = status != "optimal" or growth is None or abs(growth) < threshold
            if is_essential:
                essential.append(key)
            relative = growth / primary["objective"] if growth is not None and primary["objective"] else None
            rows.append([key, "" if growth is None else number(growth), status,
                         "" if relative is None else "%.6f" % relative, "yes" if is_essential else "no"])
        deletion_path = output_dir / "deletions.csv"
        write_csv(deletion_path, ["Gene" if options["analysis"] == "gene-deletion" else "Reaction",
                                  "Objective after deletion", "Solver status", "Fraction of unperturbed", "Essential"], rows)
        paths["deletionsCsv"] = str(deletion_path)
        impaired = sorted(((key, growth or 0.0) for key, (growth, _) in primary["deletions"].items()
                           if growth is None or growth < 0.999 * primary["objective"]), key=lambda item: item[1])[:40]
        plot = bar_plot([key for key, _ in reversed(impaired)], [round(value, 6) for _, value in reversed(impaired)],
                        "Deletions that lower the objective", "Objective after deletion")
        summary_extra["deletions"] = {"count": len(rows), "essential": essential, "threshold": threshold,
                                      "essentialRule": "below 1% of the unperturbed optimum, or infeasible"}
    else:
        plot = bar_plot([rid for rid, _ in exchanges], [round(flux, 6) for _, flux in exchanges],
                        "Exchange fluxes (negative: uptake; positive: secretion)", "Flux (mmol/gDW/h)")
        if "totalFlux" in primary:
            summary_extra["parsimonious"] = {"totalFlux": primary["totalFlux"]}
    plot_path = output_dir / "metabolic-plot.json"
    write_json_atomic(plot_path, plot)
    paths["plot"] = str(plot_path)
    summary = {
        "schemaVersion": 1,
        "kind": "liatir.metabolic-modeling-summary",
        "runtimeId": RUNTIME_ID,
        "runtimeBoxRelease": payload.get("runtimeBoxRelease"),
        "targetId": payload.get("targetId"),
        "versions": found_versions,
        "solver": "HiGHS %s through optlang's hybrid interface" % HIGHS_VERSION,
        "crossCheck": confirmation,
        "model": {**metrics["model"], "id": base.id, "sha256": sha256_file(path)},
        "options": options,
        "objective": {"expression": str(model.objective.expression), "direction": options["direction"],
                      "value": primary["objective"]},
        "exchanges": [{"reaction": rid, "flux": flux} for rid, flux in exchanges],
        **summary_extra,
        "units": {"flux": "mmol/gDW/h, as the model defines", "growth": "1/h for a biomass objective"},
        "scientificNotice": SCIENTIFIC_NOTICE,
        "elapsedSeconds": round(time.time() - started, 3),
        "networkAccess": False,
        "hardwareEstimate": payload.get("hardwareEstimate"),
    }
    summary_path = output_dir / "metabolic-summary.json"
    write_json_atomic(summary_path, summary)
    paths["summaryJson"] = str(summary_path)
    return {"schemaVersion": 1, "kind": "liatir.metabolic-modeling-result", "action": "analyze-metabolic",
            "paths": paths, "summary": summary}


def main():
    payload = json.load(sys.stdin)
    action = payload.get("action")
    if action == "preflight-metabolic":
        print(json.dumps(preflight_metabolic(payload), separators=(",", ":")))
        return
    if action != "analyze-metabolic":
        fail("Unsupported metabolic modeling action.")
    deny_network()
    metrics = preflight_metabolic(payload)
    require_measured_envelope(payload, metrics)
    output_dir = output_directory(payload)
    with tempfile.TemporaryDirectory(prefix="liatir-metabolic-") as scratch:
        # COBRApy creates its model cache directory on import; it belongs in this run's scratch space,
        # not in the user's home.
        os.environ["XDG_CACHE_HOME"] = scratch
        result = analyze_metabolic(payload, output_dir, metrics)
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
`;
