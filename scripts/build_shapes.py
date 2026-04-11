#!/usr/bin/env python3
"""
build_shapes.py
---------------
Converts two GTFS text files into compact JSON data files:

  shapes.txt  →  data/shapes.json        { shape_id: [[lon, lat], ...] }
  trips.txt   →  data/trip_to_shape.json { trip_id: shape_id }

Coordinates are rounded to 5 decimal places and each shape is sorted by
shape_pt_sequence, matching the output of scripts/build-gtfs-data.js.

Usage:
  python scripts/build_shapes.py <shapes.txt> <trips.txt> [--out-dir <dir>]

  <shapes.txt>  Path to GTFS shapes.txt
  <trips.txt>   Path to GTFS trips.txt
  --out-dir     Directory to write JSON files into (default: data/ next to this
                script's parent directory, i.e. the repo root data/ folder)

Example:
  python scripts/build_shapes.py /gtfs/shapes.txt /gtfs/trips.txt
  python scripts/build_shapes.py shapes.txt trips.txt --out-dir ./data
"""

import argparse
import csv
import json
import os
import sys
from collections import defaultdict


def round5(value: float) -> float:
    return round(value, 5)


def parse_shapes(path: str) -> dict:
    """
    Parse shapes.txt into { shape_id: [[lon, lat], ...] } sorted by sequence.
    """
    shape_pts = defaultdict(list)  # shape_id -> [(seq, lon, lat), ...]

    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        required = {"shape_id", "shape_pt_lat", "shape_pt_lon"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            sys.exit(f"shapes.txt mangler kolonner: {', '.join(sorted(missing))}")

        has_seq = "shape_pt_sequence" in (reader.fieldnames or [])
        for i, row in enumerate(reader):
            sid = row["shape_id"].strip()
            if not sid:
                continue
            try:
                lat = float(row["shape_pt_lat"])
                lon = float(row["shape_pt_lon"])
            except ValueError:
                continue
            seq = int(row["shape_pt_sequence"]) if has_seq else i
            shape_pts[sid].append((seq, lon, lat))

    shapes_out = {}
    for sid, pts in shape_pts.items():
        pts.sort(key=lambda p: p[0])
        shapes_out[sid] = [[round5(p[1]), round5(p[2])] for p in pts]

    return shapes_out


def parse_trip_to_shape(path: str) -> dict:
    """
    Parse trips.txt into { trip_id: shape_id } for all rows that have both fields.
    """
    trip_to_shape = {}

    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        fieldnames = reader.fieldnames or []
        if "trip_id" not in fieldnames or "shape_id" not in fieldnames:
            sys.exit("trips.txt mangler 'trip_id' og/eller 'shape_id' kolonner")

        for row in reader:
            tid = row["trip_id"].strip()
            sid = row["shape_id"].strip()
            if tid and sid:
                trip_to_shape[tid] = sid

    return trip_to_shape


def write_json(data: dict, filepath: str) -> None:
    os.makedirs(os.path.dirname(filepath) or ".", exist_ok=True)
    with open(filepath, "w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"), ensure_ascii=False)


def main() -> None:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    default_out = os.path.join(script_dir, "..", "data")

    parser = argparse.ArgumentParser(
        description="Konvertér shapes.txt + trips.txt til shapes.json og trip_to_shape.json"
    )
    parser.add_argument("shapes_txt", help="Sti til GTFS shapes.txt")
    parser.add_argument("trips_txt", help="Sti til GTFS trips.txt")
    parser.add_argument(
        "--out-dir",
        default=default_out,
        help=f"Output-mappe (standard: {os.path.normpath(default_out)})",
    )
    args = parser.parse_args()

    for f in (args.shapes_txt, args.trips_txt):
        if not os.path.isfile(f):
            sys.exit(f"Fil ikke fundet: {f}")

    print(f"Behandler {args.shapes_txt} ...")
    shapes = parse_shapes(args.shapes_txt)
    print(f"  → {len(shapes)} shapes indlæst")

    print(f"Behandler {args.trips_txt} ...")
    trip_to_shape = parse_trip_to_shape(args.trips_txt)
    print(f"  → {len(trip_to_shape)} trip→shape mappings indlæst")

    shapes_file = os.path.join(args.out_dir, "shapes.json")
    write_json(shapes, shapes_file)
    print(f"  → shapes skrevet til {os.path.normpath(shapes_file)}")

    t2s_file = os.path.join(args.out_dir, "trip_to_shape.json")
    write_json(trip_to_shape, t2s_file)
    print(f"  → trip_to_shape skrevet til {os.path.normpath(t2s_file)}")


if __name__ == "__main__":
    main()
