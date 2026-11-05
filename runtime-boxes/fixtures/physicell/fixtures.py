"""PhysiCell settings for the validator, derived from the template's own settings.

Reads one JSON payload on stdin: {"template": path, "workDir": path, "marker": path}. Writes one settings
file per case into workDir and prints their paths as JSON. Every case changes only what its reference
needs, so the rest of the template stays as PhysiCell ships it.
"""
import copy
import json
import pathlib
import sys
import xml.etree.ElementTree as ET

payload = json.load(sys.stdin)
TEMPLATE = ET.parse(payload["template"]).getroot()
WORK = pathlib.Path(payload["workDir"])
MARKER = payload["marker"]


def base(cells, half_width, voxel, max_time):
    root = copy.deepcopy(TEMPLATE)
    for axis in "xy":
        root.find("domain/%s_min" % axis).text = str(-half_width)
        root.find("domain/%s_max" % axis).text = str(half_width)
    for axis in "xyz":
        root.find("domain/d%s" % axis).text = str(voxel)
    root.find("overall/max_time").text = str(max_time)
    root.find("save/SVG/enable").text = "false"
    root.find("user_parameters/number_of_cells").text = str(cells)
    return root


def live_cycle(root, duration, fixed):
    """One phase, Live (code 5): a cell divides when it leaves it."""
    phenotype = root.find("cell_definitions/cell_definition/phenotype")
    old = phenotype.find("cycle")
    cycle = ET.Element("cycle", {"code": "5", "name": "live"})
    durations = ET.SubElement(cycle, "phase_durations", {"units": "min"})
    ET.SubElement(durations, "duration", {"index": "0", "fixed_duration": "true" if fixed else "false"}).text = str(duration)
    phenotype.insert(list(phenotype).index(old), cycle)
    phenotype.remove(old)


def death_rates(root, apoptosis, necrosis=0.0):
    for model in root.findall("cell_definitions/cell_definition/phenotype/death/model"):
        model.find("death_rate").text = str(apoptosis if model.get("code") == "100" else necrosis)


cases = {}

# Every cell divides exactly 600 min after its birth: 50 cells double on every multiple of 600 min.
doubling = base(50, 1000, 20, 2700)
live_cycle(doubling, 600, True)
death_rates(doubling, 0.0)
cases["doubling"] = doubling

# Division at 1/600 per minute, drawn every phenotype step (6 min): a Galton-Watson process.
exponential = base(1000, 1500, 30, 600)
live_cycle(exponential, 600, False)
death_rates(exponential, 0.0)
cases["exponential"] = exponential

# No division within the run; apoptosis at 1/600 per minute.
apoptosis = base(1000, 1500, 30, 600)
live_cycle(apoptosis, 1e9, True)
death_rates(apoptosis, 1.0 / 600.0)
cases["apoptosis"] = apoptosis

# A uniform substrate decaying at 0.001 per minute through BioFVM. One cell, which neither secretes
# nor takes it up: PhysiCell cannot start without a cell.
decay = base(1, 500, 20, 1000)
variable = decay.find("microenvironment_setup/variable")
variable.find("physical_parameter_set/diffusion_coefficient").text = "1000"
variable.find("physical_parameter_set/decay_rate").text = "0.001"
variable.find("initial_condition").text = "1"
cases["substrate-decay"] = decay

# Shell metacharacters where PhysiCell builds shell commands from the settings' paths.
hostile = base(5, 500, 20, 60)
hostile.find("save/folder").text = "output; touch %s" % MARKER
positions = hostile.find("initial_conditions/cell_positions")
positions.set("enabled", "true")
positions.find("folder").text = "./config; touch %s" % MARKER
positions.find("filename").text = "cells.csv; touch %s" % MARKER
cases["hostile-paths"] = hostile

# Inputs the tool refuses.
intracellular = base(5, 500, 20, 60)
ET.SubElement(intracellular.find("cell_definitions/cell_definition/phenotype"), "intracellular", {"type": "maboss"})
cases["intracellular"] = intracellular
matlab = base(5, 500, 20, 60)
matlab.find("microenvironment_setup/options/initial_condition").set("enabled", "true")
cases["matlab-initial-condition"] = matlab
cases["too-many-voxels"] = base(5, 20000, 10, 60)
cases["no-cells"] = base(0, 500, 20, 60)
rules = base(5, 500, 20, 60)
rules.find("cell_rules/rulesets/ruleset").set("enabled", "true")
cases["rules-without-csv"] = rules

written = {}
for name, root in cases.items():
    path = WORK / ("%s.xml" % name)
    ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)
    written[name] = str(path)
doctype = WORK / "doctype.xml"
doctype.write_text('<?xml version="1.0"?>\n<!DOCTYPE PhysiCell_settings [<!ENTITY x "x">]>\n'
                   + ET.tostring(TEMPLATE, encoding="unicode"), encoding="utf-8")
written["doctype"] = str(doctype)
cells = WORK / "hostile-cells.csv"
cells.write_text("x,y,z,type\n0,0,0,default\n50,50,0,default\n", encoding="utf-8")
written["hostile-cells"] = str(cells)
print(json.dumps(written))
