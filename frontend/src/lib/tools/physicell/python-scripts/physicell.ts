/**
 * Offline PhysiCell adapter for Multicellular Simulation.
 *
 * The preflight reads PhysiCell settings with the Python standard library only. A run writes the
 * settings PhysiCell runs, with every path its own (PhysiCell builds shell commands from them), starts
 * the reviewed executable on them, and reads PhysiCell's own output files.
 */
export const PHYSICELL_SCRIPT = String.raw`
"""Offline agent-based multicellular simulation with PhysiCell.

Every action reads one JSON payload on stdin and prints one JSON result as its last stdout line. The
preflight reads PhysiCell settings with the Python standard library only. A run never hands a user's
settings to PhysiCell as they are: PhysiCell copies files with shell commands built from the paths in
its settings, so the runner writes the settings it runs, with every path its own, then starts the
reviewed executable and reads PhysiCell's own output files.
"""
import csv
import hashlib
import json
import math
import os
import pathlib
import socket
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET

PHYSICELL_VERSION = "1.14.2"
RUNTIME_ID = "physicell-1-14-2"
EXECUTABLE = "physicell/bin/physicell-1.14.2-template-linux-x86_64"
# The executable runtime-boxes/native-builds/physicell/build.sh makes from the reviewed source.
EXECUTABLE_SHA256 = "2dd954ad781fe9088a483a070b120701ce70b57a2ef253276617142fe34952f1"
DEFAULT_SETTINGS = "physicell/config/PhysiCell_settings.xml"
MAX_SETTINGS_BYTES = 4 * 1024 * 1024
MAX_CSV_BYTES = 64 * 1024 * 1024
MAX_VOXELS = 1_000_000
MAX_SUBSTRATES = 32
MAX_CELL_TYPES = 64
MAX_INITIAL_CELLS = 100_000
MAX_TIME_MIN = 100_000
MAX_SNAPSHOTS = 2_000
MAX_SEED = 2_147_483_647
# Cells drawn per type and state in the tissue plot; the final-cells table always lists every cell.
MAX_PLOTTED_CELLS = 20_000
# The paths PhysiCell reads and writes inside the run directory; they reach PhysiCell's shell commands.
SETTINGS_PATH = "config/PhysiCell_settings.xml"
CELLS_FILE = "cells.csv"
RULES_FILE = "cell_rules.csv"
# PhysiCell's phase codes, as PhysiCell_constants.cpp (1.14.2) names them.
PHASE_NAMES = {
    0: "Ki67_positive_premitotic", 1: "Ki67_positive_postmitotic", 2: "Ki67_positive", 3: "Ki67_negative",
    4: "G0G1_phase", 5: "G0_phase", 6: "G1_phase", 7: "G1a_phase", 8: "G1b_phase", 9: "G1c_phase", 10: "S_phase",
    11: "G2M_phase", 12: "G2_phase", 13: "M_phase", 14: "live", 15: "G1pm_phase", 16: "G1ps_phase", 17: "cycling",
    18: "quiescent", 100: "apoptotic", 101: "necrotic_swelling", 102: "necrotic_lysed", 103: "necrotic",
    104: "debris", 9999: "custom_phase",
}
SCIENTIFIC_NOTICE = (
    "An agent-based simulation follows the model's cell definitions, rules and parameters, not the "
    "tissue they stand for. Cell behaviour is stochastic, so one seed gives one sample; with more than "
    "one thread the same seed does not repeat a run exactly."
)


def fail(message):
    raise ValueError(message)


def deny_network():
    original_connect = socket.socket.connect

    def blocked(*_args, **_kwargs):
        raise RuntimeError("Network access is disabled for this local multicellular simulation.")

    def blocked_connect(sock, address):
        if sock.family == socket.AF_UNIX:
            return original_connect(sock, address)
        return blocked()

    socket.socket.connect = blocked_connect
    socket.create_connection = blocked
    socket.getaddrinfo = blocked


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


def integer(value, label, minimum, maximum):
    if isinstance(value, bool):
        fail("%s must be a whole number." % label)
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError):
        fail("%s must be a whole number." % label)
    if number < minimum or number > maximum:
        fail("%s must be from %s to %s." % (label, minimum, maximum))
    return number


def checked_file(raw_path, label, max_bytes, extensions):
    path = pathlib.Path(str(raw_path or "")).expanduser().resolve()
    if not path.is_file():
        fail("%s does not exist: %s" % (label, path.name or raw_path))
    if not path.name.lower().endswith(extensions):
        fail("%s must use one of these formats: %s." % (label, ", ".join(extensions)))
    size = path.stat().st_size
    if size < 1 or size > max_bytes:
        fail("%s must hold between 1 and %d bytes." % (label, max_bytes))
    return path, size


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json_atomic(path, value):
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


def payload_root():
    """The box's root: the interpreter is venv/bin/python inside it."""
    return pathlib.Path(sys.executable).resolve().parents[2]


# ── stdlib-only reading of the settings ─────────────────────────────────────

def enabled(node):
    return node is not None and str(node.get("enabled", "")).strip().lower() == "true"


def text_number(root, path, label, minimum=None, maximum=None):
    node = root.find(path)
    if node is None or not (node.text or "").strip():
        fail("The settings have no %s (%s)." % (label, path))
    return finite_number(node.text.strip(), label, minimum, maximum)


def read_settings(path):
    raw = path.read_bytes()
    # The standard library would expand an internal entity; PhysiCell settings never need either.
    if b"<!DOCTYPE" in raw or b"<!ENTITY" in raw:
        fail("The settings declare a document type or entities, which PhysiCell settings never need.")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as error:
        fail("The settings are not well-formed XML: %s" % error)
    if root.tag != "PhysiCell_settings":
        fail("This is not a PhysiCell settings file (its root element is %s)." % root.tag)
    return root


def count_csv_rows(path):
    rows = 0
    with open(path, encoding="utf-8", errors="strict") as handle:
        for line in handle:
            stripped = line.strip()
            if stripped and not stripped.startswith(("#", "x,", "X,")):
                rows += 1
    return rows


def model_summary(root, inputs):
    """What the settings ask for, refused where this tool cannot run it as written."""
    if root.find(".//intracellular") is not None:
        fail("The settings attach intracellular models (PhysiBoSS, SBML or FBA), which need a PhysiCell build "
             "with those libraries; this tool runs PhysiCell's template engine.")
    options = root.find("microenvironment_setup/options")
    if options is not None and (enabled(options.find("initial_condition")) or enabled(options.find("dirichlet_nodes"))):
        fail("The settings load substrate initial or boundary values from .mat files, which this tool does not read.")
    extent = {}
    for axis in "xyz":
        low = text_number(root, "domain/%s_min" % axis, "%s_min" % axis)
        high = text_number(root, "domain/%s_max" % axis, "%s_max" % axis)
        step = text_number(root, "domain/d%s" % axis, "d%s" % axis, 1e-6)
        if high <= low:
            fail("The domain's %s_max must exceed its %s_min." % (axis, axis))
        extent[axis] = (low, high, step)
    two_d = (root.findtext("domain/use_2D") or "").strip().lower() == "true"
    voxels = 1
    for axis, (low, high, step) in extent.items():
        if not (two_d and axis == "z"):
            voxels *= max(1, math.ceil((high - low) / step - 1e-9))
    if voxels > MAX_VOXELS:
        fail("The domain has %d voxels, more than the %d this tool simulates." % (voxels, MAX_VOXELS))
    substrates = [variable.get("name") or "" for variable in root.findall("microenvironment_setup/variable")]
    if len(substrates) > MAX_SUBSTRATES:
        fail("The settings declare %d substrates; at most %d are supported." % (len(substrates), MAX_SUBSTRATES))
    cell_types = {}
    for definition in root.findall("cell_definitions/cell_definition"):
        cell_types[integer(definition.get("ID"), "A cell definition ID", 0, 10_000)] = definition.get("name") or ""
    if not cell_types or len(cell_types) > MAX_CELL_TYPES:
        fail("The settings must define from 1 to %d cell types." % MAX_CELL_TYPES)
    rulesets = [ruleset for ruleset in root.findall("cell_rules/rulesets/ruleset") if enabled(ruleset)]
    if len(rulesets) > 1:
        fail("The settings enable %d rule sets; this tool runs one." % len(rulesets))
    if rulesets and not inputs.get("rules"):
        fail("The settings enable cell rules: choose the rules CSV they name (%s)."
             % (rulesets[0].findtext("filename") or "cell_rules.csv"))
    positions = root.find("initial_conditions/cell_positions")
    placed = 0
    if enabled(positions):
        if not inputs.get("cells"):
            fail("The settings place cells from a CSV file: choose the file they name (%s)."
                 % (positions.findtext("filename") or "cells.csv"))
        placed = count_csv_rows(inputs["cells"])
    per_type = root.find("user_parameters/number_of_cells")
    # The template engine places this many cells of every type at random, as well as any listed.
    random_cells = integer(per_type.text, "number_of_cells", 0, MAX_INITIAL_CELLS) if per_type is not None else 0
    initial_cells = random_cells * len(cell_types) + placed
    if initial_cells == 0:
        # A population that dies out during a run is fine; one that starts empty crashes PhysiCell.
        fail("The settings start no cells, and PhysiCell 1.14.2 stops with a crash when a simulation starts "
             "without one: place at least one cell (number_of_cells, or a cell positions file).")
    if initial_cells > MAX_INITIAL_CELLS:
        fail("The settings start %d cells; at most %d are supported." % (initial_cells, MAX_INITIAL_CELLS))
    return {
        "cellTypes": [cell_types[key] for key in sorted(cell_types)],
        "cellTypeIds": sorted(cell_types),
        "substrates": substrates,
        "domain": {axis: list(values) for axis, values in extent.items()},
        "twoDimensional": two_d,
        "voxels": voxels,
        "initialCells": initial_cells,
        "randomCellsPerType": random_cells,
        "rulesEnabled": bool(rulesets),
        "cellPositionsEnabled": enabled(positions),
    }


def model_inputs(payload):
    """The settings file and the CSV files they name, resolved and size-checked."""
    source = payload.get("source", "builtin")
    inputs = {}
    if source == "builtin":
        inputs["settings"] = payload_root() / DEFAULT_SETTINGS
        size = 0
    elif source == "settings":
        inputs["settings"], size = checked_file(payload.get("settings"), "PhysiCell settings", MAX_SETTINGS_BYTES,
                                                (".xml",))
        for key, label in (("cells", "Cell positions"), ("rules", "Cell rules")):
            if payload.get(key):
                inputs[key], extra = checked_file(payload[key], label, MAX_CSV_BYTES, (".csv",))
                size += extra
    else:
        fail("The model must be PhysiCell's template or a settings file.")
    return source, inputs, size


def run_options(payload, root):
    raw = payload.get("physicell") or {}
    settings_time = text_number(root, "overall/max_time", "max_time", 0)
    options = {
        "maxTime": finite_number(raw.get("maxTime", settings_time), "Simulated time", 0, MAX_TIME_MIN),
        "seed": integer(raw.get("seed", 0), "Seed", 0, MAX_SEED),
        "threads": integer(raw.get("threads", 1), "Threads", 1, os.cpu_count() or 1),
    }
    if options["maxTime"] <= 0:
        fail("Simulated time must be positive.")
    return options


def preflight_simulation(payload):
    source, inputs, size = model_inputs(payload)
    root = read_settings(inputs["settings"])
    model = model_summary(root, inputs)
    options = run_options(payload, root)
    dt_mechanics = text_number(root, "overall/dt_mechanics", "dt_mechanics", 1e-6)
    text_number(root, "overall/dt_diffusion", "dt_diffusion", 1e-9)
    text_number(root, "overall/dt_phenotype", "dt_phenotype", 1e-6)
    snapshots = 1
    if enabled_text(root.find("save/full_data/enable")):
        interval = text_number(root, "save/full_data/interval", "the full-data interval", 1e-6)
        snapshots = int(options["maxTime"] // interval) + 1
        if snapshots > MAX_SNAPSHOTS:
            fail("The run would write %d snapshots; raise the full-data interval to stay within %d."
                 % (snapshots, MAX_SNAPSHOTS))
    return {
        "schemaVersion": 1,
        "kind": "liatir.physicell-preflight",
        "action": "simulate-physicell",
        "workloadId": "physicell:template",
        "tokenCount": model["initialCells"],
        "atomCount": model["voxels"] * max(1, len(model["substrates"])),
        "stepCount": math.ceil(options["maxTime"] / dt_mechanics),
        "outputItemCount": snapshots,
        "model": {"source": source, **model},
        "options": options,
        "inputBytes": size,
        "networkAccess": False,
    }, root, inputs


def enabled_text(node):
    return node is not None and (node.text or "").strip().lower() == "true"


def require_measured_envelope(payload, metrics=None):
    """A run needs an accepted measured preflight: checked before anything runs, then against the input."""
    if payload.get("measurementMode") is True:
        return
    estimate = payload.get("hardwareEstimate")
    if not isinstance(estimate, dict) or estimate.get("accepted") is not True:
        fail("A measured hardware preflight must accept this input before PhysiCell runs.")
    if not str(estimate.get("evidenceRecord") or "").strip():
        fail("Hardware preflight has no retained evidence record.")
    for key in ("workloadId", "tokenCount", "atomCount", "stepCount", "outputItemCount"):
        if metrics is not None and estimate.get(key) != metrics.get(key):
            fail("Hardware preflight no longer matches the selected input (%s)." % key)


# ── the run ─────────────────────────────────────────────────────────────────

def set_text(root, path, value):
    node = root
    for name in path.split("/"):
        child = node.find(name)
        node = child if child is not None else ET.SubElement(node, name)
    node.text = str(value)


def run_settings(root, options, inputs):
    """The settings PhysiCell runs: the user's model, with every path and run control the runner's own."""
    set_text(root, "save/folder", "output")
    set_text(root, "parallel/omp_num_threads", options["threads"])
    set_text(root, "options/random_seed", options["seed"])
    set_text(root, "overall/max_time", repr(float(options["maxTime"])))
    seed = root.find("user_parameters/random_seed")
    if seed is not None:
        seed.text = str(options["seed"])
    positions = root.find("initial_conditions/cell_positions")
    if positions is not None:
        set_text(positions, "folder", "./config")
        set_text(positions, "filename", CELLS_FILE)
        if not inputs.get("cells"):
            positions.set("enabled", "false")
    for ruleset in root.findall("cell_rules/rulesets/ruleset"):
        set_text(ruleset, "folder", "./config")
        set_text(ruleset, "filename", RULES_FILE)
        if not inputs.get("rules"):
            ruleset.set("enabled", "false")
    return root


def executable():
    path = payload_root() / EXECUTABLE
    if not path.is_file() or not os.access(path, os.X_OK):
        fail("The PhysiCell executable is missing from the Runtime Box or cannot run; reinstall it.")
    if sha256_file(path) != EXECUTABLE_SHA256:
        fail("The PhysiCell executable is not the reviewed build.")
    return path


def labels_of(snapshot):
    """Row index of each per-cell quantity in PhysiCell's cell matrix, from the snapshot's own labels."""
    labels = {}
    for label in snapshot.iter("label"):
        labels.setdefault((label.text or "").strip(), int(label.get("index")))
    for required in ("ID", "position", "cell_type", "current_phase", "dead"):
        if required not in labels:
            fail("PhysiCell's output lacks the %s column; it cannot be read." % required)
    return labels


def read_snapshot(output, xml_path):
    import numpy as np
    import scipy.io
    snapshot = ET.parse(xml_path).getroot()
    current = float(snapshot.findtext(".//current_time"))
    cells_name = snapshot.find(".//simplified_data/filename").text.strip()
    cells = scipy.io.loadmat(output / cells_name)["cells"]
    environment_name = snapshot.find(".//microenvironment//data/filename").text.strip()
    environment = scipy.io.loadmat(output / environment_name)["multiscale_microenvironment"]
    if not (np.isfinite(cells).all() and np.isfinite(environment).all()):
        fail("PhysiCell wrote non-finite values at t = %g min." % current)
    return current, labels_of(snapshot), cells, environment


def simulate(payload, output_dir, metrics, root, inputs, started):
    import numpy as np
    options = metrics["options"]
    model = metrics["model"]
    exe = executable()
    run_dir = output_dir / "physicell"
    (run_dir / "config").mkdir(parents=True, exist_ok=True)
    (run_dir / "output").mkdir(exist_ok=True)
    for key, name in (("cells", CELLS_FILE), ("rules", RULES_FILE)):
        if inputs.get(key):
            (run_dir / "config" / name).write_bytes(inputs[key].read_bytes())
    ET.ElementTree(run_settings(root, options, inputs)).write(run_dir / SETTINGS_PATH, encoding="utf-8",
                                                               xml_declaration=True)
    environment = {**os.environ, "OMP_NUM_THREADS": str(options["threads"])}
    with open(run_dir / "physicell.log", "w", encoding="utf-8") as log:
        completed = subprocess.run([str(exe), SETTINGS_PATH], cwd=run_dir, stdout=log, stderr=subprocess.STDOUT,
                                   stdin=subprocess.DEVNULL, env=environment, check=False)
    if completed.returncode != 0:
        tail = (run_dir / "physicell.log").read_text(encoding="utf-8", errors="replace")[-1500:]
        fail("PhysiCell stopped with exit code %d:\n%s" % (completed.returncode, tail))
    output = run_dir / "output"
    snapshots = sorted(output.glob("output[0-9]*.xml"))
    if not snapshots:
        fail("PhysiCell wrote no snapshots; nothing can be reported.")
    ids = model["cellTypeIds"]
    names = dict(zip(ids, model["cellTypes"]))
    population, substrate_rows = [], []
    for path in snapshots:
        current, labels, cells, environment_matrix = read_snapshot(output, path)
        kinds = cells[labels["cell_type"]].astype(int) if cells.size else np.array([], dtype=int)
        dead = cells[labels["dead"]] > 0.5 if cells.size else np.array([], dtype=bool)
        row = [current]
        for type_id in ids:
            mine = kinds == type_id
            row += [int(np.sum(mine & ~dead)), int(np.sum(mine & dead))]
        population.append(row)
        volume = environment_matrix[3]
        substrate_rows.append([current] + [float(np.average(environment_matrix[4 + index], weights=volume))
                                           for index in range(len(model["substrates"]))])
    final_time, labels, cells, _ = read_snapshot(output, snapshots[-1])
    header = ["Time (min)"] + [part for type_id in ids for part in ("%s live" % names[type_id], "%s dead" % names[type_id])]
    population_path = output_dir / "cell-populations.csv"
    write_csv(population_path, header, population)
    substrates_path = output_dir / "substrates.csv"
    write_csv(substrates_path, ["Time (min)"] + ["%s mean" % name for name in model["substrates"]], substrate_rows)
    final_path = output_dir / "final-cells.csv"
    position = labels["position"]
    write_csv(final_path, ["ID", "Cell type", "x", "y", "z", "Phase", "Dead"],
              [[int(cells[labels["ID"], index]), names.get(int(cells[labels["cell_type"], index]), "?"),
                "%.6g" % cells[position, index], "%.6g" % cells[position + 1, index],
                "%.6g" % cells[position + 2, index],
                PHASE_NAMES.get(int(cells[labels["current_phase"], index]), str(int(cells[labels["current_phase"], index]))),
                int(cells[labels["dead"], index] > 0.5)] for index in range(cells.shape[1] if cells.size else 0)])
    times = [row[0] for row in population]
    plot = {"data": [{"type": "scatter", "mode": "lines", "name": "%s (live)" % names[type_id], "x": times,
                      "y": [row[1 + 2 * position_index] for row in population]}
                     for position_index, type_id in enumerate(ids)][:20],
            "layout": {"title": "Live cells", "xaxis": {"title": "Time (min)"}, "yaxis": {"title": "Cells"}}}
    plot_path = output_dir / "simulation-plot.json"
    write_json_atomic(plot_path, plot)
    # Where the cells ended, by type, in the x-y plane: a picture of the tissue the results page can draw.
    kinds = cells[labels["cell_type"]].astype(int) if cells.size else np.array([], dtype=int)
    dead = cells[labels["dead"]] > 0.5 if cells.size else np.array([], dtype=bool)
    tissue = {"data": [], "layout": {"title": "Cells at %g min" % final_time, "xaxis": {"title": "x (micron)"},
                                     "yaxis": {"title": "y (micron)", "scaleanchor": "x"}}}
    for type_id in ids:
        for is_dead, label in ((False, "live"), (True, "dead")):
            chosen = np.flatnonzero((kinds == type_id) & (dead == is_dead))[:MAX_PLOTTED_CELLS]
            if chosen.size:
                tissue["data"].append({"type": "scatter", "mode": "markers", "name": "%s (%s)" % (names[type_id], label),
                                       "x": [float(value) for value in cells[position, chosen]],
                                       "y": [float(value) for value in cells[position + 1, chosen]],
                                       "marker": {"size": 5, "opacity": 0.4 if is_dead else 0.9}})
    tissue_path = output_dir / "tissue-plot.json"
    write_json_atomic(tissue_path, tissue)
    last = population[-1]
    final = {names[type_id]: {"live": last[1 + 2 * index], "dead": last[2 + 2 * index]} for index, type_id in enumerate(ids)}
    summary = {
        "schemaVersion": 1,
        "kind": "liatir.physicell-summary",
        "runtimeId": RUNTIME_ID,
        "runtimeBoxRelease": payload.get("runtimeBoxRelease"),
        "targetId": payload.get("targetId"),
        "versions": {"physicell": PHYSICELL_VERSION, "executableSha256": EXECUTABLE_SHA256},
        "model": {**model, "settingsSha256": sha256_file(inputs["settings"]),
                  "runSettingsSha256": sha256_file(run_dir / SETTINGS_PATH)},
        "options": options,
        "snapshots": len(snapshots),
        "finalTime": final_time,
        "final": final,
        "method": "PhysiCell %s template engine, %d thread%s, seed %d" % (
            PHYSICELL_VERSION, options["threads"], "" if options["threads"] == 1 else "s", options["seed"]),
        "scientificNotice": SCIENTIFIC_NOTICE,
        "elapsedSeconds": round(time.time() - started, 3),
        "networkAccess": False,
        "hardwareEstimate": payload.get("hardwareEstimate"),
    }
    summary_path = output_dir / "physicell-summary.json"
    write_json_atomic(summary_path, summary)
    paths = {"populationCsv": str(population_path), "substratesCsv": str(substrates_path),
             "finalCellsCsv": str(final_path), "plot": str(plot_path), "tissuePlot": str(tissue_path),
             "summaryJson": str(summary_path)}
    final_svg = output / "final.svg"
    if final_svg.is_file():
        paths["finalSvg"] = str(final_svg)
    return {"schemaVersion": 1, "kind": "liatir.physicell-result", "action": "simulate-physicell",
            "paths": paths, "summary": summary}


def main():
    started = time.time()
    payload = json.load(sys.stdin)
    action = payload.get("action")
    if action not in ("preflight-physicell", "simulate-physicell"):
        fail("Unsupported PhysiCell action.")
    metrics, root, inputs = preflight_simulation(payload)
    if action == "preflight-physicell":
        print(json.dumps(metrics, separators=(",", ":")))
        return
    require_measured_envelope(payload, metrics)
    raw_output = str(payload.get("outputDir") or "").strip()
    if not raw_output:
        fail("An output directory is required.")
    output_dir = pathlib.Path(raw_output).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    deny_network()
    result = simulate(payload, output_dir, metrics, root, inputs, started)
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
`;
