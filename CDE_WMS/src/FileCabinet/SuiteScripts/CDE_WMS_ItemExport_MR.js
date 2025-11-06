/**
 * @NApiVersion 2.1
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
], (search, record, runtime, log, file, QueueUtil, FileHeader) => {

    // Paramètres de nommage fichier export WMS
  const FILE_PREFIX = 'ART';        
  const OWNER_CODE  = 'XXXXXX';     

  function getInputData() {
    log.audit('ItemExportMR.getInputData', 'Start');

    return search.create({
      type: 'customrecord_cde_item_sync_queue',
      filters: [
        ['custrecord_sync_status', 'is', QueueUtil.STATUS.READY],
        'AND',
        ['custrecord_sync_topic', 'is', QueueUtil.TOPIC.ITEM]
      ],
      columns: [
        search.createColumn({ name: 'internalid' }),
        search.createColumn({ name: 'custrecord_sync_item' }),
        search.createColumn({ name: 'custrecord_sync_record_id' }),
        search.createColumn({ name: 'custrecord_sync_record_type' })
      ]
    });
  }

  function map(context) {
    try {
      const result = JSON.parse(context.value);
      const values = result.values || {};
      const queueId = result.id;

      const itemField   = values.custrecord_sync_item;
      const itemId      = itemField && itemField.value ? itemField.value : null;
      const recordIdTxt = values.custrecord_sync_record_id;
      const recordType  = values.custrecord_sync_record_type;

      // fallback: si pas d’item, on essaye avec recordIdTxt
      const finalItemId = itemId || recordIdTxt;

      log.debug('MAP queue line', {
        queueId,
        itemId,
        recordIdTxt,
        recordType
      });

      record.submitFields({
        type: 'customrecord_cde_item_sync_queue',
        id: queueId,
        values: {
          custrecord_sync_status: QueueUtil.STATUS.IN_PROGRESS
        },
        options: { enableSourcing: false, ignoreMandatoryFields: true }
      });

      if (!finalItemId) {
        log.error('MAP - no itemId', { queueId });
        markQueueStatus(queueId, QueueUtil.STATUS.ERROR);
        return;
      }

      context.write({
        key: QueueUtil.TOPIC.ITEM,
        value: JSON.stringify({
          queueId,
          itemId: finalItemId,
          recordType
        })
      });

    } catch (e) {
      log.error('MAP ERROR', { error: e.message, stack: e.stack, raw: context.value });
    }
  }

  function reduce(context) {
    const topic = context.key; // ITEM
    log.audit('REDUCE start', { topic });

    let headerCols;
    try {
      headerCols = FileHeader.getHeaderColumns(topic);
    } catch (eHeader) {
      log.error('REDUCE - header error', { topic, error: eHeader.message });
      return;
    }

    const sep = ';';
    const lines = [headerCols.join(sep)];

    const queueIdsDone = [];
    const queueIdsError = [];

    context.values.forEach((value) => {
      let obj;
      try {
        obj = JSON.parse(value);
      } catch (eParse) {
        log.error('REDUCE - parse value error', { raw: value, error: eParse.message });
        return;
      }

      const { queueId, itemId, recordType } = obj;

      try {
        const recType = recordType || record.Type.INVENTORY_ITEM; // fallback si jamais
        const itemRec = record.load({ type: recType, id: itemId });

        const payload = {
          id: itemId,
          itemid: itemRec.getValue({ fieldId: 'itemid' }),
          displayname: itemRec.getValue({ fieldId: 'displayname' }),
          islotitem: itemRec.getValue({ fieldId: 'islotitem' }),
          type: itemRec.type,
          // à enrichir plus tard avec tous les champs de mapping vers Pixi
        };

        const line = buildItemExportLine(payload, headerCols, sep);
        lines.push(line);
        queueIdsDone.push(queueId);

      } catch (eLine) {
        log.error('REDUCE - item/load error', {
          queueId,
          itemId,
          recordType,
          error: eLine.message,
          stack: eLine.stack
        });
        queueIdsError.push(queueId);
      }
    });

    if (lines.length <= 1) {
      log.audit('REDUCE - no data to export', { topic });
      return;
    }

    const fileContent = lines.join('\n');
    var fileName = FileHeader.buildFileName(topic);

    const folderId = getOutputFolderId();
    if (!folderId) {
      log.error('REDUCE - no output folder', { param: 'custscript_cde_wms_item_folder' });
      queueIdsDone.concat(queueIdsError).forEach((id) => markQueueStatus(id, QueueUtil.STATUS.ERROR));
      return;
    }

    try {
      const fileObj = file.create({
        name: fileName,
        fileType: file.Type.CSV,
        contents: fileContent,
        folder: parseInt(folderId, 10)
      });

      const fileId = fileObj.save();

      log.audit('REDUCE - file created', {
        fileId,
        fileName,
        folderId,
        lines: lines.length - 1
      });

      queueIdsDone.forEach((id) => markQueueStatus(id, QueueUtil.STATUS.DONE));
      queueIdsError.forEach((id) => markQueueStatus(id, QueueUtil.STATUS.ERROR));

    } catch (eFile) {
      log.error('REDUCE - file save error', { error: eFile.message, stack: eFile.stack });
      queueIdsDone.concat(queueIdsError).forEach((id) => markQueueStatus(id, QueueUtil.STATUS.ERROR));
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

    summary.mapSummary.errors.iterator().each((key, error) => {
      log.error('SUMMARIZE map error', { key, error });
      return true;
    });

    summary.reduceSummary.errors.iterator().each((key, error) => {
      log.error('SUMMARIZE reduce error', { key, error });
      return true;
    });

    log.audit('SUMMARIZE end', 'OK');
  }

  // ---------- Helpers ----------

  function markQueueStatus(queueId, statusValue) {
    try {
      record.submitFields({
        type: 'customrecord_cde_item_sync_queue',
        id: queueId,
        values: {
          custrecord_sync_status: statusValue
        },
        options: { enableSourcing: false, ignoreMandatoryFields: true }
      });
    } catch (e) {
      log.error('markQueueStatus ERROR', { queueId, statusValue, error: e.message });
    }
  }

  function sanitizeValue(val) {
    if (val === null || val === undefined) return '';
    return String(val).replace(/[\r\n;]/g, ' ');
  }

  function buildItemExportLine(p, headerCols, sep) {
    return headerCols.map((col) => {
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
          // ex: actif par défaut
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


  function getOutputFolderId() {
    const script = runtime.getCurrentScript();
    return script.getParameter({ name: 'custscript_cde_wms_item_folder' });
  }

  return {
    getInputData,
    map,
    reduce,
    summarize
  };
});
