/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/log', './CDE_WMS_QueueUtil'], (log, Queue) => {

  // Topic pour les Purchase Orders → à mapper dans CDE_WMS_QueueUtil
  const TOPIC_PO       = 'PURCHASE_ORDER';  // Queue.mapTopicLabel gérera la conversion label → ID
  const READY_STATUS   = 'Ready';           // label du statut dans la liste CDE Status Sync WMS
  const PENDING_STATUS = 'Pending';         // idem

  const F_SYNC = 'custbody_cde_trans_sync'; // même checkbox que sur les SO

  function afterSubmit(context) {
    try {
      if (context.type === context.UserEventType.DELETE) {
        // Pour l’instant on ne synchronise pas les suppressions de PO vers le WMS
        return;
      }

      const rec = context.newRecord;
      const sync = !!rec.getValue({ fieldId: F_SYNC });

      // --- CREATE ---
      if (context.type === context.UserEventType.CREATE) {
        if (!sync) {
          log.debug('PO UE', 'Création ignorée (custbody_cde_trans_sync non cochée)');
          return;
        }

        const queueId = Queue.enqueue({
          topic: TOPIC_PO,
          recordType: rec.type,  // "purchaseorder"
          recordId: rec.id,
          statusId: READY_STATUS
        });

        log.debug('PO UE', `Ajout en queue (Ready) → ${queueId || 'déjà présent'}`);
        return;
      }

      // --- EDIT ---
      if (context.type === context.UserEventType.EDIT && context.oldRecord) {
        const wasSync = !!context.oldRecord.getValue({ fieldId: F_SYNC });

        // Passage NON → OUI → (re)mise en Ready
        if (!wasSync && sync) {
          const existingId = Queue.findExisting({
            topic: TOPIC_PO,
            recordType: rec.type,
            recordId: rec.id
          });

          if (existingId) {
            Queue.updateStatus(existingId, READY_STATUS);
            log.debug('PO UE', `Statut queue mis à jour → Ready (id=${existingId})`);
          } else {
            const queueId = Queue.enqueue({
              topic: TOPIC_PO,
              recordType: rec.type,
              recordId: rec.id,
              statusId: READY_STATUS
            });
            log.debug('PO UE', `Ajout en queue (Ready) → ${queueId}`);
          }
          return;
        }

        // Optionnel : Passage OUI → NON → on met la queue en Pending
        if (wasSync && !sync) {
          const existingId = Queue.findExisting({
            topic: TOPIC_PO,
            recordType: rec.type,
            recordId: rec.id
          });

          if (existingId) {
            Queue.updateStatus(existingId, PENDING_STATUS);
            log.debug('PO UE', `Statut queue mis à jour → Pending (id=${existingId})`);
          } else {
            log.debug('PO UE', 'Case décochée mais aucune queue existante trouvée');
          }
          return;
        }

        // Sinon : la case n’a pas changé → on ne touche à rien
      }

    } catch (e) {
      log.error('PO UE error', {
        message: e.message,
        stack: e.stack
      });
    }
  }

  return { afterSubmit };
});
