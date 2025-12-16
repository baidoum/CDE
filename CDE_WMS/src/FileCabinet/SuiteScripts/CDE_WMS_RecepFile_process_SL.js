/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/search', 'N/record', 'N/log'], function (search, record, log) {

  var REC_LINE = 'customrecord_cde_wms_prep_line';

  // Adapter ces IDs à ta liste WMS Line Status
  var LINE_STATUS = {
    NEW:   '1',
    ERROR: '2',
    DONE:  '3'
  };

  // -----------------------------
  // Helpers
  // -----------------------------

  function toNumber(raw) {
    if (raw === null || raw === undefined || raw === '') return 0;
    var n = parseFloat(String(raw).replace(',', '.'));
    return isFinite(n) ? n : 0;
  }

  function markLine(prepLineId, status, msg) {
    var values = { custrecord_wms_line_status: status };
    if (msg) values.custrecord_wms_error_mess = String(msg).substring(0, 1000);

    record.submitFields({
      type: REC_LINE,
      id: prepLineId,
      values: values,
      options: { ignoreMandatoryFields: true }
    });
  }

  function groupLinesByItemAndLot(lines) {
    var grouped = {}; // key itemId|lot
    lines.forEach(function (l) {
      var key = String(l.itemId) + '|' + String(l.lotNumber || '');
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
    return grouped;
  }

  function clearInventoryAssignments(invDetailSubrec) {
    if (!invDetailSubrec) return;
    var count = invDetailSubrec.getLineCount({ sublistId: 'inventoryassignment' }) || 0;
    for (var i = count - 1; i >= 0; i--) {
      invDetailSubrec.removeLine({
        sublistId: 'inventoryassignment',
        line: i,
        ignoreRecalc: true
      });
    }
  }

  function isLotNumberedItem(itemId) {
    // Petit lookup pour savoir si l’article est lot-numbered (utile si le lot n’est pas fourni)
    // ⚠️ Pas obligatoire, mais permet de générer une erreur plus claire.
    var s = search.create({
      type: search.Type.ITEM,
      filters: [['internalid', 'anyof', itemId]],
      columns: ['islotitem']
    });
    var res = s.run().getRange({ start: 0, end: 1 });
    if (res && res.length) {
      var v = res[0].getValue({ name: 'islotitem' });
      return (v === true || v === 'T');
    }
    return false;
  }

  // -----------------------------
  // Suitelet
  // -----------------------------

  function onRequest(context) {
    var inboundId = context.request.parameters.inboundId;
    if (!inboundId) {
      context.response.write('Paramètre inboundId manquant.');
      return;
    }

    log.audit('WMS RECEIPT PROCESS - start', { inboundId: inboundId });

    // 1) Charger les lignes NEW pour ce inbound
    var linesByPo = {};
    var totalLines = 0;

    var lineSearch = search.create({
      type: REC_LINE,
      filters: [
        ['custrecordwms_prep_parent_file', 'anyof', inboundId],
        'AND',
        ['custrecord_wms_line_status', 'anyof', LINE_STATUS.NEW]
      ],
      columns: [
        'internalid',
        'custrecordwms_transaction',     // PO internalid
        'custrecord_wms_item',           // Item internalid (List/Record Item)
        'custrecord_wms_lot_number',     // Lot (texte)
        'custrecord_wms_quantity'        // Qty
      ]
    });

    lineSearch.run().each(function (res) {
      var prepLineId = res.getValue({ name: 'internalid' });
      var poId = res.getValue({ name: 'custrecordwms_transaction' });
      var itemId = res.getValue({ name: 'custrecord_wms_item' });
      var lotNumber = (res.getValue({ name: 'custrecord_wms_lot_number' }) || '').trim();
      var qty = toNumber(res.getValue({ name: 'custrecord_wms_quantity' }));

      if (!poId || !itemId || !qty) {
        var msg = 'Données insuffisantes (poId=' + poId + ', itemId=' + itemId + ', qty=' + qty + ')';
        log.error('WMS RECEIPT - missing data', { prepLineId: prepLineId, msg: msg });
        markLine(prepLineId, LINE_STATUS.ERROR, msg);
        return true;
      }

      if (!linesByPo[poId]) linesByPo[poId] = [];
      linesByPo[poId].push({ prepLineId: prepLineId, itemId: itemId, lotNumber: lotNumber, qty: qty });

      totalLines++;
      return true;
    });

    log.audit('WMS RECEIPT PROCESS - lines loaded', {
      inboundId: inboundId,
      poCount: Object.keys(linesByPo).length,
      totalLines: totalLines
    });

    if (!totalLines) {
      context.response.write('Aucune ligne NEW à traiter pour ce fichier (PO).');
      return;
    }

    var createdIRs = [];
    var errors = [];

    // 2) Pour chaque PO, transformer en Item Receipt
    Object.keys(linesByPo).forEach(function (poId) {
      var poLines = linesByPo[poId];

      try {
        log.audit('WMS RECEIPT - transform PO', { poId: poId, lines: poLines.length });

        // Charger PO pour location + tranid
        var poRec = record.load({ type: record.Type.PURCHASE_ORDER, id: poId });
        var poLocation = poRec.getValue({ fieldId: 'location' });
        var poTranId = poRec.getValue({ fieldId: 'tranid' });

        if (!poLocation) {
          throw new Error('Aucune location sur PO ' + poTranId + ' (id ' + poId + ')');
        }

        var irRec = record.transform({
          fromType: record.Type.PURCHASE_ORDER,
          fromId: poId,
          toType: record.Type.ITEM_RECEIPT,
          isDynamic: true
        });

        // forcer location si vide
        if (!irRec.getValue({ fieldId: 'location' })) {
          irRec.setValue({ fieldId: 'location', value: poLocation });
        }

        // Agrégation
        var grouped = groupLinesByItemAndLot(poLines);

        var irLineCount = irRec.getLineCount({ sublistId: 'item' });
        var touchedPrepLines = []; // à passer en DONE si succès

        // Traitement de chaque groupe
        Object.keys(grouped).forEach(function (key) {
          var g = grouped[key];

          // trouver la ligne IR correspondante à l'article
          var found = false;

          for (var i = 0; i < irLineCount; i++) {
            var currItemId = irRec.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });
            if (String(currItemId) !== String(g.itemId)) continue;

            found = true;

            irRec.selectLine({ sublistId: 'item', line: i });

            irRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'itemreceive', value: true });
            irRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: g.qty });

            // Lot handling
            var needsLot = isLotNumberedItem(g.itemId);
            if (needsLot && !g.lotNumber) {
              // lot requis mais absent => erreur de ligne
              var msgLotMissing = 'Lot requis mais non fourni (item ' + g.itemId + ')';
              log.error('WMS RECEIPT - lot missing', { poId: poId, itemId: g.itemId, msg: msgLotMissing });
              g.prepLines.forEach(function (pid) { markLine(pid, LINE_STATUS.ERROR, msgLotMissing); });
              // On n'ajoute pas ce groupe à l'IR
              irRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'itemreceive', value: false });
              irRec.commitLine({ sublistId: 'item' });
              return;
            }

            if (g.lotNumber) {
              var invDetail = irRec.getCurrentSublistSubrecord({ sublistId: 'item', fieldId: 'inventorydetail' });

              // Nettoyage des assignments existants pour éviter "inventory detail not configured"
              clearInventoryAssignments(invDetail);

              invDetail.selectNewLine({ sublistId: 'inventoryassignment' });

              // ✅ En réception: renseigner le lot par TEXT
              invDetail.setCurrentSublistText({
                sublistId: 'inventoryassignment',
                fieldId: 'receiptinventorynumber',
                text: g.lotNumber
              });

              invDetail.setCurrentSublistValue({
                sublistId: 'inventoryassignment',
                fieldId: 'quantity',
                value: g.qty
              });

              invDetail.commitLine({ sublistId: 'inventoryassignment' });
            }

            irRec.commitLine({ sublistId: 'item' });

            // on marque ces prep lines comme "touchées", à passer en DONE si save OK
            touchedPrepLines = touchedPrepLines.concat(g.prepLines);

            break;
          }

          if (!found) {
            var msgNotFound = 'Article non trouvé dans l’Item Receipt (itemId=' + g.itemId + ')';
            log.error('WMS RECEIPT - item not found in IR', { poId: poId, msg: msgNotFound });
            g.prepLines.forEach(function (pid) { markLine(pid, LINE_STATUS.ERROR, msgNotFound); });
          }
        });

        // Sauvegarde IR
        var irId = irRec.save({ enableSourcing: true, ignoreMandatoryFields: false });
        createdIRs.push(irId);

        // Passer les lignes touchées en DONE
        touchedPrepLines.forEach(function (pid) {
          // ⚠️ si déjà ERROR (cas lot missing/item not found), on ne l’écrase pas
          // => on relit le statut ? on évite pour rester simple.
          // Hypothèse: touchedPrepLines n’inclut que les groupes traités avec succès.
          markLine(pid, LINE_STATUS.DONE);
        });

        log.audit('WMS RECEIPT - IR created', { poId: poId, irId: irId });

      } catch (e) {
        log.error('WMS RECEIPT - error for PO', { poId: poId, error: e.message, stack: e.stack });
        errors.push({ poId: poId, message: e.message });
      }
    });

    var msg = 'Item Receipts créés : ' + (createdIRs.join(', ') || 'aucun') +
              '. Erreurs : ' + (errors.length ? JSON.stringify(errors) : 'aucune');

    log.audit('WMS RECEIPT PROCESS - end', { inboundId: inboundId, createdIRs: createdIRs, errors: errors });

    context.response.write(msg);
  }

  return { onRequest: onRequest };
});
