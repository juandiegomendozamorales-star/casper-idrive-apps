'use strict';
/**
 * ESSENTIALS - the four values that matter at the drag strip, as big as they fit:
 *
 *   ACEITE MOTOR   REFRIGERANTE   ACEITE CAJA   IAT
 *
 * Every value has its own range in deg F (the app's settings, "Rangos"):
 *   between min and max          green   READY TO FUCK
 *   the last warnPct % below max amber   CERCA DEL LIMITE
 *   above max                    red     ESTOY CANSADO JEFE
 *   below min (oils, coolant)    red     FRIO - LISTO EN N MIN (warm-up estimate)
 *   below min (IAT)              green   (cold intake air is good)
 *
 * Warm-up estimate: the rise per minute measured over the last 3 minutes (least squares), blended
 * from a typical rate over the first 2 minutes, to the value's min.
 * Engine oil and coolant come from the car's own signal; IAT and gearbox oil are read from the
 * engine and gearbox units, read only (sensors.js).
 */
const mgu = require('./kit/mgu');
const { withAlpha } = require('./kit/canvas');
const G = require('./kit/gauges');
const Car = require('./kit/car');
const { Sensors } = require('./sensors');

const W = 1600, H = 520;
const GREEN = '#2fd27a', AMBER = '#ffb020', RED = '#ff3b3b';
const READY = 'READY TO FUCK', TIRED = 'ESTOY CANSADO JEFE', NEAR = 'CERCA DEL LIMITE';
const F = (c) => (G.isNum(c) ? c * 9 / 5 + 32 : null);
// typical warm-up rates in deg F per minute, until enough has been measured
const TYPICAL = { oil: { drive: 7, idle: 2.7 }, coolant: { drive: 12.6, idle: 5.4 }, gb: { drive: 5.4, idle: 1.4 } };

