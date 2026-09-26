'use strict';
const C = require('./contract.cjs');
const ID = /^[A-Za-z0-9._:-]{1,128}$/;
// Revalidated at SDK invocation and again before an AI request leaves its durable queue.
function pageCommandGrant(db, {pageId, commandId, backendName, syncId, now=Date.now()}) {
  if (!ID.test(pageId) || !ID.test(commandId)) throw C.fail('INVALID_COMMAND','Trang/command không hợp lệ.');
  C.name(backendName);
  const page=db.prepare('SELECT enabled,meta,sync_id FROM system_pages WHERE page_id=?').get(pageId);
  const command=db.prepare('SELECT enabled,sync_id,params_schema FROM system_cmds WHERE cmd_id=?').get(commandId);
  if (!page?.enabled || !command?.enabled) throw C.fail('COMMAND_DISABLED','Trang hoặc command đã tắt.',403);
  if (!syncId || page.sync_id!==syncId || command.sync_id!==syncId) throw C.fail('PAYER_MISMATCH','SyncID backend và trang/command phải trùng nhau.',403);
  const api=JSON.parse(page.meta||'{}').publicApi;
  if (!api?.allowedCommands?.includes(commandId) || !Array.isArray(api.backendCommands?.[commandId]) || !api.backendCommands[commandId].includes(backendName))
    throw C.fail('BACKEND_COMMAND_FORBIDDEN','Trang chưa cho phép backend gọi command này.',403);
  const window=api.backendWindow;
  if (window) {
    const {offsetMinutes,startHour,endHour}=window;
    if (!Number.isInteger(offsetMinutes) || Math.abs(offsetMinutes)>840 || !Number.isInteger(startHour) || startHour<0 || startHour>23 ||
        !Number.isInteger(endHour) || endHour<0 || endHour>24 || startHour===endHour) throw C.fail('INVALID_WINDOW','Khung giờ không hợp lệ.');
    const hour=new Date(now+offsetMinutes*60000).getUTCHours();
    if (!(startHour<endHour ? hour>=startHour&&hour<endHour : hour>=startHour||hour<endHour)) throw C.fail('OUTSIDE_WINDOW','Ngoài khung giờ tự động.',409);
  }
  return {api,command};
}
module.exports={pageCommandGrant};
