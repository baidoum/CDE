/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Utilitaire création/MAJ dans la queue WMS
 */
define(['N/record','N/search','N/log'], (record, search, log) => {

  const QUEUE_RT   = 'customrecord_cde_item_sync_queue';
  const F_TOPIC    = 'custrecord_sync_topic';
  const F_REC_TYPE = 'custrecord_sync_record_type';
  const F_REC_ID   = 'custrecord_sync_record_id';
  const F_STATUS   = 'custrecord_sync_status';
  const F_DATE     = 'custrecord_sync_item_date_sync';
  const F_ITEM     = 'custrecord_sync_item';

  const ITEM_TYPES = new Set([
    'inventoryitem','assemblyitem','noninventoryitem','serviceitem','otherchargeitem',
    'kititem','downloaditem','lotnumberedinventoryitem','serializedinventoryitem'
  ]);

  function findExisting({ topic, recordType, recordId }) {
    const res = search.create({
      type: QUEUE_RT,
      filters: [
        [F_TOPIC, 'is', String(topic)], 'AND',
        [F_REC_TYPE, 'is', String(recordType)], 'AND',
        [F_REC_ID, 'is', String(recordId)]
      ],
      columns: ['internalid']
    }).run().getRange({ start: 0, end: 1 });
    return (res && res.length) ? res[0].getValue('internalid') : null;
  }

  function enqueue({ topic, recordType, recordId, statusId = null }) {
    try {
      const existingId = findExisting({ topic, recordType, recordId });
      if (existingId) {
        log.debug('Queue', `déjà présent (topic=${topic}, rec=${recordType}#${recordId})`);
        return existingId;
      }

      const r = record.create({ type: QUEUE_RT, isDynamic: false });

      // Topic : texte ou ID
      if (/^\d+$/.test(String(topic))) {
        r.setValue({ fieldId: F_TOPIC, value: Number(topic) });
      } else {
        r.setText({ fieldId: F_TOPIC, text: String(topic) });
      }

      r.setValue({ fieldId: F_REC_TYPE, value: String(recordType) });
      r.setValue({ fieldId: F_REC_ID,   value: String(recordId) });
      r.setValue({ fieldId: F_DATE,     value: new Date() });

      if (statusId !== null && statusId !== undefined && statusId !== '') {
        // accepte texte ("Ready") ou ID
        if (/^\d+$/.test(String(statusId))) {
          r.setValue({ fieldId: F_STATUS, value: Number(statusId) });
        } else {
          r.setText({ fieldId: F_STATUS, text: String(statusId) });
        }
      }

      if (ITEM_TYPES.has(String(recordType))) {
        r.setValue({ fieldId: F_ITEM, value: Number(recordId) });
      }

      const queueId = r.save({ ignoreMandatoryFields: true });
      log.audit('Queue', `créé → queueId=${queueId} (${recordType}#${recordId})`);
      return queueId;

    } catch (e) {
      log.error('Queue error', e);
    }
  }

  function updateStatus(queueId, statusIdOrText) {
    try {
      if (!queueId || statusIdOrText === null || statusIdOrText === undefined || statusIdOrText === '') return;
      const r = record.load({ type: QUEUE_RT, id: Number(queueId), isDynamic: false });
      if (/^\d+$/.test(String(statusIdOrText))) {
        r.setValue({ fieldId: F_STATUS, value: Number(statusIdOrText) });
      } else {
        r.setText({ fieldId: F_STATUS, text: String(statusIdOrText) });
      }
      r.save({ ignoreMandatoryFields: true });
      log.debug('Queue', `statut mis à jour → queueId=${queueId}, status=${statusIdOrText}`);
    } catch (e) {
      log.error('Queue updateStatus error', e);
    }
  }

  return { enqueue, updateStatus, findExisting };
});
