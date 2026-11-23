'use strict';
/**
 * health.js - why did the app close? (Jorge 2026-11-22: after ~20 minutes it closed by itself and would not
 * open again for a few minutes.) Reads nothing from the car.
 *
 *   - every minute: one 'vida:' line in the app's own log (minutes open, memory in MB, tab)
 *   - every 30 s: a garbage collection, so memory can't float up to the head unit's limit (Node 8 frees
 *     lazily; the kit only collects in its software mode, not with the GPU renderer)
 *   - at start: the last 'vida:' line and any crash line of the run before, as one short line for AJUSTES
 */
const fs = require('fs');
const path = require('path');

const LOG = 'jorge_suite.log';

function lastRun() {
    const dirs = [process.cwd(), path.resolve(__dirname, '..', '..', 'data')];
    let text = '';
    for (const d of dirs) {
        for (const f of [LOG + '.1', LOG]) {
            try { text += fs.readFileSync(path.join(d, f), 'utf8'); } catch (e) { /* not there */ }
        }
        if (text) break;
    }
    if (!text) return '';
    const lines = text.split('\n');
    let vida = null, fatal = null;
    for (const l of lines) {
        if (l.indexOf(' vida: ') > 0) { vida = l; fatal = null; }
        else if (vida && / FATAL /.test(l)) fatal = fatal || l;
    }
    if (!vida) return '';
    const m = /vida: min=(\d+) rss=(\d+)/.exec(vida);
    let s = 'ULTIMA VEZ ' + (m ? m[1] + ' MIN  ' + m[2] + ' MB' : '');
    if (fatal) {
        const why = /uncaught: (\w*Error[^\n]{0,40})|exit code (\d+)|(out of memory)/i.exec(fatal);
        s += '  CIERRE: ' + (why ? (why[1] || (why[2] ? 'CODIGO ' + why[2] : why[3])) : 'ERROR').toUpperCase().replace(/[^A-Z0-9 .:]/g, ' ');
    }
    return s.trim();
}

function start(log, page) {
    const before = lastRun();
    let gc = typeof global.gc === 'function' ? global.gc : null;
    if (!gc) {
        try { require('v8').setFlagsFromString('--expose_gc'); gc = require('vm').runInNewContext('gc'); } catch (e) { gc = null; }
    }
    const t0 = Date.now();
    setInterval(() => { if (gc) { try { gc(); } catch (e) { /* ignore */ } } }, 30000).unref();
    setInterval(() => {
        const mu = process.memoryUsage();
        log.info('vida: min=' + Math.round((Date.now() - t0) / 60000) + ' rss=' + Math.round(mu.rss / 1048576)
            + ' heap=' + Math.round(mu.heapUsed / 1048576) + ' tab=' + page());
    }, 60000).unref();
    log.info('health: gc ' + (gc ? 'on' : 'off') + (before ? ', before: ' + before : ''));
    return { before };
}

module.exports = { start, lastRun };
