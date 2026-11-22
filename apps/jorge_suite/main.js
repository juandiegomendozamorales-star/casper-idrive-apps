'use strict';
/**
 * PEREA PERFORMANCE - ESSENTIALS, FLEX FUEL and DENSITY ALTITUD in one app, one tab each, in FLEX FUEL's
 * look (the logo as the background, no boxes, big arcs, everything symmetric). Opens on ESSENTIALS.
 *
 *   ESSENTIALS    engine oil, coolant, gearbox oil, IAT in deg F: green ready, amber near the max, red
 *                 too hot (or cold, with the warm-up estimate) - as jorge_essentials
 *   ETANOL        ethanol % (MHD flex fuel sensor, read as perea_mhd_flex does) and gallons in the tank
 *   CALCULADORA   gallons of ethanol to add to reach the target (ethanol only)
 *   DENSITY       density altitude in metres (green under the limit, amber over) and how much air the
 *                 engine gets; outside temp, pressure, IAT, humidity under them
 *   TIEMPOS       a 1/4 mile run here, and the same run in sea-level air (SAE J1349, softened for the turbo)
 *   AJUSTES       one page, three groups: ESSENTIALS ranges, ETANOL, DENSITY
 *
 * Each group of sensors asks the car only while one of its own tabs shows.
 */
const mgu = require('./kit/mgu');
const { withAlpha } = require('./kit/canvas');
const G = require('./kit/gauges');
const Car = require('./kit/car');
const EssSensors = require('./ess_sensors').Sensors;
const DaSensors = require('./da_sensors').Sensors;
const FfSensors = require('./ff_sensors').Sensors;
const LOGO = require('./logo');

const W = 1600, H = 520;
const BG = '#030507', WHITE = '#ffffff', DIM = '#8fa0b8', FAINT = '#5d6a7e', TRACK = '#141c28';
const BLUE = '#4d9bff', BLUE0 = '#3a7bd5', BLUE1 = '#7fd4ff', ORANGE = '#ff6a2a', ORANGE0 = '#e04a10', ORANGE1 = '#ff8a3a';
const GREEN = '#2fd27a', AMBER = '#ffb020', RED = '#ff3b3b';
const L_PER_GAL = 3.78541, SCALE_M = 4000;
// the look: 'termo' (a slim upright bar per value, the number beside it, the logo faint) or 'arco' (FLEX FUEL's arcs)
const LOOK = 'arco';
const LOGO_ALPHA = LOOK === 'termo' ? 0.12 : 0.30;
const F = (c) => (G.isNum(c) ? c * 9 / 5 + 32 : null);

const TABS = ['ESSENTIALS', 'ETANOL', 'CALCULADORA', 'DENSITY', 'TIEMPOS', 'AJUSTES'];
const P_ESS = 0, P_ETH = 1, P_CALC = 2, P_DA = 3, P_TIME = 4, P_SET = 5;

/* ---------- ESSENTIALS ---------- */
const READY = 'READY TO FUCK', TIRED = 'ESTOY CANSADO JEFE', NEAR = 'CERCA DEL LIMITE';
const TYPICAL = { oil: { drive: 7, idle: 2.7 }, coolant: { drive: 12.6, idle: 5.4 }, gb: { drive: 5.4, idle: 1.4 } };
const VALUES = [
    { key: 'oil', label: 'ACEITE MOTOR', min: 'oilMin', max: 'oilMax', cold: true },
    { key: 'coolant', label: 'REFRIGERANTE', min: 'coolMin', max: 'coolMax', cold: true },
    { key: 'gb', label: 'ACEITE CAJA', min: 'gbMin', max: 'gbMax', cold: true },
    { key: 'iat', label: 'IAT', min: 'iatMin', max: 'iatMax', cold: false },
];

