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

    /**
     * Retourne l'internalid de inventorynumber pour un couple (item, lot)
     */
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
        if (res && res.length > 0) {
            return res[0].id;
        }
        return null;
    }

    function onRequest(context) {
        var request = context.request;
        var response = context.response;

        var inboundId = request.parameters.inboundId;
        if (!inboundId) {
            response.write('Paramètre inboundId manquant.');
            return;
        }

        log.audit('WMS RECEIPT PROCESS - start', { inboundId: inboundId });

        // 1) Récupérer les lignes de préparation NON en erreur pour ce fichier
        var linesByPo = {}; // poId -> [obj lignes]
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
                'custrecordwms_transaction',     // PO
                'custrecord_wms_item',          // item internalid
                'custrecord_wms_lot_number',    // lot
                'custrecord_wms_quantity'       // qty
            ]
        });

        lineSearch.run().each(function (res) {
            var prepLineId = res.getValue({ name: 'internalid' });

            var poId      = res.getValue({ name: 'custrecordwms_transaction' });
            var itemId    = res.getValue({ name: 'custrecord_wms_item' });
            var lotNumber = res.getValue({ name: 'custrecord_wms_lot_number' });
            var qtyRaw    = res.getValue({ name: 'custrecord_wms_quantity' });

            var qty = qtyRaw ? parseFloat(qtyRaw) : 0;

            if (!poId || !itemId || !qty) {
                // si info critique manquante, on passe la ligne en erreur
                var msg = 'Données insuffisantes (poId=' + poId + ', itemId=' + itemId + ', qty=' + qty + ')';

                log.error('WMS RECEIPT PROCESS - missing data', {
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

            if (!linesByPo[poId]) {
                linesByPo[poId] = [];
            }

            linesByPo[poId].push({
                prepLineId: prepLineId,
                itemId: itemId,
                lotNumber: lotNumber || '',
                qty: qty
            });

            totalLines++;
            return true;
        });

        log.audit('WMS RECEIPT PROCESS - lines loaded', {
            inboundId: inboundId,
            poCount: Object.keys(linesByPo).length,
            totalLines: totalLines
        });

        if (totalLines === 0) {
            response.write('Aucune ligne NEW à traiter pour ce fichier (PO).');
            return;
        }

        var createdIRs = [];
        var errors = [];

        // 2) Pour chaque Purchase Order, créer un Item Receipt
        Object.keys(linesByPo).forEach(function (poId) {
            var poLines = linesByPo[poId];

            try {
                log.audit('WMS RECEIPT PROCESS - transform PO', { poId: poId });

                // Charger le PO pour récupérer la location
                var poRec = record.load({
                    type: record.Type.PURCHASE_ORDER,
                    id: poId
                });
                var poLocation = poRec.getValue({ fieldId: 'location' });
                var poTranId   = poRec.getValue({ fieldId: 'tranid' });

                if (!poLocation) {
                    throw new Error('Aucune location définie sur la commande achat ' + poTranId +
                        ' (id ' + poId + '). Impossible de créer la réception.');
                }

                var irRec = record.transform({
                    fromType: record.Type.PURCHASE_ORDER,
                    fromId: poId,
                    toType: record.Type.ITEM_RECEIPT,
                    isDynamic: true
                });

                // S’assurer que la location est bien positionnée sur l’Item Receipt
                var irLocation = irRec.getValue({ fieldId: 'location' });
                if (!irLocation) {
                    irRec.setValue({
                        fieldId: 'location',
                        value: poLocation
                    });
                }

                // Agrégation par Article + Lot
                var grouped = {}; // key = itemId|lot
                poLines.forEach(function (l) {
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

                var lineCount = irRec.getLineCount({ sublistId: 'item' });

                // Pour chaque groupe (item + lot), on cherche la ligne correspondante dans l'IR
                Object.keys(grouped).forEach(function (key) {
                    var g = grouped[key];

                    for (var i = 0; i < lineCount; i++) {
                        var currItemId = irRec.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'item',
                            line: i
                        });

                        if (String(currItemId) !== String(g.itemId)) {
                            continue;
                        }

                        // On a trouvé une ligne d'IR pour cet article
                        irRec.selectLine({
                            sublistId: 'item',
                            line: i
                        });

                        // Marquer la ligne à réceptionner
                        irRec.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'itemreceive',
                            value: true
                        });

                        irRec.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'quantity',
                            value: g.qty
                        });

                        // Gestion du lot si présent
                        if (g.lotNumber) {
                            try {
                                var invDetail = irRec.getCurrentSublistSubrecord({
                                    sublistId: 'item',
                                    fieldId: 'inventorydetail'
                                });

                                var lotId = findInventoryNumberId(g.itemId, g.lotNumber);

                                if (!lotId) {
                                    log.error('WMS RECEIPT PROCESS - lot introuvable', {
                                        poId: poId,
                                        itemId: g.itemId,
                                        lotNumber: g.lotNumber
                                    });
                                } else {
                                    invDetail.selectNewLine({
                                        sublistId: 'inventoryassignment'
                                    });
                                    invDetail.setCurrentSublistValue({
                                        sublistId: 'inventoryassignment',
                                        fieldId: 'receiptinventorynumber', // différent de l’IF
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
                                log.error('WMS RECEIPT PROCESS - inventorydetail error', {
                                    poId: poId,
                                    itemId: g.itemId,
                                    lotNumber: g.lotNumber,
                                    error: eInv.message
                                });
                            }
                        }

                        irRec.commitLine({
                            sublistId: 'item'
                        });

                        break; // on arrête dès qu'on a trouvé une ligne pour cet article
                    }
                });

                var irId = irRec.save({
                    enableSourcing: true,
                    ignoreMandatoryFields: false
                });

                createdIRs.push(irId);

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

                log.audit('WMS RECEIPT PROCESS - IR created', {
                    poId: poId,
                    irId: irId
                });

            } catch (e) {
                log.error('WMS RECEIPT PROCESS - error for PO', {
                    poId: poId,
                    error: e.message,
                    stack: e.stack
                });

                errors.push({
                    poId: poId,
                    message: e.message
                });
            }
        });

        // 4) Résumé dans la réponse
        var msg = 'Item Receipts créés : ' + (createdIRs.join(', ') || 'aucun') +
                  '. Erreurs : ' + (errors.length ? JSON.stringify(errors) : 'aucune');

        log.audit('WMS RECEIPT PROCESS - end', {
            inboundId: inboundId,
            createdIRs: createdIRs,
            errors: errors
        });

        response.write(msg);
    }

    return {
        onRequest: onRequest
    };
});
