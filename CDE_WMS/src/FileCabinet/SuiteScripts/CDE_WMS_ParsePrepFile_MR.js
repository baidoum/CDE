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
    var INBOUND_TOPIC = {
        PREPARATION_RETURN: '1'
    };

    // ⚠️ Adapte ces IDs aux valeurs de ta liste WMS Line Status
    var LINE_STATUS = {
        NEW:   '1',
        ERROR: '2'
    };

    /**
     * Index (0-based) des colonnes dans le fichier de retour préparation
     * D’après ta spec :
     *  - OrderNumber  = col C  -> index 2
     *  - ItemNumber   = col AJ -> index 35
     *  - OrderedQty   = col AK -> index 36
     *  - LotNumber    = col BO -> index 66
     */
    var COL_INDEX = {
        ORDER_NUMBER:  2,   
        ITEM_NUMBER:   4,  
        ORDERED_QTY:   19,  
        LOT_NUMBER:    8   
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

    // ---- getInputData : sélection des fichiers inbound à parser ----

    function getInputData() {
        log.audit('PARSE PREP FILE - getInputData', 'Start');

        var inboundSearch = search.create({
            type: REC_INBOUND_FILE,
            filters: [
                ['custrecord_wms_in_status', 'anyof', INBOUND_STATUS.NEW],
                'AND',
                ['custrecord_wms_in_topic', 'anyof', INBOUND_TOPIC.PREPARATION_RETURN]
            ],
            columns: [
                'internalid',
                'custrecord_wms_in_file'
            ]
        });

        return inboundSearch;
    }

    // ---- map : parse un fichier inbound et crée les lignes de préparation ----

    function map(context) {
        var searchResult = JSON.parse(context.value);
        var inboundId = searchResult.id;
        var fileField = searchResult.values['custrecord_wms_in_file'];
        var fileId = fileField && fileField.value;

        log.audit('PARSE PREP FILE - MAP start', {
            inboundId: inboundId,
            fileId: fileId
        });

        if (!fileId) {
            log.error('PARSE PREP FILE - MAP', 'Aucun fichier associé au inbound ' + inboundId);
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

        // Idempotence : si des lignes existent déjà pour ce fichier, on ne refait rien
        if (prepLinesExistForInbound(inboundId)) {
            log.audit('PARSE PREP FILE - MAP skip', 'Lignes déjà créées pour inbound ' + inboundId);
            return;
        }

        try {
            var f = file.load({ id: fileId });
            var contents = f.getContents();

            var rows = parseCsvFile(contents);

            log.debug('PARSE PREP FILE - file parsed', {
                inboundId: inboundId,
                fileId: fileId,
                rowCount: rows.length
            });

            if (!rows || !rows.length) {
                log.audit('PARSE PREP FILE - no data rows', 'Aucune ligne de données pour inbound ' + inboundId);
            }

            var createdCount = 0;
            var errorCount = 0;

            rows.forEach(function (cols, idx) {
                var orderNumber   = (cols[COL_INDEX.ORDER_NUMBER]  || '').trim();
                var itemNumber    = (cols[COL_INDEX.ITEM_NUMBER]   || '').trim();
                var orderedQtyRaw = (cols[COL_INDEX.ORDERED_QTY]   || '').trim();
                var lotNumber     = (cols[COL_INDEX.LOT_NUMBER]    || '').trim();

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

                if (!orderNumber) {
                    errorMsg = 'OrderNumber manquant';
                } else {
                    soId = findSalesOrder(orderNumber);
                    if (!soId) {
                        errorMsg = 'Sales Order introuvable pour OrderNumber = ' + orderNumber;
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

                if (soId) {
                    prepRec.setValue({
                        fieldId: 'custrecordwms_transaction',
                        value: soId
                    });
                }

                if (itemNumber) {
                    prepRec.setValue({
                        fieldId: 'custrecord_wms_item',
                        value: itemNumber
                    });
                }

                if (lotNumber) {
                    prepRec.setValue({
                        fieldId: 'custrecord_wms_lot_number',
                        value: lotNumber
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
                        fieldId: 'custrecord_wms__line_status',
                        value: LINE_STATUS.ERROR
                    });
                    prepRec.setValue({
                        fieldId: 'custrecord_wms_error_mess',
                        value: errorMsg
                    });
                    errorCount++;
                } else {
                    prepRec.setValue({
                        fieldId: 'custrecord_wms__line_status',
                        value: LINE_STATUS.NEW
                    });
                }

                var prepId = prepRec.save();
                createdCount++;

                if (createdCount <= 5) { // pour ne pas spammer les logs
                    log.debug('PARSE PREP FILE - line created', {
                        inboundId: inboundId,
                        lineIndex: idx,
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

            log.audit('PARSE PREP FILE - MAP end', {
                inboundId: inboundId,
                fileId: fileId,
                createdLines: createdCount,
                errorLines: errorCount
            });

        } catch (e) {
            log.error('PARSE PREP FILE - MAP fatal error', {
                inboundId: inboundId,
                fileId: fileId,
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
        log.audit('PARSE PREP FILE - summarize', {
            usage: summary.usage,
            concurrency: summary.concurrency,
            yields: summary.yields
        });

        summary.mapSummary.errors.iterator().each(function (key, error) {
            log.error('PARSE PREP FILE - map error', {
                key: key,
                error: error
            });
            return true;
        });

        summary.reduceSummary.errors.iterator().each(function (key, error) {
            log.error('PARSE PREP FILE - reduce error', {
                key: key,
                error: error
            });
            return true;
        });

        log.audit('PARSE PREP FILE', 'Terminé');
    }

    return {
        getInputData: getInputData,
        map: map,
        reduce: reduce,
        summarize: summarize
    };
});
