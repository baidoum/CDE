/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 *
 * Export des Purchase Orders vers le WMS.
 * - Lit la file customrecord_cde_item_sync_queue (topic = PURCHASE_ORDER, status = READY)
 * - Charge chaque PO
 * - Génère une ligne par ligne de PO, éclatée par lot si inventaire détaillé
 * - Crée un fichier texte (.txt) dans le File Cabinet
 * - Lie le fichier à chaque enregistrement de queue traité (champ custrecord_sync_file)
 * - Met à jour les statuts (READY → IN_PROGRESS → SENT / ERROR)
 */
define([
    'N/search',
    'N/record',
    'N/runtime',
    'N/log',
    'N/file',
    './CDE_WMS_QueueUtil',
    './CDE_WMS_FileHeader',
    './CDE_WMS_SFTPUtil'
], function (search, record, runtime, log, file, QueueUtil, FileHeader, SFTPUtil) {

    // ---------------- getInputData ----------------

    function getInputData() {
        log.audit('POExportMR.getInputData', 'Start');

        return search.create({
            type: 'customrecord_cde_item_sync_queue',
            filters: [
                ['custrecord_sync_status', 'is', QueueUtil.STATUS.READY],
                'AND',
                ['custrecord_sync_topic', 'is', QueueUtil.TOPIC.PURCHASE_ORDER]
            ],
            columns: [
                search.createColumn({ name: 'internalid' }),
                search.createColumn({ name: 'custrecord_sync_record_id' }),
                search.createColumn({ name: 'custrecord_sync_record_type' })
            ]
        });
    }

    // ---------------- map ----------------
    // 1 queueId = 1 key = 1 reduce = 1 fichier

    function map(context) {
        try {
            var result = JSON.parse(context.value);
            var values = result.values || {};
            var queueId = result.id;

            var recordIdTxt = values.custrecord_sync_record_id;
            var recordType  = values.custrecord_sync_record_type;

            var finalPoId = recordIdTxt;

            log.debug('MAP queue line', {
                queueId: queueId,
                poId: finalPoId,
                recordIdTxt: recordIdTxt,
                recordType: recordType
            });

            // statut → IN_PROGRESS
            record.submitFields({
                type: 'customrecord_cde_item_sync_queue',
                id: queueId,
                values: {
                    custrecord_sync_status: QueueUtil.STATUS.IN_PROGRESS
                },
                options: { enableSourcing: false, ignoreMandatoryFields: true }
            });

            if (!finalPoId) {
                log.error('MAP - no Purchase Order id', { queueId: queueId });
                markQueueStatus(queueId, QueueUtil.STATUS.ERROR, 'MAP: missing Purchase Order id');
                return;
            }

            context.write({
                key: queueId, // <--- CHANGEMENT : clé = queueId (et plus topic)
                value: JSON.stringify({
                    queueId: queueId,
                    poId: finalPoId,
                    recordType: recordType || record.Type.PURCHASE_ORDER,
                    topic: QueueUtil.TOPIC.PURCHASE_ORDER
                })
            });

        } catch (e) {
            log.error('MAP ERROR', { error: e.message, stack: e.stack, raw: context.value });
        }
    }

    // ---------------- reduce ----------------
    // 1 reduce = 1 queueId = 1 PO = 1 fichier

    function reduce(context) {
        var queueKey = context.key;
        log.audit('REDUCE start', { queueKey: queueKey });

        // Pour ce MR, on sait que c’est de l’export PO
        var topic = QueueUtil.TOPIC.PURCHASE_ORDER;

        var headerCols;
        try {
            headerCols = FileHeader.getHeaderColumns(topic);
        } catch (eHeader) {
            log.error('REDUCE - header error', { topic: topic, error: eHeader.message });

            // On tente de marquer les queues en erreur
            context.values.forEach(function (val) {
                try {
                    var obj = JSON.parse(val);
                    markQueueStatus(obj.queueId, QueueUtil.STATUS.ERROR, 'Header error: ' + eHeader.message);
                } catch (e) {}
            });
            return;
        }

        var sep = ';';
        var lines = [headerCols.join(sep)];

        var queueIdsDone  = [];
        var queueIdsError = [];

        // Normalement une seule value par queueKey, mais on boucle au cas où
        context.values.forEach(function (value) {
            var obj;
            try {
                obj = JSON.parse(value);
            } catch (eParse) {
                log.error('REDUCE - parse value error', { raw: value, error: eParse.message });
                return;
            }

            var queueId    = obj.queueId;
            var poId       = obj.poId;
            var recordType = obj.recordType || record.Type.PURCHASE_ORDER;

            try {
                var poRec = record.load({
                    type: recordType,
                    id: poId
                });

                var poLines = buildLinesForPurchaseOrder(poRec, headerCols, sep);
                lines = lines.concat(poLines);
                queueIdsDone.push(queueId);

            } catch (eLine) {
                log.error('REDUCE - PO/load error', {
                    queueId: queueId,
                    poId: poId,
                    recordType: recordType,
                    error: eLine.message,
                    stack: eLine.stack
                });
                queueIdsError.push(queueId);
                markQueueStatus(queueId, QueueUtil.STATUS.ERROR, 'REDUCE load/build: ' + eLine.message);
            }
        });

        if (lines.length <= 1) {
            log.audit('REDUCE - no data to export', { queueKey: queueKey });
            return;
        }

        var fileContent = lines.join('\n');
        var fileName    = FileHeader.buildFileName(topic);

        var folderId = getOutputFolderId();
        if (!folderId) {
            log.error('REDUCE - no output folder', { param: 'custscript_cde_wms_po_folder' });
            var errMsg = 'No output folder configured';
            queueIdsDone.concat(queueIdsError).forEach(function (id) {
                markQueueStatus(id, QueueUtil.STATUS.ERROR, errMsg);
            });
            return;
        }

        // Centralisation création fichier + SFTP
        var res = SFTPUtil.exportFileAndSend({
            fileName:      fileName,
            fileContent:   fileContent,
            folderId:      folderId,
            queueIdsDone:  queueIdsDone,
            queueIdsError: queueIdsError,
            logPrefix:     'PO EXPORT',
            fileType:      file.Type.CSV
        });

        if (!res.success) {
            log.error('REDUCE - export error', res.message);
            // SFTPUtil gère déjà les statuts, on s'arrête là
            return;
        }
    }

    // ---------------- summarize ----------------

    function summarize(summary) {
        log.audit('SUMMARIZE usage', {
            usage: summary.usage,
            concurrency: summary.concurrency,
            yields: summary.yields
        });

        if (summary.inputSummary.error) {
            log.error('SUMMARIZE input error', summary.inputSummary.error);
        }

        summary.mapSummary.errors.iterator().each(function (key, error) {
            log.error('SUMMARIZE map error', { key: key, error: error });
            return true;
        });

        summary.reduceSummary.errors.iterator().each(function (key, error) {
            log.error('SUMMARIZE reduce error', { key: key, error: error });
            return true;
        });

        log.audit('SUMMARIZE end', 'OK');
    }

    // ---------- Helpers métiers ----------

    function buildLinesForPurchaseOrder(poRec, headerCols, sep) {
        var lines = [];
        var poId = poRec.id || poRec.getValue({ fieldId: 'tranid' });
        var separator = sep || ';';

        var lineCount = poRec.getLineCount({ sublistId: 'item' });
        log.debug('PO Lines', {
            poId: poId,
            lineCount: lineCount
        });

        // ----- Données d'entête (répétées sur chaque ligne) -----
        var headerData = {
            Owner:          'CDE',   
            Site:           'STOCK',                            // Site
            OrderNumber:    poRec.getValue({ fieldId: 'tranid' }) || '',                             // OrderNumber
            OrderDate:      formatDateYYYYMMDD(poRec.getValue({ fieldId: 'trandate' })),             // OrderDate
            DueDate:        formatDateYYYYMMDD(poRec.getValue({ fieldId: 'duedate' })) || formatDateYYYYMMDD(poRec.getValue({ fieldId: 'trandate' })),            // DueDate

            VendorID:       poRec.getValue({ fieldId: 'entity' }) || '',                             // VendorID
            VendorName:     poRec.getText({ fieldId: 'entity' }) || '',                              // Nom fournisseur
            Carrier:        '',                                                                      // à mapper si besoin
            Commentaire:    poRec.getValue({ fieldId: 'memo' }) || '',                               // Commentaire

            SoucheOrderERP: '',                                                                      // à mapper si tu as une souche
            OrderType:      '',                                                                      // Type de bon
            TypeDocument:   'PO',                                                                    // Type document ERP
            NumeroContainer: poRec.getValue({ fieldId: 'custbody_cde_container_no' }) || '',        // custom
            //CAOrderNumberHeader: poRec.getValue({ fieldId: 'tranid' }) || '',                       // CAOrderNumber entête
            VendorOrderNumber:    poRec.getValue({ fieldId: 'otherrefnum' }) || ''                  // Numéro commande fournisseur
        };

        for (var i = 0; i < lineCount; i++) {
            var itemId = poRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'item',
                line: i
            });
            var itemType = poRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'itemtype',
                line: i
            });
            var qty = poRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'quantity',
                line: i
            });

            log.debug('PO line analysis', {
                poId: poId,
                line: i,
                itemId: itemId,
                itemType: itemType,
                quantity: qty
            });

            if (!itemId) {
                continue;
            }

            var itemCode = QueueUtil.getItemCode(itemId);

            var lineNumber = poRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'line',
                line: i
            });

            var itemDisplay = poRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'item_display',
                line: i
            });

            var lineMemo = poRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'memo',
                line: i
            });

            var uom = poRec.getSublistText({
                sublistId: 'item',
                fieldId: 'unit',
                line: i
            });

            var itemDescription = lineMemo || '';
            var itemVariante    = '';

            var invDetail = null;
            var assCount  = 0;
            try {
                invDetail = poRec.getSublistSubrecord({
                    sublistId: 'item',
                    fieldId: 'inventorydetail',
                    line: i
                });
                if (invDetail) {
                    assCount = invDetail.getLineCount({ sublistId: 'inventoryassignment' });
                }
            } catch (e) {
                invDetail = null;
                assCount = 0;
            }

            log.debug('PO line inventory detail', {
                poId: poId,
                line: i,
                hasInvDetail: !!invDetail,
                assCount: assCount
            });

            if (invDetail && assCount > 0) {
                // CAS 1 : avec lots → une ligne par lot
                for (var j = 0; j < assCount; j++) {
                    var lotNumber = invDetail.getSublistText({
                        sublistId: 'inventoryassignment',
                        fieldId: 'receiptinventorynumber',
                        line: j
                    });

                    var lotQty = invDetail.getSublistValue({
                        sublistId: 'inventoryassignment',
                        fieldId: 'quantity',
                        line: j
                    });

                    var lineData = {
                        LineNumber:              lineNumber,
                        ItemNumber:              itemCode,
                        OrderedQuantity:         lotQty,
                        Comment:                 lineMemo,
                        VendorName:              headerData.VendorName,
                        UnitOfMeasure:           uom,
                        SoucheOrderERP:          headerData.SoucheOrderERP,
                        OrderType:               headerData.OrderType,
                        TypeDocument:            headerData.TypeDocument,
                        NumeroContainer:         headerData.NumeroContainer,
                        CAOrderNumberLine:       headerData.CAOrderNumberHeader,
                        CALineNumber:            lineNumber,
                        ReferenceFournisseur:    '',
                        ReferenceExterne:        '',
                        CCOrderNumber:           '',
                        CCLineNumber:            '',
                        ItemSuffixe:             '',
                        ItemDescription:         itemDescription,
                        ItemVariante:            itemVariante,
                        PrixUnitaireNet:         '',
                        SiteERP:                 '',
                        CAOrderNumberHeader:     headerData.CAOrderNumberHeader,
                        VendorShippingOrderNumber: '',
                        VendorShippingLineNumber:  '',
                        CodeSociete:             '',
                        VendorOrderNumber:       headerData.VendorOrderNumber,
                        LotNumber:               lotNumber,
                        LineNumberERP:           lineNumber,
                        Indice:                  '',
                        ExpirationDate:          '',
                        QuantiteUA:              '',
                        RDExtended:              '',
                        CodeDepotERPLine:        '',
                        RDIdControl:             '',
                        Reserve:                 '',
                        RDCertificatRevision:    '',
                        RDCertificatDateReception: ''
                    };

                    var csvLine = buildPOExportLine(headerCols, headerData, lineData, separator);
                    lines.push(csvLine);
                }
            } else {
                // CAS 2 : pas de lots → une ligne par ligne de commande
                var lineDataSingle = {
                    LineNumber:              lineNumber,
                    ItemNumber:              itemDisplay,
                    OrderedQuantity:         qty,
                    Comment:                 lineMemo,
                    VendorName:              headerData.VendorName,
                    UnitOfMeasure:           uom,
                    SoucheOrderERP:          headerData.SoucheOrderERP,
                    OrderType:               headerData.OrderType,
                    TypeDocument:            headerData.TypeDocument,
                    NumeroContainer:         headerData.NumeroContainer,
                    CAOrderNumberLine:       headerData.CAOrderNumberHeader,
                    CALineNumber:            lineNumber,
                    ReferenceFournisseur:    '',
                    ReferenceExterne:        '',
                    CCOrderNumber:           '',
                    CCLineNumber:            '',
                    ItemSuffixe:             '',
                    ItemDescription:         itemDescription,
                    ItemVariante:            itemVariante,
                    PrixUnitaireNet:         '',
                    SiteERP:                 '',
                    CAOrderNumberHeader:     headerData.CAOrderNumberHeader,
                    VendorShippingOrderNumber: '',
                    VendorShippingLineNumber:  '',
                    CodeSociete:             '',
                    VendorOrderNumber:       headerData.VendorOrderNumber,
                    LotNumber:               '',
                    LineNumberERP:           lineNumber,
                    Indice:                  '',
                    ExpirationDate:          '',
                    QuantiteUA:              '',
                    RDExtended:              '',
                    CodeDepotERPLine:        '',
                    RDIdControl:             '',
                    Reserve:                 '',
                    RDCertificatRevision:    '',
                    RDCertificatDateReception: ''
                };

                var csvLineSingle = buildPOExportLine(headerCols, headerData, lineDataSingle, separator);
                lines.push(csvLineSingle);
            }
        }

        log.debug('PO export lines built', {
            poId: poId,
            exportedLines: lines.length
        });

        return lines;
    }

    function buildPOExportLine(headerCols, headerData, lineData, sep) {
        var separator = sep || ';';

        return headerCols.map(function (col) {
            switch (col) {
                case 'Owner':                    return sanitizeValue(headerData.Owner);
                case 'Site':                     return sanitizeValue(headerData.Site);
                case 'OrderNumber':              return sanitizeValue(headerData.OrderNumber);
                case 'OrderDate':                return sanitizeValue(headerData.OrderDate);
                case 'DueDate':                  return sanitizeValue(headerData.DueDate);
                case 'VendorID':                 return sanitizeValue(headerData.VendorID);
                case 'Carrier':                  return sanitizeValue(headerData.Carrier);
                case 'Commentaire':              return sanitizeValue(headerData.Commentaire);

                case 'LineNumber':               return sanitizeValue(lineData.LineNumber);
                case 'ItemNumber':               return sanitizeValue(lineData.ItemNumber);
                case 'OrderedQuantity':          return sanitizeValue(lineData.OrderedQuantity);
                case 'Comment':                 return sanitizeValue(lineData.Comment);
                case 'VendorName':               return sanitizeValue(lineData.VendorName);
                case 'UnitOfMeasure':            return sanitizeValue(lineData.UnitOfMeasure);
                case 'SoucheOrderERP':           return sanitizeValue(lineData.SoucheOrderERP);
                case 'OrderType':                return sanitizeValue(lineData.OrderType);
                case 'TypeDocument':             return sanitizeValue(lineData.TypeDocument);
                case 'NumeroContainer':          return sanitizeValue(lineData.NumeroContainer);
                case 'CAOrderNumberLine':        return sanitizeValue(lineData.CAOrderNumberLine);
                case 'CALineNumber':             return sanitizeValue(lineData.CALineNumber);
                case 'ReferenceFournisseur':     return sanitizeValue(lineData.ReferenceFournisseur);
                case 'ReferenceExterne':         return sanitizeValue(lineData.ReferenceExterne);
                case 'CCOrderNumber':            return sanitizeValue(lineData.CCOrderNumber);
                case 'CCLineNumber':             return sanitizeValue(lineData.CCLineNumber);
                case 'ItemSuffixe':              return sanitizeValue(lineData.ItemSuffixe);
                case 'ItemDescription':          return sanitizeValue(lineData.ItemDescription);
                case 'ItemVariante':             return sanitizeValue(lineData.ItemVariante);
                case 'PrixUnitaireNet':          return sanitizeValue(lineData.PrixUnitaireNet);
                case 'SiteERP':                  return sanitizeValue(lineData.SiteERP);
                case 'CAOrderNumberHeader':      return sanitizeValue(lineData.CAOrderNumberHeader);
                case 'VendorShippingOrderNumber':return sanitizeValue(lineData.VendorShippingOrderNumber);
                case 'VendorShippingLineNumber': return sanitizeValue(lineData.VendorShippingLineNumber);
                case 'CodeSociete':              return sanitizeValue(lineData.CodeSociete);
                case 'VendorOrderNumber':        return sanitizeValue(lineData.VendorOrderNumber);
                case 'LotNumber':                return sanitizeValue(lineData.LotNumber);
                case 'LineNumberERP':            return sanitizeValue(lineData.LineNumberERP);
                case 'Indice':                   return sanitizeValue(lineData.Indice);
                case 'ExpirationDate':           return sanitizeValue(lineData.ExpirationDate);
                case 'QuantiteUA':               return sanitizeValue(lineData.QuantiteUA);
                case 'RDExtended':               return sanitizeValue(lineData.RDExtended);
                case 'CodeDepotERPLine':         return sanitizeValue(lineData.CodeDepotERPLine);
                case 'RDIdControl':              return sanitizeValue(lineData.RDIdControl);
                case 'Reserve':                  return sanitizeValue(lineData.Reserve);
                case 'RDCertificatRevision':     return sanitizeValue(lineData.RDCertificatRevision);
                case 'RDCertificatDateReception':return sanitizeValue(lineData.RDCertificatDateReception);

                default:
                    return '';
            }
        }).join(separator);
    }

    // ---------- Helpers génériques ----------

    function markQueueStatus(queueId, statusValue, errorMsg) {
        try {
            var values = {
                custrecord_sync_status: statusValue
            };

            if (errorMsg) {
                var msg = String(errorMsg);
                values.custrecord_sync_error_msg = msg.substring(0, 1000);
            }

            record.submitFields({
                type: 'customrecord_cde_item_sync_queue',
                id: queueId,
                values: values,
                options: { enableSourcing: false, ignoreMandatoryFields: true }
            });
        } catch (e) {
            log.error('markQueueStatus ERROR', {
                queueId: queueId,
                statusValue: statusValue,
                error: e.message
            });
        }
    }

    function linkQueueToFile(queueId, fileId) {
        try {
            record.submitFields({
                type: 'customrecord_cde_item_sync_queue',
                id: queueId,
                values: {
                    custrecord_sync_file: fileId
                },
                options: { enableSourcing: false, ignoreMandatoryFields: true }
            });
        } catch (e) {
            log.error('linkQueueToFile ERROR', {
                queueId: queueId,
                fileId: fileId,
                error: e.message
            });
        }
    }

    function sanitizeValue(val) {
        if (val === null || val === undefined) return '';
        return String(val).replace(/[\r\n;]/g, ' ');
    }

    function formatDateYYYYMMDD(dateValue) {
        if (!dateValue) return '';
        try {
            var d = (dateValue instanceof Date) ? dateValue : new Date(dateValue);
            var yyyy = d.getFullYear();
            var MM = pad2(d.getMonth() + 1);
            var dd = pad2(d.getDate());
            return '' + yyyy + MM + dd;
        } catch (e) {
            return '';
        }
    }

    function pad2(n) {
        return (n < 10 ? '0' : '') + n;
    }

    function getOutputFolderId() {
        var script = runtime.getCurrentScript();
        return script.getParameter({ name: 'custscript_cde_wms_po_folder' });
    }

    return {
        getInputData: getInputData,
        map: map,
        reduce: reduce,
        summarize: summarize
    };
});
