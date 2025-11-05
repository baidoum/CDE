/**
 * @NApiVersion 2.x
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
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
        log.audit('CDE_WMS_ItemExport_MR.getInputData', 'Début');

        var queueSearch = search.create({
            type: 'customrecord_cde_item_sync_queue',
            filters: [
                ['custrecord_sync_status', 'is', QueueUtil.STATUS.PENDING],
                'AND',
                ['custrecord_sync_topic', 'is', QueueUtil.TOPIC.ITEM]
            ],
            columns: [
                search.createColumn({ name: 'internalid' }),
                search.createColumn({ name: 'custrecord_sync_item' }),
                search.createColumn({ name: 'custrecord_sync_record_id' }),
                search.createColumn({ name: 'custrecord_sync_topic' }),
                search.createColumn({ name: 'custrecord_sync_status' })
            ]
        });

        return queueSearch;
    }

    function map(context) {
        try {
            var result = JSON.parse(context.value); // search.Result.toJSON()
            var values = result.values || {};
            var queueId = result.id;

            var itemField = values['custrecord_sync_item'];
            var itemId = itemField && itemField.value ? itemField.value : null;
            var recordIdText = values['custrecord_sync_record_id'];

            log.debug('MAP - queue line', {
                queueId: queueId,
                itemId: itemId,
                recordIdText: recordIdText
            });

            // Marquer IN_PROGRESS
            try {
                record.submitFields({
                    type: 'customrecord_cde_item_sync_queue',
                    id: queueId,
                    values: {
                        custrecord_sync_status: QueueUtil.STATUS.IN_PROGRESS
                    },
                    options: {
                        enableSourcing: false,
                        ignoreMandatoryFields: true
                    }
                });
            } catch (eStatus) {
                log.error('MAP - erreur maj statut IN_PROGRESS', {
                    queueId: queueId,
                    error: eStatus.message
                });
            }

            if (!itemId) {
                log.error('MAP - pas d’item sur la ligne de queue', { queueId: queueId });
                markQueueStatus(queueId, QueueUtil.STATUS.ERROR);
                return;
            }

            context.write({
                key: QueueUtil.TOPIC.ITEM,
                value: JSON.stringify({
                    queueId: queueId,
                    itemId: itemId
                })
            });

        } catch (e) {
            log.error('MAP - ERROR', {
                error: e.message,
                stack: e.stack,
                rawValue: context.value
            });
        }
    }

    function reduce(context) {
        var topic = context.key; // 'ITEM'
        log.audit('REDUCE - start', { topic: topic });

        var headerCols;
        try {
            headerCols = FileHeader.getHeaderColumns(topic);
        } catch (eHeader) {
            log.error('REDUCE - erreur getHeaderColumns', {
                topic: topic,
                error: eHeader.message
            });
            return;
        }

        var sep = ';';
        var lines = [];
        lines.push(headerCols.join(sep));

        var queueIdsDone = [];
        var queueIdsError = [];

        context.values.forEach(function (value) {
            var obj;
            try {
                obj = JSON.parse(value);
            } catch (eParseValue) {
                log.error('REDUCE - parse value ERROR', {
                    rawValue: value,
                    error: eParseValue.message
                });
                return;
            }

            var queueId = obj.queueId;
            var itemId  = obj.itemId;

            try {
                // 🔎 On charge l’article pour construire la ligne
                var itemRec = record.load({
                    type: record.Type.INVENTORY_ITEM, // ⚠️ à adapter si tu as plusieurs types
                    id: itemId
                });

                var p = {
                    id: itemId,
                    itemid: itemRec.getValue({ fieldId: 'itemid' }),
                    displayname: itemRec.getValue({ fieldId: 'displayname' }),
                    islotitem: itemRec.getValue({ fieldId: 'islotitem' }),
                    type: itemRec.type,
                    // ici tu pourras ajouter les champs NetSuite qui mappent vers tes colonnes WMS
                    // ex:
                    // uom: itemRec.getText({ fieldId: 'saleunit' }),
                    // status: itemRec.getValue({ fieldId: 'isinactive' }) ? '0' : '1',
                    // etc.
                };

                var line = buildItemExportLine(p, headerCols, sep);
                lines.push(line);
                queueIdsDone.push(queueId);

            } catch (eLine) {
                log.error('REDUCE - buildItemExportLine/load item ERROR', {
                    queueId: queueId,
                    itemId: itemId,
                    error: eLine.message,
                    stack: eLine.stack
                });
                queueIdsError.push(queueId);
            }
        });

        if (lines.length <= 1) {
            log.audit('REDUCE - nothing to export', { topic: topic });
            return;
        }

        var fileContent = lines.join('\n');

        var fileNamePrefix = FileHeader.getFileNamePrefix(topic);
        var timestamp = formatTimestamp(new Date());
        var fileName = fileNamePrefix + timestamp + '.csv';

        var folderId = getOutputFolderId();
        if (!folderId) {
            log.error('REDUCE - aucun dossier de sortie paramétré', {
                param: 'custscript_cde_wms_item_folder'
            });
            queueIdsDone.concat(queueIdsError).forEach(function (id) {
                markQueueStatus(id, QueueUtil.STATUS.ERROR);
            });
            return;
        }

        try {
            var fileObj = file.create({
                name: fileName,
                fileType: file.Type.CSV,
                contents: fileContent,
                folder: parseInt(folderId, 10)
            });

            var fileId = fileObj.save();

            log.audit('REDUCE - file created in File Cabinet', {
                fileId: fileId,
                fileName: fileName,
                folderId: folderId,
                lines: lines.length - 1
            });

            // tu peux, si tu veux, stocker le fileId dans le champ custrecord_sync_file
            queueIdsDone.forEach(function (id) {
                markQueueStatus(id, QueueUtil.STATUS.DONE);
            });

            queueIdsError.forEach(function (id) {
                markQueueStatus(id, QueueUtil.STATUS.ERROR);
            });

        } catch (eFile) {
            log.error('REDUCE - file save ERROR', {
                error: eFile.message,
                stack: eFile.stack
            });

            queueIdsDone.concat(queueIdsError).forEach(function (id) {
                markQueueStatus(id, QueueUtil.STATUS.ERROR);
            });
        }
    }

    function summarize(summary) {
        log.audit('SUMMARIZE - usage', {
            usage: summary.usage,
            concurrency: summary.concurrency,
            yields: summary.yields
        });

        if (summary.inputSummary.error) {
            log.error('SUMMARIZE - input error', summary.inputSummary.error);
        }

        summary.mapSummary.errors.iterator().each(function (key, error) {
            log.error('SUMMARIZE - map error', {
                key: key,
                error: error
            });
            return true;
        });

        summary.reduceSummary.errors.iterator().each(function (key, error) {
            log.error('SUMMARIZE - reduce error', {
                key: key,
                error: error
            });
            return true;
        });

        log.audit('SUMMARIZE - end', 'Terminé');
    }

    // --------------------
    // Helpers
    // --------------------

    function markQueueStatus(queueId, status) {
        try {
            record.submitFields({
                type: 'customrecord_cde_item_sync_queue',
                id: queueId,
                values: {
                    custrecord_sync_status: status
                },
                options: {
                    enableSourcing: false,
                    ignoreMandatoryFields: true
                }
            });
        } catch (e) {
            log.error('markQueueStatus - ERROR', {
                queueId: queueId,
                status: status,
                error: e.message
            });
        }
    }

    function sanitizeValue(val) {
        if (val === null || val === undefined) return '';
        var s = String(val);
        return s.replace(/[\r\n;]/g, ' ');
    }

    function buildItemExportLine(p, headerCols, sep) {
        return headerCols.map(function (col) {
            switch (col) {
                case 'Owner':
                    return sanitizeValue(p.owner);

                case 'ItemNumber':
                    return sanitizeValue(p.itemid);

                case 'Description':
                    return sanitizeValue(p.displayname);

                case 'UsesLot':
                    return (p.islotitem === true || p.islotitem === 'T' || p.islotitem === 1) ? '1' : '0';

                case 'UsesSerialNo':
                    return p.usesSerial ? '1' : '0';

                case 'UnitOfMeasure':
                    return sanitizeValue(p.uom);

                case 'Status':
                    // exemple : actif = 1, inactif = 0
                    return sanitizeValue(p.status || '1');

                case 'ReferenceERP':
                    return sanitizeValue(p.id);

                case 'Type':
                    return sanitizeValue(p.type || '');

                default:
                    return '';
            }
        }).join(sep);
    }

    function formatTimestamp(d) {
        var yyyy = d.getFullYear();
        var MM = pad2(d.getMonth() + 1);
        var dd = pad2(d.getDate());
        var hh = pad2(d.getHours());
        var mm = pad2(d.getMinutes());
        var ss = pad2(d.getSeconds());
        return '' + yyyy + MM + dd + '_' + hh + mm + ss;
    }

    function pad2(n) {
        return (n < 10 ? '0' : '') + n;
    }

    function getOutputFolderId() {
        var script = runtime.getCurrentScript();
        var folderId = script.getParameter({
            name: 'custscript_cde_wms_item_folder'
        });
        return folderId;
    }

    return {
        getInputData: getInputData,
        map: map,
        reduce: reduce,
        summarize: summarize
    };
});
