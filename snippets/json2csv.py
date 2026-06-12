#!/usr/bin/env python3
#: 把 JSON 数组拍平成 CSV：python3 json2csv.py data.json > out.csv
# tags: 数据, 转换

import csv
import json
import sys


def flatten(obj, prefix=""):
    out = {}
    for k, v in obj.items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            out.update(flatten(v, key))
        elif isinstance(v, list):
            out[key] = json.dumps(v, ensure_ascii=False)
        else:
            out[key] = v
    return out


rows = [flatten(r) for r in json.load(open(sys.argv[1], encoding="utf-8"))]
fields = sorted({k for r in rows for k in r})
w = csv.DictWriter(sys.stdout, fieldnames=fields)
w.writeheader()
w.writerows(rows)
