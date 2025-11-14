/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/log', './CDE_WMS_QueueUtil'], (log, Queue) => {

  // Topic pour les transactions (Sales Orders) → à mapper dans CDE_WMS_QueueUtil
  const TOPIC_SO       = 'SALES_ORDER';   // Queue.mapTopicLabel gérera la conversion vers l’ID de liste
  const READY_STATUS   = 'Ready';         // label du statut dans la liste CDE Status Sync WMS
  const PENDING_STATUS = 'Pending';       // optionnel si tu veux gérer le "uncheck" comme pour les items

  const F_SYNC = 'custbody_cde_trans_sync'; // case à cocher sur la SO

  function afterSubmit(context) {
    try {
      if (context.type === context.UserEventType.DELETE) {
        // On ne synchronise pas les suppressions vers le WMS (à adapter si besoin)
        return;
      }

      const rec = context.newRecord;
      const sync = !!rec.getValue({ fieldId: F_SYNC });

      // --- CREATE ---
      if (context.type === context.UserEventType.CREATE) {
        if (!sync) {
          log.debug('SO UE', 'Création ignorée (custbody_cde_trans_sync non cochée)');
          return;
        }

        const queueId = Queue.enqueue({
          topic: TOPIC_SO,
          recordType: rec.type,
          recordId: rec.id,
          statusId: READY_STATUS
        });

        log.debug('SO UE', `Ajout en queue (Ready) → ${queueId || 'déjà présent'}`);
        return;
      }

      // --- EDIT ---
      if (context.type === context.UserEventType.EDIT && context.oldRecord) {
        const wasSync = !!context.oldRecord.getValue({ fieldId: F_SYNC });

        // Passage NON → OUI → on (re)met en Ready
        if (!wasSync && sync) {
          const existingId = Queue.findExisting({
            topic: TOPIC_SO,
            recordType: rec.type,
            recordId: rec.id
          });

          if (existingId) {
            Queue.updateStatus(existingId, READY_STATUS);
            log.debug('SO UE', `Statut queue mis à jour → Ready (id=${existingId})`);
          } else {
            const queueId = Queue.enqueue({
              topic: TOPIC_SO,
              recordType: rec.type,
              recordId: rec.id,
              statusId: READY_STATUS
            });
            log.debug('SO UE', `Ajout en queue (Ready) → ${queueId}`);
          }
          return;
        }

        // Optionnel : Passage OUI → NON → on met en Pending (comme pour les items)
        if (wasSync && !sync) {
          const existingId = Queue.findExisting({
            topic: TOPIC_SO,
            recordType: rec.type,
            recordId: rec.id
          });

          if (existingId) {
            Queue.updateStatus(existingId, PENDING_STATUS);
            log.debug('SO UE', `Statut queue mis à jour → Pending (id=${existingId})`);
          }
          return;
        }

        // Sinon : pas de changement sur la case → on ne fait rien
      }

    } catch (e) {
      log.error('SO UE error', {
        message: e.message,
        stack: e.stack
      });
    }
  }

  return { afterSubmit };
});
