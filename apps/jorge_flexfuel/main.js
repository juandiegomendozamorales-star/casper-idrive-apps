'use strict';
/**
 * FLEX FUEL (Perea Performance) - what is in the tank, and how much ethanol to add.
 *
 *   TANQUE        ethanol % (MHD flex fuel sensor, through the engine unit) and fuel in the tank in gallons
 *   CALCULADORA   target E% with - and +: gallons of ethanol to add (ethanol only, never gasoline):
 *                   x = G * (T - C) / (P - T)
 *                 G gallons in the tank, C its ethanol %, T the target %, P the purity of the ethanol bought
 *   AJUSTES       purity of the ethanol, size of the tank
 *
 * The logo (logo.js, Jorge's own) is the background of every page, at 30 %.
 */
const mgu = require('./kit/mgu');
const { withAlpha } = require('./kit/canvas');
const G = require('./kit/gauges');
const Car = require('./kit/car');
const { Sensors } = require('./sensors');
const LOGO = require('./logo');

const W = 1600, H = 520;
const BG = '#030507', WHITE = '#ffffff', DIM = '#8fa0b8', FAINT = '#5d6a7e';
const BLUE = '#4d9bff', BLUE0 = '#3a7bd5', BLUE1 = '#7fd4ff', ORANGE = '#ff6a2a', ORANGE0 = '#e04a10', ORANGE1 = '#ff8a3a';
const GREEN = '#2fd27a', RED = '#ff3b3b';
const L_PER_GAL = 3.78541;
const LOGO_ALPHA = 0.30;

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const car = new Car(ctx, ['rpm', 'speed']);
        const sensors = new Sensors(ctx, log, () => ui.isVisible('MAIN')).start();

        /** Ethanol % and gallons in the tank (null when the car has not said). */
        function tankNow(d) {
            if (d.demo) return { eth: 38, gal: 6.0 };
            const l = sensors.litres(), pct = sensors.fuelPct(), tank = Number(settings.get('tank')) || 15.6;
            const gal = l !== null ? l / L_PER_GAL : G.isNum(pct) ? pct / 100 * tank : null;
            return { eth: sensors.ethanol(), gal };
        }

        /* ---------- the logo in the background: recorded once as a layer ---------- */
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
        function card(cv, x, y, w, h, edge) {
                        cv.strokeRoundRect(x, y, w, h, 16, 2, edge || withAlpha(WHITE, 0.08));
        }
        function title(cv, cx, y, s, col) { cv.text(s, cx, y + 44, 26, col || DIM, { font: 'bold', align: 'center', spacing: 4 }); }
        /** A number and its unit, centred on cx as one; the E of an E-number in the bold font. */
        function value(cv, cx, base, s, size, col, unit, usize) {
            const font = /^E/.test(s) ? 'bold' : 'num';
            const nw = cv.textWidth(s, size, { font }), uw = unit ? cv.textWidth(unit, usize, { font: 'bold' }) + 8 : 0;
            const x = cx - (nw + uw) / 2;
            cv.text(s, x, base, size, col, { font });
            if (unit) cv.text(unit, x + nw + 8, base, usize, DIM, { font: 'bold' });
        }
        /** Two small figures side by side under a big one: [label, text, colour, unit]. */
        function pair(cv, cx, y, items) {
            const gap = 230, x0 = cx - gap / 2 * (items.length - 1);
            items.forEach((it, i) => {
                const x = x0 + i * gap;
                cv.text(it[0], x, y, 17, FAINT, { font: 'bold', align: 'center', spacing: 2 });
                value(cv, x, y + 50, it[1], 46, it[2], it[3], 18);
            });
        }
        const gal = (g) => (G.isNum(g) ? g.toFixed(1) : '--');
        const eNum = (e) => (G.isNum(e) ? 'E' + Math.round(e) : '--');

        /* ---------- TANQUE ---------- */
        function gauge(cv, x, top, w, h, label, frac, big, unit, c0, c1, ends, foot) {
            const cx = x + w / 2, cy = top + 215, r1 = 150, r0 = 120;
            card(cv, x, top, w, h);
            title(cv, cx, top, label);
            cv.arc(cx, cy, r0, r1, -120, 120, withAlpha('#141c28', 0.9));
            if (G.isNum(frac) && frac > 0.005) cv.arc(cx, cy, r0, r1, -120, -120 + 240 * G.clamp(frac, 0, 1), c0, { ramp: [c0, c1], rampFrom: -120, rampTo: 120 });
            value(cv, cx, cy + 40, big, 112, WHITE);
            cv.text(unit, cx, cy + 88, 20, c1, { font: 'bold', align: 'center', spacing: 5 });
            const ex = r1 * 0.866 - 15, ey = cy + r1 * 0.5 + 32;
            cv.text(ends[0], cx - ex, ey, 17, FAINT, { font: 'bold', align: 'center' });
            cv.text(ends[1], cx + ex, ey, 17, FAINT, { font: 'bold', align: 'center' });
            // the line at the bottom: label in grey, figure in blue
            const lw = cv.textWidth(foot[0] + ' ', 22, { font: 'bold', spacing: 1 }), fw = cv.textWidth(foot[1], 22, { font: 'bold', spacing: 1 });
            const fx = cx - (lw + fw) / 2;
            cv.text(foot[0] + ' ', fx, top + h - 26, 22, DIM, { font: 'bold', spacing: 1 });
            cv.text(foot[1], fx + lw, top + h - 26, 22, BLUE, { font: 'bold', spacing: 1 });
        }
        function renderTank(cv, top, bottom, n) {
            const gap = 20, w = (W - 32 - gap) / 2, h = bottom - top, tank = Number(settings.get('tank')) || 15.6;
            const alcohol = G.isNum(n.eth) && G.isNum(n.gal) ? (n.gal * n.eth / 100).toFixed(1) + ' gal' : '--';
            gauge(cv, 16, top, w, h, 'ETANOL', G.isNum(n.eth) ? n.eth / 100 : null, eNum(n.eth), '% ETANOL', BLUE0, BLUE1,
                ['E0', 'E100'], ['MEZCLA ACTUAL', eNum(n.eth)]);
            gauge(cv, 16 + w + gap, top, w, h, 'GASOLINA', G.isNum(n.gal) ? n.gal / tank : null, gal(n.gal), 'GALONES', ORANGE0, ORANGE1,
                ['VACIO', 'LLENO'], ['ALCOHOL ADENTRO', alcohol]);
        }

        /* ---------- CALCULADORA ---------- */
        function nudge(key, by, lo, hi, dec) {
            const v = Number(settings.get(key)) || 0;
            settings.set(key, Number(G.clamp(v + by, lo, hi).toFixed(dec)));
            return render();
        }
        /** Gallons of ethanol to add to reach the target; null without the car's figures. */
        function mix(n) {
            const T = Number(settings.get('target')), P = Number(settings.get('purity')), tank = Number(settings.get('tank')) || 15.6;
            if (!G.isNum(n.eth) || !G.isNum(n.gal)) return null;
            const C = n.eth, Gal = n.gal, space = Math.max(0, tank - Gal);
            if (T <= C) return { add: 0, end: C, total: Gal, space };
            const add = P > T ? Gal * (T - C) / (P - T) : Infinity;
            if (add <= space) return { add, end: T, total: Gal + add, space };
            // does not fit: what a full tank of it would reach
            return { add, end: (Gal * C + space * P) / tank, total: tank, space, over: true };
        }
        function renderCalc(cv, top, bottom, n) {
            const gap = 20, w = (W - 32 - gap) / 2, h = bottom - top, P = Number(settings.get('purity'));
            const lx = 16, rx = 16 + w + gap, lc = lx + w / 2, rc = rx + w / 2;
            // left: the target
            card(cv, lx, top, w, h);
            title(cv, lc, top, 'OBJETIVO');
            const T = Number(settings.get('target')), b = 70, by = top + 150;
            G.button(cv, ctxTheme, lc - 250, by - b / 2, b, b, '-', () => nudge('target', -1, 0, Math.max(1, P - 1), 0), { key: 'target-' });
            G.button(cv, ctxTheme, lc + 250 - b, by - b / 2, b, b, '+', () => nudge('target', 1, 0, Math.max(1, P - 1), 0), { key: 'target+' });
            value(cv, lc, by + 45, 'E' + Math.round(T), 120, WHITE);
            pair(cv, lc, top + 290, [['AHORA', eNum(n.eth), BLUE], ['EN EL TANQUE', gal(n.gal), WHITE, 'gal']]);
            // right: what to add
            const m = mix(n);
            card(cv, rx, top, w, h, withAlpha(m && m.over ? RED : ORANGE0, 0.9));
            title(cv, rc, top, m && m.over ? 'NO CABE' : 'AGREGAR ETANOL', m && m.over ? RED : ORANGE);
            value(cv, rc, by + 45, m ? (isFinite(m.add) ? m.add.toFixed(1) : '--') : '--', 120, m && m.over ? RED : BLUE, 'gal', 30);
            if (!m) { pair(cv, rc, top + 290, [['QUEDAS EN', '--', GREEN], ['TANQUE TOTAL', '--', WHITE, 'gal']]); return; }
            pair(cv, rc, top + 290, m.over
                ? [['LLENO QUEDAS EN', eNum(m.end), GREEN], ['ESPACIO', gal(m.space), WHITE, 'gal']]
                : [['QUEDAS EN', eNum(m.end), GREEN], ['TANQUE TOTAL', gal(m.total), WHITE, 'gal']]);
        }

        /* ---------- AJUSTES ---------- */
        const SET = [
            { key: 'purity', label: 'PUREZA DEL ETANOL', unit: '%', by: 1, lo: 50, hi: 100, dec: 0, fmt: (v) => String(Math.round(v)) },
            { key: 'tank', label: 'TAMANO DEL TANQUE', unit: 'gal', by: 0.1, lo: 8, hi: 30, dec: 1, fmt: (v) => Number(v).toFixed(1) },
        ];
        function renderSet(cv, top, bottom) {
            const gap = 20, w = (W - 32 - gap) / 2, h = bottom - top;
            SET.forEach((s, i) => {
                const x = 16 + i * (w + gap), cx = x + w / 2, b = 80;
                card(cv, x, top, w, h);
                title(cv, cx, top, s.label, WHITE);
                value(cv, cx, top + 230, s.fmt(settings.get(s.key)), 120, WHITE, s.unit, 34);
                G.button(cv, ctxTheme, cx - 110 - b / 2, top + h - b - 30, b, b, '-', () => nudge(s.key, -s.by, s.lo, s.hi, s.dec), { key: s.key + '-' });
                G.button(cv, ctxTheme, cx + 110 - b / 2, top + h - b - 30, b, b, '+', () => nudge(s.key, s.by, s.lo, s.hi, s.dec), { key: s.key + '+' });
            });
        }

        const TABS = ['TANQUE', 'CALCULADORA', 'AJUSTES'];
        let page = 0, ctxTheme = null;
        function render() {
            const t = ctxTheme = ctx.theme(), d = car.data();
            const cv = ctx.canvas(W, H).clear(BG);
            const top = G.TOP + 6, bottom = G.pageBottom(cv) - 4;
            watermark(cv, top + 20, bottom - 50);
            const n = tankNow(d);
            if (page === 1) renderCalc(cv, top, bottom, n);
            else if (page === 2) renderSet(cv, top, bottom);
            else renderTank(cv, top, bottom, n);
            G.frame(cv, t, TABS, page, [d.demo && { text: 'DEMO' }]);
            return ui.image('MAIN_GFX', cv);
        }

        if (ctx.onTab) ctx.onTab((i) => { page = i; return render(); });
        ctx.loop('MAIN', 4, render);
        render().then(() => log.info('first frame done')).catch((e) => log.warn('first render: ' + e));
    },
});
