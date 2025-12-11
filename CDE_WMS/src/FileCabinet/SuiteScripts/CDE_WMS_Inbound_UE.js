/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/ui/serverWidget', 'N/log'], function (serverWidget, log) {

    function beforeLoad(context) {
        try {
            if (context.type !== context.UserEventType.VIEW) {
                return;
            }

            var form = context.form;
            var rec  = context.newRecord;

            // On utilise l'ID du Client Script, exactement comme ton script initial
            form.clientScriptFileId = 7290; // CDE_WMS_Inbound_CS.js

            // --- Bouton pour traiter la préparation (Sales Orders → Item Fulfillment) ---
            form.addButton({
                id: 'custpage_wms_prep_process',
                label: 'Traiter la préparation WMS',
                functionName: 'cdeWmsProcessPrep(' + rec.id + ')'
            });

            // --- Bouton pour traiter la réception (Purchase Orders → Item Receipt) ---
            form.addButton({
                id: 'custpage_wms_receipt_process',
                label: 'Traiter la réception WMS',
                functionName: 'cdeWmsProcessReceipt(' + rec.id + ')'
            });

        } catch (e) {
            log.error('CDE_WMS_Inbound_UE beforeLoad error', e);
        }
    }

    return {
        beforeLoad: beforeLoad
    };
});
