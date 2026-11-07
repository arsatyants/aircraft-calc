#!/usr/bin/env python3
"""APC PER3_*.dat -> compact apc.json. Usage: build_apc.py <dir with PER3 files> <out.json>"""
import sys, re, json, glob, os
NJ, NR = 14, 8
def interp(xs, ys, x):
    if x <= xs[0]: return ys[0]
    for i in range(1, len(xs)):
        if x <= xs[i]:
            t = (x - xs[i-1]) / ((xs[i] - xs[i-1]) or 1)
            return ys[i-1] + t * (ys[i] - ys[i-1])
    return ys[-1]
out = {}
for path in sorted(glob.glob(os.path.join(sys.argv[1], 'PER3_*.dat'))):
    lines = open(path, errors='ignore').read().splitlines()
    m = re.match(r'\s*([\d.]+)x([\d.]+)(\S*)', lines[0])
    if not m: continue
    name = lines[0].split('(')[0].strip()
    D, P = float(m.group(1)), float(m.group(2))
    blocks, cur = [], None
    for ln in lines:
        r = re.search(r'PROP RPM =\s*(\d+)', ln)
        if r: cur = {'rpm': int(r.group(1)), 'J': [], 'Ct': [], 'Cp': []}; blocks.append(cur); continue
        if cur is None: continue
        p = ln.split()
        if len(p) >= 5:
            try: j, ct, cp = float(p[1]), float(p[3]), float(p[4])
            except ValueError: continue
            if j == 0 and cur['J']: continue
            cur['J'].append(j); cur['Ct'].append(ct); cur['Cp'].append(cp)
    blocks = [b for b in blocks if len(b['J']) > 3]
    if not blocks: continue
    if len(blocks) > NR:
        idx = sorted({round(i * (len(blocks) - 1) / (NR - 1)) for i in range(NR)})
        blocks = [blocks[i] for i in idx]
    rpms, tabs = [], []
    for b in blocks:
        jm = b['J'][-1]
        grid = [jm * k / (NJ - 1) for k in range(NJ)]
        tabs.append([round(jm, 4), [round(interp(b['J'], b['Ct'], g), 4) for g in grid],
                     [round(interp(b['J'], b['Cp'], g), 4) for g in grid]])
        rpms.append(b['rpm'])
    out[name] = [D, P, rpms, tabs]
json.dump(out, open(sys.argv[2], 'w'), separators=(',', ':'))
print(len(out), 'props', os.path.getsize(sys.argv[2]) // 1024, 'KB')
