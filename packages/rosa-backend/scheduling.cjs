"use strict";
const C = require('./contract.cjs');
const HOUR = 3600000;
const DEFAULTS = { maxConcurrent: 20, maxBackendsPerDevice: 100, scheduleMinHours: 1 };
function limits(value = {}) {
  const result = {};
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const n = value[key];
    result[key] = Number.isSafeInteger(n) && n > 0 ? n : fallback;
  }
  return result;
}
function installScheduling(Store) {
  Object.assign(Store.prototype, {
    initScheduling() {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS backend_schedules(
          ioid TEXT NOT NULL,name TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,
          interval_hours INTEGER NOT NULL DEFAULT 1,revision INTEGER NOT NULL DEFAULT 0,
          next_at INTEGER,pending_at INTEGER,last_at INTEGER,last_run_id TEXT,
          last_status TEXT,last_error TEXT,skipped INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(ioid,name));
        CREATE INDEX IF NOT EXISTS backend_schedules_due ON backend_schedules(next_at) WHERE enabled=1;
        CREATE INDEX IF NOT EXISTS backend_schedules_pending ON backend_schedules(pending_at) WHERE pending_at IS NOT NULL;
        CREATE INDEX IF NOT EXISTS backend_runs_active_backend ON backend_runs(ioid,name,scope,status);
        CREATE TABLE IF NOT EXISTS backend_schedule_devices(ioid TEXT PRIMARY KEY,last_started INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS backend_schedule_clock(id INTEGER PRIMARY KEY,offset_ms INTEGER NOT NULL);
      `);
    },
    scheduleNow() {
      return Date.now() + (this.simulation ? Number(this.db.prepare('SELECT offset_ms FROM backend_schedule_clock WHERE id=1').get()?.offset_ms || 0) : 0);
    },
    schedule(ioid, name) {
      const r = this.db.prepare('SELECT * FROM backend_schedules WHERE ioid=? AND name=?').get(C.ioid(ioid), C.name(name));
      return r ? { enabled: !!r.enabled, intervalHours: r.interval_hours, revision: r.revision, nextAt: r.next_at, pendingAt: r.pending_at,
        lastAt: r.last_at, lastRunId: r.last_run_id, lastStatus: r.last_status, lastError: r.last_error, skipped: r.skipped }
        : { enabled: false, intervalHours: limits(this.settings()).scheduleMinHours, revision: 0, nextAt: null, pendingAt: null };
    },
    setSchedule(ioid, name, raw, expectedRevision, now = this.scheduleNow()) {
      C.ioid(ioid); C.name(name);
      if (!raw || typeof raw.enabled !== 'boolean') throw C.fail('INVALID_SCHEDULE', 'Cần cờ bật/tắt lịch.');
      const { scheduleMinHours } = limits(this.settings());
      const hours = raw.intervalHours;
      if (!Number.isSafeInteger(hours) || hours < 1 || hours > 8760 || (raw.enabled && hours < scheduleMinHours))
        throw C.fail('INVALID_INTERVAL', `Chu kỳ cần là số nguyên từ ${scheduleMinHours} đến 8760 giờ.`);
      return this.db.transaction(() => {
        this.draft(ioid, name);
        const old = this.schedule(ioid, name);
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== old.revision)
          throw C.fail('SCHEDULE_CONFLICT', 'Lịch đã thay đổi. Đọc lại trước khi lưu.', 409);
        if (raw.enabled) {
          const d = this.published(ioid, name);
          try { C.validateSchema(d.inputSchema, {}); }
          catch { throw C.fail('SCHEDULE_INPUT_REQUIRED', 'Backend định kỳ phải nhận được input {}. Sửa schema/code rồi phát hành lại.'); }
          if (!this.config(ioid, name).syncId) throw C.fail('SYNC_REQUIRED', 'Cần cấu hình SyncID trả phí.');
        }
        // First execution is never earlier than one full requested interval.
        const next = raw.enabled ? Math.ceil((now + hours * HOUR) / HOUR) * HOUR : null;
        this.db.prepare(`INSERT INTO backend_schedules(ioid,name,enabled,interval_hours,revision,next_at)
          VALUES(?,?,?,?,?,?) ON CONFLICT(ioid,name) DO UPDATE SET enabled=excluded.enabled,
          interval_hours=excluded.interval_hours,revision=excluded.revision,next_at=excluded.next_at,
          pending_at=NULL,last_error=NULL`).run(ioid,name,Number(raw.enabled),hours,old.revision+1,next);
        return this.schedule(ioid,name);
      }).immediate();
    },
    clearSchedule(ioid, name) {
      this.db.prepare('DELETE FROM backend_schedules WHERE ioid=? AND name=?').run(ioid,name);
    },
    scanSchedules(now = this.scheduleNow(), batch = 100) {
      return this.db.transaction(() => {
        const rows = this.db.prepare('SELECT * FROM backend_schedules WHERE enabled=1 AND next_at<=? ORDER BY next_at,ioid,name LIMIT ?').all(now,batch);
        const minimum = limits(this.settings()).scheduleMinHours;
        for (const r of rows) {
          const period = r.interval_hours * HOUR;
          const missed = Math.floor((now-r.next_at)/period);
          const due = r.next_at + missed * period;
          const busy = r.pending_at !== null || !!this.db.prepare("SELECT 1 FROM backend_runs WHERE ioid=? AND name=? AND scope='schedule' AND status IN ('queued','running') LIMIT 1").get(r.ioid,r.name);
          const invalid = r.interval_hours < minimum;
          this.db.prepare(`UPDATE backend_schedules SET next_at=?,pending_at=?,skipped=skipped+?,
            last_status=CASE WHEN ? THEN 'skipped' ELSE last_status END,
            last_error=CASE WHEN ? THEN 'Chu kỳ thấp hơn cài đặt chung.' ELSE last_error END
            WHERE ioid=? AND name=?`).run(due+period, busy || invalid ? r.pending_at : due,
              missed + (busy || invalid ? 1 : 0),Number(invalid),Number(invalid),r.ioid,r.name);
        }
        return rows.length;
      }).immediate();
    },
    schedulingStatus() {
      const { maxConcurrent, maxBackendsPerDevice, scheduleMinHours } = limits(this.settings());
      const row = this.db.prepare("SELECT COUNT(*) total,COALESCE(SUM(scope='schedule'),0) scheduled FROM backend_runs WHERE status='running'").get();
      return { maxConcurrent, maxScheduled: Math.floor(maxConcurrent/5), running: row.total, scheduledRunning: row.scheduled,
        pendingScheduled: this.db.prepare('SELECT COUNT(*) n FROM backend_schedules WHERE pending_at IS NOT NULL').get().n,
        maxBackendsPerDevice, scheduleMinHours };
    },
    claimScheduled(owner, count, now = Date.now()) {
      const output=[];
      // Caller holds the admission transaction. Re-check priorities and caps there.
      for (let i=0;i<count;i++) {
        const r=this.db.prepare(`SELECT s.* FROM backend_schedules s LEFT JOIN backend_schedule_devices d ON d.ioid=s.ioid
          WHERE s.pending_at IS NOT NULL ORDER BY COALESCE(d.last_started,0),s.pending_at,s.ioid,s.name LIMIT 1`).get();
        if (!r) break;
        this.db.prepare('UPDATE backend_schedules SET pending_at=NULL,last_at=?,last_run_id=NULL WHERE ioid=? AND name=?').run(r.pending_at,r.ioid,r.name);
        try {
          if (!r.enabled || r.interval_hours < limits(this.settings()).scheduleMinHours) throw C.fail('SCHEDULE_DISABLED','Lịch đã tắt hoặc chu kỳ không hợp lệ.');
          const definition=this.published(r.ioid,r.name);
          const value=this.submit({ ioid:r.ioid,name:r.name,input:{},requestKey:`schedule:${r.revision}:${r.pending_at}`,
            scope:'schedule',definition,settings:this.settings() });
          const run=this.raw(value.runId);
          if (run.status!=='queued') continue;
          this.db.prepare("UPDATE backend_runs SET status='running',owner=?,heartbeat=? WHERE id=?").run(owner,now,run.id);
          this.db.prepare("UPDATE backend_schedules SET last_run_id=?,last_status='running',last_error=NULL WHERE ioid=? AND name=?").run(run.id,r.ioid,r.name);
          this.db.prepare('INSERT INTO backend_schedule_devices VALUES(?,?) ON CONFLICT(ioid) DO UPDATE SET last_started=excluded.last_started').run(r.ioid,now+i);
          output.push({...run,status:'running',owner});
        } catch(e) {
          this.db.prepare("UPDATE backend_schedules SET last_status='skipped',last_error=? WHERE ioid=? AND name=?").run(String(e.message).slice(0,500),r.ioid,r.name);
        }
      }
      return output;
    },
  });
}
module.exports={ installScheduling, limits, HOUR };
