/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define([], function () {

    /**
     * Entry point requis par NetSuite pour considérer le fichier comme un vrai Client Script.
     * Même si on ne l'utilise pas, il doit exister.
     */
    function pageInit(context) {
        // no-op
    }

    /**
     * Appelé lorsque l'utilisateur clique sur "Traiter la préparation WMS"
     * → On appelle le Suitelet de création des Item Fulfillments (SO)
     */
    function cdeWmsProcessPrep(inboundId) {
        if (!inboundId) {
            alert("Inbound ID manquant.");
            return;
        }

        var url = '/app/site/hosting/scriptlet.nl?script=654&deploy=1&inboundId=' + inboundId;
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

        var url = '/app/site/hosting/scriptlet.nl?script=653&deploy=1&inboundId=' + inboundId;
        window.location.href = url;
    }

    return {
        pageInit: pageInit,
        cdeWmsProcessPrep: cdeWmsProcessPrep,
        cdeWmsProcessReceipt: cdeWmsProcessReceipt
    };
});
