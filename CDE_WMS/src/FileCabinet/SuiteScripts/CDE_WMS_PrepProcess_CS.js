/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define([], function () {

    /**
     * Appelé lorsque l'utilisateur clique sur "Traiter la préparation WMS"
     * → On appelle le Suitelet de création des Item Fulfillments (SO)
     */
    function cdeWmsProcessPrep(inboundId) {
        if (!inboundId) {
            alert("Inbound ID manquant.");
            return;
        }

        var url = '/app/site/hosting/scriptlet.nl?script=979&deploy=1&inboundId=' + inboundId;
        window.location.href = url;
    }

    /**
     * Appelé lorsque l'utilisateur clique sur "Traiter la réception WMS"
     * → On appelle le Suitelet de création des Item Receipts (PO)
     */
    function cdeWmsProcessReceipt(inboundId) {
        if (!inboundId) {
            alert("Inbound ID manquant.");
            return;
        }

        var url = '/app/site/hosting/scriptlet.nl?script=981&deploy=1&inboundId=' + inboundId;
        window.location.href = url;
    }

    return {
        cdeWmsProcessPrep: cdeWmsProcessPrep,
        cdeWmsProcessReceipt: cdeWmsProcessReceipt
    };
});