/* ---------- DENSITY: air from pressure (kPa), temperature (deg C), humidity (%) ---------- */
function air(kpa, tc, rh) {
    if (!G.isNum(kpa) || !G.isNum(tc)) return null;
    const p = kpa * 10, tk = tc + 273.15;
    const es = 6.1078 * Math.pow(10, 7.5 * tc / (tc + 237.3));
    const pv = es * G.clamp(rh, 0, 100) / 100, pd = p - pv;
    const rho = pd * 100 / (287.058 * tk) + pv * 100 / (461.495 * tk);
    const ratio = rho / 1.225;
    return { ratio, da: 44330.8 * (1 - Math.pow(ratio, 0.234969)), cf: 1.18 * (990 / pd) * Math.sqrt((tc + 273) / 298) - 0.18 };
}
const thousands = (n) => { const s = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); return n < 0 ? '-' + s : s; };

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const car = new Car(ctx, ['rpm', 'speed', 'temps']);
        let page = P_ESS, ctxTheme = null;
        const shown = (pages) => () => ui.isVisible('MAIN') && pages.indexOf(page) >= 0;
        const ess = new EssSensors(ctx, log, shown([P_ESS])).start();
        const da = new DaSensors(ctx, log, shown([P_DA, P_TIME])).start();
        const ff = new FfSensors(ctx, log).start();
        const num = (k) => Number(settings.get(k));

        /* ---------- the logo in the background ---------- */
        function watermark(cv, top, bottom) {
            const h = Math.min(370, bottom - top - 20), k = h / LOGO.h, w = LOGO.w * k;
            const L = G.layer('pp-logo|' + Math.round(h), Math.ceil(w), Math.ceil(h), (c) => {
                LOGO.shapes.forEach((s) => {
                    const pts = [];
                    for (let i = 0; i < s.p.length; i += 2) pts.push([s.p[i] * k, s.p[i + 1] * k]);
                    c.fill(pts, s.hole ? BG : withAlpha(s.c, LOGO_ALPHA));
                });
            }, cv.textScale);
            cv.blit(L, (W - w) / 2, (top + bottom - h) / 2);
        }

        /* ---------- shared drawing ---------- */
        function title(cv, cx, y, s, col, size) { cv.text(s, cx, y + 44, size || 26, col || DIM, { font: 'bold', align: 'center', spacing: 4 }); }
        function value(cv, cx, base, s, size, col, unit, usize) {
            const font = /^[0-9.,:%-]*$/.test(s) ? 'num' : 'bold';
            const nw = cv.textWidth(s, size, { font }), uw = unit ? cv.textWidth(unit, usize, { font: 'bold' }) + 8 : 0;
            const x = cx - (nw + uw) / 2;
            cv.text(s, x, base, size, col, { font });
            if (unit) cv.text(unit, x + nw + 8, base, usize, DIM, { font: 'bold' });
        }
        function pair(cv, cx, y, items, gap) {
            gap = gap || 230;
            const x0 = cx - gap / 2 * (items.length - 1);
            items.forEach((it, i) => {
                const x = x0 + i * gap;
                cv.text(it[0], x, y, 17, FAINT, { font: 'bold', align: 'center', spacing: 2 });
                value(cv, x, y + 50, it[1], 46, it[2], it[3], 18);
            });
        }
        /** A footer line: label in grey, figure in colour, centred on cx. */
        function foot(cv, cx, y, label, fig, col) {
            const lw = cv.textWidth(label + ' ', 22, { font: 'bold', spacing: 1 }), fw = cv.textWidth(fig, 22, { font: 'bold', spacing: 1 });
            const fx = cx - (lw + fw) / 2;
            cv.text(label + ' ', fx, y, 22, DIM, { font: 'bold', spacing: 1 });
            cv.text(fig, fx + lw, y, 22, col || BLUE, { font: 'bold', spacing: 1 });
        }
        /**
         * The big arc of FLEX FUEL: o = { cx, top, h, label, frac, big, bigCol, unit, unitCol, c0, c1, ends, foot: [label, fig, col], marks }
         */
        /**
         * The thermometer: a slim upright bar at the slot's left, filled from the bottom; beside it, at the bottom,
         * the label, the number (o.tUnit after it) and the footer. o.w is the slot's width (centred on o.cx).
         */
        function thermo(cv, o) {
            const w = o.w || 760, x0 = o.cx - w / 2 + (w > 500 ? 70 : 20), bw = w > 500 ? 26 : 22;
            const y0 = o.top + 40, y1 = o.top + o.h - 30, bh = y1 - y0;
            cv.roundRect(x0, y0, bw, bh, bw / 2, withAlpha(TRACK, 0.95));
            if (G.isNum(o.frac) && o.frac > 0.005) {
                const fh = Math.max(bw, bh * G.clamp(o.frac, 0, 1));
                cv.roundRect(x0, y1 - fh, bw, fh, bw / 2, o.c1);
            }
            (o.marks || []).forEach((f) => cv.fillRect(x0 - 8, y1 - bh * G.clamp(f, 0, 1) - 1.5, bw + 16, 3, withAlpha(WHITE, 0.75)));
            const tx = x0 + bw + (w > 500 ? 50 : 30), big = w > 500 ? 190 : 110;
            const nb = y1 - 48;
            cv.text(o.label, tx, nb - big * 0.78 - 22, w > 500 ? 26 : 20, DIM, { font: 'bold', spacing: 4 });
            const font = /^[0-9.,:%-]*$/.test(o.big) ? 'num' : 'bold', size = big * (o.bigScale || 1);
            const nw = cv.text(o.big, tx, nb, size, o.bigCol || WHITE, { font });
            const u = o.tUnit != null ? o.tUnit : o.bigUnit;
            if (u) cv.text(u, tx + nw + 8, nb, w > 500 ? 40 : 26, DIM, { font: 'bold' });
            if (o.foot) {
                const lw = o.foot[0] ? cv.text(o.foot[0] + ' ', tx, y1, 20, DIM, { font: 'bold', spacing: 1.5 }) : 0;
                cv.text(o.foot[1], tx + lw, y1, 20, o.foot[2] || BLUE, { font: 'bold', spacing: 1.5 });
            }
        }
        function gauge(cv, o) {
            if (LOOK === 'termo') return thermo(cv, o);
            const r1 = o.r || G.clamp((o.h - 170) / 1.5, 150, 215), r0 = r1 * 0.8, z = r1 / 150;
            const cx = o.cx, cy = o.top + 66 + r1;
            title(cv, cx, o.top, o.label);
            cv.arc(cx, cy, r0, r1, -120, 120, withAlpha(TRACK, 0.9));
            if (G.isNum(o.frac) && o.frac > 0.005) cv.arc(cx, cy, r0, r1, -120, -120 + 240 * G.clamp(o.frac, 0, 1), o.c0, { ramp: [o.c0, o.c1], rampFrom: -120, rampTo: 120 });
            (o.marks || []).forEach((f) => { const a = -120 + 240 * G.clamp(f, 0, 1); cv.arc(cx, cy, r0 - 6, r1 + 6, a - 0.8, a + 0.8, withAlpha(WHITE, 0.7)); });
            value(cv, cx, cy + 55 * z, o.big, 112 * z * (o.bigScale || 1), o.bigCol || WHITE, o.bigUnit, 34 * z);
            if (o.unit) cv.text(o.unit, cx, cy - 62 * z, 20 * Math.min(z, 1.3), o.unitCol || o.c1, { font: 'bold', align: 'center', spacing: 5 });
            if (o.ends) {
                const ex = r1 * 0.866 - 15, ey = cy + r1 * 0.5 + 34;
                cv.text(o.ends[0], cx - ex, ey, 19, FAINT, { font: 'bold', align: 'center' });
                cv.text(o.ends[1], cx + ex, ey, 19, FAINT, { font: 'bold', align: 'center' });
            }
            if (o.foot) foot(cv, cx, o.top + o.h - 26, o.foot[0], o.foot[1], o.foot[2]);
        }
        function nudge(key, by, lo, hi, dec) {
            settings.set(key, Number(G.clamp((num(key) || 0) + by, lo, hi).toFixed(dec)));
            return render();
        }
        function stepList(key, dir) {
            const it = settings.item(key), steps = (it && it.steps) || [];
            const cur = settings.get(key);
            let i = steps.indexOf(cur);
            if (i < 0) i = steps.findIndex((x) => x >= cur);
            const n = steps[G.clamp(i + dir, 0, steps.length - 1)];
            if (n !== undefined) settings.set(key, n);
            return render();
        }
        const halves = () => { const gap = 20, w = (W - 32 - gap) / 2; return { w, l: 16 + w / 2, r: 16 + w + gap + w / 2 }; };

        /* ================= ESSENTIALS ================= */
        function essValues(d) {
            if (d.demo) {
                const t = Date.now() / 1000;
                return { oil: F(d.oil), coolant: F(d.coolant), gb: F(G.isNum(d.oil) ? d.oil - 14 : null), iat: F(32 + 8 * Math.sin(t / 7)) };
            }
            return { oil: F(d.oil), coolant: F(d.coolant), gb: F(ess.gearbox()), iat: F(ess.iat()) };
        }
        const mono = () => { const h = process.hrtime(); return h[0] * 1000 + h[1] / 1e6; };
        const hist = { oil: [], coolant: [], gb: [] };
        let lastHist = 0;
        function track(v) {
            const m = mono();
            if (m - lastHist < 5000) return;
            lastHist = m;
            Object.keys(hist).forEach((k) => {
                if (G.isNum(v[k])) hist[k].push([m, v[k]]);
                while (hist[k].length > 240) hist[k].shift();
            });
        }
        car.onSample(() => {}, () => { Object.keys(hist).forEach((k) => { hist[k].length = 0; }); });
        function measured(key) {
            const h = hist[key], last = h.length ? h[h.length - 1][0] : 0;
            const pts = h.filter((p) => last - p[0] < 180000);
            if (pts.length < 4) return { rate: null, span: 0 };
            const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
            let nu = 0, de = 0;
            pts.forEach((p) => { nu += (p[0] - mx) * (p[1] - my); de += (p[0] - mx) * (p[0] - mx); });
            return { rate: de ? nu / de * 60000 : null, span: pts[n - 1][0] - pts[0][0] };
        }
        function eta(key, temp, target, d) {
            if (G.isNum(d.rpm) && d.rpm < 300) return { state: 'off' };
            const m = measured(key), typ = TYPICAL[key][G.isNum(d.speed) && d.speed > 10 ? 'drive' : 'idle'];
            const w = G.clamp(m.span / 120000, 0, 1), rate = G.isNum(m.rate) ? w * m.rate + (1 - w) * typ : typ;
            if (w > 0.8 && rate < 0.25) return { state: 'stalled' };
            return { state: 'warming', min: (target - temp) / Math.max(0.25, rate) };
        }
        function judge(def, v, d) {
            const lo = num(def.min), hi = Math.max(num(def.max), lo + 1), pct = Number(settings.get('warnPct')) || 10;
            const span = hi - lo, barLo = Math.min(lo - span * 0.6, 40), barHi = hi + span * 0.15;
            const at = (x) => G.clamp((x - barLo) / (barHi - barLo), 0, 1);
            const base = { marks: [at(lo), at(hi)] };
            if (!G.isNum(v)) return Object.assign(base, { col: DIM, text: 'SIN DATO', fill: 0 });
            const fill = at(v);
            if (v > hi) return Object.assign(base, { col: RED, text: TIRED, fill, alert: true });
            if (v >= hi - span * pct / 100) return Object.assign(base, { col: AMBER, text: NEAR, fill });
            if (v < lo && def.cold) {
                const e = eta(def.key, v, lo, d);
                const text = e.state === 'off' ? 'FRIO  MOTOR APAGADO' : e.state === 'stalled' ? 'FRIO  NO CALIENTA'
                    : 'FRIO  LISTO EN ' + (e.min > 60 ? '+60' : Math.max(1, Math.round(e.min))) + ' MIN';
                return Object.assign(base, { col: RED, text, fill });
            }
            return Object.assign(base, { col: GREEN, text: READY, fill });
        }
        function renderEss(cv, top, bottom, d) {
            const v = essValues(d), h = bottom - top, w = (W - 32) / 4, now = Date.now();
            track(v);
            VALUES.forEach((def, i) => {
                const j = judge(def, v[def.key], d), cx = 16 + w * i + w / 2;
                const s = G.isNum(v[def.key]) ? String(Math.round(G.smooth(def.key, v[def.key]))) : '--';
                const col = j.alert ? withAlpha(RED, 0.75 + 0.25 * Math.sin(now / 200)) : j.col;
                gauge(cv, { cx, top, h, w, r: 150, label: def.label, frac: j.fill, big: s, bigCol: col, unit: '°F', unitCol: DIM, tUnit: '°F',
                    c0: withAlpha(j.col, 0.55), c1: j.col, marks: j.marks, foot: LOOK === 'termo' ? ['', j.text, j.col] : null });
                if (LOOK === 'termo') return;
                let ts = 22;
                while (ts > 14 && cv.textWidth(j.text, ts, { font: 'bold', spacing: 1.5 }) > w - 20) ts -= 1;
                cv.text(j.text, cx, top + h - 26, ts, j.col, { font: 'bold', align: 'center', spacing: 1.5 });
            });
        }

        /* ================= ETANOL / CALCULADORA ================= */
        function tankNow(d) {
            if (d.demo) return { eth: 38, gal: 6.0 };
            const l = ff.litres(), gal = l !== null ? l / L_PER_GAL : null, e = ff.ethanol();
            if (G.isNum(e)) return { eth: e, gal };
            return { eth: num('ethManual'), gal, manual: true };
        }
        const gal = (g) => (G.isNum(g) ? g.toFixed(1) : '--');
        const eNum = (e) => (G.isNum(e) ? 'E' + Math.round(e) : '--');
        function renderEth(cv, top, bottom, n) {
            const hv = halves(), h = bottom - top, tank = num('tank') || 15.6;
            gauge(cv, { cx: hv.l - 40, top, h, w: hv.w, tUnit: n.manual ? 'MANUAL' : '', label: 'ETANOL', frac: G.isNum(n.eth) ? n.eth / 100 : null, big: eNum(n.eth),
                unit: n.manual ? 'MANUAL' : '', c0: BLUE0, c1: BLUE1 });
            gauge(cv, { cx: hv.r + 40, top, h, w: hv.w, tUnit: 'gal', label: 'GASOLINA', frac: G.isNum(n.gal) ? n.gal / tank : null, big: gal(n.gal),
                unit: 'GALONES', c0: ORANGE0, c1: ORANGE1 });
        }
        function mix(n) {
            const T = num('target'), P = num('purity'), tank = num('tank') || 15.6;
            if (!G.isNum(n.eth) || !G.isNum(n.gal)) return null;
            const C = n.eth, Gal = n.gal, space = Math.max(0, tank - Gal);
            if (T <= C) return { add: 0, end: C, total: Gal, space };
            const add = P > T ? Gal * (T - C) / (P - T) : Infinity;
            if (add <= space) return { add, end: T, total: Gal + add, space };
            return { add, end: (Gal * C + space * P) / tank, total: tank, space, over: true };
        }
        function renderCalc(cv, top, n) {
            const hv = halves(), P = num('purity'), T = num('target'), b = 70, by = top + 150;
            title(cv, hv.l, top, 'OBJETIVO');
            G.button(cv, ctxTheme, hv.l - 250, by - b / 2, b, b, '-', () => nudge('target', -1, 0, Math.max(1, P - 1), 0), { key: 'target-' });
            G.button(cv, ctxTheme, hv.l + 250 - b, by - b / 2, b, b, '+', () => nudge('target', 1, 0, Math.max(1, P - 1), 0), { key: 'target+' });
            value(cv, hv.l, by + 45, 'E' + Math.round(T), 120, WHITE);
            pair(cv, hv.l, top + 290, [['AHORA', eNum(n.eth), BLUE], ['EN EL TANQUE', gal(n.gal), WHITE, 'gal']]);
            const m = mix(n), over = m && m.over;
            title(cv, hv.r, top, over ? 'NO CABE' : 'AGREGAR ETANOL', over ? RED : ORANGE);
            value(cv, hv.r, by + 45, m ? (isFinite(m.add) ? m.add.toFixed(1) : '--') : '--', 120, over ? RED : BLUE, 'gal', 30);
            if (!m) { pair(cv, hv.r, top + 290, [['QUEDAS EN', '--', GREEN], ['TANQUE TOTAL', '--', WHITE, 'gal']]); return; }
            pair(cv, hv.r, top + 290, over
                ? [['LLENO QUEDAS EN', eNum(m.end), GREEN], ['ESPACIO', gal(m.space), WHITE, 'gal']]
                : [['QUEDAS EN', eNum(m.end), GREEN], ['TANQUE TOTAL', gal(m.total), WHITE, 'gal']]);
        }

        /* ================= DENSITY / TIEMPOS ================= */
        function readings(d) {
            if (d.demo) {
                const t = Date.now() / 1000, amb = 18 + 1.5 * Math.sin(t / 20);
                return { kpa: 75.0 + 0.1 * Math.sin(t / 30), amb, iat: amb + 20 + 3 * Math.sin(t / 7) };
            }
            return { kpa: da.baro(), amb: da.ambient(), iat: da.iat() };
        }
        function renderDa(cv, top, bottom, r) {
            const hv = halves(), h = bottom - top, limit = num('daLimit'), rh = num('humidity');
            const a = air(r.kpa, r.amb, rh), dam = a ? G.smooth('da', a.da) : null;
            const col = a ? (a.da < limit ? GREEN : AMBER) : DIM;
            gauge(cv, { cx: hv.l - 40, top, h, w: hv.w, tUnit: 'm', label: 'DENSITY ALTITUDE', frac: a ? dam / SCALE_M : null,
                big: a ? thousands(Math.round(dam / 10) * 10) : '--', bigCol: col, bigScale: 0.85, unit: 'METROS', unitCol: col,
                c0: withAlpha(col, 0.55), c1: col, marks: [limit / SCALE_M],
                foot: ['AMBIENTE', (G.isNum(r.amb) ? Math.round(F(r.amb)) + '°F' : '--') + '    PRESION ' + (G.isNum(r.kpa) ? (r.kpa * 0.2953).toFixed(2) + ' inHg' : '--'), WHITE] });
            const ratio = a ? a.ratio * 100 : null;
            gauge(cv, { cx: hv.r + 40, top, h, w: hv.w, label: 'AIRE PARA EL MOTOR', frac: G.isNum(ratio) ? ratio / 100 : null,
                big: G.isNum(ratio) ? String(Math.round(ratio)) : '--', bigUnit: G.isNum(ratio) ? '%' : '', unit: 'VS NIVEL MAR', c0: BLUE0, c1: BLUE1,
                foot: ['IAT', (G.isNum(r.iat) ? Math.round(F(r.iat)) + '°F' : '--') + '    HUMEDAD ' + rh + '%', WHITE] });
        }
        function renderTimes(cv, top, r) {
            const hv = halves(), et = num('et'), trap = num('trap'), b = 70, by = top + 150;
            const a = air(r.kpa, r.amb, num('humidity')), k = (num('turbo') || 0) / 100;
            title(cv, hv.l, top, 'TU PASADA AQUI');
            G.button(cv, ctxTheme, hv.l - 250, by - b / 2, b, b, '-', () => nudge('et', -0.01, 6, 25, 2), { key: 'et-' });
            G.button(cv, ctxTheme, hv.l + 250 - b, by - b / 2, b, b, '+', () => nudge('et', 0.01, 6, 25, 2), { key: 'et+' });
            value(cv, hv.l, by + 45, et.toFixed(2), 120, WHITE, 's', 30);
            const ty = top + 300, f = a ? Math.pow(Math.max(0.5, a.cf), k / 3) : null;
            cv.text('TRAP', hv.l, ty - 50, 17, FAINT, { font: 'bold', align: 'center', spacing: 2 });
            G.button(cv, ctxTheme, hv.l - 160, ty - 30, 60, 60, '-', () => nudge('trap', -1, 40, 250, 0), { key: 'trap-' });
            G.button(cv, ctxTheme, hv.l + 100, ty - 30, 60, 60, '+', () => nudge('trap', 1, 40, 250, 0), { key: 'trap+' });
            value(cv, hv.l, ty + 18, String(Math.round(trap)), 56, WHITE, 'mph', 18);
            // the right half mirrors the left: same places, the run in sea-level air
            title(cv, hv.r, top, 'A NIVEL DEL MAR', GREEN);
            value(cv, hv.r, by + 45, f ? (et / f).toFixed(2) : '--', 120, GREEN, f ? 's' : '', 30);
            cv.text('TRAP', hv.r, ty - 50, 17, FAINT, { font: 'bold', align: 'center', spacing: 2 });
            value(cv, hv.r, ty + 18, f ? String(Math.round(trap * f)) : '--', 56, GREEN, f ? 'mph' : '', 18);
        }

        /* ================= AJUSTES: three groups ================= */
        const GROUPS = ['ESSENTIALS', 'ETANOL', 'DENSITY'];
        let group = 0;
        const ITEMS = [
            VALUES.map((v) => ({ label: v.label, keys: [v.min, v.max], unit: '°F', list: true })),
            [
                { label: 'PUREZA DEL ETANOL', key: 'purity', unit: '%', by: 1, lo: 50, hi: 100, dec: 0, fmt: (x) => String(Math.round(x)) },
                { label: 'TAMANO DEL TANQUE', key: 'tank', unit: 'gal', by: 0.1, lo: 8, hi: 30, dec: 1, fmt: (x) => Number(x).toFixed(1) },
                { label: 'ETANOL MANUAL', key: 'ethManual', unit: '', by: 1, lo: 0, hi: 100, dec: 0, fmt: (x) => 'E' + Math.round(x), why: true },
            ],
            [
                { label: 'HUMEDAD', key: 'humidity', unit: '%', list: true, fmt: (x) => String(x) },
                { label: 'EFECTO TURBO', key: 'turbo', unit: '%', list: true, fmt: (x) => String(x) },
                { label: 'DA VERDE HASTA', key: 'daLimit', unit: 'm', by: 50, lo: 0, hi: 5000, dec: 0, fmt: (x) => thousands(x) },
            ],
        ];
        function renderSet(cv, top, bottom) {
            const h = bottom - top;
            // the group switch: three words across the top, the chosen one white and underlined
            const gw = 260, gx0 = W / 2 - gw * 1.5;
            GROUPS.forEach((g, i) => {
                const cx = gx0 + gw * i + gw / 2, on = i === group;
                G.button(cv, ctxTheme, cx - gw / 2 + 10, top + 4, gw - 20, 50, g, () => { group = i; return render(); }, { key: 'grp' + i, primary: on });
            });
            const items = ITEMS[group], n = items.length, w = (W - 32) / n, y0 = top + 70;
            items.forEach((s, i) => {
                const cx = 16 + w * i + w / 2, b = 70;
                cv.text(s.label, cx, y0 + 30, 22, WHITE, { font: 'bold', align: 'center', spacing: 3 });
                if (s.keys) {               // a range: MIN and MAX, one under the other
                    s.keys.forEach((key, k) => {
                        const y = y0 + 80 + k * 160;
                        cv.text(k ? 'MAX' : 'MIN', cx, y + 6, 16, FAINT, { font: 'bold', align: 'center', spacing: 2 });
                        value(cv, cx, y + 80, String(settings.get(key)), 72, WHITE, s.unit, 22);
                        G.button(cv, ctxTheme, cx - 170, y + 20, b, b, '-', () => stepList(key, -1), { key: key + '-' });
                        G.button(cv, ctxTheme, cx + 100, y + 20, b, b, '+', () => stepList(key, 1), { key: key + '+' });
                    });
                    return;
                }
                value(cv, cx, y0 + 200, s.fmt(settings.get(s.key)), 110, WHITE, s.unit, 30);
                if (s.why) cv.text(ff.ethWhy(), cx, y0 + 250, 16, FAINT, { font: 'bold', align: 'center' });
                const go = (dir) => (s.list ? stepList(s.key, dir) : nudge(s.key, dir * s.by, s.lo, s.hi, s.dec));
                G.button(cv, ctxTheme, cx - 110 - b / 2, top + h - b - 20, b, b, '-', () => go(-1), { key: s.key + '-' });
                G.button(cv, ctxTheme, cx + 110 - b / 2, top + h - b - 20, b, b, '+', () => go(1), { key: s.key + '+' });
            });
        }

        function render() {
            const t = ctxTheme = ctx.theme(), d = car.data();
            ff.tick(ui.isVisible('MAIN') && (page === P_ETH || page === P_CALC || (page === P_SET && group === 1)), !!d.demo);
            const cv = ctx.canvas(W, H).clear(BG);
            const top = G.TOP + 6, bottom = G.pageBottom(cv) - 4;
            watermark(cv, top + 20, bottom - 50);
            if (page === P_ESS) renderEss(cv, top, bottom, d);
            else if (page === P_ETH) renderEth(cv, top, bottom, tankNow(d));
            else if (page === P_CALC) renderCalc(cv, top, tankNow(d));
            else if (page === P_DA) renderDa(cv, top, bottom, readings(d));
            else if (page === P_TIME) renderTimes(cv, top, readings(d));
            else renderSet(cv, top, bottom);
            G.frame(cv, t, TABS, page, [d.demo && { text: 'DEMO' }]);
            return ui.image('MAIN_GFX', cv);
        }

        if (ui.onVisible) ui.onVisible((name, on) => { if (name === 'MAIN' && !on) ff.tick(false); });
        if (ctx.onTab) ctx.onTab((i) => { page = i; return render(); });
        ctx.loop('MAIN', 4, render);
        render().then(() => log.info('first frame done')).catch((e) => log.warn('first render: ' + e));
    },
});
