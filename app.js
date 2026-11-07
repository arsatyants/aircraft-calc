(function () {
  const A = window.AircraftCalc, d = A.defaults;
  const groups = [
    ['Общее', [['mass', 'Взлётный вес, кг', d.mass, ''], ['altitude', 'Высота над ур. моря, м', d.altitude, ''], ['catapultLen', 'Длина разгона катапульты, м', d.catapultLen]]],
    ['Мотор', [['motor.kv', 'Kv, об/мин/В', d.motor.kv], ['motor.rm', 'Сопротивление, Ом', d.motor.rm], ['motor.i0', 'Ток х.х., А', d.motor.i0], ['motor.iMax', 'Макс. ток, А', d.motor.iMax], ['motor.count', 'Кол-во моторов', d.motor.count]]],
    ['Винт', [['__apc', 'Винт APC (модель)', ''], ['prop.diam', 'Диаметр, дюйм', d.prop.diam], ['prop.pitch', 'Шаг, дюйм', d.prop.pitch], ['prop.Ct0', 'Ct0 (статич.)', d.prop.Ct0], ['prop.Cp0', 'Cp0 (статич.)', d.prop.Cp0]]],
    ['Батарея', [['batt.cells', 'Число банок S', d.batt.cells], ['batt.capMah', 'Ёмкость, мА·ч', d.batt.capMah], ['batt.vCell', 'Напр. банки, В', d.batt.vCell], ['batt.rCell', 'Внутр. R банки, мОм', d.batt.rCell], ['batt.usable', 'Доступная доля', d.batt.usable]]],
    ['Аэродинамика / крыло', [['vStall', 'Скорость сваливания, м/с', d.vStall], ['CLmax', 'CLmax', d.CLmax], ['AR', 'Удлинение', d.AR], ['taper', 'Сужение (tip/root)', d.taper], ['sweepLE', 'Стреловидность по передней кромке, °', d.sweepLE], ['Cd0', 'Cd0 (весь самолёт)', d.Cd0], ['e', 'Коэфф. Освальда', d.e]]],
    ['Прочее', [['esc', 'КПД регулятора', d.esc], ['avionicsW', 'Бортовая нагрузка, Вт', d.avionicsW]]],
  ];
  const form = document.getElementById('form');
  form.innerHTML = groups.map(([t, fs]) => `<fieldset><legend>${t}</legend>` +
    fs.map(([k, l, v]) => k === '__apc' ? `<label>${l}<input id="apc" list="apclist" placeholder="напр. 10x7E" autocomplete="off"></label><datalist id="apclist"></datalist><div id="apcnote" class="note">Таблицы APC загружаются…</div>` : `<label>${l}<input type="number" step="any" name="${k}" value="${v}"></label>`).join('') + '</fieldset>').join('');

  let apcDB = null;
  const apcIn = document.getElementById('apc'), note = document.getElementById('apcnote');
  fetch('apc.json').then(r => r.json()).then(db => {
    apcDB = db;
    document.getElementById('apclist').innerHTML = Object.keys(db).map(n => `<option value="${n}">`).join('');
    note.textContent = `Доступно ${Object.keys(db).length} винтов APC. Не выбран — используется упрощённая модель по Ct0/Cp0.`;
  }).catch(() => { note.textContent = 'Таблицы APC недоступны (откройте через http/Pages) — упрощённая модель Ct0/Cp0.'; });
  function applyApc() {
    const e = apcDB && apcDB[apcIn.value.trim()];
    form.elements['prop.Ct0'].disabled = form.elements['prop.Cp0'].disabled = !!e;
    if (e) { form.elements['prop.diam'].value = e[0]; form.elements['prop.pitch'].value = e[1]; }
    return e;
  }

  function read() {
    const c = JSON.parse(JSON.stringify(d));
    for (const el of form.elements) {
      const v = parseFloat(el.value); if (!isFinite(v)) continue;
      const p = el.name.split('.'); if (p.length === 2) c[p[0]][p[1]] = v; else c[p[0]] = v;
    }
    const e = applyApc();
    if (e) { c.prop.table = { rpm: e[2], tabs: e[3] }; c.prop.apc = apcIn.value.trim(); }
    return c;
  }
  const f = (x, n = 1) => isFinite(x) ? x.toFixed(n) : '—';
  const kmh = v => v * 3.6;

  function card(v, l) { return `<div class="card"><b>${v}</b><span>${l}</span></div>`; }

  function render() {
    const c = A.build(read());
    let r; try { r = A.compute(c); } catch (e) { document.getElementById('warn').innerHTML = `<div>Ошибка: ${e.message}</div>`; return; }
    const w = r.wing, cr = r.cruise;
    document.getElementById('warn').innerHTML = r.warnings.map(x => `<div>⚠ ${x}</div>`).join('');
    document.getElementById('cards').innerHTML = [
      card(f(w.b * 100, 0) + ' см', 'Размах крыла'),
      card(f(w.mac * 100, 1) + ' см', 'САХ (MAC)'),
      card(f(w.S * 100, 1) + ' дм²', 'Площадь крыла'),
      card(f(w.cr * 100, 1) + ' / ' + f(w.ct * 100, 1) + ' см', 'Хорда корень / конец'),
      card(f(w.yMac * 100, 1) + ' см', 'Положение САХ от оси'),
      card(f(w.wingLoading * 10, 1) + ' г/дм²', 'Нагрузка на крыло'),
      card(cr ? `${f(cr.V, 1)} м/с (${f(kmh(cr.V), 0)} км/ч)` : '—', 'Крейсерская скорость'),
      card(`${f(r.Vlof, 1)} м/с (${f(kmh(r.Vlof), 0)} км/ч)`, 'Скорость отрыва = схода с катапульты'),
      card(`${f(r.Vs, 1)} м/с`, 'Скорость сваливания'),
      card(`${f(r.Vmax, 1)} м/с (${f(kmh(r.Vmax), 0)} км/ч)`, 'Макс. горизонтальная'),
      card(cr ? f(cr.range / 1000, 1) + ' км' : '—', 'Дальность'),
      card(cr ? f(cr.endurance / 60, 0) + ' мин' : '—', 'Продолжительность'),
      card(f(r.launch.accelG, 1) + ' g', `Перегрузка на катапульте (${f(r.launch.energy, 0)} Дж, ~${f(r.launch.force, 0)} Н)`),
      card(f(r.bestClimb, 1) + ' м/с', 'Макс. скороподъёмность'),
      card(f(r.stat.T / 9.80665 * 1000, 0) + ' г', 'Статическая тяга'),
      card(f(r.tw, 2), 'Тяговооружённость'),
      card(cr ? f(cr.Pbat, 0) + ' Вт / ' + f(cr.Ibat, 1) + ' А' : '—', 'Мощность в крейсере'),
      card(f(r.energyWh, 1) + ' Вт·ч', 'Доступная энергия'),
    ].join('');
    drawPlanform(w, c.sweepLE);
    const P = r.pts;
    plot('plot1', P, [['Tmax', 'Тяга макс.', '#1f6feb'], ['D', 'Сопротивление', '#d1242f']], 'Н', 'V, м/с');
    plot('plot2', P.filter(p => p.Pbat != null), [['Pbat', 'Мощность от батареи', '#2da44e']], 'Вт', 'V, м/с', cr && cr.V);
  }

  function drawPlanform(w, sweep) {
    const svg = document.getElementById('planform'), W = 600, H = 260;
    const t = Math.tan(sweep * Math.PI / 180), half = w.b / 2;
    const xs = [0, w.cr, half * t + w.ct, half * t]; // root LE, root TE, tip TE, tip LE
    const depth = Math.max(...xs) - Math.min(...xs, 0);
    const s = Math.min((W - 40) / w.b, (H - 50) / depth);
    const ox = W / 2, oy = 25;
    const P = (y, x) => [ox + y * s, oy + x * s];
    const pt = a => a.map(p => p.join(',')).join(' ');
    const poly = [P(-half, half * t), P(-half, half * t + w.ct), P(0, w.cr), P(half, half * t + w.ct), P(half, half * t), P(0, 0)];
    const ym = w.yMac, xm = ym * t;
    const [mx1, my1] = P(ym, xm), [mx2, my2] = P(ym, xm + w.mac);
    const [nx1, ny1] = P(-ym, xm), [nx2, ny2] = P(-ym, xm + w.mac);
    const [ax, ay] = P(ym, xm + 0.25 * w.mac);
    svg.innerHTML = `<polygon points="${pt(poly)}" fill="#1f6feb22" stroke="#1f6feb" stroke-width="2"/>
      <line x1="${mx1}" y1="${my1}" x2="${mx2}" y2="${my2}" stroke="#d1242f" stroke-width="3"/>
      <line x1="${nx1}" y1="${ny1}" x2="${nx2}" y2="${ny2}" stroke="#d1242f" stroke-width="3"/>
      <circle cx="${ax}" cy="${ay}" r="3.5" fill="#d1242f"/>
      <text x="${mx2 + 6}" y="${(my1 + my2) / 2}">САХ ${(w.mac * 100).toFixed(1)} см (А.Ц. = 25%)</text>
      <text x="10" y="${H - 8}">Размах ${(w.b * 100).toFixed(0)} см</text>
      <line x1="${ox - half * s}" y1="${H - 20}" x2="${ox + half * s}" y2="${H - 20}" stroke="#889"/>`;
  }

  function plot(id, pts, series, yl, xl, mark) {
    const svg = document.getElementById(id), W = 600, H = 260, m = { l: 50, r: 15, t: 15, b: 35 };
    if (!pts.length) { svg.innerHTML = ''; return; }
    const xmin = pts[0].V, xmax = pts[pts.length - 1].V;
    let ymax = 0; series.forEach(([k]) => pts.forEach(p => { if (p[k] != null) ymax = Math.max(ymax, p[k]); }));
    ymax *= 1.1; if (!ymax) ymax = 1;
    const X = v => m.l + (v - xmin) / (xmax - xmin || 1) * (W - m.l - m.r), Y = v => H - m.b - v / ymax * (H - m.t - m.b);
    let out = '';
    for (let i = 0; i <= 5; i++) {
      const v = ymax * i / 5; out += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#8884" /><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(v < 10 ? 1 : 0)}</text>`;
      const xv = xmin + (xmax - xmin) * i / 5; out += `<text x="${X(xv)}" y="${H - m.b + 15}" text-anchor="middle">${xv.toFixed(0)}</text>`;
    }
    series.forEach(([k, name, col], j) => {
      const line = pts.filter(p => p[k] != null).map(p => X(p.V) + ',' + Y(p[k])).join(' ');
      out += `<polyline points="${line}" fill="none" stroke="${col}" stroke-width="2"/><text x="${m.l + 8 + j * 140}" y="${m.t + 8}" fill="${col}" style="fill:${col}">● ${name}</text>`;
    });
    if (mark) out += `<line x1="${X(mark)}" x2="${X(mark)}" y1="${m.t}" y2="${H - m.b}" stroke="#889" stroke-dasharray="4"/><text x="${X(mark) + 4}" y="${H - m.b - 6}">крейсер</text>`;
    out += `<text x="${W / 2}" y="${H - 3}" text-anchor="middle">${xl}</text><text x="12" y="${m.t + 8}">${yl}</text>`;
    svg.innerHTML = out;
  }

  form.addEventListener('input', render);
  render();
})();
