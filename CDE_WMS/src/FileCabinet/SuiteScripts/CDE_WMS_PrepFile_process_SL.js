/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/search', 'N/record', 'N/log'], function (search, record, log) {

    var REC_PREP_LINE = 'customrecord_cde_wms_prep_line';

    // Adapter ces IDs à ta liste WMS Line Status
    var LINE_STATUS = {
        NEW:   '1',
        ERROR: '2',
        DONE:  '3'   // à créer dans ta liste si pas encore présent
    };

    function findInventoryNumberId(itemId, lotNumber) {
        if (!itemId || !lotNumber) return null;

        var invSearch = search.create({
            type: 'inventorynumber',
            filters: [
                ['item', 'anyof', itemId],
                'AND',
                ['inventorynumber', 'is', lotNumber]
            ],
            columns: ['internalid']
        });

        var res = invSearch.run().getRange({ start: 0, end: 1 });
        return (res && res.length > 0) ? res[0].id : null;
    }

    function onRequest(context) {
        var request = context.request;
        var response = context.response;

        var inboundId = request.parameters.inboundId;
        if (!inboundId) {
            response.write('Paramètre inboundId manquant.');
            return;
        }

        log.audit('WMS PREP PROCESS - start', { inboundId: inboundId });

        // 1) Récupérer les lignes de préparation NON en erreur pour ce fichier
        var linesBySo = {}; // soId -> [obj lignes]
        var totalLines = 0;

        var lineSearch = search.create({
            type: REC_PREP_LINE,
            filters: [
                ['custrecordwms_prep_parent_file', 'anyof', inboundId],
                'AND',
                ['custrecord_wms_line_status', 'anyof', LINE_STATUS.NEW]
            ],
            columns: [
                'internalid',
                'custrecordwms_transaction',
                'custrecord_wms_item',
                'custrecord_wms_lot_number',
                'custrecord_wms_quantity'
            ]
        });

        lineSearch.run().each(function (res) {
            var prepLineId = res.getValue({ name: 'internalid' });

            var soId      = res.getValue({ name: 'custrecordwms_transaction' });
            var itemId    = res.getValue({ name: 'custrecord_wms_item' });
            var lotNumber = res.getValue({ name: 'custrecord_wms_lot_number' });
            var qtyRaw    = res.getValue({ name: 'custrecord_wms_quantity' });

            var qty = qtyRaw ? parseFloat(qtyRaw) : 0;

            if (!soId || !itemId || !qty) {
                // si info critique manquante, on passe la ligne en erreur
                var msg = 'Données insuffisantes (soId=' + soId + ', itemId=' + itemId + ', qty=' + qty + ')';

                log.error('WMS PREP PROCESS - missing data', {
                    prepLineId: prepLineId,
                    message: msg
                });

                record.submitFields({
                    type: REC_PREP_LINE,
                    id: prepLineId,
                    values: {
                        custrecord_wms_line_status: LINE_STATUS.ERROR,
                        custrecord_wms_error_mess: msg
                    },
                    options: { ignoreMandatoryFields: true }
                });

                return true; // continuer la boucle search
            }

            if (!linesBySo[soId]) {
                linesBySo[soId] = [];
            }

            linesBySo[soId].push({
                prepLineId: prepLineId,
                itemId: itemId,
                lotNumber: lotNumber,
                qty: qty
            });

            totalLines++;
            return true;
        });

        log.audit('WMS PREP PROCESS - lines loaded', {
            inboundId: inboundId,
            soCount: Object.keys(linesBySo).length,
            totalLines: totalLines
        });

        if (totalLines === 0) {
            response.write('Aucune ligne NEW à traiter pour ce fichier.');
            return;
        }

        var createdIFs = [];
        var errors     = [];

        // 2) Pour chaque Sales Order, créer un Item Fulfillment
        Object.keys(linesBySo).forEach(function (soId) {
            var soLines = linesBySo[soId];

            try {
                // ---- Charger le SO pour récupérer la location ----
                var soRec = record.load({
                    type: record.Type.SALES_ORDER,
                    id: soId
                });

                var soLocation = soRec.getValue({ fieldId: 'location' });
                var soTranId   = soRec.getValue({ fieldId: 'tranid' });

                if (!soLocation) {
                    throw new Error(
                        'Aucune location définie sur la commande client ' +
                        soTranId + ' (id ' + soId + '). Impossible de créer le fulfilment.'
                    );
                }

                log.audit('WMS PREP PROCESS - transform SO', { soId: soId });

                var ifRec = record.transform({
                    fromType: record.Type.SALES_ORDER,
                    fromId:   soId,
                    toType:   record.Type.ITEM_FULFILLMENT,
                    isDynamic: true
                });

                // Si la location n’est pas renseignée sur l’IF, on force celle du SO
                var ifLocation = ifRec.getValue({ fieldId: 'location' });
                if (!ifLocation) {
                    ifRec.setValue({
                        fieldId: 'location',
                        value: soLocation
                    });
                }

                // ---- Agrégation par Article + Lot ----
                var grouped = {}; // key = itemId|lot
                soLines.forEach(function (l) {
                    var key = l.itemId + '|' + (l.lotNumber || '');
                    if (!grouped[key]) {
                        grouped[key] = {
                            itemId: l.itemId,
                            lotNumber: l.lotNumber || '',
                            qty: 0,
                            prepLines: []
                        };
                    }
                    grouped[key].qty += l.qty;
                    grouped[key].prepLines.push(l.prepLineId);
                });

                var lineCount = ifRec.getLineCount({ sublistId: 'item' });

                // Pour chaque groupe (item + lot), on cherche la ligne correspondante dans l'IF
                Object.keys(grouped).forEach(function (key) {
                    var g = grouped[key];

                    for (var i = 0; i < lineCount; i++) {
                        var currItemId = ifRec.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'item',
                            line: i
                        });

                        if (String(currItemId) !== String(g.itemId)) {
                            continue;
                        }

                        // On a trouvé une ligne d'IF pour cet article
                        ifRec.selectLine({
                            sublistId: 'item',
                            line: i
                        });

                        // Marquer la ligne à expédier
                        ifRec.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'itemreceive',
                            value: true
                        });

                        ifRec.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'quantity',
                            value: g.qty
                        });

                        // Gestion du lot si présent
                        if (g.lotNumber) {
                            try {
                                var invDetail = ifRec.getCurrentSublistSubrecord({
                                    sublistId: 'item',
                                    fieldId: 'inventorydetail'
                                });

                                var lotId = findInventoryNumberId(g.itemId, g.lotNumber);

                                if (!lotId) {
                                    log.error('WMS PREP PROCESS - lot introuvable', {
                                        soId: soId,
                                        itemId: g.itemId,
                                        lotNumber: g.lotNumber
                                    });
                                } else {
                                    invDetail.selectNewLine({
                                        sublistId: 'inventoryassignment'
                                    });
                                    invDetail.setCurrentSublistValue({
                                        sublistId: 'inventoryassignment',
                                        fieldId: 'issueinventorynumber',
                                        value: lotId
                                    });
                                    invDetail.setCurrentSublistValue({
                                        sublistId: 'inventoryassignment',
                                        fieldId: 'quantity',
                                        value: g.qty
                                    });
                                    invDetail.commitLine({
                                        sublistId: 'inventoryassignment'
                                    });
                                }
                            } catch (eInv) {
                                log.error('WMS PREP PROCESS - inventorydetail error', {
                                    soId: soId,
                                    itemId: g.itemId,
                                    lotNumber: g.lotNumber,
                                    error: eInv.message
                                });
                            }
                        }

                        ifRec.commitLine({
                            sublistId: 'item'
                        });

                        break; // on arrête dès qu'on a trouvé une ligne pour cet article
                    }
                });

                var ifId = ifRec.save({
                    enableSourcing: true,
                    ignoreMandatoryFields: false
                });

                createdIFs.push(ifId);

                // 3) Mettre à jour les lignes WMS comme DONE
                Object.keys(grouped).forEach(function (key) {
                    var g = grouped[key];
                    g.prepLines.forEach(function (prepId) {
                        record.submitFields({
                            type: REC_PREP_LINE,
                            id: prepId,
                            values: {
                                custrecord_wms_line_status: LINE_STATUS.DONE
                            },
                            options: { ignoreMandatoryFields: true }
                        });
                    });
                });

                log.audit('WMS PREP PROCESS - IF created', {
                    soId: soId,
                    ifId: ifId
                });

            } catch (e) {
                log.error('WMS PREP PROCESS - error for SO', {
                    soId: soId,
                    error: e.message,
                    stack: e.stack
                });

                errors.push({
                    soId: soId,
                    message: e.message
                });
            }
        });

        // 4) Résumé dans la réponse (simple)
        var msg = 'Item Fulfillments créés : ' + (createdIFs.join(', ') || 'aucun') +
                  '. Erreurs : ' + (errors.length ? JSON.stringify(errors) : 'aucune');

        log.audit('WMS PREP PROCESS - end', {
            inboundId: inboundId,
            createdIFs: createdIFs,
            errors: errors
        });

        response.write(msg);
    }

    return {
        onRequest: onRequest
    };
});
