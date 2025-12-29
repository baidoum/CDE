/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 *
 * Export des Sales Orders vers le WMS.
 * - Lit la file customrecord_cde_item_sync_queue (topic = SALES_ORDER, status = READY)
 * - Charge chaque Sales Order
 * - Génère une ligne par ligne de commande, et si possible une ligne par numéro de lot
 * - Crée un fichier texte (.csv) dans le File Cabinet
 * - Envoie le fichier sur le SFTP
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
        log.audit('SOExportMR.getInputData', 'Start');

        return search.create({
            type: 'customrecord_cde_item_sync_queue',
            filters: [
                ['custrecord_sync_status', 'is', QueueUtil.STATUS.READY],
                'AND',
                ['custrecord_sync_topic', 'is', QueueUtil.TOPIC.SALES_ORDER]
            ],
            columns: [
                search.createColumn({ name: 'internalid' }),
                search.createColumn({ name: 'custrecord_cde_sync_sales_order' }), // lien direct SO
                search.createColumn({ name: 'custrecord_sync_record_id' }),
                search.createColumn({ name: 'custrecord_sync_record_type' })
            ]
        });
    }

    // ---------------- map ----------------
    // CHANGEMENT : key = queueId (1 reduce par queue / par SO)

    function map(context) {
        try {
            var result = JSON.parse(context.value);
            var values = result.values || {};
            var queueId = result.id;

            var soField     = values.custrecord_cde_sync_sales_order;
            var soId        = soField && soField.value ? soField.value : null;
            var recordIdTxt = values.custrecord_sync_record_id;
            var recordType  = values.custrecord_sync_record_type;

            var finalSoId = soId || recordIdTxt;

            log.debug('MAP queue line', {
                queueId: queueId,
                soId: soId,
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

            if (!finalSoId) {
                log.error('MAP - no Sales Order id', { queueId: queueId });
                markQueueStatus(queueId, QueueUtil.STATUS.ERROR, 'MAP: missing Sales Order id');
                return;
            }

            // IMPORTANT : clé = queueId pour avoir 1 reduce par queue
            context.write({
                key: queueId,
                value: JSON.stringify({
                    queueId: queueId,
                    soId: finalSoId,
                    recordType: recordType || record.Type.SALES_ORDER,
                    topic: QueueUtil.TOPIC.SALES_ORDER
                })
            });

        } catch (e) {
            log.error('MAP ERROR', { error: e.message, stack: e.stack, raw: context.value });
        }
    }

    // ---------------- reduce ----------------
    // 1 reduce = 1 queueId = 1 SO = 1 fichier

    function reduce(context) {
        var queueKey = context.key;
        log.audit('REDUCE start', { queueKey: queueKey });

        // Pour ce MR, le topic est toujours SALES_ORDER
        var topic = QueueUtil.TOPIC.SALES_ORDER;

        var headerCols;
        try {
            headerCols = FileHeader.getHeaderColumns(topic);
        } catch (eHeader) {
            log.error('REDUCE - header error', { topic: topic, error: eHeader.message });
            // si on n'a pas de header, on met la/les queues en erreur
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

        var queueIdsDone = [];
        var queueIdsError = [];

        // Normalement on n’a qu’une seule value par queueKey,
        // mais on loop au cas où.
        context.values.forEach(function (value) {
            var obj;
            try {
                obj = JSON.parse(value);
            } catch (eParse) {
                log.error('REDUCE - parse value error', { raw: value, error: eParse.message });
                return;
            }

            var queueId    = obj.queueId;
            var soId       = obj.soId;
            var recordType = obj.recordType || record.Type.SALES_ORDER;

            try {
                var soRec = record.load({
                    type: recordType,
                    id: soId
                });

                var soLines = buildLinesForSalesOrder(soRec, headerCols, sep);
                lines = lines.concat(soLines);
                queueIdsDone.push(queueId);

            } catch (eLine) {
                log.error('REDUCE - SO/load error', {
                    queueId: queueId,
                    soId: soId,
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
        var fileName = FileHeader.buildFileName(topic);

        var folderId = getOutputFolderId();
        if (!folderId) {
            log.error('REDUCE - no output folder', { param: 'custscript_cde_wms_so_folder' });
            var errMsg = 'No output folder configured';
            queueIdsDone.concat(queueIdsError).forEach(function (id) {
                markQueueStatus(id, QueueUtil.STATUS.ERROR, errMsg);
            });
            return;
        }

        // Centralisation création fichier + SFTP
        var res = SFTPUtil.exportFileAndSend({
            fileName: fileName,
            fileContent: fileContent,
            folderId: folderId,
            queueIdsDone: queueIdsDone,
            queueIdsError: queueIdsError,
            logPrefix: 'SO EXPORT',
            fileType: file.Type.CSV
        });

        if (!res.success) {
            log.error('REDUCE - export error', res.message);
            // SFTPUtil s'occupe déjà des statuts, on s'arrête là
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

    // ---------------- Helpers métiers ----------------

    function buildLinesForSalesOrder(soRec, headerCols, sep) {
        var lines = [];
        var soId = soRec.id || soRec.getValue({ fieldId: 'tranid' });
        var separator = sep || ';';

        var lineCount = soRec.getLineCount({ sublistId: 'item' });
        log.debug('SO Lines', {
            soId: soId,
            lineCount: lineCount
        });

        var addr = QueueUtil.getAddressInfos(soRec.id);

        // ----- Données d'entête (répétées sur chaque ligne) -----
        var headerData = {
            Owner:          'CDE',
            Site:           'STOCK',
            OrderNumber:    soRec.getValue({ fieldId: 'tranid' }) || '',
            OrderDate:      formatDateYYYYMMDD(soRec.getValue({ fieldId: 'trandate' })),
            DueDate:        formatDateYYYYMMDD(soRec.getValue({ fieldId: 'shipdate' })) || formatDateYYYYMMDD(soRec.getValue({ fieldId: 'trandate' })) ,
            Commentaire:    soRec.getValue({ fieldId: 'memo' }) || '',
            CommentaireLogistique:    soRec.getValue({ fieldId: 'custbody_cde_logistic_comment' }) || '',

            CustomerBillTo: soRec.getText({ fieldId: 'entity' }) || '',
            CBTCompanyName: addr.billaddressee || '',
            CBTAddress1:    addr.billaddress1  || '',
            CBTAddress2:    addr.billaddress2  || '',
            CBTAddress3:    '',
            CBTZipCode:     addr.billzip       || '',
            CBTCity:        addr.billcity      || '',
            CBTState:       '',
            CBTCounty:      addr.billcountry   || '',
            CBTContact:     '',
            CBTVoicePhone:  '',
            CBTEmail:       soRec.getValue({ fieldId: 'custbody_cde_billto_email' }) || '',

            CustomerShipTo: soRec.getText({ fieldId: 'entity' }) || '',
            CSTCompanyName: addr.shipaddressee || '',
            CSTAddress1:    addr.shipaddress1  || '',
            CSTAddress2:    addr.shipaddress2  || '',
            CSTAddress3:    '',
            CSTZipCode:     addr.shipzip       || '',
            CSTCity:        addr.shipcity      || '',
            CSTState:       '',
            CSTCountry:     addr.shipcountry   || '',
            CSTContact:     addr.attention     || '',
            CSTVoicePhone:  addr.phone         || '',
            CSTEmail:       soRec.getValue({ fieldId: 'custbody_cde_shipto_email' }) || '',

            Carrier:        soRec.getText({ fieldId: 'shipcarrier' }) || '',
            ShippingMethod: soRec.getText({ fieldId: 'shipmethod' }) || ''
        };

        for (var i = 0; i < lineCount; i++) {
            var itemId = soRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'item',
                line: i
            });
            var itemType = soRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'itemtype',
                line: i
            });
            var qty = soRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'quantity',
                line: i
            });

            log.debug('SO line analysis', {
                soId: soId,
                line: i,
                itemId: itemId,
                itemType: itemType,
                quantity: qty
            });

            if (!itemId) continue;

            var itemCode = QueueUtil.getItemCode(itemId);

            var lineNumber = soRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'line',
                line: i
            });

            var lineMemo = soRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'description',
                line: i
            });

            var uom = soRec.getSublistText({
                sublistId: 'item',
                fieldId: 'unit',
                line: i
            });

            var lineComment = soRec.getSublistText({
                sublistId: 'item',
                fieldId: 'custcol_cde_logistic_comment',
                line: i
            });

            var kitFlag = '0';
            if (itemType === 'Kit') {
                kitFlag = '2';
            }

            var invDetail = null;
            var assCount  = 0;
            try {
                invDetail = soRec.getSublistSubrecord({
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

            log.debug('SO line inventory detail', {
                soId: soId,
                line: i,
                hasInvDetail: !!invDetail,
                assCount: assCount
            });

            if (invDetail && assCount > 0) {
                // CAS 1 : avec lots → une ligne par lot
                for (var j = 0; j < assCount; j++) {
                    var lotNumber = invDetail.getSublistText({
                        sublistId: 'inventoryassignment',
                        fieldId: 'issueinventorynumber',
                        line: j
                    });

                    var lotQty = invDetail.getSublistValue({
                        sublistId: 'inventoryassignment',
                        fieldId: 'quantity',
                        line: j
                    });

                    var lineData = {
                        LineNumber:        lineNumber,
                        ItemNumber:        itemCode,
                        OrderedQuantity:   lotQty,
                        Comment:           lineMemo,
                        Enseigne:          headerData.Owner,
                        KitouComposant:    kitFlag,
                        KitItemNumber:     '',
                        KitLineNumber:     '',
                        NbParkit:          '',
                        PointRelais:       '',
                        Zone:              soRec.getValue({ fieldId: 'custbody_cde_zone_erp' }) || '',
                        UnitOfMeasure:     uom,
                        LotNumber:         lotNumber,
                        UV:                uom,
                        LineNumberERP:     lineNumber,
                        Comment:           lineComment
                    };

                    var csvLine = buildSOExportLine(headerCols, headerData, lineData, separator);
                    lines.push(csvLine);
                }
            } else {
                // CAS 2 : pas de lots → une ligne par ligne de commande
                var lineDataSingle = {
                    LineNumber:        lineNumber,
                    ItemNumber:        itemCode,
                    OrderedQuantity:   qty,
                    Comment:           lineMemo,
                    Enseigne:          headerData.Owner,
                    KitouComposant:    kitFlag,
                    KitItemNumber:     '',
                    KitLineNumber:     '',
                    NbParkit:          '',
                    PointRelais:       '',
                    Zone:              soRec.getValue({ fieldId: 'custbody_cde_zone_erp' }) || '',
                    UnitOfMeasure:     uom,
                    LotNumber:         '',
                    UV:                uom,
                    LineNumberERP:     lineNumber,
                    Comment:           lineComment
                };

                var csvLineSingle = buildSOExportLine(headerCols, headerData, lineDataSingle, separator);
                lines.push(csvLineSingle);
            }
        }

        log.debug('SO export lines built', {
            soId: soId,
            exportedLines: lines.length
        });

        return lines;
    }

    function buildSOExportLine(headerCols, headerData, lineData, sep) {
        var separator = sep || ';';

        return headerCols.map(function (col) {
            switch (col) {
                case 'Owner':                return sanitizeValue(headerData.Owner);
                case 'Site':                 return sanitizeValue(headerData.Site);
                case 'OrderNumber':          return sanitizeValue(headerData.OrderNumber);
                case 'OrderDate':            return sanitizeValue(headerData.OrderDate);
                case 'DueDate':              return sanitizeValue(headerData.DueDate);

                case 'CustomerBillTo':       return sanitizeValue(headerData.CustomerBillTo);
                case 'CBTCompanyName':       return sanitizeValue(headerData.CBTCompanyName);
                case 'CBTAddress1':          return sanitizeValue(headerData.CBTAddress1);
                case 'CBTAddress2':          return sanitizeValue(headerData.CBTAddress2);
                case 'CBTAddress3':          return sanitizeValue(headerData.CBTAddress3);
                case 'CBTZipCode':           return sanitizeValue(headerData.CBTZipCode);
                case 'CBTCity':              return sanitizeValue(headerData.CBTCity);
                case 'CBTState':             return sanitizeValue(headerData.CBTState);
                case 'CBTCountry':           return sanitizeValue(headerData.CBTCounty);
                case 'CBTContact':           return sanitizeValue(headerData.CBTContact);
                case 'CBTVoicePhone':        return sanitizeValue(headerData.CBTVoicePhone);
                case 'CBTEmail':             return sanitizeValue(headerData.CBTEmail);

                case 'CustomerShipTo':       return sanitizeValue(headerData.CustomerShipTo);
                case 'CSTCompanyName':       return sanitizeValue(headerData.CSTCompanyName);
                case 'CSTAddress1':          return sanitizeValue(headerData.CSTAddress1);
                case 'CSTAddress2':          return sanitizeValue(headerData.CSTAddress2);
                case 'CSTAddress3':          return sanitizeValue(headerData.CSTAddress3);
                case 'CSTZipCode':           return sanitizeValue(headerData.CSTZipCode);
                case 'CSTCity':              return sanitizeValue(headerData.CSTCity);
                case 'CSTState':             return sanitizeValue(headerData.CSTState);
                case 'CSTCountry':           return sanitizeValue(headerData.CSTCountry);
                case 'CSTContact':           return sanitizeValue(headerData.CSTContact);
                case 'CSTVoicePhone':        return sanitizeValue(headerData.CSTVoicePhone);
                case 'CSTEmail':             return sanitizeValue(headerData.CSTEmail);

                case 'Carrier':              return sanitizeValue(headerData.Carrier);
                case 'ShippingMethod':       return sanitizeValue(headerData.ShippingMethod);
                case 'Commentaire':          return sanitizeValue(headerData.Commentaire);

                case 'LineNumber':           return sanitizeValue(lineData.LineNumber);
                case 'ItemNumber':           return sanitizeValue(lineData.ItemNumber);
                case 'OrderedQuantity':      return sanitizeValue(lineData.OrderedQuantity);
                case 'Comment':              return sanitizeValue(lineData.Comment);
                case 'Enseigne':             return sanitizeValue(lineData.Enseigne);

                case 'KitouComposant':       return sanitizeValue(lineData.KitouComposant);
                case 'KitItemNumber':        return sanitizeValue(lineData.KitItemNumber);
                case 'KitLineNumber':        return sanitizeValue(lineData.KitLineNumber);
                case 'NbParkit':             return sanitizeValue(lineData.NbParKit);
                case 'PointRelais':          return sanitizeValue(lineData.PointRelais);

                case 'Zone':                 return sanitizeValue(lineData.Zone);
                case 'UnitOfMeasure':        return sanitizeValue(lineData.UnitOfMeasure);
                case 'LotNumber':            return sanitizeValue(lineData.LotNumber);
                case 'UV':                   return sanitizeValue(lineData.UV);
                case 'LineNumberERP':        return sanitizeValue(lineData.LineNumberERP);

                default:
                    return '';
            }
        }).join(separator);
    }

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
       var prefs = SFTPUtil.getWmsPrefs();
        var folderId = prefs.soOutFolderId;

        if (!folderId) {
        log.error('REDUCE - no output folder', { pref: 'custscript_cde_wms_so_folder' });
     
        return;
        }

        return folderId;
    }


    return {
        getInputData: getInputData,
        map: map,
        reduce: reduce,
        summarize: summarize
    };
});
