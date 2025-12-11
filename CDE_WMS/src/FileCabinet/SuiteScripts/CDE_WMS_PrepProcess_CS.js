/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define(['N/currentRecord', 'N/log'], function (currentRecord, log) {

    function cdeWmsProcessPrep() {
        try {
            var rec = currentRecord.get();
            var inboundId = rec.id;

            // URL de base du Suitelet (script / deploy connus)
            var baseUrl = '/app/site/hosting/scriptlet.nl?script=979&deploy=1';

            var fullUrl = baseUrl + '&inboundId=' + encodeURIComponent(inboundId);

            log.debug('WMS PREP CS - redirect URL', fullUrl);

            window.location.href = fullUrl;

        } catch (e) {
            log.error('WMS PREP CS - error', e);
            alert('Erreur lors du lancement du traitement WMS : ' + e.message);
        }
    }

    return {
        cdeWmsProcessPrep: cdeWmsProcessPrep
    };
});
