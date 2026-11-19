'use strict';
/**
 * sensors.js - FLEX FUEL: read ONLY from the engine unit (DME, 0x12; kit/readonly-diag refuses anything
 * that is not a read):
 *
 *   ethanol   22 550D  (PROZENT_ALK_KRST, % alcohol in the fuel, raw x 0.392), else OBD 01 52 (raw x 100/255)
 *             - with MHD's flex fuel kit the tune feeds its sensor's reading into this value
 *   fuel      22 5949 + 22 594A  (left + right half of the tank, raw x 0.5 l), else OBD 01 2F (% of the tank)
 *
 * Asked only while the screen shows (visible()).
 *
 *   const s = new Sensors(ctx, log, () => visible).start();
 *   s.ethanol()  -> %          s.litres()  -> l (both halves)     s.fuelPct() -> % (fallback)
 */
const { ReadOnlyDiag } = require('./kit/readonly-diag');
const { DidReader } = require('./kit/dids');

const DME = 0x12;
const ETHANOL = [
    { did: '550D', bytes: 1, at: 0, factor: 100 / 255, offset: 0, min: 0, max: 100 },
    { obd: '52', bytes: 1, at: 0, factor: 100 / 255, offset: 0, min: 0, max: 100 },
];
const LEFT = [{ did: '5949', bytes: 1, at: 0, factor: 0.5, offset: 0, min: 0, max: 100 }];
const RIGHT = [{ did: '594A', bytes: 1, at: 0, factor: 0.5, offset: 0, min: 0, max: 100 }];
const PCT = [{ obd: '2F', bytes: 1, at: 0, factor: 100 / 255, offset: 0, min: 0, max: 100 }];
const EVERY = 3000, SLOW_MS = 30000, FRESH_MS = 30000;

class Sensors {
    constructor(ctx, log, visible) {
        this.ctx = ctx; this.log = log; this.visible = visible || (() => true);
        this.v = {}; this.at = {}; this.next = {}; this.miss = {}; this.logged = {};
    }

    start() {
        this.link = new ReadOnlyDiag(this.ctx.signals, this.log);
        this.rd = new DidReader(this.link, { ecu: DME });
        this.link.init().then(() => {
            if (this.link.ready === false) { this.log.info('no diagnostic link'); return; }
            this._loop();
        }).catch((e) => this.log.warn('diagnostic link: ' + (e && e.message || e)));
        return this;
    }

    _get(k) { return Date.now() - (this.at[k] || 0) < FRESH_MS ? this.v[k] : null; }
    ethanol() { return this._get('eth'); }
    litres() { const l = this._get('left'), r = this._get('right'); return l !== null && l !== undefined && r !== null && r !== undefined ? l + r : null; }
    fuelPct() { return this._get('pct'); }

    async _loop() {
        for (;;) {
            try {
                if (this.visible()) {
                    await this._read('eth', ETHANOL);
                    await this._read('left', LEFT);
                    await this._read('right', RIGHT);
                    if (this.litres() === null) await this._read('pct', PCT);
                }
            } catch (e) {
                // the head unit's transport comes up a few seconds after the app: try again soon
                this._once('err', 'read: ' + (e && e.message || e) + ' (trying again)');
            }
            await new Promise((r) => setTimeout(r, 250));
        }
    }

    async _read(key, list) {
        if ((this.next[key] || 0) > Date.now()) return;
        if (this.link.wake) this.link.wake(DME);
        const v = await this.rd.value(key, list);
        const now = Date.now();
        if (v !== null) {
            this.v[key] = v; this.at[key] = now; this.miss[key] = 0;
            this._once(key + 'ok', key + ' -> ' + v);
            this.next[key] = now + EVERY;
        } else {
            this.miss[key] = (this.miss[key] || 0) + 1;
            this._once(key + 'none', key + ': no answer (' + JSON.stringify(this.rd.raws) + ')');
            this.next[key] = now + (this.miss[key] >= 3 ? SLOW_MS : EVERY);
        }
    }

    _once(k, msg) { if (!this.logged[k]) { this.logged[k] = true; this.log.info(msg); } }
}

module.exports = { Sensors };
