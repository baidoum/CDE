/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/ui/serverWidget', 'N/url', 'N/log'], function (serverWidget, url, log) {

    function beforeLoad(context) {
        if (context.type !== context.UserEventType.VIEW) {
            return;
        }

        var form = context.form;
        var rec = context.newRecord;

        try {
            var scriptId = 'customscript_cde_wms_prep_process_sl';     // adapter
            var deployId = 'customdeploy_cde_wms_prep_process_sl';     // adapter

            var suiteletUrl = url.resolveScript({
                scriptId: scriptId,
                deploymentId: deployId,
                params: { inboundId: rec.id }
            });

            // AUCUN client script requis.
            form.addButton({
                id: 'custpage_wms_prep_process',
                label: 'Traiter la préparation WMS',
                functionName: "window.location.href='" + suiteletUrl + "';"
            });

        } catch (e) {
            log.error('WMS PREP UE - beforeLoad error', e);
        }
    }

    return {
        beforeLoad: beforeLoad
    };
});
