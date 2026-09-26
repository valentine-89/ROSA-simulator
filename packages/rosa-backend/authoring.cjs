const C = require('./contract.cjs');
const TOOLS = ['list_backends', 'get_backend', 'upsert_backend', 'delete_backend', 'check_backend', 'publish_backend', 'run_backend', 'get_backend_run', 'schedule_backend'];
function createBackendAuthoring({ store, verifySession, verifyDevices, settings, pump, changed }) {
    const detail = (ioid, name) => {
        const definition = store.draft(ioid, name);
        return { definition, revision: C.hash(definition), config: store.config(ioid, name, true), schedule: store.schedule(ioid,name) };
    };
    return async function execute(tool, raw, context) {
        if (!TOOLS.includes(tool))
            throw C.fail('INVALID_TOOL', 'Công cụ backend không hợp lệ.');
        if (context.signal?.aborted)
            throw C.fail('WORKFLOW_CANCELLED', 'Tác vụ đã hủy.');
        const parameters = C.json(raw || {}, C.LIMITS.source + 131072);
        if (!context.sessionId)
            throw C.fail('SESSION_REQUIRED', 'Cần chọn thiết bị IoT.');
        const verified = await verifySession(context.sessionId);
        const ioid = C.ioid(context.sessionId.split('@')[0]);
        if (verified.ioid !== ioid)
            throw C.fail('DEVICE_MISMATCH', 'Thiết bị không hợp lệ.', 403);
        if (context.signal?.aborted)
            throw C.fail('WORKFLOW_CANCELLED', 'Tác vụ đã hủy.');
        if (tool === 'list_backends')
            return { ioid, backends: store.list(ioid).map(d => ({ name: d.name, description: d.description || '', revision: C.hash(Object.fromEntries(Object.entries(d).filter(([k]) => !['config', 'updatedAt','schedule'].includes(k)))), enabled: d.config.enabled, published: d.config.published || false, externalEnabled: d.config.externalEnabled, schedule:d.schedule })), limits:store.schedulingStatus(), editorUrl: '/backend' };
        if (tool === 'get_backend_run') {
            const row = store.raw(String(parameters.runId || parameters.runid || ''));
            if (row.ioid !== ioid)
                throw C.fail('NOT_FOUND', 'Không tìm thấy lượt chạy.', 404);
            return store.view(row);
        }
        const name = C.name(parameters.name || parameters.definition?.name);
        if (tool === 'get_backend')
            return detail(ioid, name);
        const expected = parameters.expectedRevision ?? parameters.expectedrevision;
        if (tool === 'schedule_backend') {
            const current=detail(ioid,name);
            if (expected!==current.revision) throw C.fail('REVISION_CONFLICT','Đọc lại backend trước khi đổi lịch.',409);
            const schedule=store.setSchedule(ioid,name,parameters.schedule,parameters.expectedScheduleRevision ?? parameters.expectedschedulerevision);
            changed?.(ioid,name,context.syncId);
            return {...detail(ioid,name),schedule};
        }
        if (tool === 'delete_backend') {
            const result = store.remove(ioid, name, expected);
            changed?.(ioid, name, context.syncId);
            return result;
        }
        if (tool === 'upsert_backend' || tool === 'check_backend') {
            let previous;
            try {
                previous = store.draft(ioid, name);
            }
            catch (e) {
                if (e.code !== 'NOT_FOUND')
                    throw e;
            }
            if (tool === 'upsert_backend' && previous && typeof expected !== 'string')
                throw C.fail('REVISION_REQUIRED', 'Đọc get_backend rồi gửi expectedRevision trước khi sửa.');
            const patch = parameters.definition || parameters;
            const candidate = { ...previous, ...Object.fromEntries(['description', 'source', 'inputSchema', 'outputSchema', 'permissions'].filter(k => Object.hasOwn(patch, k)).map(k => [k, patch[k]])), name };
            const analysis = C.analyze(candidate.source);
            if (!analysis.ok || tool === 'check_backend') {
                if (analysis.ok)
                    C.definition(candidate);
                return { ...analysis, saved: false };
            }
            const definition = C.definition(candidate);
            await verifyDevices(ioid, definition, context);
            if (context.signal?.aborted)
                throw C.fail('WORKFLOW_CANCELLED', 'Tác vụ đã hủy.');
            store.save(ioid, definition, previous ? expected : (expected ?? null));
            changed?.(ioid, name, context.syncId);
            return { ...detail(ioid, name), saved: true, publishedNow: false, diagnostics: analysis.diagnostics };
        }
        const current = detail(ioid, name);
        if (typeof expected !== 'string' || expected !== current.revision)
            throw C.fail('REVISION_CONFLICT', 'Cần expectedRevision hiện tại từ get_backend.', 409);
        const definition = C.definition(current.definition);
        const grants = await verifyDevices(ioid, definition, context);
        if (context.signal?.aborted)
            throw C.fail('WORKFLOW_CANCELLED', 'Tác vụ đã hủy.');
        if (C.hash(store.draft(ioid, name)) !== expected)
            throw C.fail('REVISION_CONFLICT', 'Backend đã thay đổi; đọc lại.', 409);
        const config = store.config(ioid, name);
        if (!config.syncId) {
            if (!context.syncId)
                throw C.fail('SYNC_REQUIRED', 'Cần SyncID của cuộc trò chuyện để cấu hình backend.');
            store.configure(ioid, name, { syncId: context.syncId, enabled: false, externalEnabled: false });
        }
        if (tool === 'publish_backend') {
            const result = store.publish(ioid, name, grants, expected);
            // Preserve credentials, external access and payer already configured by the developer.
            store.configure(ioid, name, { ...store.config(ioid, name), enabled: true });
            changed?.(ioid, name, context.syncId);
            return { ...result, ...detail(ioid, name), publishedNow: true };
        }
        if (typeof parameters.requestId !== 'string' && typeof parameters.requestid !== 'string')
            throw C.fail('REQUEST_ID_REQUIRED', 'Cần requestId cố định để tránh chạy trùng khi thử lại.');
        const result = store.submit({ ioid, name, input: parameters.input ?? {}, requestKey: parameters.requestId || parameters.requestid, scope: 'editor', definition: { ...definition, deviceGrants: grants }, settings: settings(), test: true });
        pump();
        return result;
    };
}
module.exports = { BACKEND_AUTHORING_TOOLS: TOOLS, createBackendAuthoring };
