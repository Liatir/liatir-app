/**
 * Offline PySB and BioNetGen adapter for Biochemical Simulation.
 *
 * Both actions check the input with the Python standard library, then generate the reaction network
 * under memory and CPU limits, because a run's cost follows the network. A run denies network sockets,
 * executes only reviewed PySB models or BNGL without its actions, compiles nothing, and gives every
 * stochastic replicate its own seed.
 */
export const BIOCHEMICAL_SIMULATION_SCRIPT = String.raw`
"""Offline rule-based biochemical network simulation with PySB and BioNetGen.

Every action reads one JSON payload on stdin and prints one JSON result as its last stdout line. Both
actions check the input with the Python standard library first, then generate the reaction network,
because a run's cost follows the network and no input size predicts it. Every action denies network
sockets, executes only reviewed PySB example models or declarative BNGL imported without its actions,
compiles nothing, and a run gives every stochastic replicate its own seed.
"""
import csv
import hashlib
import importlib
import json
import math
import os
import pathlib
import re
import resource
import shutil
import socket
import sys
import tempfile
import time
from contextlib import contextmanager

PYSB_VERSION = "1.17.0"
BIONETGEN_VERSION = "2.9.3"
RUNTIME_ID = "biochemical-simulation-pysb-1-17-0"
BIONETGEN_DIR = "bionetgen-release/BioNetGen-%s" % BIONETGEN_VERSION
MAX_BNGL_BYTES = 16 * 1024 * 1024
MAX_POINTS = 10_001
MAX_RUNS = 10_000
MAX_SEED = 2_147_483_647
MAX_TIME = 1e12
MAX_OVERRIDES = 1_000
# Rule-based models can define networks of any size, and BioNetGen has no limit of its own on memory or
# time: a polymer doubles its longest chain every round. BioNetGen runs under these bounds and a model that
# exceeds one is refused; a partial network is never simulated.
BIONETGEN_MEMORY_BYTES = 4 * 1024 ** 3
BIONETGEN_CPU_SECONDS = 300
# LSODA's stiff solver holds a dense species-by-species Jacobian: 10,000 species already take 0.8 GB.
MAX_SPECIES = 10_000
MAX_REACTIONS = 200_000
# BioNetGen stops after this many rounds of rule application; a network still growing then never closed.
MAX_NETWORK_ITERATIONS = 100
# Reviewed models that ship in PySB 1.17.0; user Python is never executed.
BUILTIN_MODELS = {
    "robertson": "Robertson's stiff chemical kinetics problem",
    "synth_deg": "Synthesis and first-order degradation of one species",
    "michment": "Michaelis-Menten enzyme kinetics",
    "tyson_oscillator": "Tyson's cell-cycle oscillator",
    "kinase_cascade": "A three-tier kinase cascade",
    "earm_1_0": "Extrinsic apoptosis reaction model 1.0 (Albeck et al. 2008)",
    "bngwiki_egfr_simple": "A simple EGFR signalling model from the BioNetGen tutorial",
    "schloegl": "Schlögl's bistable reaction network",
}
SCIENTIFIC_NOTICE = (
    "A simulation describes the model's reactions, rate laws and parameters, not the cell they stand for. "
    "Deterministic results assume well-mixed, large populations; stochastic results are samples whose "
    "statistics depend on the number of runs."
)


def fail(message):
    raise ValueError(message)


def log(message):
    print(message, file=sys.stderr, flush=True)


def deny_network():
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex

    def blocked(*_args, **_kwargs):
        raise RuntimeError("Network access is disabled for this local biochemical simulation.")

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
    # PySB logs socket.getfqdn() whenever it sets up its logger, a reverse DNS lookup it does not need;
    # the local host name answers without the network.
    socket.getfqdn = lambda name="": name or socket.gethostname()


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


def integer(value, label, minimum=None, maximum=None):
    if isinstance(value, bool):
        fail("%s must be an integer." % label)
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError):
        fail("%s must be an integer." % label)
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


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


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


def require_measured_envelope(payload, metrics=None):
    """A run needs an accepted measured preflight: checked before PySB loads, then against the network."""
    if payload.get("measurementMode") is True:
        return
    estimate = payload.get("hardwareEstimate")
    if not isinstance(estimate, dict) or estimate.get("accepted") is not True:
        fail("A measured hardware preflight must accept this input before PySB is loaded.")
    if not str(estimate.get("evidenceRecord") or "").strip():
        fail("Hardware preflight has no retained evidence record.")
    for key in ("workloadId", "tokenCount", "atomCount", "stepCount", "outputItemCount"):
        if metrics is not None and estimate.get(key) != metrics.get(key):
            fail("Hardware preflight no longer matches the selected input (%s)." % key)


# ── stdlib-only model inspection ────────────────────────────────────────────

BLOCKS = ("parameters", "molecule types", "seed species", "species", "observables", "functions",
          "reaction rules", "compartments", "energy patterns", "population maps")
ACTION_LINE = re.compile(r"^\s*([A-Za-z_]\w*)\s*\(")


def bngl_summary(path):
    """What a BNGL file declares, read without BioNetGen; its actions are reported and never run."""
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        fail("The BNGL file is not UTF-8 text.")
    counts = {name: 0 for name in BLOCKS}
    parameters = set()
    block = None
    in_model = False
    actions = []
    joined = re.sub(r"\\\s*\n", " ", text)
    for raw in joined.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        lowered = " ".join(line.lower().split())
        if lowered == "begin model":
            in_model = True
            continue
        if lowered == "end model":
            in_model = False
            continue
        if lowered.startswith("begin "):
            name = lowered[len("begin "):]
            if name == "actions":
                block = "actions"
            elif name in BLOCKS:
                block = name
            else:
                fail("The BNGL file has a block this tool does not read: %s." % name)
            continue
        if lowered.startswith("end "):
            block = None
            continue
        if block == "actions" or (block is None and not in_model and ACTION_LINE.match(line)):
            match = ACTION_LINE.match(line)
            actions.append(match.group(1) if match else line[:40])
            continue
        if block in counts:
            counts[block] += 1
            if block == "parameters":
                parameters.add(line.split()[0] if not line.split()[0].endswith(":") else line.split()[1])
    rules = counts["reaction rules"]
    observables = counts["observables"]
    if rules < 1:
        fail("The BNGL file declares no reaction rules.")
    if observables < 1:
        fail("The BNGL file declares no observables, so a simulation would report nothing.")
    return {"format": "bngl", "rules": rules, "observables": observables,
            "moleculeTypes": counts["molecule types"], "seedSpecies": counts["seed species"] + counts["species"],
            "parameters": len(parameters), "parameterNames": parameters, "ignoredActions": actions[:50],
            "functions": counts["functions"], "compartments": counts["compartments"]}


def model_source(payload):
    source = payload.get("source")
    if source == "builtin":
        name = str(payload.get("builtinModel") or "")
        if name not in BUILTIN_MODELS:
            fail("The built-in model must be one of: %s." % ", ".join(sorted(BUILTIN_MODELS)))
        return {"format": "builtin", "name": name, "description": BUILTIN_MODELS[name]}, 0
    if source == "bngl":
        path, size = checked_file(payload.get("bngl"), "BNGL model", MAX_BNGL_BYTES, (".bngl",))
        return {**bngl_summary(path), "path": path}, size
    fail("The model must be a built-in PySB model or a BNGL file.")


def simulation_options(payload):
    raw = payload.get("simulation") or {}
    method = raw.get("method", "ode")
    if method not in ("ode", "ssa"):
        fail("The method must be ode (deterministic) or ssa (stochastic).")
    t_end = finite_number(raw.get("tEnd", 100), "End time", 0, MAX_TIME)
    if t_end <= 0:
        fail("End time must be positive.")
    points = integer(raw.get("points", 101), "Output points", 2, MAX_POINTS)
    spacing = raw.get("spacing", "linear")
    if spacing not in ("linear", "log"):
        fail("Time spacing must be linear or log.")
    t_first = None
    if spacing == "log":
        t_first = finite_number(raw.get("tFirst", t_end * 1e-6), "First output time", 0, t_end)
        if t_first <= 0 or t_first >= t_end:
            fail("The first output time of a log-spaced series must lie between zero and the end time.")
        if method == "ssa":
            fail("Stochastic runs report evenly spaced times; choose linear spacing.")
    overrides = []
    for index, item in enumerate(raw.get("parameters") or []):
        if not isinstance(item, dict) or not str(item.get("name") or "").strip():
            fail("Parameter change %d needs a name." % (index + 1))
        overrides.append({"name": str(item["name"]).strip(),
                          "value": finite_number(item.get("value"), "Parameter %s" % item["name"])})
    if len(overrides) > MAX_OVERRIDES or len({item["name"] for item in overrides}) != len(overrides):
        fail("Each parameter may be changed once, and at most %d parameters." % MAX_OVERRIDES)
    options = {"method": method, "tEnd": t_end, "points": points, "spacing": spacing, "tFirst": t_first,
               "parameters": overrides}
    if method == "ode":
        options.update({"integrator": "lsoda",
                        "rtol": finite_number(raw.get("rtol", 1e-8), "Relative tolerance", 1e-14, 1e-3),
                        "atol": finite_number(raw.get("atol", 1e-12), "Absolute tolerance", 1e-30, 1e-3)})
    else:
        runs = integer(raw.get("runs", 100), "Stochastic runs", 1, MAX_RUNS)
        seed = integer(raw.get("seed", 1), "Seed", 1, MAX_SEED - runs + 1)
        options.update({"runs": runs, "seed": seed})
    return options


def checked_input(payload):
    """The model source and options, checked with the standard library before PySB or BioNetGen runs."""
    source, size = model_source(payload)
    options = simulation_options(payload)
    if source["format"] == "bngl":
        unknown = [item["name"] for item in options["parameters"] if item["name"] not in source["parameterNames"]]
        if unknown:
            fail("These parameters are not in the BNGL file: %s." % ", ".join(unknown[:10]))
    return source, size, options


def inspect_network(payload, scratch):
    """The model with its generated network, and the workload a run of it represents.

    Species and reactions set what integration costs, and only network generation knows them.
    """
    source, size, options = checked_input(payload)
    found_versions = versions()
    prepare_bionetgen()
    # PySB and BioNetGen write their working files through tempfile; keep every one in this run's scratch.
    tempfile.tempdir = str(scratch)
    bionetgen_log = BioNetGenLog()
    with bounded_bionetgen():
        model = load_model(source)
        apply_parameters(model, options["parameters"])
        network, rounds = generate(model, bionetgen_log, scratch)
    steps = options["points"] * options.get("runs", 1)
    public = {key: value for key, value in source.items() if key not in ("path", "parameterNames")}
    metrics = {
        "schemaVersion": 1,
        "kind": "liatir.biochemical-simulation-preflight",
        "action": "simulate-network",
        "workloadId": "pysb:%s" % options["method"],
        "tokenCount": len(model.reactions),
        "atomCount": len(model.species),
        "stepCount": steps,
        "outputItemCount": steps * len(model.observables),
        "model": public,
        "network": {"species": len(model.species), "reactions": len(model.reactions),
                    "observables": len(model.observables), "iterations": rounds,
                    "sha256": sha256_bytes(network.encode("utf-8"))},
        "options": options,
        "inputBytes": size,
        "networkAccess": False,
    }
    return metrics, source, model, network, found_versions


# ── PySB and BioNetGen ──────────────────────────────────────────────────────

def payload_root():
    """The box's root: the interpreter is venv/bin/python inside it."""
    return pathlib.Path(sys.executable).resolve().parents[2]


def prepare_bionetgen():
    bng = payload_root() / BIONETGEN_DIR
    if not (bng / "BNG2.pl").is_file() or not (bng / "bin" / "run_network").is_file():
        fail("BioNetGen is missing from the Runtime Box; reinstall it.")
    os.environ["BNGPATH"] = str(bng)
    # BNG2.pl runs on the box's own Perl, never on one the host happens to have.
    os.environ["PATH"] = os.pathsep.join([str(pathlib.Path(sys.executable).parent), os.environ.get("PATH", "")])
    return bng


def versions():
    import importlib.metadata
    found = {"pysb": importlib.metadata.version("pysb"),
             "bionetgen": (payload_root() / BIONETGEN_DIR / "VERSION").read_text(encoding="utf-8").strip()}
    if found["pysb"] != PYSB_VERSION:
        fail("Installed PySB %s is not the reviewed %s." % (found["pysb"], PYSB_VERSION))
    if BIONETGEN_VERSION not in found["bionetgen"]:
        fail("Installed BioNetGen %s is not the reviewed %s." % (found["bionetgen"], BIONETGEN_VERSION))
    return found


def load_model(source):
    if source["format"] == "builtin":
        return importlib.import_module("pysb.examples.%s" % source["name"]).model
    from pysb.importers.bngl import BnglImportError, model_from_bngl
    try:
        # PySB reads the file through BioNetGen with skip_actions: the model is imported, nothing in it runs.
        return model_from_bngl(str(source["path"]), cleanup=True)
    except BnglImportError as error:
        fail("PySB cannot import this BNGL model: %s" % error)
    except Exception as error:  # BioNetGen reports syntax errors as a failed subprocess.
        fail("BioNetGen could not read this BNGL model: %s" % str(error)[-1500:])


def apply_parameters(model, overrides):
    for item in overrides:
        parameter = model.parameters.get(item["name"])
        if parameter is None:
            fail("The model has no parameter named %s." % item["name"])
        parameter.value = item["value"]


ITERATION = re.compile(r"Iteration\s+(\d+):\s+(\d+)\s+species\s+(\d+)\s+rxns")


class BioNetGenLog:
    """BioNetGen's own report of network generation, which PySB passes only to its debug log."""

    def __init__(self):
        import logging
        from pysb.logging import BASE_LOGGER_NAME, setup_logger
        setup_logger(logging.DEBUG, console_output=False)
        self.lines = []
        handler = logging.Handler(logging.DEBUG)
        handler.emit = lambda record: self.lines.append(record.getMessage())
        logging.getLogger(BASE_LOGGER_NAME).addHandler(handler)

    def rounds(self):
        """(round, species, reactions) for every round of rule application BioNetGen completed."""
        return [tuple(int(value) for value in match.groups()) for match in map(ITERATION.search, self.lines) if match]


@contextmanager
def bounded_bionetgen():
    """Memory and CPU-time limits that the BioNetGen processes started meanwhile inherit.

    This process holds them too, briefly: it only waits on BioNetGen. A process past its CPU limit is
    killed by the kernel and one past its memory limit fails to allocate; neither writes a core file.
    """
    kinds = (resource.RLIMIT_AS, resource.RLIMIT_CPU, resource.RLIMIT_CORE)
    saved = {kind: resource.getrlimit(kind) for kind in kinds}
    usage = resource.getrusage(resource.RUSAGE_SELF)
    wanted = {resource.RLIMIT_AS: BIONETGEN_MEMORY_BYTES,
              resource.RLIMIT_CPU: int(usage.ru_utime + usage.ru_stime) + BIONETGEN_CPU_SECONDS,
              resource.RLIMIT_CORE: 0}
    for kind, value in wanted.items():
        hard = saved[kind][1]
        resource.setrlimit(kind, (value if hard == resource.RLIM_INFINITY else min(value, hard), hard))
    try:
        yield
    finally:
        for kind, limits in saved.items():
            resource.setrlimit(kind, limits)


def generate(model, bionetgen_log, scratch):
    """The complete reaction network, loaded into the model and kept in scratch for BioNetGen's SSA.

    BioNetGen stops after max_iter rounds of rule application without a word, and hands back the network
    as it stood. A network still gaining species in its last permitted round never closed.
    """
    from pysb.bng import BngFileInterface, BngInterfaceError, load_equations
    netfile = scratch / "network.net"
    bionetgen_log.lines.clear()
    try:
        with BngFileInterface(model, cleanup=True, output_dir=str(scratch)) as interface:
            interface.action("generate_network", overwrite=True, max_iter=MAX_NETWORK_ITERATIONS)
            interface.execute()
            shutil.copyfile(interface.net_filename, netfile)
    except BngInterfaceError as error:
        children = resource.getrusage(resource.RUSAGE_CHILDREN)
        if children.ru_utime + children.ru_stime >= BIONETGEN_CPU_SECONDS:
            limit = "%d minutes of computing" % (BIONETGEN_CPU_SECONDS // 60)
        elif "Out of memory" in str(error):
            limit = "%d GB of memory" % (BIONETGEN_MEMORY_BYTES // 1024 ** 3)
        else:
            fail("BioNetGen could not generate the reaction network: %s" % str(error).strip()[-1500:])
        rounds = bionetgen_log.rounds()
        fail("BioNetGen reached its limit of %s before completing the reaction network (%s): the rules define a "
             "network too large to generate. A model that polymerizes or aggregates without bound needs "
             "network-free simulation, which this tool does not offer." % (
                 limit, "%d species after %d rounds" % (rounds[-1][1], rounds[-1][0]) if rounds else "no round done"))
    rounds = bionetgen_log.rounds()
    if not rounds:
        fail("BioNetGen did not report its network generation; the result cannot be checked.")
    if rounds[-1][0] >= MAX_NETWORK_ITERATIONS and len(rounds) > 1 and rounds[-1][1] > rounds[-2][1]:
        fail("BioNetGen applied the rules %d times and the network was still growing (%d species): it is unbounded "
             "or too large to generate, so it is not simulated." % (MAX_NETWORK_ITERATIONS, rounds[-1][1]))
    if rounds[-1][1] > MAX_SPECIES or rounds[-1][2] > MAX_REACTIONS:
        fail("The reaction network has %d species and %d reactions, beyond the %d species and %d reactions this "
             "tool simulates." % (rounds[-1][1], rounds[-1][2], MAX_SPECIES, MAX_REACTIONS))
    network = netfile.read_text(encoding="utf-8")
    load_equations(model, str(netfile))
    if not model.reactions:
        fail("The rules produce no reactions from the seed species, so there is nothing to simulate.")
    if not model.observables:
        fail("The model declares no observables, so a simulation would report nothing.")
    return network, rounds[-1][0]


def time_points(options):
    import numpy as np
    if options["spacing"] == "log":
        return np.concatenate([[0.0], np.logspace(math.log10(options["tFirst"]), math.log10(options["tEnd"]),
                                                  options["points"] - 1)])
    return np.linspace(0.0, options["tEnd"], options["points"])


def run_ode(model, options, tspan):
    import numpy as np
    from pysb.simulator import ScipyOdeSimulator
    # A Python right-hand side: PySB's default would compile C with Cython on the user's computer.
    simulator = ScipyOdeSimulator(model, tspan=tspan, compiler="python", integrator="lsoda",
                                  integrator_options={"rtol": options["rtol"], "atol": options["atol"]})
    result = simulator.run()
    table = {obs.name: np.asarray(result.observables[obs.name], dtype=float) for obs in model.observables}
    if not all(np.isfinite(values).all() for values in table.values()):
        fail("The integrator failed to follow the solution (non-finite values); the system may be stiffer than "
             "the tolerances allow, or diverge.")
    return table


def run_ssa(model, options, tspan, scratch):
    import numpy as np
    from pysb.bng import BngFileInterface
    seeds = [options["seed"] + index for index in range(options["runs"])]
    # PySB's BngSimulator passes one seed to every replicate, which makes them identical; each replicate
    # here gets its own seed, in one BioNetGen session.
    with BngFileInterface(model, cleanup=True, output_dir=str(scratch)) as interface:
        for index, seed in enumerate(seeds):
            interface.action("simulate", method="ssa", t_start=0, t_end=options["tEnd"], n_steps=options["points"] - 1,
                             seed=seed, prefix="run%d" % index, print_functions=True)
            interface.action("resetConcentrations")
        # BioNetGen reads the network generated and checked before instead of generating it again.
        interface.execute(reload_netfile=str(scratch / "network.net"))
        records = BngFileInterface.read_simulation_results_multi(
            [os.path.join(interface.base_directory, "run%d" % index) for index in range(len(seeds))])
    runs = []
    for record in records:
        if len(record["time"]) != len(tspan) or not np.allclose(record["time"], tspan, rtol=1e-9, atol=1e-12):
            fail("BioNetGen reported different output times than requested.")
        runs.append({obs.name: np.asarray(record[obs.name], dtype=float) for obs in model.observables})
    return runs, seeds


def line_plot(traces, title, x_title, y_title, log_x=False):
    return {"data": [{"type": "scatter", "mode": "lines", "name": name, "x": x, "y": y} for name, x, y in traces],
            "layout": {"title": title, "xaxis": {"title": x_title, **({"type": "log"} if log_x else {})},
                       "yaxis": {"title": y_title}}}


def simulate(payload, output_dir, inspected, scratch, started):
    import numpy as np
    metrics, source, model, network, found_versions = inspected
    options = metrics["options"]
    network_path = output_dir / "reaction-network.net"
    network_path.write_text(network, encoding="utf-8")
    tspan = time_points(options)
    names = [obs.name for obs in model.observables]
    paths = {"networkNet": str(network_path)}
    plot_traces = []
    final = {}
    seeds = None
    if options["method"] == "ode":
        table = run_ode(model, options, tspan)
        path = output_dir / "observables.csv"
        write_csv(path, ["Time"] + names, [["%.10g" % tspan[i]] + ["%.10g" % table[name][i] for name in names]
                                            for i in range(len(tspan))])
        paths["observablesCsv"] = str(path)
        final = {name: float(table[name][-1]) for name in names}
        plot_traces = [(name, [float(t) for t in tspan], [float(v) for v in table[name]]) for name in names[:20]]
    else:
        runs, seeds = run_ssa(model, options, tspan, scratch)
        stacked = {name: np.vstack([run[name] for run in runs]) for name in names}
        mean = {name: stacked[name].mean(axis=0) for name in names}
        spread = {name: stacked[name].std(axis=0, ddof=1) if len(runs) > 1 else np.zeros(len(tspan)) for name in names}
        path = output_dir / "observables-mean.csv"
        header = ["Time"] + [part for name in names for part in ("%s mean" % name, "%s SD" % name)]
        write_csv(path, header, [["%.10g" % tspan[i]] + [value for name in names for value in
                                                         ("%.10g" % mean[name][i], "%.10g" % spread[name][i])]
                                 for i in range(len(tspan))])
        paths["observablesCsv"] = str(path)
        runs_path = output_dir / "observables-runs.csv"
        write_csv(runs_path, ["Run", "Seed", "Time"] + names,
                  [[index + 1, seeds[index], "%.10g" % tspan[i]] + ["%.10g" % runs[index][name][i] for name in names]
                   for index in range(len(runs)) for i in range(len(tspan))])
        paths["runsCsv"] = str(runs_path)
        final = {name: {"mean": float(mean[name][-1]), "sd": float(spread[name][-1])} for name in names}
        plot_traces = [("%s (mean of %d runs)" % (name, len(runs)), [float(t) for t in tspan],
                        [float(v) for v in mean[name]]) for name in names[:20]]
    plot_path = output_dir / "simulation-plot.json"
    write_json_atomic(plot_path, line_plot(plot_traces, "Observables", "Time", "Amount",
                                           log_x=options["spacing"] == "log"))
    paths["plot"] = str(plot_path)
    public_source = {key: value for key, value in source.items() if key not in ("path", "parameterNames")}
    if source["format"] == "bngl":
        public_source["sha256"] = sha256_bytes(source["path"].read_bytes())
    summary = {
        "schemaVersion": 1,
        "kind": "liatir.biochemical-simulation-summary",
        "runtimeId": RUNTIME_ID,
        "runtimeBoxRelease": payload.get("runtimeBoxRelease"),
        "targetId": payload.get("targetId"),
        "versions": found_versions,
        "model": public_source,
        "network": metrics["network"],
        "options": options,
        "method": ("LSODA (SciPy) with a Python right-hand side, rtol %g, atol %g" % (options["rtol"], options["atol"])
                   if options["method"] == "ode" else
                   "Gillespie direct method (BioNetGen run_network), %d runs with seeds %d to %d"
                   % (options["runs"], seeds[0], seeds[-1])),
        "final": final,
        "scientificNotice": SCIENTIFIC_NOTICE,
        "elapsedSeconds": round(time.time() - started, 3),
        "networkAccess": False,
        "hardwareEstimate": payload.get("hardwareEstimate"),
    }
    summary_path = output_dir / "simulation-summary.json"
    write_json_atomic(summary_path, summary)
    paths["summaryJson"] = str(summary_path)
    return {"schemaVersion": 1, "kind": "liatir.biochemical-simulation-result", "action": "simulate-network",
            "paths": paths, "summary": summary}


def main():
    started = time.time()
    payload = json.load(sys.stdin)
    action = payload.get("action")
    if action not in ("preflight-network", "simulate-network"):
        fail("Unsupported biochemical simulation action.")
    output_dir = None
    if action == "simulate-network":
        require_measured_envelope(payload)
        output_dir = output_directory(payload)
    deny_network()
    with tempfile.TemporaryDirectory(prefix="liatir-biochemical-") as scratch:
        inspected = inspect_network(payload, pathlib.Path(scratch))
        if output_dir is None:
            print(json.dumps(inspected[0], separators=(",", ":")))
            return
        require_measured_envelope(payload, inspected[0])
        result = simulate(payload, output_dir, inspected, pathlib.Path(scratch), started)
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
`;
