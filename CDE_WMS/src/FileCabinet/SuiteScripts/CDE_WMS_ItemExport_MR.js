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
  './CDE_WMS_FileHeader',
  './CDE_WMS_SFTPUtil' 

], (search, record, runtime, log, file, QueueUtil, FileHeader, SFTPUtil ) => {


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
          description4: itemRec.getValue({fieldId: 'purchasedescription'}),
          UOM: itemRec.getValue({fieldId: 'stockunit'}),
          cost: itemRec.getValue({fieldId: 'cost'}),
          manufacturer: itemRec.getValue({fieldId: 'manufacturer'}),
          
          
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
        markQueueStatus(queueId, QueueUtil.STATUS.ERROR, 'REDUCE load/build: ' + eLine.message);
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



var res = SFTPUtil.exportFileAndSend({
  fileName: fileName,
  fileContent: fileContent,
  folderId: folderId,
  queueIdsDone: queueIdsDone,
  queueIdsError: queueIdsError,
  logPrefix: 'ITEM EXPORT',          // ou 'SO EXPORT', 'PO EXPORT'
  fileType: file.Type.CSV            // ou PLAINTEXT si besoin
});

if (!res.success) {
  log.error('REDUCE - export error', res.message);
  return;
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



  function markQueueStatus(queueId, statusValue, errorMsg) {
      try {
          var values = {
              custrecord_sync_status: statusValue
          };

          // On nettoie et on tronque le message d'erreur si fourni
          if (errorMsg) {
              var msg = String(errorMsg);
              // 1000 caractères par ex., pour éviter les erreurs de longueur
              values.custrecord_sync_error_msg = msg.substring(0, 1000);
          }

          record.submitFields({
              type: 'customrecord_cde_item_sync_queue',
              id: queueId,
              values: values,
              options: {
                  enableSourcing: false,
                  ignoreMandatoryFields: true
              }
          });
      } catch (e) {
          log.error('markQueueStatus - ERROR', {
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

  function buildItemExportLine(p, headerCols, sep) {
    return headerCols.map((col) => {
      switch (col) {
        case 'Owner':
          return 'CDE';

        case 'ItemNumber':
          return sanitizeValue(p.itemid);

        case 'Description':
          return sanitizeValue(p.displayname);

        case 'Description4': 
          return (p.description4)

        case 'UsesLot':
          return (p.islotitem === true || p.islotitem === 'T' || p.islotitem === 1) ? '1' : '0';

        case 'UsesSerialNo':
          return p.usesSerial ? '1' : '0';

        case 'UsesDateFab':
          return '0';

        case 'UsesDLV':
          return '1';

        case 'UsesDateRec':
          return '0';

        case 'UsesDateLimiteVente':
          return '0';

        case 'SurPalette':
          return '0';

        case 'GereStock':
          return '1';

        case 'UnitOfMeasure':
          return sanitizeValue(p.UOM || '');

        case 'Status':
          // ex: actif par défaut
          return sanitizeValue(p.status || '1');

        case 'ReferenceERP':
          return sanitizeValue(p.itemid);

        case 'Type':
          return '';

        case 'Kit':
          return '0';

        case 'GestionERP':
          return '1';

        case 'VendorID':
          return p.manufacturer;

        case 'EachCount':
          return '1';

        case 'UnitCost':
          return p.cost;

        case 'cube':
          return '0';
        case 'Weight':
          return '0';
        case 'GrossWeight':
          return '0';
        case 'Largeur':
          return '0';
        case 'Hauteur':
          return '0';
        case 'SerialNoPicking':
          return '0';
        case 'Itm_SurPrepPourcent':
          return '0';
        case 'Itm_SurRecepPourcent':
          return '0';
        case 'UsesCarton':
          return '0';
        case 'Itm_SerialLuhn':
          return '0';
        case 'UsesPoidsVariable':
          return '0';
        case 'IUOM_Receiving':
          return '1';
        case 'IUOM_Picking':
          return '1';
        case 'IUOM_Inventory':
          return '1';
        case 'IUOM_RetourClient':
          return '1';
        case 'Contrat Date':
          return '0';
        case 'TolerancePoidsVariable':
          return '0';
        case 'Gerbable':
          return '1';
        case 'Type Palette':
          return '0';
        case 'Contrôle Classe':
          return '0';
        case 'PourcentContenu':
          return '0';
        case 'Libellé Unité de Mesure':
          return  sanitizeValue(p.UOM || '');;



        default:
          return '';
      }
    }).join(sep);
  }



    function getOutputFolderId() {
       var prefs = SFTPUtil.getWmsPrefs();
        var folderId = prefs.itemOutFolderId;

        if (!folderId) {
        log.error('REDUCE - no output folder', { pref: 'custscript_cde_wms_item_folder' });
     
        return;
        }

        return folderId;
    }

  return {
    getInputData,
    map,
    reduce,
    summarize
  };
});
