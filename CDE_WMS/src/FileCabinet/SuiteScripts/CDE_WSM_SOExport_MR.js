/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 *
 * Export des Sales Orders vers le WMS.
 * - Lit la file customrecord_cde_item_sync_queue (topic = SALES_ORDER, status = READY)
 * - Charge chaque Sales Order
 * - Génère une ligne par ligne de commande, et si possible une ligne par numéro de lot
 * - Crée un fichier texte (.txt) dans le File Cabinet
 * - Lie le fichier à chaque enregistrement de queue traité (champ custrecord_sync_file)
 * - Met à jour les statuts (READY → IN_PROGRESS → DONE / ERROR)
 */
define([
    'N/search',
    'N/record',
    'N/runtime',
    'N/log',
    'N/file',
    './CDE_WMS_QueueUtil',
    './CDE_WMS_FileHeader'
], function (search, record, runtime, log, file, QueueUtil, FileHeader) {

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

            context.write({
                key: QueueUtil.TOPIC.SALES_ORDER,
                value: JSON.stringify({
                    queueId: queueId,
                    soId: finalSoId,
                    recordType: recordType || record.Type.SALES_ORDER
                })
            });

        } catch (e) {
            log.error('MAP ERROR', { error: e.message, stack: e.stack, raw: context.value });
        }
    }

    function reduce(context) {
        var topic = context.key;
        log.audit('REDUCE start', { topic: topic });

        var headerCols;
        try {
            headerCols = FileHeader.getHeaderColumns(topic);
        } catch (eHeader) {
            log.error('REDUCE - header error', { topic: topic, error: eHeader.message });
            return;
        }

        var sep = ';';
        var lines = [headerCols.join(sep)];

        var queueIdsDone = [];
        var queueIdsError = [];

        context.values.forEach(function (value) {
            var obj;
            try {
                obj = JSON.parse(value);
            } catch (eParse) {
                log.error('REDUCE - parse value error', { raw: value, error: eParse.message });
                return;
            }

            var queueId   = obj.queueId;
            var soId      = obj.soId;
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
            log.audit('REDUCE - no data to export', { topic: topic });
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

        try {
            var fileObj = file.create({
                name: fileName,
                fileType: file.Type.PLAINTEXT,
                contents: fileContent,
                folder: parseInt(folderId, 10)
            });

            var fileId = fileObj.save();

            log.audit('REDUCE - file created', {
                fileId: fileId,
                fileName: fileName,
                folderId: folderId,
                lines: lines.length - 1
            });

            // Lier le fichier + statut DONE
            queueIdsDone.forEach(function (id) {
                markQueueStatus(id, QueueUtil.STATUS.DONE, null);
                linkQueueToFile(id, fileId);
            });

            // Statut ERROR pour ceux en erreur
            queueIdsError.forEach(function (id) {
                // le message d'erreur a déjà été enregistré au cas par cas
                // on ne remet pas d'override ici
                if (!id) return;
                // Si tu veux forcer un message générique, décommente :
                // markQueueStatus(id, QueueUtil.STATUS.ERROR, 'Error during SO export (file creation step)');
            });

        } catch (eFile) {
            log.error('REDUCE - file save error', { error: eFile.message, stack: eFile.stack });
            var errMsgFile = 'File save: ' + eFile.message;
            queueIdsDone.concat(queueIdsError).forEach(function (id) {
                markQueueStatus(id, QueueUtil.STATUS.ERROR, errMsgFile);
            });
        }
    }

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

    // ---------- Helpers ----------

    function buildLinesForSalesOrder(soRec, headerCols, sep) {
        var lines = [];

        // ----- Données d'entête (répétées sur chaque ligne) -----
        var headerData = {
            // TODO: adapter ces champs selon ton modèle NetSuite exact
            Owner:          soRec.getValue({ fieldId: 'custbody_cde_owner' }) || '',         // po_Owner
            Site:           soRec.getText({ fieldId: 'location' }) || '',                    // Site
            OrderNumber:    soRec.getValue({ fieldId: 'tranid' }) || '',                     // OrderNumber
            OrderDate:      formatDateYYYYMMDD(soRec.getValue({ fieldId: 'trandate' })),     // OrderDate
            DueDate:        formatDateYYYYMMDD(soRec.getValue({ fieldId: 'duedate' })),      // DueDate

            CustomerBillTo: soRec.getValue({ fieldId: 'entity' }) || '',                     // code client facturé (ID)
            CBTCompanyName: soRec.getText({ fieldId: 'entity' }) || '',                      // nom client facturé
            CBTAddress1:    soRec.getValue({ fieldId: 'billaddr1' }) || '',
            CBTAddress2:    soRec.getValue({ fieldId: 'billaddr2' }) || '',
            CBTAddress3:    soRec.getValue({ fieldId: 'billaddr3' }) || '',
            CBTZipCode:     soRec.getValue({ fieldId: 'billzip' }) || '',
            CBTCity:        soRec.getValue({ fieldId: 'billcity' }) || '',
            CBTState:       soRec.getValue({ fieldId: 'billstate' }) || '',
            CBTCounty:      soRec.getValue({ fieldId: 'billcountry' }) || '',
            CBTContact:     soRec.getValue({ fieldId: 'billattention' }) || '',
            CBTVoicePhone:  soRec.getValue({ fieldId: 'billphone' }) || '',
            CBTEmail:       soRec.getValue({ fieldId: 'custbody_cde_billto_email' }) || '',

            CustomerShipTo: soRec.getValue({ fieldId: 'shipto' }) || '',                     // code adresse livrée (à adapter)
            CSTCompanyName: soRec.getValue({ fieldId: 'shipaddressee' }) || '',
            CSTAddress1:    soRec.getValue({ fieldId: 'shipaddr1' }) || '',
            CSTAddress2:    soRec.getValue({ fieldId: 'shipaddr2' }) || '',
            CSTAddress3:    soRec.getValue({ fieldId: 'shipaddr3' }) || '',
            CSTZipCode:     soRec.getValue({ fieldId: 'shipzip' }) || '',
            CSTCity:        soRec.getValue({ fieldId: 'shipcity' }) || '',
            CSTState:       soRec.getValue({ fieldId: 'shipstate' }) || '',
            CSTCountry:     soRec.getValue({ fieldId: 'shipcountry' }) || '',
            CSTContact:     soRec.getValue({ fieldId: 'shipattention' }) || '',
            CSTVoicePhone:  soRec.getValue({ fieldId: 'shipphone' }) || '',
            CSTEmail:       soRec.getValue({ fieldId: 'custbody_cde_shipto_email' }) || '',

            Carrier:        soRec.getText({ fieldId: 'shipcarrier' }) || '',                // selon ton paramétrage
            ShippingMethod: soRec.getText({ fieldId: 'shipmethod' }) || '',
            Commentaire:    soRec.getValue({ fieldId: 'memo' }) || ''                       // commentaire SO
        };

        // ----- Parcours des lignes d'articles -----
        var lineCount = soRec.getLineCount({ sublistId: 'item' });
        for (var i = 0; i < lineCount; i++) {
            var itemId = soRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'item',
                line: i
            });

            if (!itemId) {
                continue;
            }

            var itemType = soRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'itemtype',
                line: i
            });

            var lineNumber = soRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'line',
                line: i
            });

            var itemDisplay = soRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'item_display',
                line: i
            });

            var quantity = soRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'quantity',
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

            // Kit / composant : mapping simple (à raffiner si besoin)
            var kitFlag = '0';
            if (itemType === 'Kit') {
                kitFlag = '2'; // ligne kit
            }
            // si un jour tu veux détecter les composants de kit → passer à '1'

            // Tentative de lire le subrecord d'inventaire pour éclater par lot
            var invDetail;
            try {
                invDetail = soRec.getSublistSubrecord({
                    sublistId: 'item',
                    fieldId: 'inventorydetail',
                    line: i
                });
            } catch (e) {
                invDetail = null;
            }

            if (invDetail) {
                var assCount = invDetail.getLineCount({ sublistId: 'inventoryassignment' });
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
                        ItemNumber:        itemDisplay,
                        OrderedQuantity:   lotQty,
                        Comment:           lineMemo,
                        Enseigne:          headerData.Owner, // souvent = code propriétaire
                        KitouComposant:    kitFlag,
                        KitItemNumber:     '',     // à renseigner si besoin
                        KitLineNumber:     '',     // à renseigner si besoin
                        NbParKit:          '',     // à renseigner si besoin
                        PointRelais:       '',     // à mapper si tu l'as
                        Zone:              soRec.getValue({ fieldId: 'custbody_cde_zone_erp' }) || '',
                        UnitOfMeasure:     uom,
                        LotNumber:         lotNumber,   // Numéro de Lot
                        UV:                uom,
                        LineNumberERP:     lineNumber   // ou un autre field custom si besoin
                    };

                    var csvLine = buildSOExportLine(headerCols, headerData, lineData, sep);
                    lines.push(csvLine);
                }
            } else {
                // Pas de détail de lot : une seule ligne par ligne de commande
                var lineDataSingle = {
                    LineNumber:        lineNumber,
                    ItemNumber:        itemDisplay,
                    OrderedQuantity:   quantity,
                    Comment:           lineMemo,
                    Enseigne:          headerData.Owner,
                    KitouComposant:    kitFlag,
                    KitItemNumber:     '',
                    KitLineNumber:     '',
                    NbParKit:          '',
                    PointRelais:       '',
                    Zone:              soRec.getValue({ fieldId: 'custbody_cde_zone_erp' }) || '',
                    UnitOfMeasure:     uom,
                    LotNumber:         '',
                    UV:                uom,
                    LineNumberERP:     lineNumber
                };

                var csvLineSingle = buildSOExportLine(headerCols, headerData, lineDataSingle, sep);
                lines.push(csvLineSingle);
            }
        }

        return lines;
    }

    /**
     * Construit une ligne CSV en combinant :
     * - les données d'entête (headerData)
     * - les données de ligne (lineData)
     * selon l'ordre des colonnes défini dans headerCols.
     */
    function buildSOExportLine(headerCols, headerData, lineData, sep) {
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

                // TODO: compléter progressivement le mapping pour toutes les autres colonnes (BF...EP)
                default:
                    return '';
            }
        }).join(sep);
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
        return script.getParameter({ name: 'custscript_cde_wms_so_folder' });
    }

    return {
        getInputData: getInputData,
        map: map,
        reduce: reduce,
        summarize: summarize
    };
});
