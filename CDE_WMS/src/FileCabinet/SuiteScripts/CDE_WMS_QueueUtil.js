/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search', 'N/log'], (record, search, log) => {

  const QUEUE_RECORD_TYPE = 'customrecord_cde_item_sync_queue';

  const FIELDS = {
    RECORD_TYPE: 'custrecord_sync_record_type',
    DATE_SYNC:   'custrecord_sync_item_date_sync',
    STATUS:      'custrecord_sync_status',
    FILE:        'custrecord_sync_file',
    RECORD_ID:   'custrecord_sync_record_id',
    TOPIC:       'custrecord_sync_topic',
    ITEM:        'custrecord_sync_item'
  };

  /**
   * ⚠️ À ADAPTER : mapping "label" → internalid de la liste CDE Status Sync WMS.
   * Exemple ci-dessous, remplace '1','2','3','4','5' par tes vrais IDs.
   */
  const STATUS_MAP = {
    Pending:    '1',
    Ready:      '2',
    InProgress: '3',
    Done:       '4',
    Error:      '5'
  };

  /**
   * ⚠️ À ADAPTER : mapping "label" → internalid de la liste CDE Sync Type.
   * Exemple: valeur "ITEM" dans ta liste = internalid 1 → '1'.
   */
  const TOPIC_MAP = {
    ITEM: '1'
  };

  const STATUS = {
    PENDING:     STATUS_MAP.Pending,
    READY:       STATUS_MAP.Ready,
    IN_PROGRESS: STATUS_MAP.InProgress,
    DONE:        STATUS_MAP.Done,
    ERROR:       STATUS_MAP.Error
  };

  const TOPIC = {
    ITEM: TOPIC_MAP.ITEM
  };

  function mapStatusLabel(statusId) {
    // tu passes 'Ready', 'Pending' depuis le UE → on traduit en internalid
    return STATUS_MAP[statusId] || statusId;
  }

  function mapTopicLabel(topic) {
    // tu passes 'ITEM' depuis le UE → on traduit en internalid
    return TOPIC_MAP[topic] || topic;
  }

  /**
   * Enqueue appelé par ton UE
   *
   * options = {
   *   topic: 'ITEM' ou internalid direct,
   *   recordType: rec.type,
   *   recordId: rec.id,
   *   statusId: 'Ready' / 'Pending' (label de la liste)
   * }
   */
  function enqueue(options) {
    if (!options || !options.topic || !options.recordId) {
      throw new Error('enqueue: topic et recordId sont obligatoires');
    }

    const topicValue  = mapTopicLabel(options.topic);
    const statusValue = options.statusId ? mapStatusLabel(options.statusId) : STATUS.PENDING;
    const recordType  = options.recordType || '';
    const recordId    = String(options.recordId);

    log.debug('Queue.enqueue - start', {
      topic: options.topic,
      topicValue,
      statusId: options.statusId,
      statusValue,
      recordType,
      recordId
    });

    const rec = record.create({
      type: QUEUE_RECORD_TYPE,
      isDynamic: true
    });

    rec.setValue({ fieldId: FIELDS.TOPIC,  value: topicValue });
    rec.setValue({ fieldId: FIELDS.RECORD_ID, value: recordId });

    if (recordType) {
      rec.setValue({ fieldId: FIELDS.RECORD_TYPE, value: recordType });
    }

    // si c’est un article, on remplit aussi le champ "Item"
    if (recordType && recordType.indexOf('item') !== -1) {
      const numericId = parseInt(recordId, 10);
      if (!isNaN(numericId)) {
        rec.setValue({ fieldId: FIELDS.ITEM, value: numericId });
      }
    }

    // date du jour
    rec.setValue({ fieldId: FIELDS.DATE_SYNC, value: new Date() });

    // statut initial
    rec.setValue({ fieldId: FIELDS.STATUS, value: statusValue });

    const queueId = rec.save({ enableSourcing: false, ignoreMandatoryFields: true });

    log.audit('Queue.enqueue - queued', {
      queueId,
      topicValue,
      statusValue
    });

    return queueId;
  }

  /**
   * findExisting : utilisé par ton UE pour retrouver une ligne existante
   *
   * options = {
   *   topic: 'ITEM' ou internalid,
   *   recordType: rec.type,
   *   recordId: rec.id
   * }
   */
  function findExisting(options) {
    const topicValue = mapTopicLabel(options.topic);
    const recordType = options.recordType || '';
    const recordId   = String(options.recordId);

    const s = search.create({
      type: QUEUE_RECORD_TYPE,
      filters: [
        [FIELDS.TOPIC, 'is', topicValue],
        'AND',
        [FIELDS.RECORD_TYPE, 'is', recordType],
        'AND',
        [FIELDS.RECORD_ID, 'is', recordId]
      ],
      columns: ['internalid']
    });

    const res = s.run().getRange({ start: 0, end: 1 });
    if (res && res.length) {
      const id = res[0].getValue({ name: 'internalid' });
      log.debug('Queue.findExisting - found', { id, topicValue, recordType, recordId });
      return id;
    }

    log.debug('Queue.findExisting - none', { topicValue, recordType, recordId });
    return null;
  }

  /**
   * updateStatus : utilisé par ton UE pour passer Ready / Pending
   *
   * @param {number|string} queueId
   * @param {string} statusId  → 'Ready', 'Pending', etc. (label)
   */
  function updateStatus(queueId, statusId) {
    const statusValue = mapStatusLabel(statusId);

    log.debug('Queue.updateStatus', {
      queueId,
      statusId,
      statusValue
    });

    record.submitFields({
      type: QUEUE_RECORD_TYPE,
      id: queueId,
      values: {
        [FIELDS.STATUS]: statusValue
      },
      options: {
        enableSourcing: false,
        ignoreMandatoryFields: true
      }
    });
  }

  return {
    enqueue,
    findExisting,
    updateStatus,
    STATUS,
    TOPIC,
    FIELDS
  };
});