const VALUES = [
    { key: 'oil', label: 'ACEITE MOTOR', min: 'oilMin', max: 'oilMax', cold: true },
    { key: 'coolant', label: 'REFRIGERANTE', min: 'coolMin', max: 'coolMax', cold: true },
    { key: 'gb', label: 'ACEITE CAJA', min: 'gbMin', max: 'gbMax', cold: true },
    { key: 'iat', label: 'IAT  ADMISION', min: 'iatMin', max: 'iatMax', cold: false },
];

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const car = new Car(ctx, ['rpm', 'speed', 'temps']);
        const sensors = new Sensors(ctx, log, () => ui.isVisible('MAIN')).start();

        /** The four values in deg F; in the demo, IAT and gearbox follow the demo's oil. */
        function values(d) {
            if (d.demo) {
                const t = Date.now() / 1000;
                return { oil: F(d.oil), coolant: F(d.coolant), gb: F(G.isNum(d.oil) ? d.oil - 14 : null), iat: F(32 + 8 * Math.sin(t / 7)) };
            }
            return { oil: F(d.oil), coolant: F(d.coolant), gb: F(sensors.gearbox()), iat: F(sensors.iat()) };
        }

        /* ---------- warm-up history: every 5 s, 20 min, on a steady clock ---------- */
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

        /** deg F per minute over the last ~3 min, and the time it covers (ms). */
        function measured(key) {
            const h = hist[key], last = h.length ? h[h.length - 1][0] : 0;
            const pts = h.filter((p) => last - p[0] < 180000);
            if (pts.length < 4) return { rate: null, span: 0 };
            const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
            let num = 0, den = 0;
            pts.forEach((p) => { num += (p[0] - mx) * (p[1] - my); den += (p[0] - mx) * (p[0] - mx); });
            return { rate: den ? num / den * 60000 : null, span: pts[n - 1][0] - pts[0][0] };
        }

        /** Minutes until key reaches target: { state: warming | off | stalled, min }. */
        function eta(key, temp, target, d) {
            if (G.isNum(d.rpm) && d.rpm < 300) return { state: 'off' };
            const m = measured(key);
            const typ = TYPICAL[key][G.isNum(d.speed) && d.speed > 10 ? 'drive' : 'idle'];
            const w = G.clamp(m.span / 120000, 0, 1);
            const rate = G.isNum(m.rate) ? w * m.rate + (1 - w) * typ : typ;
            if (w > 0.8 && rate < 0.25) return { state: 'stalled' };
            return { state: 'warming', min: (target - temp) / Math.max(0.25, rate) };
        }

        /** Colour, status line and bar fill for one value. */
        function judge(def, v, d) {
            const lo = settings.get(def.min), hi = Math.max(settings.get(def.max), lo + 1);
            const pct = Number(settings.get('warnPct')) || 10;
            const span = hi - lo, barLo = Math.min(lo - span * 0.6, 40), barHi = hi + span * 0.15;
            if (!G.isNum(v)) return { col: null, text: 'SIN DATO', fill: 0, lo, hi, barLo, barHi };
            const fill = G.clamp((v - barLo) / (barHi - barLo), 0, 1);
            if (v > hi) return { col: RED, text: TIRED, fill, alert: true, lo, hi, barLo, barHi };
            if (v >= hi - span * pct / 100) return { col: AMBER, text: NEAR, fill, lo, hi, barLo, barHi };
            if (v < lo && def.cold) {
                const e = eta(def.key, v, lo, d);
                const text = e.state === 'off' ? 'FRIO  MOTOR APAGADO' : e.state === 'stalled' ? 'FRIO  NO CALIENTA'
                    : 'FRIO  LISTO EN ' + (e.min > 60 ? '+60' : Math.max(1, Math.round(e.min))) + ' MIN';
                return { col: RED, text, fill, lo, hi, barLo, barHi };
            }
            return { col: GREEN, text: READY, fill, lo, hi, barLo, barHi };
        }

        /* ---------- drawing ---------- */
        function tile(cv, t, x, y, w, h, def, v, j, now) {
            const col = j.col || t.dim;
            cv.roundRect(x, y, w, h, 14, j.alert ? withAlpha(RED, 0.10 + 0.06 * Math.sin(now / 250)) : withAlpha('#18202b', 0.9));
            cv.strokeRoundRect(x, y, w, h, 14, 2, j.alert ? RED : withAlpha('#2a3442', 1));
            cv.text(def.label, x + 22, y + 40, 24, t.dim, { font: 'bold', spacing: 2.5 });
            // the number, as big as the panel allows
            const s = G.isNum(v) ? String(Math.round(G.smooth(def.key, v))) : '--';
            const room = h - 60 - 100;                      // between the label and the bar
            const uw = cv.textWidth('°F', 44, { font: 'num' });
            const nw0 = cv.textWidth('888', 100, { font: 'num' }) / 100;    // width per size unit (3 digits)
            const fit = Math.min(room * 1.05, (w - 44 - uw - 10) / Math.max(0.01, nw0));
            const base = y + 60 + room / 2 + fit * 0.36;
            const nw = cv.text(s, x + 20, base, fit, col, { font: 'num' });
            cv.text('°F', x + 28 + nw, base, 44, t.dim, { font: 'num' });
            // bar with the range marked
            const by = y + h - 82, bw = w - 44, bx = x + 22;
            cv.roundRect(bx, by, bw, 14, 7, withAlpha('#2a3442', 1));
            if (j.fill > 0) cv.roundRect(bx, by, Math.max(14, bw * j.fill), 14, 7, col);
            if (G.isNum(j.lo)) [j.lo, j.hi].forEach((m) => {
                const mx = bx + bw * G.clamp((m - j.barLo) / (j.barHi - j.barLo), 0, 1);
                cv.fillRect(mx - 1, by - 6, 3, 26, withAlpha('#ffffff', 0.55));
            });
            // status line, shrunk to fit
            let ts = 24;
            while (ts > 16 && cv.textWidth(j.text, ts, { font: 'bold', spacing: 1.5 }) > bw) ts -= 1;
            cv.text(j.text, bx, y + h - 30, ts, col, { font: 'bold', spacing: 1.5 });
        }

        function render() {
            const t = ctx.theme(), d = car.data(), now = Date.now();
            const cv = ctx.canvas(W, H).clear('#05070a');
            const v = values(d);
            track(v);
            const top = G.TOP + 6, bottom = G.pageBottom(cv) - 4, gap = 14;
            const w = (W - 2 * 16 - 3 * gap) / 4;
            VALUES.forEach((def, i) => tile(cv, t, 16 + i * (w + gap), top, w, bottom - top, def, v[def.key], judge(def, v[def.key], d), now));
            G.frame(cv, t, ['ESSENTIALS'], 0, [d.demo && { text: 'DEMO' }]);
            return ui.image('MAIN_GFX', cv);
        }

        // every screen refresh with the GPU renderer; 4 fps in software
        ctx.loop('MAIN', 4, render);
        render().then(() => log.info('first frame done')).catch((e) => log.warn('first render: ' + e));
    },
});
