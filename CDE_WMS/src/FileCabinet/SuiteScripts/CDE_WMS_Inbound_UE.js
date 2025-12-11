/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/ui/serverWidget', 'N/log'], function (serverWidget, log) {

    function beforeLoad(context) {
        if (context.type !== context.UserEventType.VIEW) {
            return;
        }

        var form = context.form;

        try {
            // On attache le client script
            form.clientScriptModulePath = './CDE_WMS_PrepProcess_CS.js';

            // Bouton qui appelle une fonction du client script
            form.addButton({
                id: 'custpage_wms_prep_process',
                label: 'Traiter la préparation WMS',
                functionName: 'cdeWmsProcessPrep'
            });

        } catch (e) {
            log.error('WMS PREP UE - beforeLoad error', e);
        }
    }

    return {
        beforeLoad: beforeLoad
    };
});
