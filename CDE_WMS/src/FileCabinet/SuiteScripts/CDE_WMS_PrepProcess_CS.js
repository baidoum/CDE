/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define(['N/log'], function (log) {

    function cdeWmsProcessPrep(inboundId) {
        try {
            if (!inboundId) {
                alert("Impossible de déterminer l'ID du fichier inbound.");
                return;
            }

           
            var baseUrl = '/app/site/hosting/scriptlet.nl?script=979&deploy=1';
            var fullUrl = baseUrl + '&inboundId=' + encodeURIComponent(inboundId);

            log.debug('WMS PREP CS - redirect URL', fullUrl);

            window.location.href = fullUrl;

        } catch (e) {
            log.error('WMS PREP CS - error', e);
            alert('Erreur lors du lancement du traitement WMS : ' + e.message);
        }
    }

    // entry point "officiel" pour satisfaire NetSuite (même vide)
    function pageInit(context) {
        // rien de spécial
    }

    return {
        pageInit: pageInit,
        cdeWmsProcessPrep: cdeWmsProcessPrep
    };
});
