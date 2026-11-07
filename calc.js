/* Aircraft calculator: чистая физика без DOM. Работает в браузере (window.AircraftCalc) и в Node. */
(function (root) {
  'use strict';
  const G = 9.80665;
  const IN = 0.0254;

  function airDensity(h) { return 1.225 * Math.pow(1 - 2.25577e-5 * h, 4.2559); }

  // --- Модели ---------------------------------------------------------------
  // Коэффициенты винта. p.table (из APC PER3) -> табличная интерполяция по J и RPM,
  // иначе упрощённая аналитическая модель по Ct0/Cp0.
  function lerpTab(arr, jm, J) {
    const x = Math.min(Math.max(J / jm, 0), 1) * (arr.length - 1), i = Math.min(Math.floor(x), arr.length - 2);
    return arr[i] + (x - i) * (arr[i + 1] - arr[i]);
  }
  function propCoeffs(p, J, rpm) {
    if (p.table) {
      const R = p.table.rpm, T = p.table.tabs;
      let i = 0; while (i < R.length - 2 && rpm > R[i + 1]) i++;
      const t = Math.min(Math.max((rpm - R[i]) / (R[i + 1] - R[i]), 0), 1);
      const at = k => [lerpTab(T[k][1], T[k][0], J), lerpTab(T[k][2], T[k][0], J)];
      const a = at(i), b = at(i + 1);
      const Jz = T[i][0];
      return { Ct: a[0] + t * (b[0] - a[0]), Cp: Math.max(a[1] + t * (b[1] - a[1]), 0.002), J0: Jz };
    }
    const J0 = 0.85 * p.pitch / p.diam;           // J при нулевой тяге
    const x = Math.min(J / J0, 1.2);
    return { Ct: p.Ct0 * (1 - x * x), Cp: Math.max(p.Cp0 * (1 - 0.5 * x), 0.2 * p.Cp0), J0 };
  }

  // Режим работы одного мотора+винта при скорости V, газе thr
  function operating(c, V, thr) {
    const D = c.prop.diam * IN, rho = c.rho;
    const Kt = 60 / (2 * Math.PI * c.motor.kv);
    const Rb = c.batt.cells * c.batt.rCell / 1000;
    const Voc = c.batt.cells * c.batt.vCell;
    const N = c.motor.count;
    let Vb = Voc, res;
    for (let it = 0; it < 30; it++) {
      const Vm = thr * Vb;
      let lo = 0, hi = Math.max(Vm * c.motor.kv / 60, 1e-6);
      const g = n => {
        const I = (Vm - 60 * n / c.motor.kv) / c.motor.rm;
        const { Cp } = propCoeffs(c.prop, V / (Math.max(n, 1e-6) * D), 60 * n);
        return Kt * (I - c.motor.i0) - Cp * rho * n * n * Math.pow(D, 5) / (2 * Math.PI);
      };
      for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; (g(m) > 0 ? lo = m : hi = m); }
      const n = (lo + hi) / 2;
      const I = Math.max((Vm - 60 * n / c.motor.kv) / c.motor.rm, c.motor.i0);
      const { Ct, Cp, J0 } = propCoeffs(c.prop, V / (Math.max(n, 1e-6) * D), 60 * n);
      const T = Ct * rho * n * n * Math.pow(D, 4);
      const Pshaft = Cp * rho * Math.pow(n, 3) * Math.pow(D, 5);
      const Ibat = N * thr * I / c.esc + c.avionicsW / Vb;
      const VbNew = Voc - Ibat * Rb;
      res = { T: T * N, rpm: n * 60, I, Ibat, Vb, Pshaft: Pshaft * N, J: V / (n * D), J0,
              Pbat: Ibat * Voc, etaProp: T * V / Math.max(Pshaft, 1e-9) };
      if (Math.abs(VbNew - Vb) < 1e-4) break;
      Vb = 0.5 * Vb + 0.5 * VbNew;
    }
    return res;
  }

  function wingSizing(c) {
    const W = c.mass * G;
    const S = 2 * W / (c.rho * c.vStall * c.vStall * c.CLmax);
    const b = Math.sqrt(c.AR * S);
    const lam = c.taper;
    const cr = 2 * S / (b * (1 + lam));
    const ct = lam * cr;
    const mac = (2 / 3) * cr * (1 + lam + lam * lam) / (1 + lam);
    const yMac = (b / 6) * (1 + 2 * lam) / (1 + lam);
    const xMacLE = yMac * Math.tan(c.sweepLE * Math.PI / 180);
    return { S, b, cr, ct, mac, yMac, xMacLE, W, wingLoading: c.mass / S };
  }

  function drag(c, wing, V) {
    const q = 0.5 * c.rho * V * V;
    const CL = wing.W / (q * wing.S);
    const CD = c.Cd0 + CL * CL / (Math.PI * c.e * c.AR);
    return { D: q * wing.S * CD, CL, CD, LD: CL / CD };
  }

  // дроссель, при котором тяга = сопротивлению; null если не хватает
  function throttleFor(c, V, Dreq) {
    if (operating(c, V, 1).T < Dreq) return null;
    let lo = 0, hi = 1;
    for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; (operating(c, V, m).T < Dreq ? lo = m : hi = m); }
    return (lo + hi) / 2;
  }

  // Старт с катапульты: нужна скорость схода >= Vlof; считаем энергию и перегрузку на разгоне
  function launch(c, wing, Vlof) {
    const ke = 0.5 * c.mass * Vlof * Vlof;
    const a = Vlof * Vlof / (2 * c.catapultLen);
    const d = drag(c, wing, Vlof), op = operating(c, Vlof, 1);
    return { V: Vlof, energy: ke, accelG: a / G, force: c.mass * a, time: Vlof / a,
             excessThrust: op.T - d.D, climbAtLaunch: (op.T - d.D) * Vlof / wing.W };
  }

  function compute(c) {
    const wing = wingSizing(c);
    const Vs = c.vStall, Vlof = 1.2 * Vs;
    const stat = operating(c, 0, 1);
    // свип скоростей
    const pts = [];
    let Vmax = 0;
    for (let V = Math.max(Vs * 1.05, 3); V <= 80; V += 0.5) {
      const d = drag(c, wing, V);
      const op1 = operating(c, V, 1);
      const feasible = op1.T >= d.D;
      if (feasible) Vmax = V;
      const thr = feasible ? throttleFor(c, V, d.D) : null;
      const opc = thr != null ? operating(c, V, thr) : null;
      pts.push({ V, D: d.D, Tmax: op1.T, thr, Pbat: opc ? opc.Pbat : null, Ibat: opc ? opc.Ibat : null,
                 LD: d.LD, CL: d.CL, rpm: opc ? opc.rpm : null, eta: opc ? opc.etaProp : null });
      if (!feasible && V > Vs * 1.05 + 3 && V > Vmax + 3) break;
    }
    const ok = pts.filter(p => p.Pbat != null && p.V >= 1.3 * Vs); // крейсер не ниже 1.3·Vs
    let best = null;
    for (const p of ok) if (!best || p.V / p.Pbat > best.V / best.Pbat) best = p;
    const E = c.batt.cells * c.batt.vCell * c.batt.capMah / 1000 * c.batt.usable * 3600; // Дж
    const cruise = best && {
      V: best.V, Pbat: best.Pbat, Ibat: best.Ibat, thr: best.thr, rpm: best.rpm, LD: best.LD,
      endurance: E / best.Pbat, range: best.V * E / best.Pbat,
    };
    const to = launch(c, wing, Vlof);
    const bestClimb = pts.length ? Math.max(...pts.filter(p => p.Tmax >= p.D).map(p => (p.Tmax - p.D) * p.V / wing.W)) : 0;
    const warnings = [];
    if (stat.I > c.motor.iMax) warnings.push(`Статический ток ${stat.I.toFixed(1)} А на мотор превышает максимум ${c.motor.iMax} А`);
    if (stat.T / wing.W < 0.4) warnings.push(`Тяговооружённость ${(stat.T / wing.W).toFixed(2)} мала (<0.4)`);
    if (!cruise) warnings.push('Тяги не хватает для горизонтального полёта на этой площади крыла');
    if (to.excessThrust <= 0) warnings.push('На скорости схода с катапульты тяги не хватает для горизонтального полёта — самолёт будет терять высоту');
    if (to.accelG > 15) warnings.push(`Перегрузка на катапульте ${to.accelG.toFixed(0)} g — велика, увеличьте длину разгона`);
    return { wing, Vs, Vlof, Vmax, stat, cruise, launch: to, bestClimb, energyWh: E / 3600, pts,
             tw: stat.T / wing.W, warnings };
  }

  const defaults = {
    mass: 1.5, altitude: 0, catapultLen: 3,
    motor: { kv: 1000, rm: 0.09, i0: 0.6, iMax: 25, count: 1 },
    prop: { diam: 10, pitch: 6, Ct0: 0.11, Cp0: 0.05, apc: '' },
    batt: { cells: 3, capMah: 5000, vCell: 3.7, rCell: 10, usable: 0.8 },
    esc: 0.95, avionicsW: 5,
    AR: 7, taper: 0.6, sweepLE: 0, CLmax: 1.4, Cd0: 0.035, e: 0.8, vStall: 10,
  };

  function build(raw) { const c = JSON.parse(JSON.stringify(raw)); c.rho = airDensity(c.altitude); return c; }

  const api = { compute, build, defaults, airDensity };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AircraftCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
