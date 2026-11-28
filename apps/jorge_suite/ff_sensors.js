'use strict';
/**
 * sensors.js - FLEX FUEL: the ethanol % and the fuel in the tank, from the engine unit (DME, 0x12).
 *
 * The same way as Alex Perea's perea_mhd_flex (poller.js / protocol.js, MIT, copied unchanged), which
 * is how MHD's own app logs it: on an MHD-flashed DME it asks for the ROM (22 F1 01 / F1 02), lets the
 * DME put MHD's two ethanol bytes, "Active" (what the tune uses) and "CAN" (what the flex fuel sensor
 * reads), under a temporary identifier of its own (2C, F303; the DME forgets it at the next ignition)
 * and reads that twice a second (22 F3 03). Nothing is stored in the car. Between those reads it also
 * reads the two tank halves (22 5949 / 594A, 0.5 l each) and the DME's own alcohol % (22 550D).
 *
 *   const s = new Sensors(ctx, log).start();
 *   s.tick(visible, demo)       every frame: sends only while the screen shows and not in demo
 *   s.ethanol()  -> %   (sensor, else what the tune uses, else the DME's own %)     s.litres() -> l
 *   s.ethWhy()   -> a short line for AJUSTES: where the ethanol comes from, or why there is none
 */
const { Diag } = require('./kit/diag');
const { Poller } = require('./poller');
const { DME, PROFILES } = require('./protocol');

const WHY = {
    'no-link': 'SIN CONEXION', 'link-down': 'CARRO DORMIDO', probing: 'BUSCANDO MHD', 'no-mhd': 'MHD NO ENCONTRADO',
    identifying: 'LEYENDO VERSION', 'unsupported-rom': 'VERSION NO CONOCIDA', defining: 'PREPARANDO', reading: 'LEYENDO',
    error: 'ESPERANDO AL MOTOR',
};

class Sensors {
    constructor(ctx, log) { this.ctx = ctx; this.log = log; this.poller = null; this.diag = null; }

    start() {
        const diag = this.diag = new Diag(this.ctx.signals, this.log);
        diag.quiet = true;
        diag.init().then(() => {
            this.poller = new Poller({
                physical: (sid, data, ms, accept) => diag.physical(DME, sid, data, ms, accept),
                available: () => !!diag.available, hasLink: () => !!diag.p,
                log: this.log, profiles: PROFILES,
            });
            diag.on('available', (on) => this.poller.linkChanged(on));
            this.poller.setVisible(false);
            this.poller.start();
        }).catch((e) => this.log.warn('diagnostic link: ' + (e && e.message || e)));
        return this;
    }

    tick(visible, demo) {
        if (!this.poller) return;
        if (this.poller.visible !== !!visible) this.poller.setVisible(visible);
        if (demo !== undefined && this.poller.paused !== !!demo) this.poller.setPaused(demo);
    }

    _view() { return this.poller ? this.poller.view() : null; }

    ethanol() {
        const v = this._view();
        if (!v) return null;
        if (v.can != null && !v.stale) return v.can;
        if (v.active != null && !v.stale) return v.active;
        const d = v.fuel.dmeEthanol;
        return d.fresh ? d.value : null;
    }

    /** The flex fuel sensor's reading as MHD logs it: 'can' (Ethanol Content (CAN)) or 'active' (Ethanol Content (Active)). */
    ethPart(which) {
        const v = this._view();
        if (!v || v.stale) return null;
        return which === 'active' ? v.active : v.can;
    }

    litres() { const v = this._view(); return v ? v.fuel.dme : null; }
    fuelPct() { return null; }

    ethWhy() {
        const v = this._view();
        if (!v) return 'SIN CONEXION';
        let s = WHY[v.state] || String(v.state).toUpperCase();
        if (v.state === 'reading') s += v.can != null ? ' SENSOR MHD' : v.active != null ? ' MHD ACTIVO' : '';
        else if (v.fuel.dmeEthanol.fresh) s += '  /  550D ' + Math.round(v.fuel.dmeEthanol.value) + '%';
        if (v.state === 'unsupported-rom' && v.seen.length) s += '  ' + v.seen.slice(0, 2).join(' ');
        if (v.state === 'no-mhd' || v.state === 'error') s += '  ' + String(v.reason || '').slice(0, 28);
        return s.toUpperCase();
    }
}

module.exports = { Sensors };
