'use strict';
/**
 * DENSITY ALTITUD - how thick the air is today, and what it costs the car.
 *
 *   AIRE      density altitude (DA) in metres, green below the limit (3,050 m), amber above it;
 *             how much of a sea-level breath the engine gets; outside temp, pressure, IAT, humidity
 *   TIEMPOS   a 1/4 mile time and trap speed (from the Dragy, set with - and +) and the same run
 *             corrected to sea-level air (SAE J1349), softened for the turbo
 *   CALIBRAR  humidity (the car has no humidity sensor), how much the air hits a turbo car, DA limit
 *
 * Air density from pressure, outside temperature and humidity (dry air + water vapour), DA from the
 * ISA atmosphere: DA = 44330.8 * (1 - (rho / 1.225) ^ 0.234969) m.
 * SAE J1349: CF = 1.18 * (990 / Pdry hPa) * sqrt((T + 273) / 298) - 0.18 (power at sea level / power here).
 * A turbo makes up part of the loss, so only turbo % of it is applied: ET x CF^(-k/3), trap x CF^(k/3).
 */
const mgu = require('./kit/mgu');
const { withAlpha } = require('./kit/canvas');
const G = require('./kit/gauges');
const Car = require('./kit/car');
const { Sensors } = require('./sensors');

const W = 1600, H = 520;
const GREEN = '#2fd27a', AMBER = '#ffb020', BLUE = '#4aa3ff', WHITE = '#ffffff';
const CARD = '#18202b', EDGE = '#2a3442';
const F = (c) => (G.isNum(c) ? c * 9 / 5 + 32 : null);
const SCALE_M = 4000;

/** Air from pressure (kPa), temperature (deg C), humidity (%): density ratio, DA (m), SAE factor. */
function air(kpa, tc, rh) {
    if (!G.isNum(kpa) || !G.isNum(tc)) return null;
    const p = kpa * 10, tk = tc + 273.15;
    const es = 6.1078 * Math.pow(10, 7.5 * tc / (tc + 237.3));
    const pv = es * G.clamp(rh, 0, 100) / 100, pd = p - pv;
    const rho = pd * 100 / (287.058 * tk) + pv * 100 / (461.495 * tk);
    const ratio = rho / 1.225;
    const da = 44330.8 * (1 - Math.pow(ratio, 0.234969));
    const cf = 1.18 * (990 / pd) * Math.sqrt((tc + 273) / 298) - 0.18;
    return { ratio, da, cf };
}

