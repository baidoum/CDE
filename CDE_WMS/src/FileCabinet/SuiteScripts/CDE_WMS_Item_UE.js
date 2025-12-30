/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/log','./CDE_WMS_QueueUtil'], (log, Queue) => {

  const TOPIC_ITEM   = 'ITEM';
  const READY_STATUS = 'Ready';  
  const PENDING_STATUS = 'Pending'; 
  const F_READY = 'custitem_cde_sync_ready';

  function afterSubmit(context) {
    
    try {
      const rec = context.newRecord;
      const ready = !!rec.getValue({ fieldId: F_READY });

      // CREATE
      if (context.type === context.UserEventType.CREATE) {
        if (!ready) {
          log.debug('Item UE', 'création ignorée (case non cochée)');
          return;
        }
        const queueId = Queue.enqueue({
          topic: TOPIC_ITEM,
          recordType: rec.type,
          recordId: rec.id,
          statusId: READY_STATUS
        });
        log.debug('Item UE', `ajout en queue (Ready) → ${queueId || 'déjà présent'}`);
        return;
      }

      // EDIT
      if (context.type === context.UserEventType.EDIT && context.oldRecord) {
        const wasReady = !!context.oldRecord.getValue({ fieldId: F_READY });

        // passage NON → OUI  (Pending → Ready)
        if (!wasReady && ready) {
          const existingId = Queue.findExisting({
            topic: TOPIC_ITEM,
            recordType: rec.type,
            recordId: rec.id
          });
          if (existingId) {
            Queue.updateStatus(existingId, READY_STATUS);
          } else {
            Queue.enqueue({ topic: TOPIC_ITEM, recordType: rec.type, recordId: rec.id, statusId: READY_STATUS });
          }
          log.debug('Item UE', 'statut → Ready');
          return;
        }

        // passage OUI → NON  (Ready → Pending)
        if (wasReady && !ready) {
          const existingId = Queue.findExisting({
            topic: TOPIC_ITEM,
            recordType: rec.type,
            recordId: rec.id
          });
          if (existingId) {
            Queue.updateStatus(existingId, PENDING_STATUS);
            log.debug('Item UE', 'statut → Pending (case décochée)');
          }
          return;
        }

        // sinon aucun changement => on ne fait rien
      }

    } catch (e) {
      log.error('Item UE error', e);
    }
  }

  return { afterSubmit };
});
