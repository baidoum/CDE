/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/ui/serverWidget', 'N/log'], function (serverWidget, log) {

    // ⚠️ Adapter les valeurs aux internal IDs de ta liste "WMS Inbound Topic"
    var INBOUND_TOPIC = {
        PREPARATION: '1', // retour préparation (SO)
        RECEPTION:   '2'  // retour réception (PO)
    };

    function beforeLoad(context) {
        try {
            if (context.type !== context.UserEventType.VIEW) {
                return;
            }

            var form = context.form;
            var rec  = context.newRecord;

            // Client Script (identique à ton script existant)
            form.clientScriptFileId = 4141; // CDE_WMS_PrepProcess_CS.js

            var inboundId = rec.id;
            var topic     = rec.getValue({ fieldId: 'custrecord_wms_in_topic' });

            log.debug('Inbound UE', {
                inboundId: inboundId,
                topic: topic
            });

            // --- Préparation : Sales Order → Item Fulfillment ---
            if (topic === INBOUND_TOPIC.PREPARATION) {
                form.addButton({
                    id: 'custpage_wms_prep_process',
                    label: 'Traiter la préparation WMS',
                    functionName: 'cdeWmsProcessPrep(' + inboundId + ')'
                });
            }

            // --- Réception : Purchase Order → Item Receipt ---
            if (topic === INBOUND_TOPIC.RECEPTION) {
                form.addButton({
                    id: 'custpage_wms_receipt_process',
                    label: 'Traiter la réception WMS',
                    functionName: 'cdeWmsProcessReceipt(' + inboundId + ')'
                });
            }

        } catch (e) {
            log.error('CDE_WMS_Inbound_UE beforeLoad error', {
                message: e.message,
                stack: e.stack
            });
        }
    }

    return {
        beforeLoad: beforeLoad
    };
});