const thousands = (n) => {
    const s = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return n < 0 ? '-' + s : s;
};

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const car = new Car(ctx, ['rpm', 'speed']);
        const sensors = new Sensors(ctx, log, () => ui.isVisible('MAIN')).start();

        /** Pressure kPa, outside and IAT deg C; the demo is a morning in Bogota. */
        function readings(d) {
            if (d.demo) {
                const t = Date.now() / 1000, amb = 18 + 1.5 * Math.sin(t / 20);
                return { kpa: 75.0 + 0.1 * Math.sin(t / 30), amb, iat: amb + 20 + 3 * Math.sin(t / 7) };
            }
            return { kpa: sensors.baro(), amb: sensors.ambient(), iat: sensors.iat() };
        }

        /* ---------- shared drawing ---------- */
        function card(cv, x, y, w, h, edge) {
            cv.roundRect(x, y, w, h, 14, withAlpha(CARD, 0.9));
            cv.strokeRoundRect(x, y, w, h, 14, 2, edge || withAlpha(EDGE, 1));
        }
        function heading(cv, t, x, y, label, sub, col) {
            cv.text(label, x + 22, y + 38, 24, col || t.dim, { font: 'bold', spacing: 2.5 });
            if (sub) cv.text(sub, x + 22, y + 64, 17, withAlpha(t.dim, 0.8), { spacing: 1 });
        }
        /** A number as big as maxSize, shrunk to fit width; the unit after it. Returns the end x. */
        function bigNum(cv, t, x, base, s, maxSize, width, col, unit, unitSize) {
            const uw = unit ? cv.textWidth(unit, unitSize, { font: 'bold' }) + 12 : 0;
            const w100 = cv.textWidth(s, 100, { font: 'num' }) / 100;
            const size = Math.min(maxSize, (width - uw) / Math.max(0.01, w100));
            const nw = cv.text(s, x, base, size, col, { font: 'num' });
            if (unit) cv.text(unit, x + nw + 10, base, unitSize, t.dim, { font: 'bold' });
            return x + nw;
        }

        /* ---------- AIRE ---------- */
        function renderAir(cv, t, d, r) {
            const top = G.TOP + 6, bottom = G.pageBottom(cv) - 4, gap = 14;
            const rh = settings.get('humidity'), limit = settings.get('daLimit');
            const a = air(r.kpa, r.amb, rh);
            // the big card: DA
            const bw = 850, bh = bottom - top;
            const daCol = a ? (a.da < limit ? GREEN : AMBER) : t.dim;
            card(cv, 16, top, bw, bh);
            heading(cv, t, 16, top, 'DENSITY ALTITUDE · DA', 'la altura a la que "siente" el motor que esta');
            const da = a ? G.smooth('da', a.da) : null;
            bigNum(cv, t, 36, top + 245, a ? thousands(Math.round(da / 10) * 10) : '--', 190, bw - 60, daCol, 'm', 44);
            // the scale 0 .. 4,000 m, green up to the limit, amber after it
            const sx = 38, sw = bw - 44, sy = top + bh - 140, sh = 18;
            const lx = sx + sw * G.clamp(limit / SCALE_M, 0, 1);
            cv.roundRect(sx, sy, sw, sh, 9, withAlpha(AMBER, 0.85));
            cv.roundRect(sx, sy, lx - sx, sh, 9, withAlpha(GREEN, 0.85));
            if (lx - sx > 10) cv.fillRect(lx - 9, sy, 9, sh, withAlpha(GREEN, 0.85));
            if (a) {
                const mx = sx + sw * G.clamp(da / SCALE_M, 0, 1);
                cv.roundRect(mx - 4, sy - 12, 8, sh + 24, 4, WHITE);
            }
            [0, 1000, 2000, 3000, 4000].forEach((m, i) => {
                const label = i === 0 ? '0 m  MAR' : i === 4 ? '4,000 m' : thousands(m);
                const tx = sx + sw * m / SCALE_M;
                cv.text(label, tx, sy + sh + 28, 17, t.dim, { align: i === 0 ? 'left' : i === 4 ? 'right' : 'center' });
            });
            // the verdict
            let verdict = 'ESPERANDO DATOS DEL CARRO';
            if (a) verdict = (a.da < limit ? 'AIRE BUENO' : 'AIRE FLACO') + '  ·  EL MOTOR RESPIRA ' + Math.round(a.ratio * 100) + '%';
            let vs = 28;
            while (vs > 18 && cv.textWidth(verdict, vs, { font: 'bold', spacing: 2 }) > bw - 50) vs -= 1;
            cv.text(verdict, 38, top + bh - 34, vs, daCol, { font: 'bold', spacing: 2 });

            // the four small cards
            const cx = 16 + bw + gap, cw = (W - 16 - cx - gap) / 2, ch = (bh - gap) / 2;
            const small = (i, label, sub, s, unit, col) => {
                const x = cx + (i % 2) * (cw + gap), y = top + Math.floor(i / 2) * (ch + gap);
                card(cv, x, y, cw, ch);
                heading(cv, t, x, y, label, sub);
                bigNum(cv, t, x + 22, y + ch - 30, s, 110, cw - 44, col || WHITE, unit, 34);
            };
            const ambF = F(r.amb), iatF = F(r.iat);
            small(0, 'AMBIENTE', 'temperatura afuera', G.isNum(ambF) ? String(Math.round(ambF)) : '--', '°F');
            small(1, 'PRESION', 'barometrica · inHg', G.isNum(r.kpa) ? (r.kpa * 0.2953).toFixed(2) : '--', '');
            const rise = G.isNum(iatF) && G.isNum(ambF) ? iatF - ambF : null;
            small(2, 'IAT', G.isNum(rise) ? (rise >= 0 ? '+' : '') + Math.round(rise) + '°F sobre ambiente' : 'admision',
                G.isNum(iatF) ? String(Math.round(iatF)) : '--', '°F', G.isNum(rise) && rise > 20 ? AMBER : WHITE);
            small(3, 'HUMEDAD', 'la pones tu en CALIBRAR', String(rh), '%');
            return a;
        }

        /* ---------- TIEMPOS ---------- */
        function nudge(key, by, lo, hi, dec) {
            const v = Number(settings.get(key)) || 0;
            settings.set(key, Number(G.clamp(v + by, lo, hi).toFixed(dec)));
            return render();
        }
        function renderTimes(cv, t, d, r) {
            const top = G.TOP + 6, bottom = G.pageBottom(cv) - 4, bh = bottom - top;
            const et = Number(settings.get('et')), trap = Number(settings.get('trap'));
            const a = air(r.kpa, r.amb, settings.get('humidity'));
            const k = (Number(settings.get('turbo')) || 0) / 100;
            // left: your run here
            const lw = 720;
            card(cv, 16, top, lw, bh);
            heading(cv, t, 16, top, 'TU PASADA AQUI', 'pon el tiempo de tu Dragy con - y +');
            const row = (y, key, s, unit, small, big, lo, hi, dec, size) => {
                const b = 62;
                G.button(cv, t, 36, y - b / 2, b, b, '-', () => nudge(key, -small, lo, hi, dec), { key: key + '-' });
                G.button(cv, t, 36 + b + 10, y - b / 2, b + 30, b, '-' + big, () => nudge(key, -big, lo, hi, dec), { key: key + '--' });
                const x0 = 36 + 2 * b + 50;
                const nw = cv.text(s, x0, y + size * 0.36, size, WHITE, { font: 'num' });
                cv.text(unit, x0 + nw + 8, y + size * 0.36, 30, t.dim, { font: 'bold' });
                const bx = lw + 16 - 20 - 2 * b - 40;
                G.button(cv, t, bx, y - b / 2, b + 30, b, '+' + big, () => nudge(key, big, lo, hi, dec), { key: key + '++' });
                G.button(cv, t, bx + b + 40, y - b / 2, b, b, '+', () => nudge(key, small, lo, hi, dec), { key: key + '+' });
            };
            row(top + 175, 'et', et.toFixed(2), 's', 0.01, 0.1, 6, 25, 2, 110);
            cv.text('TRAP SPEED', 38, top + 290, 22, t.dim, { font: 'bold', spacing: 2.5 });
            row(top + 365, 'trap', String(Math.round(trap)), 'mph', 1, 5, 40, 250, 0, 90);

            // right: the same run at sea level
            const rx = 16 + lw + 70, rw = W - 16 - rx;
            cv.text('>', 16 + lw + 22, top + bh / 2 + 22, 64, BLUE, { font: 'bold' });
            card(cv, rx, top, rw, bh, withAlpha(GREEN, 0.9));
            heading(cv, t, rx, top, 'A NIVEL DEL MAR', 'lo que harias con aire perfecto (SAE)', GREEN);
            if (!a) {
                cv.text('ESPERANDO DATOS DEL CARRO', rx + 22, top + bh / 2, 30, t.dim, { font: 'bold', spacing: 2 });
                return;
            }
            const f = Math.pow(Math.max(0.5, a.cf), k / 3);
            const etC = et / f, trapC = trap * f;
            bigNum(cv, t, rx + 22, top + 220, etC.toFixed(2), 150, rw - 60, GREEN, 's', 40);
            bigNum(cv, t, rx + 22, top + 370, String(Math.round(trapC)), 110, rw - 60, GREEN, 'mph', 36);
            const lost = et - etC;
            const msg = 'EL AIRE TE ESTA ROBANDO ', lostS = lost.toFixed(2) + ' s';
            const mw = cv.text(msg, rx + 22, top + bh - 30, 24, t.dim, { font: 'bold', spacing: 2 });
            cv.text(lostS, rx + 22 + mw, top + bh - 30, 24, AMBER, { font: 'bold', spacing: 2 });
        }

        /* ---------- CALIBRAR ---------- */
        function step(key, dir) {
            const it = settings.item(key), steps = (it && it.steps) || [];
            const cur = settings.get(key);
            let i = steps.indexOf(cur);
            if (i < 0) i = steps.findIndex((x) => x >= cur);
            const n = steps[G.clamp(i + dir, 0, steps.length - 1)];
            if (n !== undefined) settings.set(key, n);
            return render();
        }
        const CAL = [
            { key: 'humidity', label: 'HUMEDAD', sub: 'el carro no la mide: mirala en el clima del celular', unit: '%', go: (dir) => step('humidity', dir) },
            { key: 'turbo', label: 'EFECTO DEL AIRE', sub: '100% = motor sin turbo.  tu turbo compensa: 40% sugerido', unit: '%', go: (dir) => step('turbo', dir) },
            { key: 'daLimit', label: 'DA VERDE HASTA', sub: 'por debajo: numero verde.  por encima: amarillo', unit: 'm', go: (dir) => nudge('daLimit', dir * 50, 0, 5000, 0) },
        ];
        function renderCal(cv, t) {
            const top = G.TOP + 6, bottom = G.pageBottom(cv) - 4, gap = 12;
            const rh = (bottom - top - 2 * gap) / 3;
            CAL.forEach((c, i) => {
                const y = top + i * (rh + gap), cy = y + rh / 2, b = 72;
                card(cv, 16, y, W - 32, rh);
                cv.text(c.label, 40, cy - 4, 32, WHITE, { font: 'bold', spacing: 2 });
                cv.text(c.sub, 40, cy + 32, 18, t.dim, { spacing: 1 });
                const bx = 1000;
                G.button(cv, t, bx, cy - b / 2, b, b, '-', () => c.go(-1), { key: c.key + '-' });
                const v = settings.get(c.key);
                const vs = c.key === 'daLimit' ? thousands(v) : String(v);
                const vw = cv.textWidth(vs, 64, { font: 'num' }) + 10 + cv.textWidth(c.unit, 30, { font: 'bold' });
                const vx = bx + b + 155 - vw / 2;
                const nw = cv.text(vs, vx, cy + 24, 64, WHITE, { font: 'num' });
                cv.text(c.unit, vx + nw + 10, cy + 24, 30, t.dim, { font: 'bold' });
                G.button(cv, t, bx + b + 310, cy - b / 2, b, b, '+', () => c.go(1), { key: c.key + '+' });
            });
        }

        /* ---------- iDrive 7 ---------- */
        // its own layout of the same three pages (id7.js); on iDrive 8 the ones above, as they are
        const v7 = !ui.id8 && require('./id7').create({
            settings, air, thousands, F, card, bigNum, nudge, CAL, SCALE_M, colors: { GREEN, AMBER, BLUE, WHITE },
        });
        function render7() {
            const t = ctx.theme(), d = car.data();
            const cv = ctx.canvas(W, H).clear('#05070a');
            const r = readings(d);
            if (page === 1) v7.times(cv, t, d, r);
            else if (page === 2) v7.cal(cv, t);
            else v7.air(cv, t, d, r);
            G.frame(cv, t, TABS, page, [d.demo && { text: 'DEMO' }]);
            return ui.image('MAIN_GFX', cv);
        }

        const TABS = ['AIRE', 'TIEMPOS', 'CALIBRAR'];
        let page = 0;
        function render() {
            if (v7) return render7();
            const t = ctx.theme(), d = car.data();
            const cv = ctx.canvas(W, H).clear('#05070a');
            const r = readings(d);
            if (page === 1) renderTimes(cv, t, d, r);
            else if (page === 2) renderCal(cv, t);
            else renderAir(cv, t, d, r);
            G.frame(cv, t, TABS, page, [d.demo && { text: 'DEMO' }]);
            return ui.image('MAIN_GFX', cv);
        }

        if (ctx.onTab) ctx.onTab((i) => { page = i; return render(); });
        ctx.loop('MAIN', 4, render);
        render().then(() => log.info('first frame done')).catch((e) => log.warn('first render: ' + e));
    },
});
