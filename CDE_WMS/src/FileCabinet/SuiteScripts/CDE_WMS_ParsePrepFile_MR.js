/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/search', 'N/record', 'N/file', 'N/log'], function (search, record, file, log) {

    // ---- Constantes pour les custom records / statuts ----

    var REC_INBOUND_FILE = 'customrecord_cde_wms_inbound';
    var REC_PREP_LINE    = 'customrecord_cde_wms_prep_line';

    // ⚠️ Adapte ces IDs aux valeurs de ta liste WMS Inbound Status
    var INBOUND_STATUS = {
        NEW:   '1',
        DONE:  '3',
        ERROR: '4'
    };

    // ⚠️ Adapte ces IDs aux valeurs de ta liste WMS Inbound Topic
    // Exemple :
    //  - 1 = retour préparation
    //  - 2 = retour réception
    var INBOUND_TOPIC = {
        PREPARATION_RETURN: '1',
        RECEPTION_RETURN:   '2'  // <-- à adapter à la réalité de ta liste
    };

    // ⚠️ Adapte ces IDs aux valeurs de ta liste WMS Line Status
    var LINE_STATUS = {
        NEW:   '1',
        ERROR: '2'
    };

    /**
     * Index (0-based) des colonnes dans les fichiers
     * On définit un mapping par type de fichier WMS.
     */
    var COL_INDEX = {

        // === Retour préparation ===
        PREPARATION: {

            ORDER_NUMBER:  2,   
            ITEM_NUMBER:   4,  
            ORDERED_QTY:   19,  
            LOT_NUMBER:    8,
            LINE_NUMBER_ERP:3   
        },

        // === Retour réception ===
        // À adapter en fonction de ton analyse des fichiers réception :
        // mets ici les indexes réels des colonnes correspondant à :
        //  - Numéro de commande (PO ou SO selon le cas)
        //  - Code article
        //  - Quantité
        //  - Lot (si fourni)
        RECEPTION: {
            ORDER_NUMBER:  2,   
            ITEM_NUMBER:   4, 
            ORDERED_QTY:   15,  
            LOT_NUMBER:    8,
            LINE_NUMBER_ERP: 38 
        }
    };

    // ---- Helpers ----

    function prepLinesExistForInbound(inboundId) {
        var s = search.create({
            type: REC_PREP_LINE,
            filters: [
                ['custrecordwms_prep_parent_file', 'anyof', inboundId]
            ],
            columns: ['internalid']
        });

        var res = s.run().getRange({ start: 0, end: 1 });
        return res && res.length > 0;
    }

    function findSalesOrder(orderNumber) {
        if (!orderNumber) return null;

        var s = search.create({
            type: search.Type.SALES_ORDER,
            filters: [
                ['tranid', 'is', orderNumber]
            ],
            columns: ['internalid']
        });

        var res = s.run().getRange({ start: 0, end: 1 });
        if (res && res.length > 0) {
            return res[0].id;
        }
        return null;
    }

    function findPurchaseOrder(orderNumber) {
    if (!orderNumber) return null;

    var s = search.create({
        type: search.Type.PURCHASE_ORDER,
        filters: [
            ['tranid', 'is', orderNumber]
        ],
        columns: ['internalid']
    });

    var res = s.run().getRange({ start: 0, end: 1 });
    if (res && res.length > 0) {
        return res[0].id;
    }
    return null;
    }


    function findItemByCode(itemNumber) {
        if (!itemNumber) return null;

        var code = String(itemNumber).trim();
            if (!code) return null;

            var itemSearch = search.create({
                type: search.Type.ITEM,
                filters: [
                    ['itemid', 'is', code]
                ],
                columns: ['internalid']
            });

            var res = itemSearch.run().getRange({ start: 0, end: 1 });

            if (res && res.length > 0) {
                return res[0].id;  // Internal ID de l'article
            }

        return null;
    }


    /**
     * Parse un fichier CSV séparé par ';'
     * - première ligne = header (ignorée)
     * - lignes suivantes = données, sous forme d'array de colonnes
     */
    function parseCsvFile(contents) {
        var lines = contents.split(/\r?\n/);

        // enlever lignes vides
        lines = lines.filter(function (l) {
            return l && l.trim().length > 0;
        });

        // au moins 2 lignes : header + 1 data
        if (!lines || lines.length < 2) {
            return [];
        }

        var rows = [];

        // on commence à 1 pour skipper le header
        for (var i = 1; i < lines.length; i++) {
            var line = lines[i];
            if (!line || !line.trim()) continue;

            var cols = line.split(';').map(function (val) {
                if (!val) return '';
                // on enlève les guillemets éventuels + trim
                return val.replace(/^"+|"+$/g, '').trim();
            });

            rows.push(cols);
        }

        return rows; // array de arrays
    }

    /**
     * Récupère le mapping de colonnes en fonction du topic du fichier
     */
    function getColumnMappingForTopic(topicId) {
        if (topicId === INBOUND_TOPIC.PREPARATION_RETURN) {
            return COL_INDEX.PREPARATION;
        }
        if (topicId === INBOUND_TOPIC.RECEPTION_RETURN) {
            return COL_INDEX.RECEPTION;
        }
        return null;
    }

    // ---- getInputData : sélection des fichiers inbound à parser ----

    function getInputData() {
        log.audit('PARSE WMS FILE - getInputData', 'Start');

        var inboundSearch = search.create({
            type: REC_INBOUND_FILE,
            filters: [
                ['custrecord_wms_in_status', 'anyof', INBOUND_STATUS.NEW],
                'AND',
                [
                    ['custrecord_wms_in_topic', 'anyof', INBOUND_TOPIC.PREPARATION_RETURN],
                    'OR',
                    ['custrecord_wms_in_topic', 'anyof', INBOUND_TOPIC.RECEPTION_RETURN]
                ]
            ],
            columns: [
                'internalid',
                'custrecord_wms_in_file',
                'custrecord_wms_in_topic'
            ]
        });

        return inboundSearch;
    }

    // ---- map : parse un fichier inbound et crée les lignes de préparation ----

    function map(context) {
        var searchResult = JSON.parse(context.value);
        var inboundId = searchResult.id;
        var fileField = searchResult.values['custrecord_wms_in_file'];
        var topicField = searchResult.values['custrecord_wms_in_topic'];

        var fileId  = fileField && fileField.value;
        var topicId = topicField && topicField.value;

        log.audit('PARSE WMS FILE - MAP start', {
            inboundId: inboundId,
            fileId: fileId,
            topicId: topicId
        });

        if (!fileId) {
            log.error('PARSE WMS FILE - MAP', 'Aucun fichier associé au inbound ' + inboundId);
            record.submitFields({
                type: REC_INBOUND_FILE,
                id: inboundId,
                values: {
                    custrecord_wms_in_status: INBOUND_STATUS.ERROR,
                    custrecord_wms_in_error: 'Aucun fichier associé (custrecord_wms_in_file vide)'
                },
                options: { ignoreMandatoryFields: true }
            });
            return;
        }

        var colMap = getColumnMappingForTopic(topicId);
        if (!colMap) {
            log.error('PARSE WMS FILE - MAP', 'Aucun mapping de colonnes pour topic ' + topicId);
            record.submitFields({
                type: REC_INBOUND_FILE,
                id: inboundId,
                values: {
                    custrecord_wms_in_status: INBOUND_STATUS.ERROR,
                    custrecord_wms_in_error: 'Mapping colonnes introuvable pour topic ' + topicId
                },
                options: { ignoreMandatoryFields: true }
            });
            return;
        }

        // Idempotence : si des lignes existent déjà pour ce fichier, on ne refait rien
        if (prepLinesExistForInbound(inboundId)) {
            log.audit('PARSE WMS FILE - MAP skip', 'Lignes déjà créées pour inbound ' + inboundId);
            return;
        }

        try {
            var f = file.load({ id: fileId });
            var contents = f.getContents();

            var rows = parseCsvFile(contents);

            log.debug('PARSE WMS FILE - file parsed', {
                inboundId: inboundId,
                fileId: fileId,
                topicId: topicId,
                rowCount: rows.length
            });

            if (!rows || !rows.length) {
                log.audit('PARSE WMS FILE - no data rows', 'Aucune ligne de données pour inbound ' + inboundId);
            }

            var createdCount = 0;
            var errorCount = 0;

            rows.forEach(function (cols, idx) {

                // sécurité : si la ligne n’a pas assez de colonnes, on log et on passe en erreur
                var minIndex = Math.max(
                    colMap.ORDER_NUMBER,
                    colMap.ITEM_NUMBER,
                    colMap.ORDERED_QTY,
                    colMap.LOT_NUMBER
                );
                if (cols.length <= minIndex) {
                    var errTooShort = 'Ligne ' + idx + ' : nombre de colonnes insuffisant (' + cols.length + ')';
                    log.error('PARSE WMS FILE - row too short', {
                        inboundId: inboundId,
                        lineIndex: idx,
                        colCount: cols.length,
                        requiredMinIndex: minIndex
                    });

                    // On crée quand même une ligne d’erreur pour visibilité
                    var prepErrRec = record.create({
                        type: REC_PREP_LINE,
                        isDynamic: false
                    });

                    prepErrRec.setValue({
                        fieldId: 'custrecordwms_prep_parent_file',
                        value: inboundId
                    });
                    prepErrRec.setValue({
                        fieldId: 'custrecord_wms_line_status',
                        value: LINE_STATUS.ERROR
                    });
                    prepErrRec.setValue({
                        fieldId: 'custrecord_wms_error_mess',
                        value: errTooShort
                    });
                    prepErrRec.save();
                    errorCount++;
                    return;
                }

                var orderNumber   = (cols[colMap.ORDER_NUMBER] || '').trim();
                var itemNumber    = (cols[colMap.ITEM_NUMBER]   || '').trim();
                var orderedQtyRaw = (cols[colMap.ORDERED_QTY]   || '').trim();
                var lotNumber     = (cols[colMap.LOT_NUMBER]    || '').trim();
                var lineNumberERP = (cols[colMap.LINE_NUMBER_ERP]    || '').trim();

                // ignore lignes totalement vides
                if (!orderNumber && !itemNumber && !lotNumber) {
                    return;
                }

                var qty = null;
                if (orderedQtyRaw) {
                    var q = parseFloat(orderedQtyRaw.replace(',', '.'));
                    qty = isFinite(q) ? q : null;
                }

                var soId = null;
                var errorMsg = '';

                // Pour l’instant : on cherche toujours un Sales Order par OrderNumber
                // (si plus tard les fichiers réception sont liés à un PO, on fera un findPurchaseOrder() à la place
                if (!orderNumber) {
                    errorMsg = 'OrderNumber manquant';
                } else {
                    if (topicId === INBOUND_TOPIC.PREPARATION_RETURN) {
                    // Fichier de retour préparation → on cherche une Sales Order
                    transactionId = findSalesOrder(orderNumber);
                        if (!transactionId) {
                            errorMsg = 'Sales Order introuvable pour OrderNumber = ' + orderNumber;
                        }
                    } else if (topicId === INBOUND_TOPIC.RECEPTION_RETURN) {
                    // Fichier d’attendu / réception → on cherche une Purchase Order
                    transactionId = findPurchaseOrder(orderNumber);
                        if (!transactionId) {
                            errorMsg = 'Purchase Order introuvable pour OrderNumber = ' + orderNumber;
                        }
                    }
                }

                var prepRec = record.create({
                    type: REC_PREP_LINE,
                    isDynamic: false
                });

                prepRec.setValue({
                    fieldId: 'custrecordwms_prep_parent_file',
                    value: inboundId
                });

                if (orderNumber) {
                    prepRec.setValue({
                        fieldId: 'custrecord_wms_prep_order_no',
                        value: orderNumber
                    });
                }

                if (transactionId) {
                    prepRec.setValue({
                        fieldId: 'custrecordwms_transaction',
                        value: transactionId
                    });
                }

                var itemInternalId = null;

                if (itemNumber) {
                    itemInternalId = findItemByCode(itemNumber);

                    if (itemInternalId) {
                        // On stocke correctement l’article en sélectionnant la fiche article
                        prepRec.setValue({
                            fieldId: 'custrecord_wms_item',
                            value: itemInternalId
                        });
                    } else {
                        // L’article n'existe pas → ligne en erreur
                        errorMsg = 'Article introuvable : ' + itemNumber;
                    }
                }


                if (lotNumber) {
                    prepRec.setValue({
                        fieldId: 'custrecord_wms_lot_number',
                        value: lotNumber
                    });
                }

                if (lineNumberERP) {
                    prepRec.setValue({
                        fieldId: 'custrecord_wms_linenumber',
                        value: lineNumberERP
                    });
                }

                if (qty !== null) {
                    prepRec.setValue({
                        fieldId: 'custrecord_wms_quantity',
                        value: qty
                    });
                }

                if (errorMsg) {
                    prepRec.setValue({
                        fieldId: 'custrecord_wms_line_status',
                        value: LINE_STATUS.ERROR
                    });
                    prepRec.setValue({
                        fieldId: 'custrecord_wms_error_mess',
                        value: errorMsg
                    });
                    errorCount++;
                } else {
                    prepRec.setValue({
                        fieldId: 'custrecord_wms_line_status',
                        value: LINE_STATUS.NEW
                    });
                }

                var prepId = prepRec.save();
                createdCount++;

                if (createdCount <= 5) { // pour ne pas spammer les logs
                    log.debug('PARSE WMS FILE - line created', {
                        inboundId: inboundId,
                        lineIndex: idx,
                        topicId: topicId,
                        prepLineId: prepId,
                        orderNumber: orderNumber,
                        soId: soId,
                        itemNumber: itemNumber,
                        lotNumber: lotNumber,
                        qty: qty
                    });
                }
            });

            // Mise à jour du statut du fichier inbound
            record.submitFields({
                type: REC_INBOUND_FILE,
                id: inboundId,
                values: {
                    custrecord_wms_in_status: INBOUND_STATUS.DONE
                },
                options: { ignoreMandatoryFields: true }
            });

            log.audit('PARSE WMS FILE - MAP end', {
                inboundId: inboundId,
                fileId: fileId,
                topicId: topicId,
                createdLines: createdCount,
                errorLines: errorCount
            });

        } catch (e) {
            log.error('PARSE WMS FILE - MAP fatal error', {
                inboundId: inboundId,
                fileId: fileId,
                topicId: topicId,
                error: e.message,
                stack: e.stack
            });

            record.submitFields({
                type: REC_INBOUND_FILE,
                id: inboundId,
                values: {
                    custrecord_wms_in_status: INBOUND_STATUS.ERROR,
                    custrecord_wms_in_error: e.message || String(e)
                },
                options: { ignoreMandatoryFields: true }
            });
        }
    }

    function reduce(context) {
        // rien à faire ici
    }

    function summarize(summary) {
        log.audit('PARSE WMS FILE - summarize', {
            usage: summary.usage,
            concurrency: summary.concurrency,
            yields: summary.yields
        });

        summary.mapSummary.errors.iterator().each(function (key, error) {
            log.error('PARSE WMS FILE - map error', {
                key: key,
                error: error
            });
            return true;
        });

        summary.reduceSummary.errors.iterator().each(function (key, error) {
            log.error('PARSE WMS FILE - reduce error', {
                key: key,
                error: error
            });
            return true;
        });

        log.audit('PARSE WMS FILE', 'Terminé');
    }

    return {
        getInputData: getInputData,
        map: map,
        reduce: reduce,
        summarize: summarize
    };
});
