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


            form.clientScriptFileId = 7290;

            // 2) Bouton qui appelle la fonction du client script
            form.addButton({
                id: 'custpage_wms_prep_process',
                label: 'Traiter la préparation WMS',
                // on passe l’ID du inbound au client script
                functionName: 'cdeWmsProcessPrep(' + rec.id + ')'
            });

        } catch (e) {
            log.error('CDE_WMS_Inbound_UE beforeLoad error', e);
        }
    }

    return {
        beforeLoad: beforeLoad
    };
});
